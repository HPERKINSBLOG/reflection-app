import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas, SelectedFragment } from '../../src/contracts/index.ts';
import { IdentityCrypto } from '../../src/worker/identity/crypto.ts';
import { RecordCrypto } from '../../src/worker/readings/crypto.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { IDENTITY_SECRETS } from '../fixtures/identity.ts';
import { readingAccount } from '../fixtures/reading-client.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));

test('export pages include historical eligibility and the exact encrypted excerpt of a request', async () => {
  const { client, kit } = await readingAccount();
  const source = await client.create('Which part of my routine do I want to revisit?');
  const destination = await client.create('What has changed this week?');
  const owner = kit.subjectId;
  const grant = crypto.randomUUID();
  const crypt = new RecordCrypto(env.DB, new IdentityCrypto(IDENTITY_SECRETS));
  const fragment = SelectedFragment.parse({
    ordinal: 0,
    grantId: grant,
    grantRevision: 1,
    sourceKind: 'edition',
    sourceId: source.reading.editionId,
    sourceRevision: 1,
    start: 0,
    end: 3,
    text: 'A🌱B',
    textHash: 'b'.repeat(64),
    availability: 'retained',
    authorship: 'generated',
  });
  const request = destination.started.requestId;
  const sealed = await crypt.seal(
    {
      ownerId: owner,
      table: 'generation_context',
      column: 'fragment_enc',
      recordId: `${request}:0`,
      aadRevision: 1,
    },
    fragment,
    1,
  );
  const grantRow = env.DB.prepare(
    'INSERT INTO context_grants(id,owner_id,edition_id,state,created_at,updated_at) VALUES(?,?,?,?,1,1)',
  );
  await env.DB.batch([
    ...Array.from({ length: 100 }, () =>
      grantRow.bind(crypto.randomUUID(), owner, source.reading.editionId, 'revoked'),
    ),
    grantRow.bind(grant, owner, source.reading.editionId, 'allowed'),
    env.DB.prepare('INSERT INTO generation_context VALUES(?,?,0,?,1,?,?,1)').bind(
      request,
      owner,
      grant,
      sealed,
      fragment.textHash,
    ),
    env.DB.prepare('UPDATE generation_requests SET context_count=1 WHERE id=?').bind(request),
  ]);
  const ticket = apiSchemas.ExportTicket.parse(await (await client.request('/exports', {})).json());
  const first = await client.request(`/exports/${ticket.id}`);
  expect(first.status, await first.clone().text()).toBe(200);
  const page = apiSchemas.ExportPage.parse(await first.json());
  expect(page.records).toHaveLength(100);
  expect(page.nextCursor).toBeTruthy();
  const rest = apiSchemas.ExportPage.parse(
    await (
      await client.request(`/exports/${ticket.id}?cursor=${encodeURIComponent(page.nextCursor!)}`)
    ).json(),
  );
  const all = [...page.records, ...rest.records];
  const grants = all.filter((record) => record.kind === 'grant');
  expect(new Set(grants.map((item) => item.originalId)).size).toBe(101);
  expect(grants.find((item) => item.originalId === grant)?.value).toMatchObject({
    state: 'allowed',
    source: { kind: 'edition', editionId: source.reading.editionId },
  });
  const receipt = all.find(
    (item) => item.kind === 'generation_receipt' && item.originalId === request,
  );
  expect(receipt?.value).toMatchObject({ selectedFragments: [fragment] });

  // An unavailable context snapshot cannot justify exporting a retained transmission.
  await env.DB.prepare('UPDATE generation_context SET fragment_enc=NULL WHERE request_id=?')
    .bind(request)
    .run();
  const head = apiSchemas.ExportPage.parse(
    await (await client.request(`/exports/${ticket.id}`)).json(),
  );
  const current = head.records.find(
    (record) => record.kind === 'generation_receipt' && record.originalId === request,
  );
  expect(current?.value).toMatchObject({
    transmission: null,
    reproduction: 'redacted',
    selectedFragments: [{ availability: 'erased', grantId: grant }],
  });
});

test('a pending erasure fences both earlier tickets and a newly requested export', async () => {
  const { client, kit } = await readingAccount();
  const before = apiSchemas.ExportTicket.parse(await (await client.request('/exports', {})).json());
  const erase = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO deletion_jobs(id,owner_id,scope,target_hmac,state,ledger_key,next_run_at,created_at) VALUES(?,?,'context_copy',?,'ledger_pending',?,1,1)",
  )
    .bind(erase, kit.subjectId, 'a'.repeat(64), erase)
    .run();
  expect((await client.request(`/exports/${before.id}`)).status).toBe(409);
  const next = await client.request('/exports', {});
  expect(next.status).toBe(409);
});
