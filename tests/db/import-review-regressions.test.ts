import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { apiSchemas, SelectedFragment, ImportedReading } from '../../src/contracts/index.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { readingAccount, login } from '../fixtures/reading-client.ts';
import { fixture, note } from '../fixtures/revisits.ts';
import {
  commitGroup,
  importGroup,
  portableGroups,
  uploadGroup,
} from '../fixtures/import-workflows.ts';
import { buildImportGroups } from '../../src/domain/imports/chunks.ts';
import { parseImportFile } from '../../src/domain/imports/parse.ts';
import { rawHash } from '../../src/domain/imports/legacy.ts';
import { withdrawContent } from '../../src/worker/content/activation.ts';
import { Reflections } from '../../src/worker/readings/reflections.ts';
import { RetentionMaintenance } from '../../src/worker/maintenance/retention.ts';
import { randomToken } from '../../src/worker/identity/crypto.ts';
import { OfflineRestore } from '../../src/worker/recovery/restore.ts';
import { cleanupBindings } from '../fixtures/cleanup.ts';
import { objects } from '../../src/worker/recovery/ledger.ts';
import { importIndex } from '../../src/worker/readings/import-identity.ts';
import { identityKey } from '../../src/domain/imports/identity.ts';
import { RecordBase } from '../../src/worker/readings/base.ts';
import { ReadingRecords } from '../../src/worker/readings/records.ts';
import { ReadingExports } from '../../src/worker/readings/export.ts';
import { unavailableNativeImport } from '../../src/worker/readings/import-availability.ts';
import { gate } from '../fixtures/barrier.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(async () => {
  await clearDatabase(env.DB);
  for (const entry of await objects(env.RECOVERY, '')) await env.RECOVERY.delete(entry.key);
});
const family = (value: Awaited<ReturnType<typeof portableGroups>>) =>
  value.groups.find((g) => g.units.some((u) => u.identity.kind === 'session'))!;

async function withdraw(f: Awaited<ReturnType<typeof fixture>>) {
  const hash = await env.DB.prepare('SELECT content_hash FROM reading_editions WHERE id=?')
    .bind(f.reading.editionId)
    .first<string>('content_hash');
  const revision = await env.DB.prepare('SELECT revision FROM system_state').first<number>(
    'revision',
  );
  await withdrawContent(env.DB, hash!, revision!);
}

test.each(['withdrawal', 'restore'])(
  'native compatibility aliases cannot export a body after %s',
  async (mode) => {
    const f = await fixture();
    await commitGroup(f.client, family(await portableGroups(f.client)));
    if (mode === 'withdrawal') await withdraw(f);
    else {
      const restore = new OfflineRestore(cleanupBindings(), { validateContent: async () => false });
      await restore.prepare();
      await restore.replay();
      await login(f.client, f.passkey, f.session.subjectId);
    }
    expect((await f.client.request(`/readings/${f.reading.editionId}`)).status).toBe(410);
    const output = await portableGroups(f.client);
    const reading = output.pages.flatMap((p) => p.records).find((r) => r.kind === 'reading')!;
    expect(reading.value).toMatchObject({ kind: 'reading.unavailable.v1' });
  },
);

