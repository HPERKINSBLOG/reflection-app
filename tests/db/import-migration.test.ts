import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { OWNER, seedDatabase } from '../fixtures/database.ts';

test('0021 preserves dormant preview bodies, aliases and accounting while adding group outcomes', async () => {
  const db = env.MIGRATION_DB;
  await applyD1Migrations(
    db,
    env.TEST_MIGRATIONS.filter((m) => Number(m.name.slice(0, 4)) <= 20),
  );
  const plan = await seedDatabase(db),
    batch = crypto.randomUUID(),
    group = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO import_batches VALUES(?,?,'synthetic','old-document','preview',1,9999999999999)",
      )
      .bind(batch, OWNER),
    db
      .prepare(
        "INSERT INTO import_items(batch_id,owner_id,item_index,source_key_hmac,original_hmac,body_enc,key_version,state,session_id) VALUES(?,?,0,'old-key','old-content','old-private-envelope',1,'conflict',?)",
      )
      .bind(batch, OWNER, plan.sessionId),
    db
      .prepare(
        "INSERT INTO import_identities(owner_id,source_key_hmac,source_entity_hmac,original_hmac,entity_kind,session_id,source_record_enc,key_version) VALUES(?,'old-key','old-entity','old-content','session',?,'old-alias-envelope',1)",
      )
      .bind(OWNER, plan.sessionId),
    db
      .prepare(
        "INSERT INTO import_identities(owner_id,source_key_hmac,source_entity_hmac,original_hmac,entity_kind,key_version,erased_at) VALUES(?,'erased-key','erased-entity','erased-content','session',1,1)",
      )
      .bind(OWNER),
  ]);
  const before = await db
    .prepare('SELECT storage_bytes FROM accounts WHERE id=?')
    .bind(OWNER)
    .first('storage_bytes');
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0021'))!;
  expect(migration).toBeDefined();
  await applyD1Migrations(db, [migration]);
  expect(
    await db
      .prepare('SELECT storage_bytes FROM accounts WHERE id=?')
      .bind(OWNER)
      .first('storage_bytes'),
  ).toBe(before);
  expect(await db.prepare('SELECT body_enc FROM import_items').first('body_enc')).toBe(
    'old-private-envelope',
  );
  expect(
    await db
      .prepare("SELECT source_record_enc FROM import_identities WHERE source_key_hmac='old-key'")
      .first('source_record_enc'),
  ).toBe('old-alias-envelope');
  expect(
    await db
      .prepare("SELECT erased_at FROM import_identities WHERE source_key_hmac='erased-key'")
      .first('erased_at'),
  ).toBe(1);
  await db.batch([
    db
      .prepare(
        "INSERT INTO import_groups(id,owner_id,manifest_hash,total_items,state,header_enc,recovery_hmac,key_version,created_at,expires_at,outcome_expires_at) VALUES(?,?,'manifest',102,'committing','header','recovery',1,1,2,3)",
      )
      .bind(group, OWNER),
    db
      .prepare(
        "INSERT INTO import_items(batch_id,owner_id,item_index,source_key_hmac,original_hmac,key_version,state,group_id,ordinal,result_enc) VALUES(?,?,1,'new-key','new-content',1,'erased',?,101,'result')",
      )
      .bind(batch, OWNER, group),
  ]);
  expect(
    await db
      .prepare('SELECT storage_bytes FROM accounts WHERE id=?')
      .bind(OWNER)
      .first('storage_bytes'),
  ).toBe(Number(before) + 2048 + 6 + 6);
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  await expect(db.prepare("UPDATE import_groups SET state='partial'").run()).rejects.toThrow();
  await expect(
    db.prepare('UPDATE import_items SET ordinal=20480 WHERE group_id=?').bind(group).run(),
  ).rejects.toThrow();
});
