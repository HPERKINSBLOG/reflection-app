import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { z } from 'zod';
import {
  apiSchemas,
  ImportChunkDocument,
  ImportedReading,
  ImportUnit,
} from '../../src/contracts/index.ts';
import { buildImportGroups, verifyImportGroup } from '../../src/domain/imports/chunks.ts';
import {
  identityKey,
  importEntityInput,
  importKeyInput,
} from '../../src/domain/imports/identity.ts';
import { parseImportFile } from '../../src/domain/imports/parse.ts';
import type { ImportWrite } from '../../src/domain/imports/types.ts';
import { assertChanges, assertExists, DB_NOW, statement as q } from '../../src/worker/db/core.ts';
import { IdentityCrypto } from '../../src/worker/identity/crypto.ts';
import { RecordCrypto } from '../../src/worker/readings/crypto.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { IDENTITY_SECRETS } from '../fixtures/identity.ts';
import { largeImportFamilyDocument } from '../fixtures/imports/large-family.ts';
import nested from '../fixtures/imports/tarot-nested.json';
import { readingAccount } from '../fixtures/reading-client.ts';

const db = env.DB;
beforeAll(async () => {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  // Disposable D8 experiment. Schema, lifecycle and registry changes belong to P2.
  await db
    .prepare(`CREATE TABLE d8_destinations (
    owner_id TEXT NOT NULL, group_id TEXT NOT NULL, manifest_hmac TEXT NOT NULL, ordinal INTEGER NOT NULL,
    batch_id TEXT NOT NULL, item_index INTEGER NOT NULL, entity_hmac TEXT NOT NULL,
    edition_id TEXT NOT NULL, parent_id TEXT, edition_enc TEXT NOT NULL, alias_enc TEXT NOT NULL,
    PRIMARY KEY(owner_id,group_id,ordinal), UNIQUE(owner_id,batch_id,item_index),
    FOREIGN KEY(batch_id,item_index) REFERENCES import_items(batch_id,item_index)
  )`)
    .run();
});
beforeEach(() => clearDatabase(db));

const source = { namespaceId: '11111111-1111-4111-8111-111111111111', revision: 'original' };
const rawCopy = z.strictObject({ scope: z.literal('selected-fields.v1'), raw: z.string() });

