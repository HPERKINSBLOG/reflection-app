import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { OWNER, OTHER, seedDatabase } from '../fixtures/database.ts';

test('0019 preserves dormant previews, aliases and byte accounting and isolates staged groups by owner', async () => {
  const db = env.MIGRATION_DB;
  await applyD1Migrations(
    db,
    env.TEST_MIGRATIONS.filter((m) => m.name < '0019'),
  );
  const plan = await seedDatabase(db);
  await db.batch([
    db
      .prepare(
        "INSERT INTO import_batches VALUES('historic',?,'tarot-json','digest','preview',1,99)",
      )
      .bind(OWNER),
    db
      .prepare(
        "INSERT INTO import_items VALUES('historic',?,0,'source','original','historic-private',1,'ready',?,NULL)",
      )
      .bind(OWNER, plan.sessionId),
    db
      .prepare(
        "INSERT INTO import_identities(owner_id,source_key_hmac,source_entity_hmac,original_hmac,entity_kind,source_record_enc,key_version) VALUES(?,'key','entity','original','permission','historic-claim',1)",
      )
      .bind(OWNER),
  ]);
  const storage = () =>
    db
      .prepare('SELECT storage_bytes FROM accounts WHERE id=?')
      .bind(OWNER)
      .first<number>('storage_bytes');
  const before = await storage();
  const upgrade = env.TEST_MIGRATIONS.filter((m) => m.name.startsWith('0019_'));
  expect(upgrade, 'import persistence migration').toHaveLength(1);
  await applyD1Migrations(db, upgrade);
  expect(await storage()).toBe(before);
  expect(
    await db
      .prepare(
        "SELECT body_enc,group_id,ordinal,result_enc FROM import_items WHERE batch_id='historic'",
      )
      .first(),
  ).toEqual({ body_enc: 'historic-private', group_id: null, ordinal: null, result_enc: null });
  expect(
    await db.prepare('SELECT source_record_enc,revisit_revision FROM import_identities').first(),
  ).toEqual({ source_record_enc: 'historic-claim', revisit_revision: null });
  await db
    .prepare(
      "INSERT INTO import_groups(id,owner_id,manifest_hash,source_hmac,recovery_hmac,epoch,unit_count,state,created_at,expires_at,retain_until) VALUES('group',?,'manifest','source','recovery',1,1,'staged',1,100,200)",
    )
    .bind(OWNER)
    .run();
  await expect(
    db
      .prepare(
        "INSERT INTO import_batches(id,owner_id,source_format,document_hmac,state,created_at,expires_at,group_id) VALUES('foreign',?,'tarot-json','d','preview',1,100,'group')",
      )
      .bind(OTHER)
      .run(),
  ).rejects.toThrow(/FOREIGN KEY/);
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
