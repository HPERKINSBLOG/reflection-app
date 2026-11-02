import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas, ImportedReading } from '../../src/contracts/index.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { fixture, note } from '../fixtures/revisits.ts';
import { readingAccount } from '../fixtures/reading-client.ts';
import { ContextRecords } from '../../src/worker/readings/context.ts';
import { Reflections } from '../../src/worker/readings/reflections.ts';
import { gate } from '../fixtures/barrier.ts';
import { RecordBase } from '../../src/worker/readings/base.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));

async function grant(
  f: Awaited<ReturnType<typeof fixture>>,
  source: unknown,
  key = crypto.randomUUID(),
) {
  const response = await f.client.request('/context-grants', { source }, { key });
  expect(response.status, await response.clone().text()).toBe(201);
  return apiSchemas.Grant.parse(await response.json());
}
const preview = async (f: Awaited<ReturnType<typeof fixture>>, id: string, length: number) => ({
  clientIntentId: crypto.randomUUID(),
  question: 'What can I reconsider?',
  parentEditionId: null,
  permissionRevision: (await f.client.me()).permission.revision,
  items: [{ grantId: id, grantRevision: 1, start: 0, end: length }],
});

test('grant creation is idempotent, owner-scoped and available with AI off without dispatch', async () => {
  const f = await fixture(),
    n = await note(f, 'Owned note');
  await f.client.permission(false);
  const source = { kind: 'revisit_revision', revisitId: n.id, revision: 1 },
    key = crypto.randomUUID();
  const before = await env.DB.prepare('SELECT count(*) AS n FROM provider_dispatches').first('n');
  const first = await grant(f, source, key);
  expect(await grant(f, source, key)).toEqual(first);
  const page = await f.client.request('/context-grants?limit=1');
  expect(page.headers.get('Cache-Control')).toBe('private, no-store');
  expect(apiSchemas.GrantPage.parse(await page.json()).items).toEqual([first]);
  const other = await readingAccount();
  expect((await other.client.request('/context-grants', { source })).status).toBe(404);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM provider_dispatches').first('n')).toBe(
    before,
  );
});