async function stageFamily(document: string) {
  const { client, kit } = await readingAccount(true, false);
  const owner = kit.subjectId;
  const crypt = new RecordCrypto(db, new IdentityCrypto(IDENTITY_SECRETS));
  const file = await parseImportFile({
    format: 'tarot-json',
    source,
    recovery: { kind: 'none' },
    document,
  });
  expect(file.errors).toEqual([]);
  const [group] = await buildImportGroups(
    file.units.filter((item) => item.kind === 'legacy-reading'),
    () => crypto.randomUUID(),
  );
  const units = await verifyImportGroup(group!.chunks);
  const groupId = group!.id,
    sessionId = crypto.randomUUID();
  const manifestHmac = await crypt.hash(owner, 'import-manifest', group!.manifestHash);
  const localIds = new Map(units.map((unit) => [unit.key, crypto.randomUUID()]));
  const seal = (table: string, column: string, recordId: string, value: unknown) =>
    crypt.seal({ ownerId: owner, table, column, recordId, aadRevision: 1 }, value, 1);
  const batch = (id: string, digest: string) =>
    q(
      db,
      `INSERT INTO import_batches(id,owner_id,source_format,document_hmac,state,created_at,expires_at)
    VALUES(?,?,'reflection-portable-chunk.v1',?,'preview',${DB_NOW},${DB_NOW}+86400000)`,
      id,
      owner,
      digest,
    );
  await batch(groupId, manifestHmac).run();
  async function stageChunk(index: number) {
    const request = group!.chunks[index]!;
    const chunk = ImportChunkDocument.parse(JSON.parse(request.document));
    const batchId = crypto.randomUUID();
    const rows = await Promise.all(
      chunk.items.map(async ({ ordinal, unit }, itemIndex) => {
        if (unit.kind !== 'legacy-reading') throw new Error('Unexpected fixture kind');
        const sourceKey = await crypt.hash(owner, 'import-key', importKeyInput(unit.identity));
        const entity = await crypt.hash(owner, 'import-entity', importEntityInput(unit.identity));
        const original = await crypt.hash(owner, 'import-original', unit.record.originalSha256);
        const edition = localIds.get(unit.key)!;
        const parent = unit.parentIdentity ? localIds.get(identityKey(unit.parentIdentity)) : null;
        if (parent === undefined) throw new Error('Missing explicit fixture dependency');
        const reading = ImportedReading.parse({
          kind: 'legacy.imported.v1',
          editionId: edition,
          sessionId,
          editionNumber: ordinal + 1,
          record: unit.record,
          importedAt: '2026-11-01T00:00:00Z',
        });
        const [preview, body, alias] = await Promise.all([
          seal('import_items', 'body_enc', `${batchId}:${itemIndex}`, unit),
          seal('reading_editions', 'body_enc', edition, reading),
          seal(
            'import_identities',
            'source_record_enc',
            sourceKey,
            rawCopy.parse({ scope: unit.rawScope, raw: unit.record.originalJsonText }),
          ),
        ]);
        return [
          q(
            db,
            "INSERT INTO import_items(batch_id,owner_id,item_index,source_key_hmac,original_hmac,body_enc,key_version,state) VALUES(?,?,?,?,?,?,1,'ready')",
            batchId,
            owner,
            itemIndex,
            sourceKey,
            original,
            preview,
          ),
          q(
            db,
            'INSERT INTO d8_destinations VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            owner,
            groupId,
            manifestHmac,
            ordinal,
            batchId,
            itemIndex,
            entity,
            edition,
            parent,
            body,
            alias,
          ),
        ];
      }),
    );
    await db.batch([
      batch(batchId, await crypt.hash(owner, 'import-preview', request.document)),
      ...rows.flat(),
    ]);
  }

  const root = units.find((unit) => unit.parentIdentity === null)!;
  if (root.kind !== 'legacy-reading') throw new Error('Missing root reading');
  const question = await seal('reading_sessions', 'question_enc', sessionId, {
    v: 1,
    text: root.record.question ?? '',
  });
  const expected = units.length;
  async function reopenManifest() {
    const batches = await q(
      db,
      'SELECT batch_id FROM d8_destinations WHERE owner_id=? AND group_id=? GROUP BY batch_id ORDER BY min(ordinal)',
      owner,
      groupId,
    ).all<{ batch_id: string }>();
    const previews: ImportWrite[] = [];
    for (const { batch_id } of batches.results) {
      const rows = await q(
        db,
        `SELECT d.ordinal,i.item_index,i.body_enc FROM d8_destinations d JOIN import_items i
        ON i.owner_id=d.owner_id AND i.batch_id=d.batch_id AND i.item_index=d.item_index WHERE d.owner_id=? AND d.group_id=? AND d.batch_id=? ORDER BY i.item_index`,
        owner,
        groupId,
        batch_id,
      ).all<{ ordinal: number; item_index: number; body_enc: string }>();
      const items = await Promise.all(
        rows.results.map(async (row) => ({
          ordinal: row.ordinal,
          unit: await crypt.open(
            {
              ownerId: owner,
              table: 'import_items',
              column: 'body_enc',
              recordId: `${batch_id}:${row.item_index}`,
              aadRevision: 1,
            },
            row.body_enc,
            ImportUnit,
          ),
        })),
      );
      previews.push({
        format: 'reflection-portable-chunk.v1',
        source,
        recovery: { kind: 'none' },
        document: JSON.stringify({
          format: 'reflection-portable-chunk.v1',
          groupId,
          manifestHash: group!.manifestHash,
          unitCount: expected,
          items,
        }),
      });
    }
    return verifyImportGroup(previews);
  }
  const statements = () => [
    assertExists(
      db,
      `SELECT 1 FROM import_batches WHERE owner_id=? AND id=? AND document_hmac=? AND state='preview' AND expires_at>${DB_NOW}`,
      owner,
      groupId,
      manifestHmac,
    ),
    assertExists(
      db,
      `SELECT count(*) FROM d8_destinations d
      JOIN import_items i ON i.owner_id=d.owner_id AND i.batch_id=d.batch_id AND i.item_index=d.item_index
      JOIN import_batches b ON b.owner_id=i.owner_id AND b.id=i.batch_id
      WHERE d.owner_id=? AND d.group_id=? AND d.manifest_hmac=? AND b.state='preview' AND b.expires_at>${DB_NOW} AND i.state='ready' AND i.body_enc IS NOT NULL
      HAVING count(*)=? AND min(d.ordinal)=0 AND max(d.ordinal)=?-1`,
      owner,
      groupId,
      manifestHmac,
      expected,
      expected,
    ),
    q(
      db,
      `INSERT INTO reading_sessions(id,owner_id,question_enc,status,created_at,saved_at) VALUES(?,?,?,'saved',${DB_NOW},${DB_NOW})`,
      sessionId,
      owner,
      question,
    ),
    q(
      db,
      `INSERT INTO reading_editions(id,owner_id,session_id,edition_number,parent_edition_id,status,mode,body_enc,key_version,accepted_at)
      SELECT edition_id,owner_id,?,ordinal+1,parent_id,'imported','legacy',edition_enc,1,${DB_NOW}
      FROM d8_destinations WHERE owner_id=? AND group_id=?`,
      sessionId,
      owner,
      groupId,
    ),
    assertChanges(db, expected),
    q(
      db,
      `INSERT INTO import_identities(owner_id,source_key_hmac,source_entity_hmac,original_hmac,session_id,entity_kind,edition_id,source_record_enc,key_version)
      SELECT d.owner_id,i.source_key_hmac,d.entity_hmac,i.original_hmac,?,'edition',d.edition_id,d.alias_enc,i.key_version
      FROM d8_destinations d JOIN import_items i ON i.owner_id=d.owner_id AND i.batch_id=d.batch_id AND i.item_index=d.item_index
      WHERE d.owner_id=? AND d.group_id=?`,
      sessionId,
      owner,
      groupId,
    ),
    assertChanges(db, expected),
    q(
      db,
      "UPDATE import_items SET state='imported',session_id=? WHERE owner_id=? AND (batch_id,item_index) IN (SELECT batch_id,item_index FROM d8_destinations WHERE owner_id=? AND group_id=?)",
      sessionId,
      owner,
      owner,
      groupId,
    ),
    assertChanges(db, expected),
    q(
      db,
      "UPDATE import_batches SET state='complete' WHERE owner_id=? AND (id=? OR id IN (SELECT batch_id FROM d8_destinations WHERE owner_id=? AND group_id=?))",
      owner,
      groupId,
      owner,
      groupId,
    ),
    q(
      db,
      `UPDATE accounts SET data_revision=data_revision+1 WHERE id=? AND status='active' AND write_fence IS NULL AND key_version=1 AND storage_bytes+
      (SELECT coalesce(sum(1024+length(CAST(edition_enc AS BLOB))+length(CAST(alias_enc AS BLOB))),0) FROM d8_destinations WHERE owner_id=?)<=20971520`,
      owner,
      owner,
    ),
    assertChanges(db, 1),
  ];
  return {
    client,
    crypt,
    owner,
    groupId,
    sessionId,
    units,
    root,
    localIds,
    stageChunk,
    reopenManifest,
    statements,
    chunkCount: group!.chunks.length,
  };
}

