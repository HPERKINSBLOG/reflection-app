import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { createHostedPreviewWorker } from '../../src/worker/local-live.ts';
import { createWorker } from '../../src/worker/index.ts';
import { PatternPreview, PatternSavedIdentity } from '../../src/contracts/astrology.ts';
import { canonicalJson, sha256Json } from '../../src/domain/json.ts';
import { CALCULATION_IDENTITY } from '../../src/domain/astrology/calculate.ts';
import approved from '../../artifacts/your-pattern/qualification/approved-pattern-release.json';
import trustedKey from '../../artifacts/your-pattern/qualification/content-review-public.jwk.json';
import parity from '../fixtures/astrology-node-parity.json';
import { ReadingClient, readingAccount, readingBindings } from '../fixtures/reading-client.ts';
import { IDENTITY_SECRETS } from '../fixtures/identity.ts';
import { clearDatabase } from '../fixtures/database.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));

async function installRelease() {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO pattern_content_releases(hash,state,release_json,created_at) VALUES(?,'active',?,1)",
    ).bind(approved.releaseHash, canonicalJson(approved)),
    env.DB.prepare(
      'INSERT INTO pattern_state(id,content_hash,revision,enabled,calculation_hash,updated_at) VALUES(1,?,1,1,?,1)',
    ).bind(approved.releaseHash, await sha256Json(CALCULATION_IDENTITY)),
  ]);
}

async function setup() {
  const bindings = {
    ...readingBindings,
    IDENTITY_MODE: 'live-preview',
    READING_MODE: 'live-preview',
    IDENTITY_ORIGIN: 'https://reflection-preview.example.com',
    IDENTITY_SECRETS: JSON.stringify({ ...IDENTITY_SECRETS, environment: 'live-preview' }),
    PATTERN_PREVIEW_ENABLED: 'true',
    PATTERN_PREVIEW_RELEASE_HASH: approved.releaseHash,
    PATTERN_PREVIEW_REVIEW_KEY: JSON.stringify(trustedKey),
  };
  let calls = 0;
  const worker = createHostedPreviewWorker(async () => {
    calls++;
    throw new Error('Pattern must not call an AI provider');
  });
  const client = new ReadingClient(bindings, worker);
  await readingAccount(true, false, client);
  const health = async () =>
    (await worker.fetch(new Request(`${bindings.IDENTITY_ORIGIN}/health`), bindings)).json();
  return { worker, client, bindings, health, calls: () => calls };
}

test('approved dev-preview Pattern calculates, saves and reopens exact content with AI off', async () => {
  await installRelease();
  const f = await setup();
  expect(await f.health()).toMatchObject({ mode: 'live-preview', patternReady: true });
  const profile = await f.client.request(
    '/astrology/profile',
    { birth: parity[0]!.input.birth, expectedRevision: 0, confirmedRetention: true },
    { method: 'PUT' },
  );
  expect(profile.status).toBe(200);
  const response = await f.client.request('/astrology/pattern');
  expect(response.status).toBe(200);
  const preview = PatternPreview.parse(await response.json());
  const chapter = preview.chapters.find((c) => c.status === 'available');
  expect(chapter?.status === 'available' && chapter.chapter.editorialStatus).toBe('human_approved');
  const saved = await f.client.request('/astrology/pattern/saves', {
    chapterId: 'self',
    expectedProfileRevision: preview.profileRevision,
    basisHash: preview.basisHash,
    releaseHash: preview.releaseHash,
    reflection: { text: 'My own preview reflection.', stance: 'unspecified' },
  });
  expect(saved.status).toBe(201);
  const identity = PatternSavedIdentity.parse(await saved.json());
  const reading = await f.client.request(`/readings/${identity.editionId}`);
  expect(reading.status).toBe(200);
  expect(await reading.json()).toMatchObject({
    kind: 'astrology.pattern.accepted.v1',
    chapter: { editorialStatus: 'human_approved', releaseHash: approved.releaseHash },
  });
  expect(f.calls()).toBe(0);
});

