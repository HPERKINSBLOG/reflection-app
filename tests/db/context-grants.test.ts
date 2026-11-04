import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { z } from 'zod';
import { apiSchemas, type Grant } from '../../src/contracts/index.ts';
import { ContextRecords } from '../../src/worker/readings/context.ts';
import { Reflections } from '../../src/worker/readings/reflections.ts';
import { SyntheticGenerationPrototype, type SyntheticPlan } from '../../src/worker/db/prototype.ts';
import { gate } from '../fixtures/barrier.ts';
import { providerReceipt } from '../fixtures/provider.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { readingAccount } from '../fixtures/reading-client.ts';
import { fixture, note } from '../fixtures/revisits.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));

async function setup() {
  const f = await fixture();
  const context = new ContextRecords(f.base.db, f.base.identity);
  const fields = {
    clientIntentId: crypto.randomUUID(),
    question: 'What would I like to try next?',
    parentEditionId: null,
    permissionRevision: (await f.client.me()).permission.revision,
  };
  return { ...f, context, fields };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const range = (grant: z.infer<typeof Grant>, start: number, end: number) => ({
  grantId: grant.id,
  grantRevision: grant.revision,
  start,
  end,
});
async function grantedNote(f: Fixture, text: string) {
  const value = await note(f, text);
  const source = { kind: 'revisit_revision' as const, revisitId: value.id, revision: 1 };
  const grant = await f.context.grant(f.session, crypto.randomUUID(), source);
  return { value, source, grant };
}
function start(f: Fixture, preview: z.infer<typeof apiSchemas.ContextPreview>) {
  return apiSchemas.StartRequest.parse({
    ...f.fields,
    languageConfirmed: 'en',
    reversals: true,
    selection: preview.items.map((item) => item.selection),
    contextAcknowledgement: preview.acknowledgementHash,
  });
}
async function effects(owner: string) {
  return env.DB.prepare(`SELECT data_revision,storage_bytes,
    (SELECT count(*) FROM generation_requests WHERE owner_id=?) AS requests,
    (SELECT count(*) FROM provider_dispatches WHERE owner_id=?) AS dispatches,
    (SELECT count(*) FROM generation_context WHERE owner_id=?) AS snapshots
    FROM accounts WHERE id=?`)
    .bind(owner, owner, owner, owner)
    .first();
}

test('preview and confirmation return only the exact selected Unicode text without writes or dispatch', async () => {
  const f = await setup();
  const { value, grant } = await grantedNote(f, ' 😀e\u0301 secret unselected tail ');
  const input = { ...f.fields, items: [range(grant, 1, 4)] };
  const before = await effects(f.session.subjectId);
  const preview = await f.context.preview(f.session, input);
  expect(preview.items).toEqual([
    {
      selection: { ...input.items[0], previewHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      text: '😀e\u0301',
      authorship: 'user',
    },
  ]);
  expect(await f.context.confirmStart(f.session, start(f, preview))).toEqual([
    {
      ordinal: 0,
      ...input.items[0],
      sourceKind: 'revisit_revision',
      sourceId: value.id,
      sourceRevision: 1,
      text: '😀e\u0301',
      textHash: preview.items[0]!.selection.previewHash,
      availability: 'retained',
      authorship: 'user',
    },
  ]);
  expect(await f.context.preview(f.session, input)).toEqual(preview);
  expect(await effects(f.session.subjectId)).toEqual(before);
});

test('forged hashes and replays with edited intent, question, parent, permission, range or order fail', async () => {
  const f = await setup();
  const a = await grantedNote(f, 'abcdef'),
    b = await grantedNote(f, 'second');
  const preview = await f.context.preview(f.session, {
    ...f.fields,
    items: [range(a.grant, 1, 4), range(b.grant, 0, 6)],
  });
  const request = start(f, preview);
  for (const change of [
    { clientIntentId: crypto.randomUUID() },
    { question: `${request.question} ` },
    { parentEditionId: f.reading.editionId },
    { contextAcknowledgement: '0'.repeat(64) },
    { selection: [...request.selection].reverse() },
    { selection: request.selection.slice(0, 1) },
    { selection: [{ ...request.selection[0]!, end: 5 }, request.selection[1]!] },
    {
      selection: [{ ...request.selection[0]!, previewHash: '0'.repeat(64) }, request.selection[1]!],
    },
  ]) {
    await expect(
      f.context.confirmStart(f.session, { ...request, ...change }),
    ).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
  }
  await expect(
    f.context.confirmStart(f.session, { ...request, permissionRevision: 99 }),
  ).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
  const off = await f.client.permission(false);
  await expect(f.context.preview(f.session, { ...f.fields, items: [] })).rejects.toMatchObject({
    code: 'CONTEXT_CHANGED',
  });
  const whileOff = await f.context.preview(f.session, {
    ...f.fields,
    permissionRevision: off.revision,
    items: [range(b.grant, 0, 6)],
  });
  expect(whileOff.items[0]?.text).toBe('second');
  await expect(
    f.context.confirmStart(f.session, {
      ...start(f, whileOff),
      permissionRevision: off.revision,
    }),
  ).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
});

test('cross-owner grants, sources, parent and edition filter fail before opening private content', async () => {
  const f = await setup();
  const { grant, source } = await grantedNote(f, 'owner only');
  const other = await readingAccount();
  const otherSession = await f.base.identity.sessions.get(
    other.client.cookies.get('__Host-session'),
  );
  const open = vi.spyOn(f.context.crypt, 'open');
  for (const attempt of [
    () => f.context.grant(otherSession, crypto.randomUUID(), source),
    () =>
      f.context.grant(otherSession, crypto.randomUUID(), {
        kind: 'edition',
        editionId: f.reading.editionId,
      }),
    () => f.context.list(otherSession, null, 20, f.reading.editionId),
    () => f.context.revoke(otherSession, grant.id, 1, crypto.randomUUID()),
    () => f.context.preview(otherSession, { ...f.fields, items: [range(grant, 0, 5)] }),
    () =>
      f.context.preview(otherSession, {
        ...f.fields,
        parentEditionId: f.reading.editionId,
        items: [],
      }),
  ])
    await expect(attempt()).rejects.toMatchObject({ status: 404 });
  expect((await f.context.list(otherSession, null, 20, null)).items).toEqual([]);
  expect(open).not.toHaveBeenCalled();
});

test('grant and revocation retries join once, preserve CAS, and list pages retain revoked metadata', async () => {
  const f = await setup();
  const source = { kind: 'edition' as const, editionId: f.reading.editionId };
  const key = crypto.randomUUID();
  const [a, duplicate] = await Promise.all([
    f.context.grant(f.session, key, source),
    f.context.grant(f.session, key, source),
  ]);
  expect(duplicate).toEqual(a);
  const b = await grantedNote(f, 'another source');
  await expect(f.context.grant(f.session, key, b.source)).rejects.toMatchObject({
    code: 'IDEMPOTENCY_MISMATCH',
  });
  const revokeKey = crypto.randomUUID();
  const [revoked, retry] = await Promise.all([
    f.context.revoke(f.session, a.id, 1, revokeKey),
    f.context.revoke(f.session, a.id, 1, revokeKey),
  ]);
  expect(revoked).toEqual({ ...a, revision: 2, state: 'revoked' });
  expect(retry).toEqual(revoked);
  expect((await f.context.grant(f.session, key, source)).state).toBe('revoked');
  await expect(f.context.revoke(f.session, a.id, 1, crypto.randomUUID())).rejects.toMatchObject({
    code: 'CONFLICT',
    revision: 2,
  });
  await expect(
    f.context.preview(f.session, { ...f.fields, items: [range(a, 0, 1)] }),
  ).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
  const page = await f.context.list(f.session, null, 1, f.reading.editionId);
  expect(page.nextCursor).toBeTruthy();
  const next = await f.context.list(f.session, page.nextCursor, 1, f.reading.editionId);
  expect([...page.items, ...next.items]).toEqual(expect.arrayContaining([revoked, b.grant]));
  expect(next.nextCursor).toBe(null);
  await expect(f.context.list(f.session, page.nextCursor, 1, null)).rejects.toMatchObject({
    code: 'BAD_INPUT',
  });
  await expect(f.context.list(f.session, null, 51, null)).rejects.toMatchObject({
    code: 'BAD_INPUT',
  });
});

test('superseded authored revisions cannot be granted or confirmed even when their history remains readable', async () => {
  const f = await setup(),
    reflections = new Reflections(f.base);
  const entry = {
    editionId: f.reading.editionId,
    text: 'first reflection',
    stance: 'disagree' as const,
  };
  const reflection = await reflections.write(
    f.session,
    f.started.sessionId,
    entry,
    crypto.randomUUID(),
  );
  const source = { kind: 'reflection_revision' as const, reflectionId: reflection.id, revision: 1 };
  const grant = await f.context.grant(f.session, crypto.randomUUID(), source);
  const n = await grantedNote(f, 'first note');
  const preview = await f.context.preview(f.session, {
    ...f.fields,
    items: [range(grant, 0, 5), range(n.grant, 0, 5)],
  });
  expect(preview.items.map((item) => item.text)).toEqual(['first', 'first']);
  await reflections.update(f.session, reflection.id, 1, crypto.randomUUID(), {
    ...entry,
    text: 'second reflection',
  });
  await f.notes.update(f.session, n.value.id, 1, crypto.randomUUID(), {
    note: 'second note',
    stance: 'unsure',
  });
  expect((await f.notes.read(f.session, n.value.id, 1)).note).toBe('first note');
  expect((await reflections.read(f.session, reflection.id, 1)).text).toBe('first reflection');
  for (const old of [source, n.source]) {
    await expect(f.context.grant(f.session, crypto.randomUUID(), old)).rejects.toMatchObject({
      code: 'CONTEXT_CHANGED',
    });
  }
  const grants = await f.context.list(f.session, null, 50, null);
  expect(grants.items.every((item) => item.state === 'revoked')).toBe(true);
  await expect(f.context.confirmStart(f.session, start(f, preview))).rejects.toMatchObject({
    code: 'CONTEXT_CHANGED',
  });
});

test('multiple grants cannot bypass distinct-source, individual code point and total limits', async () => {
  const f = await setup();
  const a = await grantedNote(f, '😀'.repeat(1201));
  const duplicate = await f.context.grant(f.session, crypto.randomUUID(), a.source);
  const b = await grantedNote(f, 'b'.repeat(1200)),
    c = await grantedNote(f, 'c'.repeat(1200));
  const preview = (items: z.infer<typeof apiSchemas.ContextPreviewWrite>['items']) =>
    f.context.preview(f.session, { ...f.fields, items });
  expect(
    (
      await preview([range(a.grant, 1, 1201), range(b.grant, 0, 1200), range(c.grant, 0, 600)])
    ).items.map((x) => [...x.text].length),
  ).toEqual([1200, 1200, 600]);
  for (const items of [
    [range(a.grant, 0, 1201)],
    [range(a.grant, -1, 1)],
    [range(a.grant, 2, 1)],
    [range(a.grant, 1.5, 2)],
    [range(a.grant, 1201, 1202)],
    [range(a.grant, 0, 1), range(duplicate, 1, 2)],
    [range(a.grant, 0, 1200), range(b.grant, 0, 1200), range(c.grant, 0, 601)],
    [range(a.grant, 0, 1), range(b.grant, 0, 1), range(c.grant, 0, 1), range(duplicate, 0, 1)],
  ])
    await expect(preview(items)).rejects.toMatchObject({ status: 400 });
});

test('grant admission honors the account byte cap and repeated revocation cannot keep adding receipts above it', async () => {
  const f = await setup();
  const { grant, source } = await grantedNote(f, 'eligible note');
  await env.DB.prepare('UPDATE accounts SET storage_bytes=20971519 WHERE id=?')
    .bind(f.session.subjectId)
    .run();
  const before = await effects(f.session.subjectId);
  await expect(f.context.grant(f.session, crypto.randomUUID(), source)).rejects.toMatchObject({
    code: 'STORAGE_LIMIT_EXCEEDED',
  });
  expect(await effects(f.session.subjectId)).toEqual(before);
  const revoked = await f.context.revoke(f.session, grant.id, grant.revision, crypto.randomUUID());
  expect(revoked.state).toBe('revoked');
  const after = await effects(f.session.subjectId);
  await expect(
    f.context.revoke(f.session, grant.id, revoked.revision, crypto.randomUUID()),
  ).rejects.toMatchObject({ code: 'CONFLICT', revision: revoked.revision });
  expect(await effects(f.session.subjectId)).toEqual(after);
  expect((await f.context.list(f.session, null, 20, null)).items).toEqual([revoked]);
});

test('edition ranges expose the reviewed interpretation or its separately authored question', async () => {
  const f = await setup();
  const reading = f.reading;
  if (reading.kind !== 'tarot.accepted.v2') throw new Error('expected a native v2 fixture');
  const grant = await f.context.grant(f.session, crypto.randomUUID(), {
    kind: 'edition',
    editionId: reading.editionId,
  });
  const input = (start: number, end: number) => ({
    ...f.fields,
    items: [range(grant, start, end)],
  });
  const interpretation = reading.units[0]!.interpretation;
  const preview = await f.context.preview(f.session, input(0, [...interpretation].length));
  expect(preview.items[0]).toMatchObject({ authorship: 'generated', text: interpretation });
  const generated = [
    ...reading.units.map((u) => u.interpretation),
    reading.synthesis.text,
    reading.action.text,
    reading.reflectionQuestion?.text,
  ]
    .filter(Boolean)
    .join('\n\n');
  const questionStart = [...generated].length + 2;
  expect(
    (
      await f.context.preview(
        f.session,
        input(questionStart, questionStart + [...reading.question].length),
      )
    ).items[0],
  ).toMatchObject({ authorship: 'user', text: reading.question });
  await expect(
    f.context.preview(f.session, input(questionStart - 3, questionStart + 1)),
  ).rejects.toMatchObject({ code: 'BAD_INPUT' });
  await env.DB.prepare("UPDATE content_editions SET state='withdrawn' WHERE hash=?")
    .bind(reading.contentHash)
    .run();
  await expect(f.context.confirmStart(f.session, start(f, preview))).rejects.toMatchObject({
    code: 'CONTEXT_CHANGED',
  });
});

test('missing, unsaved and erased sources cannot establish new eligibility or release preview text', async () => {
  const f = await setup();
  const missing = crypto.randomUUID();
  for (const source of [
    { kind: 'edition', editionId: missing } as const,
    { kind: 'reflection_revision', reflectionId: missing, revision: 1 } as const,
    { kind: 'revisit_revision', revisitId: missing, revision: 1 } as const,
  ])
    await expect(f.context.grant(f.session, crypto.randomUUID(), source)).rejects.toMatchObject({
      status: 404,
    });
  const unsaved = await f.client.create();
  await expect(
    f.context.grant(f.session, crypto.randomUUID(), {
      kind: 'edition',
      editionId: unsaved.reading.editionId,
    }),
  ).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
  const n = await grantedNote(f, 'current note');
  const input = { ...f.fields, items: [range(n.grant, 0, 4)] };
  const preview = await f.context.preview(f.session, input);
  await env.DB.prepare('UPDATE revisits SET note_enc=NULL,deleted_at=1 WHERE id=?')
    .bind(n.value.id)
    .run();
  const decrypt = vi.spyOn(f.context.crypt, 'open');
  await expect(f.context.preview(f.session, input)).rejects.toMatchObject({
    code: 'CONTEXT_CHANGED',
  });
  await expect(f.context.confirmStart(f.session, start(f, preview))).rejects.toMatchObject({
    code: 'CONTEXT_CHANGED',
  });
  expect(decrypt).not.toHaveBeenCalled();
});

test('auth epoch changes invalidate an otherwise unchanged complete acknowledgement', async () => {
  const f = await setup();
  const n = await grantedNote(f, 'note');
  const input = { ...f.fields, items: [range(n.grant, 0, 4)] };
  const preview = await f.context.preview(f.session, input);
  const old = start(f, preview);
  await env.DB.batch([
    env.DB.prepare('UPDATE accounts SET auth_epoch=auth_epoch+1 WHERE id=?').bind(
      f.session.subjectId,
    ),
    env.DB.prepare('UPDATE auth_sessions SET auth_epoch=auth_epoch+1 WHERE owner_id=?').bind(
      f.session.subjectId,
    ),
  ]);
  const newer = { ...f.session, epoch: f.session.epoch + 1 };
  await expect(f.context.confirmStart(f.session, old)).rejects.toMatchObject({
    code: 'UNAUTHENTICATED',
  });
  await expect(f.context.confirmStart(newer, old)).rejects.toMatchObject({
    code: 'CONTEXT_CHANGED',
  });
  expect((await f.context.preview(newer, input)).acknowledgementHash).not.toBe(
    preview.acknowledgementHash,
  );
});

test('rechecking source eligibility closes the write and decrypted preview races', async () => {
  const f = await setup();
  const n = await grantedNote(f, 'racing source');
  const grantGate = gate((sql) => sql.some((s) => s.includes('INSERT INTO context_grants(')));
  const delayedGrant = new ContextRecords(grantGate.db, f.base.identity).grant(
    f.session,
    crypto.randomUUID(),
    n.source,
  );
  const grantRejected = expect(delayedGrant).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
  await grantGate.ready;
  await f.notes.update(f.session, n.value.id, 1, crypto.randomUUID(), {
    note: 'new revision',
    stance: 'unspecified',
  });
  grantGate.release();
  await grantRejected;
  const current = await f.context.grant(f.session, crypto.randomUUID(), {
    ...n.source,
    revision: 2,
  });
  const previewGate = gate(
    (sql) =>
      sql.some((s) => s.includes('data_revision=?')) &&
      sql.some((s) => s.includes('FROM context_grants g')),
  );
  const delayedPreview = new ContextRecords(previewGate.db, f.base.identity).preview(f.session, {
    ...f.fields,
    items: [range(current, 0, 3)],
  });
  const previewRejected = expect(delayedPreview).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
  await previewGate.ready;
  await f.context.revoke(f.session, current.id, current.revision, crypto.randomUUID());
  previewGate.release();
  await previewRejected;
  expect((await f.context.list(f.session, null, 20, null)).items).toHaveLength(2);
});

test('revocation atomically stops only requests selecting its grant, releases their quota and preserves transmission liability', async () => {
  const f = await setup();
  const { grant, value } = await grantedNote(f, 'selected synthetic text');
  const service = new SyntheticGenerationPrototype(env.DB, {
    write: async () => ({ kind: 'candidate', candidate: {}, receipt: providerReceipt() }),
  });
  const stored =
    await env.DB.prepare(`SELECT basis_id AS basisId,key_version AS keyVersion,permission_revision AS permissionRevision,
    content_hash AS contentHash,content_policy_revision AS contentPolicyRevision,policy_hash AS policyHash
    FROM generation_requests WHERE id=?`)
      .bind(f.started.requestId)
      .first<
        Pick<
          SyntheticPlan,
          | 'basisId'
          | 'keyVersion'
          | 'permissionRevision'
          | 'contentHash'
          | 'contentPolicyRevision'
          | 'policyHash'
        >
      >();
  const plan: SyntheticPlan = {
    ...stored!,
    syntheticOnly: true,
    ownerId: f.session.subjectId,
    sessionId: f.started.sessionId,
    clientIntentId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    payloadHmac: '2'.repeat(64),
    planHmac: '3'.repeat(64),
    context: [
      {
        grantId: grant.id,
        grantRevision: 1,
        fragmentHmac: '4'.repeat(64),
        sourceKind: 'revisit_revision',
        sourceId: value.id,
        sourceRevision: value.revision,
      },
    ],
  };
  const selecting = await service.start(plan);
  const independent = await service.start({
    ...plan,
    clientIntentId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    context: [],
  });
  const lease = await service.claim(f.session.subjectId, selecting);
  await service.dispatch(lease!, new Uint8Array([1]));
  const receipt = env.DB.prepare(
    'SELECT transmission_enc FROM provider_dispatches WHERE request_id=?',
  ).bind(selecting);
  const cost = env.DB.prepare(
    'SELECT state,reserved_microusd,actual_microusd FROM cost_reservations WHERE dispatch_id=(SELECT id FROM provider_dispatches WHERE request_id=?)',
  ).bind(selecting);
  const copy = env.DB.prepare(
    'SELECT fragment_enc FROM generation_context WHERE request_id=?',
  ).bind(selecting);
  const [sentBefore, costBefore, copyBefore] = await Promise.all([
    receipt.first(),
    cost.first(),
    copy.first(),
  ]);
  expect(sentBefore?.transmission_enc).toBeTruthy();
  expect(costBefore).toBeTruthy();
  expect(copyBefore?.fragment_enc).toBeTruthy();
  const key = crypto.randomUUID();
  await f.context.revoke(f.session, grant.id, 1, key);
  await f.context.revoke(f.session, grant.id, 1, key);
  const state = env.DB.prepare('SELECT state,error_code FROM generation_requests WHERE id=?');
  expect(await state.bind(selecting).first()).toEqual({
    state: 'blocked',
    error_code: 'CONTEXT_CHANGED',
  });
  expect(await state.bind(independent).first()).toEqual({ state: 'prepared', error_code: null });
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS n FROM request_events WHERE request_id=? AND code='STOPPED'",
    )
      .bind(selecting)
      .first('n'),
  ).toBe(1);
  const reservation = env.DB.prepare('SELECT state FROM quota_reservations WHERE request_id=?');
  expect(await reservation.bind(selecting).first('state')).toBe('released');
  expect(await reservation.bind(independent).first('state')).toBe('held');
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS n FROM quota_events WHERE request_id=? AND event='release'",
    )
      .bind(selecting)
      .first('n'),
  ).toBe(1);
  expect(await Promise.all([receipt.first(), cost.first(), copy.first()])).toEqual([
    sentBefore,
    costBefore,
    copyBefore,
  ]);
});