test('102 selected records across 11 encrypted previews become visible in one D1 publication', async () => {
  const f = await stageFamily(largeImportFamilyDocument());
  expect(f.units).toHaveLength(102);
  expect(f.chunkCount).toBe(11);
  const visible = () =>
    q(
      db,
      'SELECT count(*) AS n FROM reading_editions WHERE owner_id=? AND session_id=?',
      f.owner,
      f.sessionId,
    ).first<number>('n');
  const receipt = () =>
    q(
      db,
      'SELECT state FROM import_batches WHERE owner_id=? AND id=?',
      f.owner,
      f.groupId,
    ).first<string>('state');
  await f.stageChunk(0);
  await expect(f.reopenManifest()).rejects.toThrow('IMPORT_INVALID');
  await expect(db.batch(f.statements())).rejects.toThrow(/CHECK constraint failed/);
  expect(await visible()).toBe(0);
  expect(await receipt()).toBe('preview');
  for (let i = 1; i < f.chunkCount; i++) await f.stageChunk(i);
  expect(await f.reopenManifest()).toEqual(f.units);
  const rootId = f.localIds.get(f.root.key)!;
  expect((await f.client.request(`/readings/${rootId}`)).status).toBe(404);
  const writes = f.statements();
  // Fail after 102 real edition inserts and before publishing any alias or completion receipt.
  await expect(
    db.batch([
      ...writes.slice(0, 5),
      db.prepare('INSERT INTO assertion_probe VALUES(0)'),
      ...writes.slice(5),
    ]),
  ).rejects.toThrow(/CHECK constraint failed/);
  expect(await visible()).toBe(0);
  expect(await receipt()).toBe('preview');
  expect((await f.client.request(`/sessions/${f.sessionId}`)).status).toBe(404);
  const [before, , after] = await Promise.all([visible(), db.batch(f.statements()), visible()]);
  for (const count of [before, after]) expect([0, 102]).toContain(count);
  expect(await visible()).toBe(102);
  expect(await receipt()).toBe('complete');
  const session = apiSchemas.SessionRecord.parse(
    await (await f.client.request(`/sessions/${f.sessionId}`)).json(),
  );
  expect(new Set(session.editionIds)).toEqual(new Set(f.localIds.values()));
  const last = f.units.at(-1)!;
  const reopened = ImportedReading.parse(
    await (await f.client.request(`/readings/${f.localIds.get(last.key)}`)).json(),
  );
  expect(reopened.record).toEqual(last.record);
  await expect(db.batch(f.statements())).rejects.toThrow(/CHECK constraint failed/);
  expect(await visible()).toBe(102);
});