test.each(['missing', 'stopped', 'withdrawn', 'wrong-calculation', 'changed-release'])(
  'dev-preview Pattern stays unavailable for %s registry state without repairing it',
  async (failure) => {
    if (failure !== 'missing') await installRelease();
    if (failure === 'stopped') await env.DB.prepare('UPDATE pattern_state SET enabled=0').run();
    if (failure === 'withdrawn')
      await env.DB.prepare(
        "UPDATE pattern_content_releases SET state='withdrawn',withdrawn_at=1",
      ).run();
    if (failure === 'wrong-calculation')
      await env.DB.prepare('UPDATE pattern_state SET calculation_hash=?')
        .bind('0'.repeat(64))
        .run();
    if (failure === 'changed-release') {
      const changed = structuredClone(approved);
      changed.review.reviewer = 'Untrusted replacement';
      await env.DB.prepare('UPDATE pattern_content_releases SET release_json=?')
        .bind(canonicalJson(changed))
        .run();
    }
    const f = await setup();
    expect(await f.health()).toMatchObject({ mode: 'live-preview', patternReady: false });
    expect((await f.client.request('/astrology/pattern')).status).toBe(410);
    expect((await f.client.request('/me')).status).toBe(200);
    if (failure === 'missing')
      expect(await env.DB.prepare('SELECT count(*) n FROM pattern_state').first('n')).toBe(0);
    if (failure === 'stopped')
      expect(await env.DB.prepare('SELECT enabled FROM pattern_state').first('enabled')).toBe(0);
    if (failure === 'withdrawn')
      expect(
        await env.DB.prepare('SELECT state FROM pattern_content_releases').first('state'),
      ).toBe('withdrawn');
    expect(f.calls()).toBe(0);
  },
);

test.each(['disabled', 'hash', 'key', 'malformed-key'])(
  'invalid %s dev-preview configuration leaves ordinary account access operational',
  async (failure) => {
    await installRelease();
    const f = await setup();
    if (failure === 'disabled') f.bindings.PATTERN_PREVIEW_ENABLED = 'false';
    if (failure === 'hash') f.bindings.PATTERN_PREVIEW_RELEASE_HASH = '0'.repeat(64);
    if (failure === 'key') {
      const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
      f.bindings.PATTERN_PREVIEW_REVIEW_KEY = JSON.stringify(
        await crypto.subtle.exportKey('jwk', pair.publicKey),
      );
    }
    if (failure === 'malformed-key') f.bindings.PATTERN_PREVIEW_REVIEW_KEY = '{';
    expect(await f.health()).toMatchObject({ mode: 'live-preview', patternReady: false });
    expect((await f.client.request('/astrology/pattern')).status).toBe(410);
    expect((await f.client.request('/me')).status).toBe(200);
    expect(f.calls()).toBe(0);
  },
);

test('the generic Worker cannot enable approved Pattern from preview environment flags alone', async () => {
  await installRelease();
  const f = await setup();
  const client = new ReadingClient(f.bindings, createWorker());
  client.cookies = f.client.cookies;
  client.csrf = f.client.csrf;
  expect((await client.request('/astrology/pattern')).status).toBe(410);
  const response = await createWorker().fetch(
    new Request(`${f.bindings.IDENTITY_ORIGIN}/health`),
    f.bindings,
  );
  expect(await response.json()).not.toMatchObject({ patternReady: true });
  expect(f.calls()).toBe(0);
});

test('committed dev-preview saves replay after withdrawal without reactivating publication', async () => {
  await installRelease();
  const f = await setup();
  await f.client.request(
    '/astrology/profile',
    { birth: parity[0]!.input.birth, expectedRevision: 0, confirmedRetention: true },
    { method: 'PUT' },
  );
  const preview = PatternPreview.parse(await (await f.client.request('/astrology/pattern')).json());
  const input = {
    chapterId: 'self',
    expectedProfileRevision: preview.profileRevision,
    basisHash: preview.basisHash,
    releaseHash: preview.releaseHash,
    reflection: null,
  };
  const key = crypto.randomUUID();
  const saved = await f.client.request('/astrology/pattern/saves', input, { key });
  expect(saved.status).toBe(201);
  const original = await saved.json();
  await env.DB.prepare('UPDATE pattern_state SET enabled=0').run();
  await env.DB.prepare(
    "UPDATE pattern_content_releases SET state='withdrawn',withdrawn_at=1",
  ).run();
  const replay = await f.client.request('/astrology/pattern/saves', input, { key });
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(original);
  expect((await f.client.request('/astrology/pattern/saves', input)).status).toBe(410);
  expect(await f.health()).toMatchObject({ patternReady: false });
  expect(await env.DB.prepare('SELECT enabled FROM pattern_state').first('enabled')).toBe(0);
  expect(f.calls()).toBe(0);
});
