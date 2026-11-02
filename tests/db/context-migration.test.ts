import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { OWNER, OTHER, seedDatabase, addContext } from '../fixtures/database.ts';

test('0018 preserves existing grants and accepts owner-scoped exact revisit identities with accounting', async () => {
  const db = env.MIGRATION_DB;
  await applyD1Migrations(
    db,
    env.TEST_MIGRATIONS.filter((m) => m.name < '0018'),
  );
  const plan = await addContext(db, await seedDatabase(db));
  const old = await db.prepare('SELECT * FROM context_grants').first();
  // Seed the historical shape directly: today's publication guard requires the new schema.
  const requestId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO generation_requests(id,owner_id,session_id,client_intent_id,basis_id,operation,payload_hmac,state,next_run_at,permission_revision,key_version,content_hash,content_policy_revision,policy_hash,input_enc,plan_enc,plan_hmac,context_count,created_at,expires_at) VALUES(?,?,?,?,?,'initial',?,'prepared',1,1,1,?,1,?,'old-input','old-plan',?,1,1,9999999999999)",
    )
    .bind(
      requestId,
      plan.ownerId,
      plan.sessionId,
      plan.clientIntentId,
      plan.basisId,
      plan.payloadHmac,
      plan.contentHash,
      plan.policyHash,
      plan.planHmac,
    )
    .run();
  await db
    .prepare('INSERT INTO generation_context VALUES(?,?,0,?,1,?,?,1)')
    .bind(requestId, plan.ownerId, plan.context[0]!.grantId, 'old-fragment', plan.planHmac)
    .run();
  const oldContext = await db
    .prepare('SELECT * FROM generation_context WHERE request_id=?')
    .bind(requestId)
    .all();
  const edition = String(old!.edition_id),
    note = crypto.randomUUID(),
    grant = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO revisits(id,owner_id,edition_id,note_enc,key_version,created_at,session_id,current_revision,updated_at) VALUES(?,?,?,?,1,1,?,2,2)',
    )
    .bind(note, OWNER, edition, 'unchanged-current-ciphertext', plan.sessionId)
    .run();
  await db
    .prepare(
      'INSERT INTO revisit_revisions(revisit_id,owner_id,revision,body_enc,key_version,created_at) VALUES(?,?,1,?,1,1)',
    )
    .bind(note, OWNER, 'unchanged-legacy-ciphertext')
    .run();
  const storage = Number(
    await db
      .prepare('SELECT storage_bytes FROM accounts WHERE id=?')
      .bind(OWNER)
      .first('storage_bytes'),
  );
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0018'));
  expect(migration, 'context migration exists').toBeDefined();
  const drop = migration!.queries.findIndex((query) => query.includes('DROP TABLE context_grants'));
  expect(drop).toBeGreaterThan(0);
  await expect(
    applyD1Migrations(db, [
      {
        ...migration!,
        queries: [
          ...migration!.queries.slice(0, drop + 1),
          'INSERT INTO assertion_probe VALUES(0)',
          ...migration!.queries.slice(drop + 1),
        ],
      },
    ]),
  ).rejects.toThrow();
  expect(await db.prepare('SELECT * FROM context_grants WHERE id=?').bind(old!.id).first()).toEqual(
    old,
  );
  await applyD1Migrations(db, [migration!]);
  expect(
    await db.prepare('SELECT * FROM context_grants WHERE id=?').bind(old!.id).first(),
  ).toMatchObject(old!);
  expect(
    (await db.prepare('SELECT * FROM generation_context WHERE request_id=?').bind(requestId).all())
      .results,
  ).toEqual(oldContext.results);
  expect(
    await db
      .prepare('SELECT storage_bytes FROM accounts WHERE id=?')
      .bind(OWNER)
      .first('storage_bytes'),
  ).toBe(storage);
  expect(
    await db.prepare('SELECT note_enc FROM revisits WHERE id=?').bind(note).first('note_enc'),
  ).toBe('unchanged-current-ciphertext');
  expect(
    await db
      .prepare('SELECT body_enc FROM revisit_revisions WHERE revisit_id=?')
      .bind(note)
      .first('body_enc'),
  ).toBe('unchanged-legacy-ciphertext');
  const insert = (owner: string, id: string, revision: number) =>
    db
      .prepare(
        "INSERT INTO context_grants(id,owner_id,revisit_id,revisit_revision,state,created_at,updated_at) VALUES(?,?,?,?,'allowed',2,2)",
      )
      .bind(id, owner, note, revision)
      .run();
  await insert(OWNER, grant, 2);
  expect(
    await db
      .prepare('SELECT storage_bytes FROM accounts WHERE id=?')
      .bind(OWNER)
      .first('storage_bytes'),
  ).toBe(storage + 1024);
  await expect(insert(OTHER, crypto.randomUUID(), 2)).rejects.toThrow();
  await expect(insert(OWNER, crypto.randomUUID(), 0)).rejects.toThrow();
  await expect(
    db.prepare('UPDATE context_grants SET edition_id=? WHERE id=?').bind(edition, grant).run(),
  ).rejects.toThrow();
  await db
    .prepare("UPDATE context_grants SET state='revoked',revision=2 WHERE id=?")
    .bind(grant)
    .run();
  expect(
    await db
      .prepare('SELECT storage_bytes FROM accounts WHERE id=?')
      .bind(OWNER)
      .first('storage_bytes'),
  ).toBe(storage + 1024);
  await db.prepare('DELETE FROM context_grants WHERE id=?').bind(grant).run();
  expect(
    await db
      .prepare('SELECT storage_bytes FROM accounts WHERE id=?')
      .bind(OWNER)
      .first('storage_bytes'),
  ).toBe(storage);
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  // The later migration retains family provenance even if a source is unavailable on replay.
  const provenanceMigration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0019'));
  expect(provenanceMigration).toBeDefined();
  await applyD1Migrations(db, [provenanceMigration!]);
  expect(
    await db
      .prepare('SELECT source_session_id FROM context_grants WHERE id=?')
      .bind(old!.id)
      .first('source_session_id'),
  ).toBe(plan.sessionId);
  expect(
    await db
      .prepare('SELECT storage_bytes FROM accounts WHERE id=?')
      .bind(OWNER)
      .first('storage_bytes'),
  ).toBe(storage);
  await expect(
    db
      .prepare('UPDATE context_grants SET source_session_id=? WHERE id=?')
      .bind(crypto.randomUUID(), old!.id)
      .run(),
  ).rejects.toThrow();
});
