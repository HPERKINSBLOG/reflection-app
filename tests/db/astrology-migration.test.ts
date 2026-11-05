import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { expect, test } from 'vitest';
import {
  OWNER,
  OTHER,
  CONTENT,
  seedDatabase,
  seedHistoricalRequest,
  sql,
} from '../fixtures/database.ts';

test('0021 preserves populated families, cascading revisits, grants, ciphertext and accounting', async () => {
  const db = env.MIGRATION_DB;
  await applyD1Migrations(
    db,
    env.TEST_MIGRATIONS.filter((m) => m.name < '0021'),
  );
  const plan = await seedDatabase(db);
  await sql(
    db,
    "UPDATE reading_sessions SET status='saved',saved_at=1,retention_expires_at=NULL WHERE id=?",
    plan.sessionId,
  ).run();
  let parent: string | null = null;
  const editions: string[] = [];
  for (let n = 1; n <= 3; n++) {
    const request = await seedHistoricalRequest(db, {
      ...plan,
      clientIntentId: crypto.randomUUID(),
    });
    const edition = crypto.randomUUID();
    await sql(
      db,
      "INSERT INTO reading_editions(id,owner_id,session_id,edition_number,request_id,basis_id,parent_edition_id,status,mode,body_enc,key_version,content_hash,accepted_at) VALUES(?,?,?,?,?,?,?,'accepted','template',?,1,?,1)",
      edition,
      OWNER,
      plan.sessionId,
      n,
      request.requestId,
      plan.basisId,
      parent,
      `tarot-v${n}-unchanged-bytes`,
      CONTENT,
    ).run();
    editions.push(edition);
    parent = edition;
  }
  const note = crypto.randomUUID(),
    reflection = crypto.randomUUID();
  await db.batch([
    sql(
      db,
      'INSERT INTO reflections(id,owner_id,session_id,edition_id) VALUES(?,?,?,?)',
      reflection,
      OWNER,
      plan.sessionId,
      parent,
    ),
    sql(
      db,
      "INSERT INTO reflection_revisions(reflection_id,owner_id,revision,body_enc,key_version,created_at) VALUES(?,?,1,'original-writing',1,1)",
      reflection,
      OWNER,
    ),
    sql(
      db,
      "INSERT INTO revisits(id,owner_id,edition_id,session_id,note_enc,key_version,created_at,current_revision,updated_at) VALUES(?,?,?,?,'current-revisit-bytes',1,1,2,2)",
      note,
      OWNER,
      parent,
      plan.sessionId,
    ),
    sql(
      db,
      "INSERT INTO revisit_revisions(revisit_id,owner_id,revision,body_enc,key_version,created_at) VALUES(?,?,1,'earlier-revisit-bytes',1,1)",
      note,
      OWNER,
    ),
    sql(
      db,
      "INSERT INTO context_grants(id,owner_id,revisit_id,revisit_revision,state,created_at,updated_at) VALUES(?,?,?,2,'allowed',1,1)",
      crypto.randomUUID(),
      OWNER,
      note,
    ),
    sql(
      db,
      "INSERT INTO import_identities(owner_id,source_key_hmac,source_entity_hmac,original_hmac,session_id,entity_kind,revisit_id,source_record_enc,key_version) VALUES(?,'source','entity','original',?,'revisit',?,'import-provenance-bytes',1)",
      OWNER,
      plan.sessionId,
      note,
    ),
  ]);
  for (const withdrawn of [false, true]) {
    const session = crypto.randomUUID();
    await sql(
      db,
      "INSERT INTO reading_sessions(id,owner_id,status,question_enc,created_at,saved_at) VALUES(?,?,'saved','imported-question',1,1)",
      session,
      OWNER,
    ).run();
    await sql(
      db,
      "INSERT INTO reading_editions(id,owner_id,session_id,edition_number,status,mode,body_enc,key_version,accepted_at,invalidated_at) VALUES(?,?,?,1,?,'legacy',?,1,1,?)",
      crypto.randomUUID(),
      OWNER,
      session,
      withdrawn ? 'withdrawn' : 'imported',
      withdrawn ? null : 'imported-bytes',
      withdrawn ? 2 : null,
    ).run();
  }
  const tables = [
    'basis_snapshots',
    'reading_editions',
    'reflections',
    'reflection_revisions',
    'revisits',
    'revisit_revisions',
    'context_grants',
    'generation_requests',
    'generation_attempts',
    'import_identities',
  ];
  const before = await Promise.all(
    tables.map(
      async (table) => (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results,
    ),
  );
  const storage = (await db.prepare('SELECT id,storage_bytes FROM accounts ORDER BY id').all())
    .results;
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0021'));
  expect(migration, 'native Pattern migration exists').toBeDefined();
  const drop = migration!.queries.findIndex((query) =>
    query.includes('DROP TABLE reading_editions'),
  );
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
  expect((await db.prepare('SELECT * FROM revisits ORDER BY rowid').all()).results).toEqual(
    before[tables.indexOf('revisits')],
  );
  await applyD1Migrations(db, [migration!]);
  for (const [i, table] of tables.entries()) {
    const after = (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
    expect(after).toHaveLength(before[i]!.length);
    after.forEach((row, j) => {
      expect(row).toMatchObject(before[i]![j]!);
    });
  }
  expect(
    (await db.prepare('SELECT id,storage_bytes FROM accounts ORDER BY id').all()).results,
  ).toEqual(storage);
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);

  const session = crypto.randomUUID(),
    basis = crypto.randomUUID(),
    edition = crypto.randomUUID(),
    release = 'd'.repeat(64);
  await db.batch([
    sql(
      db,
      "INSERT INTO pattern_content_releases(hash,state,release_json,created_at) VALUES(?,'active','synthetic-local-catalogue',1)",
      release,
    ),
    sql(
      db,
      "INSERT INTO reading_sessions(id,owner_id,status,method,question_enc,created_at,saved_at) VALUES(?,?,'saved','astrology','chapter-title',1,1)",
      session,
      OWNER,
    ),
    sql(
      db,
      "INSERT INTO basis_snapshots(id,owner_id,session_id,kind,schema_version,body_enc,key_version,created_at) VALUES(?,?,?,'astrology.natal.v2',2,'encrypted-basis',1,1)",
      basis,
      OWNER,
      session,
    ),
  ]);
  const insert = (
    owner: string,
    basisId: string | null,
    contentHash: string | null,
    parentId: string | null = null,
  ) =>
    sql(
      db,
      "INSERT INTO reading_editions(id,owner_id,session_id,edition_number,basis_id,status,mode,body_enc,key_version,pattern_content_hash,parent_edition_id,accepted_at) VALUES(?,?,?,1,?,'accepted','pattern','encrypted-pattern',1,?,?,1)",
      edition,
      owner,
      session,
      basisId,
      contentHash,
      parentId,
    ).run();
  await expect(insert(OTHER, basis, release)).rejects.toThrow();
  await expect(insert(OWNER, null, release)).rejects.toThrow();
  await expect(insert(OWNER, plan.basisId, release)).rejects.toThrow();
  await expect(insert(OWNER, basis, null)).rejects.toThrow();
  await expect(insert(OWNER, basis, release, editions[0]!)).rejects.toThrow();
  await insert(OWNER, basis, release);
  await expect(
    sql(db, "UPDATE basis_snapshots SET kind='tarot.v1',schema_version=1 WHERE id=?", basis).run(),
  ).rejects.toThrow();
  await expect(
    sql(db, "UPDATE reading_sessions SET method='tarot' WHERE id=?", session).run(),
  ).rejects.toThrow();
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
