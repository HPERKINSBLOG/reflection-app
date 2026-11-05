import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas, PortableRecord, type Reading } from '../../src/contracts/index.ts';
import type { z } from 'zod';
import { buildImportGroups } from '../../src/domain/imports/chunks.ts';
import { parseImportFile } from '../../src/domain/imports/parse.ts';
import { readingAccount, readingBindings } from '../fixtures/reading-client.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { localIdentity } from '../../src/worker/identity/routes.ts';
import { ReadingImports } from '../../src/worker/readings/imports.ts';
import { ReadingExports } from '../../src/worker/readings/export.ts';
import { ReadingRecords } from '../../src/worker/readings/records.ts';
beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));
const source = { namespaceId: '4775d143-e97f-40ca-abd3-b25844249268', revision: 'original' };
const recovery = { kind: 'none' as const };
async function setup() {
  const f = await readingAccount(true, false),
    identity = localIdentity(readingBindings)!;
  const session = await identity.sessions.get(f.client.cookies.get('__Host-session'));
  const imports = new ReadingImports(env.DB, identity),
    exports = new ReadingExports(imports),
    records = new ReadingRecords(imports);
  const submit = async (format: string, document: string) => {
    const parsed = await parseImportFile({ source, recovery, format, document });
    expect(parsed.errors).toEqual([]);
    const groups = await buildImportGroups(parsed.units, () => crypto.randomUUID());
    const statuses = [];
    for (const group of groups) {
      for (const chunk of group.chunks) {
        const preview = await imports.preview(session, crypto.randomUUID(), chunk);
        expect(
          preview.items.every((i) => ['ready', 'duplicate'].includes(i.status)),
          JSON.stringify(preview.items),
        ).toBe(true);
      }
      const pending = await imports.groupStatus(session, group.id);
      expect(pending.previewHash).toBeTruthy();
      const complete = await imports.commitGroup(session, group.id, crypto.randomUUID(), {
        version: 'import-group.v1',
        manifestHash: group.manifestHash,
        previewHash: pending.previewHash!,
        confirmedRecovery: recovery,
      });
      expect(complete.state).toBe('complete');
      statuses.push(...(await imports.groupResults(session, group.id, null)).items);
    }
    return statuses;
  };
  const download = async () => {
    const t = await exports.create(session, crypto.randomUUID());
    const pages = [];
    let point: string | null = null;
    do {
      const page = await exports.page(session, t.id, point);
      pages.push(page);
      point = page.nextCursor;
    } while (point);
    return {
      records: pages.flatMap((p) => p.records),
      document: pages.map((p) => JSON.stringify(p)).join('\n'),
    };
  };
  return { ...f, session, imports, exports, records, submit, download };
}
test('a 501-code-point imported question, supplementary boundary and exact authored original survive export and an unchanged reimport', async () => {
  const f = await setup(),
    question = 'x'.repeat(499) + '🌱' + 'z';
  expect([...question]).toHaveLength(501);
  const statuses = await f.submit(
    'tarot-json',
    JSON.stringify({
      entryCount: 1,
      exportedAt: '2026-11-01T12:00:00Z',
      entries: [
        {
          id: 'original',
          question,
          personalReading: '<em>Original interpretation.</em>',
          cards: [],
          reflections: { feelings: 'Authored reflection 😀' },
        },
      ],
    }),
  );
  expect(statuses).toHaveLength(2);
  const history = await f.records.history(f.session);
  expect(history.items).toHaveLength(1);
  expect(history.items[0]).toMatchObject({
    questionPreview: 'x'.repeat(499),
    questionTruncated: true,
    imported: true,
  });
  const initial = await f.records.reading(f.session, history.items[0]!.latestEditionId!);
  expect(initial).toMatchObject({
    kind: 'legacy.imported.v1',
    record: {
      question,
      originalTimestamp: null,
      generatedText: '<em>Original interpretation.</em>',
    },
  });
  const original = await f.download();
  const port = original.records.find((r) => r.kind === 'reflection');
  expect(port).toMatchObject({
    identity: { source },
    value: { text: 'Authored reflection 😀', revision: 1 },
    importedOriginal: { text: 'Authored reflection 😀', originalTimestamp: null },
  });
  const reading = original.records.find((r) => r.kind === 'reading');
  expect(reading).toMatchObject({ identity: { source }, value: initial });
  const again = await f.submit('reflection-export.v1', original.document);
  expect(again.map((x) => x.status)).toEqual(again.map(() => 'duplicate'));
  expect((await f.records.history(f.session)).items).toEqual(history.items);
  const exported = await f.download();
  for (const first of original.records) expect(exported.records).toContainEqual(first);
  expect(await f.records.reading(f.session, history.items[0]!.latestEditionId!)).toEqual(initial);
  expect((await f.client.me()).permission.modelAllowed).toBe(false);
});
test('portable unavailable reading, dated revisions and historical permission survive an account-to-account round trip', async () => {
  const f = await setup(),
    family = crypto.randomUUID(),
    edition = crypto.randomUUID(),
    note = crypto.randomUUID(),
    now = '2026-10-26T09:15:00.000Z';
  type Portable = z.infer<typeof PortableRecord>;
  const rec = (kind: Portable['kind'], id: string, revision: number, value: unknown) =>
    PortableRecord.parse({
      kind,
      identity: { source, kind, recordId: id, recordRevision: revision },
      originalId: id,
      value,
    });
  const missing: z.infer<typeof Reading> = {
    kind: 'reading.unavailable.v1',
    editionNumber: 1,
    editionId: edition,
    sessionId: family,
    parentEditionId: null,
    reason: 'deleted',
    unavailableAt: now,
  };
  const records = [
    rec('session', family, 1, {
      id: family,
      revision: 1,
      status: 'saved',
      question: 'Original question',
      editionIds: [edition],
      reflectionIds: [],
      savedAt: now,
      createdAt: now,
      requests: [],
    }),
    rec('reading', edition, 1, missing),
    ...[1, 2].map((revision) =>
      rec('reflection', note, revision, {
        id: note,
        editionId: edition,
        sessionId: family,
        revision,
        text: 'Revision ' + revision,
        stance: 'unsure',
        updatedAt: now,
      }),
    ),
    rec('permission', source.namespaceId, 1, {
      revision: 1,
      modelAllowed: true,
      policyVersion: 'egress.v1',
    }),
  ];
  const page = apiSchemas.ExportPage.parse({
    format: 'reflection-export.v1',
    exportId: crypto.randomUUID(),
    snapshotRevision: 27,
    records,
    nextCursor: null,
    exportedAt: now,
    account: null,
  });
  await f.submit('reflection-export.v1', JSON.stringify(page));
  const history = (await f.records.history(f.session)).items[0]!;
  expect(await f.records.reading(f.session, history.latestEditionId!)).toEqual({
    ...missing,
    editionId: history.latestEditionId,
    sessionId: history.id,
  });

  const original = await f.download();
  for (const record of records) expect(original.records).toContainEqual(record);
  const roundtrip = await f.submit('reflection-export.v1', original.document);
  expect(roundtrip.every((i) => i.status === 'duplicate')).toBe(true);
  expect((await f.client.me()).permission.modelAllowed).toBe(false);
});
