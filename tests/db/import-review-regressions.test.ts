import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas, SelectedFragment } from '../../src/contracts/index.ts';
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

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(async () => {
  await clearDatabase(env.DB);
  for (const entry of await objects(env.RECOVERY, '')) await env.RECOVERY.delete(entry.key);
});
const family = (value: Awaited<ReturnType<typeof portableGroups>>) =>
  value.groups.find((g) => g.units.some((u) => u.identity.kind === 'session'))!;

test.each(['withdrawal', 'restore'])(
  'native compatibility aliases cannot export a body after %s',
  async (mode) => {
    const f = await fixture(),
      exported = await portableGroups(f.client);
    await commitGroup(f.client, family(exported));
    const hash = await env.DB.prepare('SELECT content_hash FROM reading_editions WHERE id=?')
      .bind(f.reading.editionId)
      .first<string>('content_hash');
    const revision = await env.DB.prepare('SELECT revision FROM system_state').first<number>(
      'revision',
    );
    if (mode === 'withdrawal') await withdrawContent(env.DB, hash!, revision!);
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

test('a native session alias does not hide a later revision or its new child IDs', async () => {
  const f = await fixture();
  await commitGroup(f.client, family(await portableGroups(f.client)));
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
  expect(
    sessions.some(
      (r) => r.value.revision === current.revision && r.value.reflectionIds.includes(authored.id),
    ),
  ).toBe(true);
  const destination = await readingAccount();
  expect((await commitGroup(destination.client, family(output))).status.state).toBe('complete');
});

test('materialized native import copies also become unreadable when their source content is withdrawn', async () => {
  const f = await fixture(),
    original = family(await portableGroups(f.client));
  await commitGroup(f.client, original);
  const copy = (await buildImportGroups(original.units, () => crypto.randomUUID()))[0]!;
  copy.chunks = copy.chunks.map((c) => ({
    ...c,
    source: { ...c.source, revision: 'deliberate-copy' },
    recovery: { kind: 'new_revision' as const, previousSource: c.source },
  }));
  await commitGroup(f.client, copy);
  const copied = await env.DB.prepare(
    'SELECT edition_id FROM import_identities WHERE materialized=1 AND edition_id IS NOT NULL',
  ).first<string>('edition_id');
  const hash = await env.DB.prepare('SELECT content_hash FROM reading_editions WHERE id=?')
      .bind(f.reading.editionId)
      .first<string>('content_hash'),
    revision = await env.DB.prepare('SELECT revision FROM system_state').first<number>('revision');
  await withdrawContent(env.DB, hash!, revision!);
  expect((await f.client.request(`/readings/${copied}`)).status).toBe(410);
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
        selected: [
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
    "SELECT session_id FROM import_identities WHERE owner_id!=? AND entity_kind='edition'",
  )
    .bind(source.session.subjectId)
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
    (await commitGroup(destination.client, family(await portableGroups(source.client)))).status
      .state,
  ).toBe('complete');
  for (const table of ['reflections', 'revisits'])
    expect(
      await env.DB.prepare(`SELECT count(*) n FROM ${table} WHERE owner_id!=?`)
        .bind(source.session.subjectId)
        .first('n'),
    ).toBe(1);
  expect(
    await env.DB.prepare('SELECT current_revision FROM reflections WHERE owner_id!=?')
      .bind(source.session.subjectId)
      .first('current_revision'),
  ).toBe(2);
  expect(
    await env.DB.prepare('SELECT current_revision FROM revisits WHERE owner_id!=?')
      .bind(source.session.subjectId)
      .first('current_revision'),
  ).toBe(2);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM revisit_revisions WHERE owner_id!=?')
      .bind(source.session.subjectId)
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
  const response = await destination.client.request('/imports/preview', group.chunks[0]);
  expect(apiSchemas.ImportPreview.parse(await response.json()).items[0]!.status).toBe('conflict');
});

test('expired abandoned previews release staging row overhead after their retry window', async () => {
  const { client } = await readingAccount(),
    group = await importGroup({ children: 4 });
  await uploadGroup(client, group);
  await env.DB.prepare('UPDATE import_batches SET expires_at=1').run();
  await env.DB.prepare('UPDATE import_groups SET expires_at=1,outcome_expires_at=1').run();
  await env.DB.prepare(
    "UPDATE idempotency_keys SET expires_at=1 WHERE operation LIKE 'imports.%'",
  ).run();
  await new RetentionMaintenance(env.DB).run();
  for (const table of ['import_items', 'import_batches', 'import_groups'])
    expect(await env.DB.prepare(`SELECT count(*) n FROM ${table}`).first('n')).toBe(0);
});