test('preview resolves complete code-point text and binds question, intent, permission and ranges', async () => {
  const f = await fixture(),
    n = await note(f, '😀'.repeat(1200));
  const g = await grant(f, { kind: 'revisit_revision', revisitId: n.id, revision: 1 });
  const input = await preview(f, g.id, 1200);
  const response = await f.client.request('/context-preview', input);
  expect(response.status, await response.clone().text()).toBe(200);
  const result = apiSchemas.ContextPreview.parse(await response.json());
  expect(result.items[0]?.text).toBe('😀'.repeat(1200));
  expect(result.items[0]?.authorship).toBe('user');
  expect(result.items[0]?.selection).toMatchObject(input.items[0]!);
  const again = apiSchemas.ContextPreview.parse(
    await (await f.client.request('/context-preview', input)).json(),
  );
  expect(again).toEqual(result);
  for (const changed of [
    { question: 'A different question' },
    { clientIntentId: crypto.randomUUID() },
    { items: [{ ...input.items[0]!, end: 1199 }] },
  ]) {
    const next = apiSchemas.ContextPreview.parse(
      await (await f.client.request('/context-preview', { ...input, ...changed })).json(),
    );
    expect(next.acknowledgementHash).not.toBe(result.acknowledgementHash);
  }
  expect(
    (
      await f.client.request('/context-preview', {
        ...input,
        permissionRevision: input.permissionRevision + 1,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await f.client.request('/context-preview', {
        ...input,
        items: [{ ...input.items[0]!, end: 1201 }],
      })
    ).status,
  ).toBe(422);
});

test('preview rejects duplicate exact sources under different grants and never shares stance', async () => {
  const f = await fixture(),
    n = await note(f, 'A precise sentence.');
  const source = { kind: 'revisit_revision', revisitId: n.id, revision: 1 };
  const a = await grant(f, source),
    b = await grant(f, source);
  const input = await preview(f, a.id, 19);
  const response = await f.client.request('/context-preview', {
    ...input,
    items: [...input.items, { ...input.items[0]!, grantId: b.id }],
  });
  expect(response.status).toBe(422);
  const single = apiSchemas.ContextPreview.parse(
    await (await f.client.request('/context-preview', input)).json(),
  );
  expect(single.items[0]?.text).toBe('A precise sentence.');
  expect(JSON.stringify(single)).not.toContain('unspecified');
});

test('revocation preserves sources and exports, is idempotent, and invalidates old previews', async () => {
  const f = await fixture(),
    n = await note(f, 'Keep my original.');
  const g = await grant(f, { kind: 'revisit_revision', revisitId: n.id, revision: 1 });
  const input = await preview(f, g.id, 17),
    key = crypto.randomUUID();
  const revoke = () =>
    f.client.request(`/context-grants/${g.id}`, {}, { method: 'DELETE', revision: 1, key });
  const response = await revoke();
  expect(response.status).toBe(200);
  expect(apiSchemas.Grant.parse(await response.json())).toMatchObject({
    state: 'revoked',
    revision: 2,
  });
  expect((await revoke()).status).toBe(200);
  expect(
    (await f.client.request(`/context-grants/${g.id}`, {}, { method: 'DELETE', revision: 1 }))
      .status,
  ).toBe(409);
  expect((await f.client.request('/context-preview', input)).status).toBe(409);
  expect((await f.notes.read(f.session, n.id)).note).toBe('Keep my original.');
  const ticket = await f.exports.create(f.session, crypto.randomUUID());
  const page = await f.exports.page(f.session, ticket.id, null);
  expect(page.records.find((r) => r.kind === 'grant')?.value).toMatchObject({
    id: g.id,
    state: 'revoked',
  });
});

test('editing a granted note invalidates its revision while keeping historical text exportable', async () => {
  const f = await fixture(),
    n = await note(f, 'Original note');
  const g = await grant(f, { kind: 'revisit_revision', revisitId: n.id, revision: 1 });
  const input = await preview(f, g.id, 13);
  await f.notes.update(f.session, n.id, 1, crypto.randomUUID(), {
    note: 'Changed note',
    stance: 'disagree',
  });
  expect((await f.client.request('/context-preview', input)).status).toBe(409);
  expect(
    (
      await f.client.request('/context-grants', {
        source: { kind: 'revisit_revision', revisitId: n.id, revision: 1 },
      })
    ).status,
  ).toBe(409);
  expect((await f.notes.read(f.session, n.id, 1)).note).toBe('Original note');
  expect(await grant(f, { kind: 'revisit_revision', revisitId: n.id, revision: 2 })).toMatchObject({
    state: 'allowed',
  });
});

test('context mutations enforce CSRF and previews conceal cross-owner grant IDs before decryption', async () => {
  const f = await fixture(),
    n = await note(f, 'Only mine'),
    other = await readingAccount();
  const source = { kind: 'revisit_revision', revisitId: n.id, revision: 1 };
  expect(
    (
      await f.client.request(
        '/context-grants',
        { source },
        { headers: { 'X-CSRF-Token': 'wrong' } },
      )
    ).status,
  ).toBe(403);
  const g = await grant(f, source),
    input = await preview(f, g.id, 9);
  input.permissionRevision = (await other.client.me()).permission.revision;
  expect((await other.client.request('/context-preview', input)).status).toBe(404);
});

test('server acknowledgement rejects forged hashes and changed request fields', async () => {
  const f = await fixture(),
    n = await note(f, '😀é text'),
    context = new ContextRecords(f.base);
  const g = await context.grant(f.session, crypto.randomUUID(), {
    kind: 'revisit_revision',
    revisitId: n.id,
    revision: 1,
  });
  const input = await preview(f, g.id, 3),
    result = await context.preview(f.session, input);
  expect(result.items[0]?.text).toBe('😀é');
  const start = {
    clientIntentId: input.clientIntentId,
    question: input.question,
    parentEditionId: null,
    permissionRevision: input.permissionRevision,
    languageConfirmed: 'en' as const,
    reversals: true,
    selection: result.items.map((i) => i.selection),
    contextAcknowledgement: result.acknowledgementHash,
  };
  expect((await context.acknowledge(f.session, start)).fragments[0]?.text).toBe('😀é');
  for (const changed of [
    { contextAcknowledgement: '0'.repeat(64) },
    { question: 'Changed question' },
    { parentEditionId: f.reading.editionId },
    { permissionRevision: start.permissionRevision + 1 },
    { selection: [{ ...start.selection[0]!, start: 1 }] },
    { selection: [{ ...start.selection[0]!, end: 2 }] },
    { selection: [{ ...start.selection[0]!, grantRevision: 2 }] },
    { selection: [{ ...start.selection[0]!, previewHash: '0'.repeat(64) }] },
    { clientIntentId: crypto.randomUUID() },
  ])
    await expect(context.acknowledge(f.session, { ...start, ...changed })).rejects.toMatchObject({
      status: 409,
    });
});

test('native edition and current reflection previews exclude unrelated fields and reject superseded reflection revisions', async () => {
  const f = await fixture(),
    context = new ContextRecords(f.base),
    reflections = new Reflections(f.base);
  const first = await reflections.write(
    f.session,
    f.started.sessionId,
    { editionId: f.reading.editionId, text: 'Exact reflection', stance: 'disagree' },
    crypto.randomUUID(),
  );
  const g = await context.grant(f.session, crypto.randomUUID(), {
    kind: 'reflection_revision',
    reflectionId: first.id,
    revision: 1,
  });
  const value = await context.preview(f.session, await preview(f, g.id, 16));
  expect(value.items[0]?.text).toBe('Exact reflection');
  expect(JSON.stringify(value)).not.toContain('disagree');
  await reflections.update(f.session, first.id, 1, crypto.randomUUID(), {
    editionId: f.reading.editionId,
    text: 'Replacement',
    stance: 'unspecified',
  });
  await expect(context.preview(f.session, await preview(f, g.id, 16))).rejects.toMatchObject({
    status: 409,
  });
  const editionGrant = await context.grant(f.session, crypto.randomUUID(), {
    kind: 'edition',
    editionId: f.reading.editionId,
  });
  const editionPreview = await context.preview(f.session, await preview(f, editionGrant.id, 10));
  expect(editionPreview.items[0]?.authorship).toBe('generated');
  expect(JSON.stringify(editionPreview)).not.toContain(
    f.reading.kind === 'tarot.accepted.v1' || f.reading.kind === 'tarot.accepted.v2'
      ? f.reading.question
      : 'impossible',
  );
});

test('source withdrawal after decryption prevents releasing a preview even without an account revision change', async () => {
  const f = await fixture(),
    ordinary = new ContextRecords(f.base);
  const g = await ordinary.grant(f.session, crypto.randomUUID(), {
    kind: 'edition',
    editionId: f.reading.editionId,
  });
  let checks = 0;
  const held = gate((sql) => sql.some((s) => s.includes('data_revision=?')) && ++checks === 2);
  const pending = new ContextRecords(new RecordBase(held.db, f.base.identity)).preview(
    f.session,
    await preview(f, g.id, 10),
  );
  const result = pending.catch((e) => e);
  await held.ready;
  try {
    await env.DB.prepare(
      "UPDATE reading_editions SET status='withdrawn',invalidated_at=1 WHERE id=?",
    )
      .bind(f.reading.editionId)
      .run();
  } finally {
    held.release();
  }
  await expect(result).resolves.toBeInstanceOf(Error);
});

test('grant retries share one durable row and bounded cursors cannot cross accounts or filters', async () => {
  const f = await fixture(),
    context = new ContextRecords(f.base),
    n = await note(f);
  const source = { kind: 'revisit_revision' as const, revisitId: n.id, revision: 1 },
    key = crypto.randomUUID();
  const results = await Promise.all([
    context.grant(f.session, key, source),
    context.grant(f.session, key, source),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM context_grants').first('n')).toBe(1);
  await expect(
    context.grant(f.session, key, { kind: 'edition', editionId: f.reading.editionId }),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  await context.grant(f.session, crypto.randomUUID(), source);
  const page = await context.list(f.session, null, 1, null);
  expect(page.items).toHaveLength(1);
  expect(page.nextCursor).not.toBeNull();
  const next = await context.list(f.session, page.nextCursor, 1, null);
  expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
  expect(next.nextCursor).toBeNull();
  await expect(
    context.list(f.session, page.nextCursor, 1, f.reading.editionId),
  ).rejects.toMatchObject({ status: 400 });
  expect((await f.client.request('/context-grants?limit=51')).status).toBe(400);
});

test('aggregate excerpt limit rejects the whole preview without truncation or provider work', async () => {
  const f = await fixture(),
    context = new ContextRecords(f.base),
    ids = [];
  for (let i = 0; i < 3; i++) {
    const n = await note(f, '😀'.repeat(1200));
    ids.push(
      (
        await context.grant(f.session, crypto.randomUUID(), {
          kind: 'revisit_revision',
          revisitId: n.id,
          revision: 1,
        })
      ).id,
    );
  }
  await f.client.permission(false);
  const input = await preview(f, ids[0]!, 1200);
  input.items = ids.map((grantId) => ({ grantId, grantRevision: 1, start: 0, end: 1000 }));
  const before = await env.DB.prepare('SELECT count(*) AS n FROM provider_dispatches').first('n');
  const storage = await env.DB.prepare('SELECT storage_bytes FROM accounts WHERE id=?')
    .bind(f.session.subjectId)
    .first('storage_bytes');
  expect((await context.preview(f.session, input)).items.map((i) => [...i.text].length)).toEqual([
    1000, 1000, 1000,
  ]);
  await expect(
    context.preview(f.session, { ...input, items: input.items.map((i) => ({ ...i, end: 1001 })) }),
  ).rejects.toMatchObject({ status: 422 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM provider_dispatches').first('n')).toBe(
    before,
  );
  expect(
    await env.DB.prepare('SELECT storage_bytes FROM accounts WHERE id=?')
      .bind(f.session.subjectId)
      .first('storage_bytes'),
  ).toBe(storage);
});

test('cross-owner checks precede decryption even when the source ciphertext is corrupt', async () => {
  const f = await fixture(),
    n = await note(f),
    context = new ContextRecords(f.base),
    other = await readingAccount();
  const source = { kind: 'revisit_revision' as const, revisitId: n.id, revision: 1 },
    g = await context.grant(f.session, crypto.randomUUID(), source);
  await env.DB.prepare("UPDATE revisits SET note_enc='corrupt' WHERE id=?").bind(n.id).run();
  expect((await other.client.request('/context-grants', { source })).status).toBe(404);
  const input = await preview(f, g.id, 3);
  input.permissionRevision = (await other.client.me()).permission.revision;
  expect((await other.client.request('/context-preview', input)).status).toBe(404);
  await expect(context.preview(f.session, input)).rejects.toMatchObject({
    code: 'KEY_UNAVAILABLE',
  });
  expect(
    (
      await f.client.request('/context-grants', {
        source: { ...source, revisitId: crypto.randomUUID() },
      })
    ).status,
  ).toBe(404);
});

test('legacy editions expose only their generated text and explicit unknown authorship', async () => {
  const f = await fixture(),
    context = new ContextRecords(f.base),
    id = crypto.randomUUID();
  const value = ImportedReading.parse({
    kind: 'legacy.imported.v1',
    editionId: id,
    sessionId: f.started.sessionId,
    editionNumber: 2,
    importedAt: new Date().toISOString(),
    record: {
      format: 'reflection-import.v1',
      identity: {
        source: { namespaceId: f.session.subjectId, revision: 'original' },
        kind: 'reading',
        recordId: 'legacy',
        recordRevision: 1,
      },
      parentIdentity: null,
      source: 'tarot',
      originalId: 'legacy',
      originalParentId: null,
      originalTimestamp: null,
      occurredAt: null,
      question: 'UNSELECTED_QUESTION',
      generatedText: 'Legacy text',
      userStatements: [
        { originalId: null, text: 'UNSELECTED_AUTHOR', originalTimestamp: null, revision: null },
      ],
      basis: {
        method: 'unknown',
        cards: [],
        sourceIds: [],
        rawBasisJson: null,
        verification: 'legacy_unverified',
      },
      originalJsonText: '{"hidden":"UNSELECTED_RAW"}',
      originalSha256: 'a'.repeat(64),
      provenanceGaps: ['authorship'],
      review: 'legacy_unknown',
    },
  });
  const body = await f.base.crypt.seal(
    {
      ownerId: f.session.subjectId,
      table: 'reading_editions',
      column: 'body_enc',
      recordId: id,
      aadRevision: 1,
    },
    value,
    1,
  );
  await env.DB.prepare(
    "INSERT INTO reading_editions(id,owner_id,session_id,edition_number,status,mode,body_enc,key_version,accepted_at) VALUES(?,?,?,2,'imported','legacy',?,1,1)",
  )
    .bind(id, f.session.subjectId, f.started.sessionId, body)
    .run();
  const g = await context.grant(f.session, crypto.randomUUID(), { kind: 'edition', editionId: id });
  const result = await context.preview(f.session, await preview(f, g.id, 11));
  expect(result.items[0]).toMatchObject({ text: 'Legacy text', authorship: 'legacy_unknown' });
  expect(JSON.stringify(result)).not.toContain('UNSELECTED_');
});
