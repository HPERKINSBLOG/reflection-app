import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { SyntheticGenerationPrototype, type SyntheticPlan } from '../../src/worker/db/prototype.ts';
import { addContext, clearDatabase, HASH, OWNER, seedDatabase, sql } from '../fixtures/database.ts';
import { providerReceipt } from '../fixtures/provider.ts';

const db = env.DB;
const writer = {
  write: vi.fn(async () => ({
    kind: 'candidate' as const,
    candidate: { synthetic: true },
    receipt: providerReceipt(),
  })),
};
const service = new SyntheticGenerationPrototype(db, writer);
const payload = new Uint8Array([1]);
const count = (table: string) =>
  db.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>('n');
beforeAll(() => applyD1Migrations(db, env.TEST_MIGRATIONS));
beforeEach(async () => {
  await clearDatabase(db);
  writer.write.mockClear();
});

async function claim(plan: SyntheticPlan) {
  const id = await service.start(plan);
  const lease = await service.claim(OWNER, id);
  expect(lease).not.toBeNull();
  return lease!;
}

async function selections() {
  const plan = await seedDatabase(db);
  const sourceSession = crypto.randomUUID();
  await sql(
    db,
    "INSERT INTO reading_sessions(id,owner_id,question_enc,status,created_at,saved_at) VALUES(?,?,'question','saved',1,1)",
    sourceSession,
    OWNER,
  ).run();
  const legacy = await addContext(db, { ...plan, sessionId: sourceSession });
  const edition = await sql(
    db,
    'SELECT id FROM reading_editions WHERE session_id=?',
    sourceSession,
  ).first<string>('id');
  const reflection = crypto.randomUUID(),
    note = crypto.randomUUID();
  const reflectionGrant = crypto.randomUUID(),
    noteGrant = crypto.randomUUID();
  await db.batch([
    sql(
      db,
      'INSERT INTO reflections(id,owner_id,session_id,edition_id) VALUES(?,?,?,?)',
      reflection,
      OWNER,
      sourceSession,
      edition,
    ),
    sql(
      db,
      "INSERT INTO reflection_revisions(reflection_id,owner_id,revision,body_enc,key_version,created_at) VALUES(?,?,1,'reflection',1,1)",
      reflection,
      OWNER,
    ),
    sql(
      db,
      "INSERT INTO context_grants(id,owner_id,reflection_id,reflection_revision,state,created_at,updated_at) VALUES(?,?,?,1,'allowed',1,1)",
      reflectionGrant,
      OWNER,
      reflection,
    ),
    sql(
      db,
      "INSERT INTO revisits(id,owner_id,edition_id,session_id,note_enc,key_version,created_at,updated_at) VALUES(?,?,?,?,'current note',1,1,1)",
      note,
      OWNER,
      edition,
      sourceSession,
    ),
    sql(
      db,
      "INSERT INTO context_grants(id,owner_id,revisit_id,revisit_revision,state,created_at,updated_at) VALUES(?,?,?,1,'allowed',1,1)",
      noteGrant,
      OWNER,
      note,
    ),
  ]);
  plan.context = [
    ...legacy.context,
    {
      grantId: reflectionGrant,
      grantRevision: 1,
      fragmentHmac: 'd'.repeat(64),
      sourceKind: 'reflection_revision',
      sourceId: reflection,
      sourceRevision: 1,
    },
    {
      grantId: noteGrant,
      grantRevision: 1,
      fragmentHmac: 'e'.repeat(64),
      sourceKind: 'revisit_revision',
      sourceId: note,
      sourceRevision: 1,
    },
  ];
  return { plan, note, reflection, sourceSession, edition };
}

async function supersedeNote(note: string) {
  await db.batch([
    sql(
      db,
      'INSERT INTO revisit_revisions(revisit_id,owner_id,revision,body_enc,key_version,created_at) SELECT id,owner_id,current_revision,note_enc,key_version,updated_at FROM revisits WHERE id=?',
      note,
    ),
    sql(
      db,
      "UPDATE revisits SET current_revision=2,note_enc='new note',updated_at=2 WHERE id=?",
      note,
    ),
  ]);
}