test('erasing one selected child removes preview, staging, edition and alias copies while its parent reopens unchanged', async () => {
  const f = await stageFamily(JSON.stringify(nested));
  for (let i = 0; i < f.chunkCount; i++) await f.stageChunk(i);
  await db.batch(f.statements());
  const child = f.units.find((unit) => unit.parentIdentity !== null)!;
  const childId = f.localIds.get(child.key)!,
    parentId = f.localIds.get(f.root.key)!;
  const body = async (id: string) =>
    ImportedReading.parse(await (await f.client.request(`/readings/${id}`)).json());
  const parentBefore = await body(parentId);
  expect(parentBefore.record.originalJsonText).not.toContain('DESELECTED_CHILD');
  expect((await body(childId)).record.originalJsonText).toContain('DESELECTED_CHILD');
  const entity = await f.crypt.hash(f.owner, 'import-entity', importEntityInput(child.identity));
  const key = await f.crypt.hash(f.owner, 'import-key', importKeyInput(child.identity));
  const alias = await q(
    db,
    'SELECT source_record_enc FROM import_identities WHERE owner_id=? AND source_key_hmac=?',
    f.owner,
    key,
  ).first<string>('source_record_enc');
  const raw = await f.crypt.open(
    {
      ownerId: f.owner,
      table: 'import_identities',
      column: 'source_record_enc',
      recordId: key,
      aadRevision: 1,
    },
    alias!,
    rawCopy,
  );
  expect(raw.raw).toBe((await body(childId)).record.originalJsonText);
  const retained = () =>
    q(
      db,
      `SELECT
    (SELECT count(*) FROM import_items WHERE owner_id=? AND source_key_hmac=? AND body_enc IS NOT NULL) AS preview,
    (SELECT count(*) FROM d8_destinations WHERE owner_id=? AND entity_hmac=? AND edition_enc IS NOT NULL AND alias_enc IS NOT NULL) AS stage,
    (SELECT count(*) FROM reading_editions WHERE owner_id=? AND id=? AND body_enc IS NOT NULL) AS edition,
    (SELECT count(*) FROM import_identities WHERE owner_id=? AND source_entity_hmac=? AND source_record_enc IS NOT NULL) AS alias`,
      f.owner,
      key,
      f.owner,
      entity,
      f.owner,
      childId,
      f.owner,
      entity,
    ).first();
  expect(await retained()).toEqual({ preview: 1, stage: 1, edition: 1, alias: 1 });
  // The child identity owns each of these copies independently from the imported parent.
  await db.batch([
    q(
      db,
      'UPDATE import_items SET body_enc=NULL WHERE owner_id=? AND source_key_hmac=?',
      f.owner,
      key,
    ),
    q(db, 'DELETE FROM d8_destinations WHERE owner_id=? AND entity_hmac=?', f.owner, entity),
    q(
      db,
      `UPDATE import_identities SET source_record_enc=NULL,session_id=NULL,edition_id=NULL,erased_at=${DB_NOW} WHERE owner_id=? AND source_entity_hmac=?`,
      f.owner,
      entity,
    ),
    q(
      db,
      `UPDATE reading_editions SET body_enc=NULL,status='deleted',invalidated_at=${DB_NOW} WHERE owner_id=? AND id=?`,
      f.owner,
      childId,
    ),
  ]);
  expect(await retained()).toEqual({ preview: 0, stage: 0, edition: 0, alias: 0 });
  expect((await f.client.request(`/readings/${childId}`)).status).toBe(410);
  expect(await body(parentId)).toEqual(parentBefore);
  expect(
    await q(
      db,
      'SELECT count(*) AS n FROM import_identities WHERE owner_id=? AND source_entity_hmac=? AND erased_at IS NOT NULL AND session_id IS NULL AND edition_id IS NULL',
      f.owner,
      entity,
    ).first('n'),
  ).toBe(1);
});