test('withdrawal during export decryption invalidates the captured snapshot', async () => {
  const f = await fixture();
  const ticket = await f.exports.create(f.session, crypto.randomUUID());
  const open = f.base.crypt.open.bind(f.base.crypt);
  let withdrawn = false;
  const spy = vi.spyOn(f.base.crypt, 'open').mockImplementation(async (...args) => {
    const value = await open(...args);
    if (!withdrawn && args[0].table === 'reading_editions') {
      withdrawn = true;
      await withdraw(f);
    }
    return value;
  });
  try {
    await expect(f.exports.page(f.session, ticket.id, null)).rejects.toMatchObject({
      code: 'EXPORT_CHANGED',
    });
    expect(withdrawn).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

test.each(['native-v1', 'snapshot-1'])(
  '%s session aliases preserve a complete current family when new children are added',
  async (revision) => {
    const f = await fixture();
    const initial = await portableGroups(f.client);
    const parsed = await parseImportFile({
      format: initial.pages[0]!.format,
      source: { namespaceId: f.session.subjectId, revision },
      recovery: { kind: 'none' },
      document: initial.pages
        .map((page) =>
          JSON.stringify({
            ...page,
            records: page.records.map((record) => ({
              ...record,
              identity: { ...record.identity, source: { ...record.identity.source, revision } },
            })),
          }),
        )
        .join('\n'),
    });
    expect(parsed.errors).toEqual([]);
    const groups = await buildImportGroups(parsed.units, () => crypto.randomUUID());
    await commitGroup(
      f.client,
      groups.find((group) => group.units.some((unit) => unit.identity.kind === 'session'))!,
    );
    const authored = await new Reflections(f.base).write(
      f.session,
      f.reading.sessionId,
      { editionId: f.reading.editionId, text: 'New authored reflection', stance: 'resonates' },
      crypto.randomUUID(),
    );
    const current = apiSchemas.SessionRecord.parse(
      await (await f.client.request(`/sessions/${f.reading.sessionId}`)).json(),
    );
    const output = await portableGroups(f.client),
      sessions = output.pages.flatMap((p) => p.records).filter((r) => r.kind === 'session');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.value.revision).toBe(current.revision);
    expect(sessions[0]!.value.reflectionIds).toContain(authored.id);
    for (const record of output.pages.flatMap((page) => page.records))
      if (record.kind === 'reading' || record.kind === 'reflection')
        expect(record.identity.source).toEqual(sessions[0]!.identity.source);
    const destination = await readingAccount();
    expect((await commitGroup(destination.client, family(output))).state).toBe('complete');
    expect(
      await env.DB.prepare('SELECT count(*) n FROM reflections WHERE owner_id=?')
        .bind(destination.kit.subjectId)
        .first('n'),
    ).toBe(1);
  },
);

async function deliberateCopy(f: Awaited<ReturnType<typeof fixture>>) {
  const original = family(await portableGroups(f.client));
  await commitGroup(f.client, original);
  const copy = (await buildImportGroups(original.units, () => crypto.randomUUID()))[0]!;
  copy.chunks = copy.chunks.map((c) => ({
    ...c,
    source: { ...c.source, revision: 'deliberate-copy' },
    recovery: { kind: 'new_revision' as const, previousSource: c.source },
  }));
  await commitGroup(f.client, copy);
  const copied = await env.DB.prepare(
    "SELECT id FROM reading_editions WHERE owner_id=? AND mode='legacy'",
  )
    .bind(f.session.subjectId)
    .first<string>('id');
  expect(copied).not.toBeNull();
  return copied!;
}

test('withdrawal also withholds deliberate same-account copies of native readings', async () => {
  const f = await fixture(),
    copied = await deliberateCopy(f);
  await withdraw(f);
  expect((await f.client.request(`/readings/${copied}`)).status).toBe(410);
  const output = await portableGroups(f.client);
  const readings = output.pages
    .flatMap((page) => page.records)
    .filter((record) => record.kind === 'reading');
  expect(readings).toHaveLength(2);
  expect(readings.every((record) => record.value.kind === 'reading.unavailable.v1')).toBe(true);
});

test.each(['read', 'export'])(
  'source availability is rechecked before releasing a copied native %s',
  async (operation) => {
    const f = await fixture(),
      copied = await deliberateCopy(f);
    const barrier = gate((sql) =>
      sql.some(
        (statement) =>
          statement.includes('e.id IN (SELECT value FROM json_each(?))') &&
          statement.includes('JOIN reading_sessions s'),
      ),
    );
    const base = new RecordBase(barrier.db, f.base.identity);
    const ticket = await f.exports.create(f.session, crypto.randomUUID());
    const pending =
      operation === 'read'
        ? new ReadingRecords(base).reading(f.session, copied)
        : new ReadingExports(base).page(f.session, ticket.id, null);
    await barrier.ready;
    // Restore/content invalidation can change availability independently of an
    // account snapshot revision. The final source guard must still reject it.
    await env.DB.prepare(
      "UPDATE reading_editions SET status='withdrawn',invalidated_at=1 WHERE id=?",
    )
      .bind(f.reading.editionId)
      .run();
    barrier.release();
    await expect(pending).rejects.toMatchObject({
      code: operation === 'read' ? 'CONTENT_UNAVAILABLE' : 'EXPORT_CHANGED',
    });
  },
);

test('nested same-account provenance remains withheld and an exhausted inspection budget fails closed', async () => {
  const f = await fixture(),
    copied = await deliberateCopy(f);
  const legacy = ImportedReading.parse(await new ReadingRecords(f.base).reading(f.session, copied));
  let record = apiSchemas.ExportPage.parse((await portableGroups(f.client)).pages[0]).records.find(
    (record) => record.kind === 'reading' && record.identity.source.revision === 'native-v1',
  )!;
  if (record.kind !== 'reading') throw new Error('Missing native reading');
  for (let depth = 0; depth < 3; depth++) {
    const originalJsonText: string = JSON.stringify(record);
    record = {
      ...record,
      value: {
        ...legacy,
        record: {
          ...legacy.record,
          originalJsonText,
          originalSha256: await rawHash(originalJsonText),
        },
      },
    };
  }
  await expect(unavailableNativeImport(f.base, f.session.subjectId, record)).resolves.toBeNull();
  await withdraw(f);
  await expect(unavailableNativeImport(f.base, f.session.subjectId, record)).resolves.toMatchObject(
    {
      kind: 'reading.unavailable.v1',
      editionId: copied,
      reason: 'content_withdrawn',
    },
  );
  const originalJsonText = JSON.stringify(record);
  record = {
    ...record,
    value: {
      ...legacy,
      record: {
        ...legacy.record,
        originalJsonText,
        originalSha256: await rawHash(originalJsonText),
      },
    },
  };
  await expect(unavailableNativeImport(f.base, f.session.subjectId, record)).rejects.toMatchObject({
    code: 'CONTENT_UNAVAILABLE',
  });
});

test('foreign portable snapshots retain historical provenance after withdrawal at their origin', async () => {
  const source = await fixture(),
    destination = await readingAccount();
  const original = family(await portableGroups(source.client));
  await commitGroup(destination.client, original);
  await withdraw(source);
  const copied = await env.DB.prepare(
    "SELECT id FROM reading_editions WHERE owner_id=? AND mode='legacy'",
  )
    .bind(destination.kit.subjectId)
    .first<string>('id');
  const response = await destination.client.request(`/readings/${copied}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    kind: 'legacy.imported.v1',
    record: { review: 'legacy_unknown' },
  });
  const exported = await portableGroups(destination.client);
  const reading = exported.pages
    .flatMap((page) => page.records)
    .find((record) => record.kind === 'reading');
  expect(reading?.identity.source.namespaceId).toBe(source.session.subjectId);
  expect(reading?.value.kind).toBe('tarot.accepted.v2');
});

test('more than one page of native compatibility aliases cannot duplicate or hide the current family', async () => {
  const f = await fixture();
  const exported = await portableGroups(f.client);
  const sessionUnit = family(exported).units.find((unit) => unit.identity.kind === 'session')!;
  if (sessionUnit.kind !== 'portable') throw new Error('Missing session envelope');
  const owner = f.session.subjectId,
    version = (await f.base.account(f.session)).key_version;
  const inserts = [];
  for (let i = 0; i < 105; i++) {
    const identity = {
      ...sessionUnit.identity,
      source: { namespaceId: owner, revision: `snapshot-${i}` },
    };
    const record = { ...sessionUnit.record, identity };
    const originalJsonText = JSON.stringify(record);
    const unit = {
      ...sessionUnit,
      identity,
      key: identityKey(identity),
      record,
      originalJsonText,
      originalSha256: await rawHash(originalJsonText),
    };
    const { key, entity } = await importIndex(f.base, owner, identity, version);
    const encrypted = await f.base.crypt.seal(
      {
        ownerId: owner,
        table: 'import_identities',
        column: 'source_record_enc',
        recordId: key,
        aadRevision: 1,
      },
      unit,
      version,
    );
    inserts.push(
      env.DB.prepare(`INSERT INTO import_identities
      (owner_id,source_key_hmac,source_entity_hmac,original_hmac,session_id,entity_kind,source_record_enc,key_version)
      VALUES(?,?,?,?,?,'session',?,?)`).bind(
        owner,
        key,
        entity,
        'a'.repeat(64),
        f.reading.sessionId,
        encrypted,
        version,
      ),
    );
  }
  await env.DB.batch(inserts);
  const output = await portableGroups(f.client),
    records = output.pages.flatMap((page) => page.records);
  expect(output.pages.length).toBeGreaterThan(1);
  expect(records.filter((record) => record.kind === 'session')).toHaveLength(1);
  expect(records.filter((record) => record.kind === 'reading')).toHaveLength(1);
  expect(new Set(records.map((record) => JSON.stringify(record.identity))).size).toBe(
    records.length,
  );
  const destination = await readingAccount();
  await commitGroup(destination.client, family(output));
});

test('foreign selected context is erased from staging and cannot publish after its mapped source is deleted', async () => {
  const source = await fixture(),
    exported = await portableGroups(source.client),
    destination = await readingAccount();
  await commitGroup(destination.client, family(exported));
  const original = exported.pages
    .flatMap((p) => p.records)
    .find((r) => r.kind === 'generation_receipt')!;
  if (original.kind !== 'generation_receipt') throw new Error('fixture receipt');
  const id = crypto.randomUUID(),
    record = {
      ...original,
      identity: { ...original.identity, recordId: id },
      originalId: id,
      value: {
        ...original.value,
        requestId: id,
        selectedFragments: [
          SelectedFragment.parse({
            ordinal: 0,
            grantId: crypto.randomUUID(),
            grantRevision: 1,
            sourceKind: 'edition',
            sourceId: source.reading.editionId,
            sourceRevision: 1,
            start: 0,
            end: 14,
            text: 'PRIVATE_COPIED',
            textHash: 'a'.repeat(64),
            availability: 'retained',
            authorship: 'generated',
          }),
        ],
      },
    };
  const parsed = await parseImportFile({
    format: 'reflection-export.v1',
    source: record.identity.source,
    recovery: { kind: 'none' },
    document: JSON.stringify({
      ...exported.pages[0],
      records: [record],
      account: null,
      nextCursor: null,
    }),
  });
  expect(parsed.errors).toEqual([]);
  const group = (await buildImportGroups(parsed.units, () => crypto.randomUUID()))[0]!,
    ready = await uploadGroup(destination.client, group);
  const row = await env.DB.prepare(
    "SELECT session_id FROM import_identities WHERE owner_id=? AND entity_kind='edition'",
  )
    .bind(destination.kit.subjectId)
    .first<{ session_id: string }>();
  const erased = await destination.client.request(
    `/sessions/${row!.session_id}`,
    { receiptId: crypto.randomUUID(), receiptToken: randomToken() },
    { method: 'DELETE', revision: 1 },
  );
  expect(erased.status, await erased.clone().text()).toBe(202);
  expect(
    await env.DB.prepare('SELECT body_enc FROM import_items WHERE group_id=?')
      .bind(group.id)
      .first('body_enc'),
  ).toBeNull();
  const response = await destination.client.request(`/imports/groups/${group.id}/commit`, {
    version: 'import-group.v1',
    manifestHash: group.manifestHash,
    previewHash: ready.previewHash,
    confirmedRecovery: { kind: 'none' },
  });
  expect(response.status).not.toBe(200);
});

test('incremental portable imports extend one reflection and one revisit history', async () => {
  const source = await fixture(),
    reflections = new Reflections(source.base),
    first = await reflections.write(
      source.session,
      source.reading.sessionId,
      { editionId: source.reading.editionId, text: 'First reflection', stance: 'unspecified' },
      crypto.randomUUID(),
    ),
    firstNote = await note(source),
    destination = await readingAccount();
  await commitGroup(destination.client, family(await portableGroups(source.client)));
  await reflections.update(source.session, first.id, 1, crypto.randomUUID(), {
    editionId: source.reading.editionId,
    text: 'Second reflection',
    stance: 'resonates',
  });
  await source.notes.update(source.session, firstNote.id, 1, crypto.randomUUID(), {
    note: 'Second revisit',
    stance: 'resonates',
  });
  expect(
    (await commitGroup(destination.client, family(await portableGroups(source.client)))).state,
  ).toBe('complete');
  for (const table of ['reflections', 'revisits'])
    expect(
      await env.DB.prepare(`SELECT count(*) n FROM ${table} WHERE owner_id=?`)
        .bind(destination.kit.subjectId)
        .first('n'),
    ).toBe(1);
  for (const table of ['reflections', 'revisits'])
    expect(
      await env.DB.prepare(`SELECT current_revision FROM ${table} WHERE owner_id=?`)
        .bind(destination.kit.subjectId)
        .first('current_revision'),
    ).toBe(2);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM revisit_revisions WHERE owner_id=?')
      .bind(destination.kit.subjectId)
      .first('n'),
  ).toBe(1);
  const third = await readingAccount();
  await commitGroup(third.client, family(await portableGroups(destination.client)));
  for (const table of ['reading_sessions', 'reflections', 'revisits'])
    expect(
      await env.DB.prepare(`SELECT count(*) n FROM ${table} WHERE owner_id=?`)
        .bind(third.kit.subjectId)
        .first('n'),
    ).toBe(1);
});

test('changed exact portable raw JSON conflicts even when parsed values are equal', async () => {
  const source = await fixture(),
    exported = await portableGroups(source.client),
    destination = await readingAccount();
  const unit = structuredClone(
    exported.groups.flatMap((g) => g.units).find((u) => u.identity.kind === 'permission')!,
  );
  await commitGroup(
    destination.client,
    (await buildImportGroups([unit], () => crypto.randomUUID()))[0]!,
  );
  if (unit.kind !== 'portable') throw new Error('fixture unit');
  unit.originalJsonText = JSON.stringify(JSON.parse(unit.originalJsonText), null, 2);
  unit.originalSha256 = await rawHash(unit.originalJsonText);
  const group = (await buildImportGroups([unit], () => crypto.randomUUID()))[0]!;
  const response = await destination.client.request('/imports', group.chunks[0]);
  expect(apiSchemas.ImportPreview.parse(await response.json()).items[0]!.status).toBe('conflict');
});

test('expired abandoned previews release staging row overhead after their retry window', async () => {
  const { client } = await readingAccount(),
    group = await importGroup({ children: 4 });
  await uploadGroup(client, group);
  await env.DB.prepare('UPDATE import_batches SET expires_at=1').run();
  await env.DB.prepare('UPDATE import_groups SET expires_at=1,retain_until=1').run();
  await env.DB.prepare(
    "UPDATE idempotency_keys SET expires_at=1 WHERE operation LIKE 'imports.%'",
  ).run();
  await new RetentionMaintenance(env.DB).run();
  for (const table of ['import_items', 'import_batches', 'import_groups'])
    expect(await env.DB.prepare(`SELECT count(*) n FROM ${table}`).first('n')).toBe(0);
});