test('an initial reading can publish precisely the three current selections from a different saved reading', async () => {
  const { plan } = await selections();
  const lease = await claim(plan);
  await service.dispatch(lease, payload);
  const accepted = await service.publish(lease);
  expect(
    await sql(
      db,
      'SELECT request_id,parent_edition_id FROM reading_editions WHERE id=?',
      accepted,
    ).first(),
  ).toEqual({ request_id: lease.requestId, parent_edition_id: null });
  expect(writer.write).toHaveBeenCalledTimes(1);
});

test.each(['reservation', 'dispatch', 'publication'] as const)(
  'a superseded note blocks %s even when its historical ciphertext and grant survive',
  async (stage) => {
    const { plan, note } = await selections();
    if (stage === 'reservation') {
      await supersedeNote(note);
      await expect(service.start(plan)).rejects.toThrow(/CHECK constraint failed/);
      expect(await count('generation_requests')).toBe(0);
      expect(await count('quota_reservations')).toBe(0);
      return;
    }
    const lease = await claim(plan);
    if (stage === 'publication') await service.dispatch(lease, payload);
    await supersedeNote(note);
    if (stage === 'dispatch') {
      await expect(service.dispatch(lease, payload)).rejects.toThrow(/CHECK constraint failed/);
      expect(writer.write).not.toHaveBeenCalled();
      expect(await count('cost_reservations')).toBe(0);
    } else {
      await expect(service.publish(lease)).rejects.toThrow(/CHECK constraint failed/);
      expect(writer.write).toHaveBeenCalledTimes(1);
      expect(await count('cost_reservations')).toBe(1);
    }
    expect(await count('reading_editions')).toBe(1);
  },
);

test.each([
  [
    'unsaved source',
    "UPDATE reading_sessions SET status='open',saved_at=NULL,retention_expires_at=9999999999999 WHERE status='saved'",
  ],
  [
    'deleted source family',
    "UPDATE reading_sessions SET status='deleted',saved_at=NULL,deleted_at=2 WHERE status='saved'",
  ],
  ['superseded reflection', 'UPDATE reflections SET current_revision=2'],
  ['erased reflection', 'UPDATE reflection_revisions SET erased_at=2,body_enc=NULL'],
  ['deleted note', 'UPDATE revisits SET deleted_at=2,note_enc=NULL'],
  ['missing snapshot', 'DELETE FROM generation_context WHERE ordinal=1'],
  ['wrong captured count', 'UPDATE generation_requests SET context_count=2'],
  ['erased fragment', 'UPDATE generation_context SET fragment_enc=NULL WHERE ordinal=2'],
  ['empty fragment', "UPDATE generation_context SET fragment_enc='' WHERE ordinal=2"],
  [
    'substituted fragment hash',
    `UPDATE generation_context SET fragment_hmac='${HASH}' WHERE ordinal=2`,
  ],
  ['stale grant revision', 'UPDATE context_grants SET revision=2 WHERE revisit_id IS NOT NULL'],
])('%s prevents dispatch without a charge', async (_name, change) => {
  const { plan } = await selections();
  const lease = await claim(plan);
  await db.prepare(change).run();
  await expect(service.dispatch(lease, payload)).rejects.toThrow(/CHECK constraint failed/);
  expect(await count('provider_dispatches')).toBe(0);
  expect(await count('cost_reservations')).toBe(0);
  expect(writer.write).not.toHaveBeenCalled();
});

test('authored text remains eligible when only the associated interpretation is withdrawn', async () => {
  const { plan } = await selections();
  plan.context = plan.context.slice(1);
  await db
    .prepare("UPDATE reading_editions SET status='withdrawn',body_enc=NULL,invalidated_at=2")
    .run();
  const lease = await claim(plan);
  await service.dispatch(lease, payload);
  await expect(service.publish(lease)).resolves.toBeTypeOf('string');
});

test('a dangling source note cannot authorize an already prepared request', async () => {
  const { plan, note } = await selections();
  const lease = await claim(plan);
  // Reproduce an incomplete historical restore; ordinary foreign keys disallow this graph.
  await db.batch([
    db.prepare('PRAGMA defer_foreign_keys=ON'),
    sql(db, 'DELETE FROM revisits WHERE id=?', note),
    db.prepare('PRAGMA defer_foreign_keys=OFF'),
  ]);
  await expect(service.dispatch(lease, payload)).rejects.toThrow(/CHECK constraint failed/);
  expect(writer.write).not.toHaveBeenCalled();
});

test('retargeting a grant to the new current note revision cannot authorize the old excerpt', async () => {
  const { plan, note } = await selections();
  const lease = await claim(plan);
  await supersedeNote(note);
  await sql(db, 'UPDATE context_grants SET revisit_revision=2 WHERE revisit_id=?', note).run();
  await expect(service.dispatch(lease, payload)).rejects.toThrow(/CHECK constraint failed/);
  expect(await count('provider_dispatches')).toBe(0);
  expect(writer.write).not.toHaveBeenCalled();
});

test('a grant retargeted to a different eligible source cannot publish the captured text', async () => {
  const { plan, reflection, note } = await selections();
  const lease = await claim(plan);
  await service.dispatch(lease, payload);
  await sql(
    db,
    'UPDATE context_grants SET revisit_id=NULL,revisit_revision=NULL,reflection_id=?,reflection_revision=1 WHERE revisit_id=?',
    reflection,
    note,
  ).run();
  await expect(service.publish(lease)).rejects.toThrow(/CHECK constraint failed/);
  expect(await count('reading_editions')).toBe(1);
  expect(await count('cost_reservations')).toBe(1);
});

async function savedFamily() {
  const first = await seedDatabase(db);
  const lease = await claim(first);
  await service.dispatch(lease, payload);
  const parent = await service.publish(lease);
  await sql(
    db,
    "UPDATE reading_sessions SET status='saved',saved_at=1 WHERE id=?",
    first.sessionId,
  ).run();
  const child = {
    ...first,
    parentEditionId: parent,
    clientIntentId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  };
  return { parent, child };
}

test.each(['reservation', 'dispatch', 'publication'] as const)(
  'an unsaved exact parent blocks %s',
  async (stage) => {
    const { child } = await savedFamily();
    const unsave = () =>
      sql(
        db,
        "UPDATE reading_sessions SET status='open',saved_at=NULL,retention_expires_at=9999999999999 WHERE id=?",
        child.sessionId,
      ).run();
    if (stage === 'reservation') {
      await unsave();
      await expect(service.start(child)).rejects.toThrow(/CHECK constraint failed/);
    } else {
      const lease = await claim(child);
      if (stage === 'publication') await service.dispatch(lease, payload);
      await unsave();
      await expect(
        stage === 'dispatch' ? service.dispatch(lease, payload) : service.publish(lease),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
    expect(await count('reading_editions')).toBe(1);
    expect(writer.write).toHaveBeenCalledTimes(stage === 'publication' ? 2 : 1);
  },
);

test('dispatch pins the exact parent even when another accepted sibling is eligible', async () => {
  const { child } = await savedFamily();
  const siblingLease = await claim(child);
  await service.dispatch(siblingLease, payload);
  const sibling = await service.publish(siblingLease);
  const lease = await claim({
    ...child,
    idempotencyKey: crypto.randomUUID(),
    clientIntentId: crypto.randomUUID(),
  });
  await sql(
    db,
    'UPDATE generation_requests SET parent_edition_id=? WHERE id=?',
    sibling,
    lease.requestId,
  ).run();
  await expect(service.dispatch(lease, payload)).rejects.toThrow(/CHECK constraint failed/);
  expect(writer.write).toHaveBeenCalledTimes(2);
});

test.each(['reservation', 'dispatch'] as const)(
  'withdrawal of the parent content blocks %s while the request content stays eligible',
  async (stage) => {
    const { child } = await savedFamily();
    const parentContent = child.contentHash,
      requestContent = 'f'.repeat(64);
    await sql(
      db,
      "INSERT INTO content_editions(hash,state,bundle_json,reviewed_hash,reviewer_kind,reviewer_id,rights_status,created_at,approved_at) VALUES(?,'approved','{}',?,'human_approved','synthetic','cleared',1,1)",
      requestContent,
      requestContent,
    ).run();
    child.contentHash = requestContent;
    const lease = stage === 'dispatch' ? await claim(child) : null;
    await sql(
      db,
      "UPDATE content_editions SET state='withdrawn' WHERE hash=?",
      parentContent,
    ).run();
    await expect(lease ? service.dispatch(lease, payload) : service.start(child)).rejects.toThrow(
      /CHECK constraint failed/,
    );
    expect(
      await sql(db, 'SELECT state FROM content_editions WHERE hash=?', requestContent).first(
        'state',
      ),
    ).toBe('approved');
    expect(writer.write).toHaveBeenCalledTimes(1);
  },
);
