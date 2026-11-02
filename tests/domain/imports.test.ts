import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  parseImport,
  selectImportUnits,
  eraseImportUnits,
} from '../../src/domain/imports/parse.ts';
import { importKeyInput, importEntityInput } from '../../src/domain/imports/identity.ts';
import { decodeImportBytes } from '../../src/domain/imports/json.ts';
import { validateUnit } from '../../src/domain/imports/parse.ts';
import { rawHash } from '../../src/domain/imports/legacy.ts';
import { parseImportFile } from '../../src/domain/imports/parse.ts';
import { identityKey } from '../../src/domain/imports/identity.ts';

const source = { namespaceId: '11111111-1111-4111-8111-111111111111', revision: 'original' };
const input = (document: string, format = 'tarot-json') => ({
  source,
  recovery: { kind: 'none' as const },
  document,
  format,
});
const tarot = readFileSync(
  new URL('../fixtures/imports/tarot-nested.json', import.meta.url),
  'utf8',
);

test('Tarot base, authored notes and follow-ups are separate units with isolated raw provenance', async () => {
  const result = await parseImport(input(tarot));
  expect(result.units).toHaveLength(4);
  const parent = result.units.find(
    (u) => u.kind === 'legacy-reading' && u.record.originalId === 'parent',
  )!;
  const selected = selectImportUnits(result, [parent.key]);
  expect(selected).toHaveLength(1);
  expect(JSON.stringify(selected)).toContain('PARENT_PROSE');
  for (const secret of [
    'DESELECTED_REFLECTION',
    'DESELECTED_CARD_NOTE',
    'DESELECTED_CHILD',
    'UNSELECTED_HISTORY',
  ])
    expect(JSON.stringify(selected)).not.toContain(secret);
  expect(parent.kind === 'legacy-reading' && parent.record.question).toBe(' parent question 😀 ');
});

test('child erasure removes every owned raw copy and keeps the independent parent', async () => {
  const result = await parseImport(input(tarot));
  const child = result.units.find(
    (u) => u.kind === 'legacy-reading' && u.record.originalId !== 'parent',
  )!;
  const copies = [...result.units, structuredClone(child), structuredClone(child)];
  const retained = eraseImportUnits(copies, child.identity);
  expect(JSON.stringify(retained)).not.toContain('DESELECTED_CHILD');
  expect(JSON.stringify(retained)).not.toContain('canonical child');
  expect(JSON.stringify(retained)).toContain('PARENT_PROSE');
});

test('selected raw spans preserve lexical strings, identity inputs exclude transport metadata', async () => {
  const doc =
    '{"exportedAt":"2026-10-26T00:00:00Z","entryCount":1,"entries":[{ "id" : "raw", "question":"\\u0061", "personalReading" : "exact" }]}';
  const first = (await parseImport(input(doc))).units[0]!;
  expect(first.kind === 'legacy-reading' && first.record.originalJsonText).toContain(
    '"question":"\\u0061"',
  );
  expect(first.kind === 'legacy-reading' && first.record.question).toBe('a');
  expect(importKeyInput(first.identity)).toEqual([
    'import-key.v1',
    source.namespaceId,
    'original',
    'reading',
    'raw',
    1,
  ]);
  expect(importEntityInput(first.identity)).toEqual([
    'import-entity.v1',
    source.namespaceId,
    'reading',
    'raw',
    1,
  ]);
});

test('Patternlike versions retain bounded unverified artifacts without inventing prose or private root sections', async () => {
  for (const version of ['0.7.0', '0.8.0']) {
    const document = readFileSync(
      new URL(`../fixtures/imports/patternlike-${version}.json`, import.meta.url),
      'utf8',
    );
    const result = await parseImport(input(document, 'patternlike-export'));
    expect(result.units).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('UNSELECTED_PROFILE');
    const reading = result.units[0]!;
    expect(reading.kind === 'legacy-reading' && reading.record.generatedText).toBe(null);
  }
  await expect(
    parseImport(input('{"schema_version":"0.9.0"}', 'patternlike-export')),
  ).rejects.toThrow('IMPORT_INVALID');
  await expect(parseImport(input('{}', 'pixel-json'))).rejects.toThrow('IMPORT_INVALID');
});

test('malformed, ambiguous, oversized and forbidden records fail without repair', async () => {
  for (const document of [
    '{"entries":[]',
    '{"entries":[],"entries":[]}',
    '{"__proto__":{}}',
    '['.repeat(70) + ']'.repeat(70),
  ])
    await expect(parseImport(input(document))).rejects.toThrow('IMPORT_INVALID');
  const document = JSON.stringify({
    exportedAt: 'x',
    entryCount: 1,
    entries: [{ id: 'x', question: 'q'.repeat(10001) }],
  });
  expect((await parseImport(input(document))).errors).toEqual([
    { pointer: '/entries/0', code: 'IMPORT_INVALID' },
  ]);
  await expect(parseImport(input(' '.repeat(200001)))).rejects.toThrow('INPUT_TOO_LARGE');
  expect(() => decodeImportBytes(new Uint8Array([0xff, 0xfe]))).toThrow('IMPORT_INVALID');
});

test('canonical round-trip preserves exact raw provenance, long questions and unsupported nested copies fail explicitly', async () => {
  const parent = (await parseImport(input(tarot))).units[0]!;
  if (parent.kind !== 'legacy-reading') throw new Error('fixture kind');
  const record = { ...parent.record, question: `${'q'.repeat(499)}😀tail` };
  const canonical = JSON.stringify({ format: 'reflection-import.v1', records: [record] });
  const reopened = await parseImport(input(canonical, 'reflection-import.v1'));
  expect(reopened.units[0]!.record).toEqual(record);
  const unsafe = { ...record, originalJsonText: '{"followUps":[{"answer":"hidden"}]}' };
  const rejected = await parseImport(
    input(
      JSON.stringify({ format: 'reflection-import.v1', records: [unsafe] }),
      'reflection-import.v1',
    ),
  );
  expect(rejected.units).toEqual([]);
  expect(rejected.errors).toHaveLength(1);
});

test('invalid nested shapes and colliding IDs cannot silently retain an ambiguous parent', async () => {
  const doc = {
    exportedAt: 'x',
    entryCount: 2,
    entries: [
      { id: 'duplicate', question: 'first' },
      { id: 'duplicate', question: 'second' },
    ],
  };
  const result = await parseImport(input(JSON.stringify(doc)));
  expect(result.units).toEqual([]);
  expect(result.errors).toHaveLength(2);
  const nested = await parseImport(
    input(
      JSON.stringify({
        exportedAt: 'x',
        entryCount: 1,
        entries: [{ id: 'p', reflections: ['lost note'] }],
      }),
    ),
  );
  expect(nested.errors).toEqual([{ pointer: '/entries/0/reflections', code: 'IMPORT_INVALID' }]);
});

test('forged raw parent carriers cannot retain nested deselected content even with a matching hash', async () => {
  const parent = (await parseImport(input(tarot))).units[0]!;
  if (parent.kind !== 'legacy-reading') throw new Error('fixture');
  parent.record.originalJsonText = JSON.stringify(JSON.parse(tarot).entries[0]);
  parent.record.originalSha256 = await rawHash(parent.record.originalJsonText);
  await expect(validateUnit(parent)).rejects.toThrow('IMPORT_INVALID');
});

test('child erasure also removes retained copies aliased under another source revision', async () => {
  const child = (await parseImport(input(tarot))).units.find(
    (u) => u.parentIdentity !== null && u.kind === 'legacy-reading',
  )!;
  const aliased = structuredClone(child);
  aliased.identity.source.revision = 'later-revision';
  aliased.key = identityKey(aliased.identity);
  expect(eraseImportUnits([child, aliased], child.identity)).toEqual([]);
});

test('a missing upstream parent ID stays missing even when the internal source identity uses a digest', async () => {
  const result = await parseImport(
    input(
      JSON.stringify({
        exportedAt: 'x',
        entryCount: 1,
        entries: [{ question: 'Parent without ID', followUps: [{ question: 'child' }] }],
      }),
    ),
  );
  const child = result.units.find((u) => u.parentIdentity !== null)!;
  expect(child.parentIdentity!.recordId).toMatch(/^sha256:/);
  expect(child.kind === 'legacy-reading' && child.record.originalParentId).toBe(null);
});

test('authored identities survive source revision changes and parent entry reordering so erasure finds every copy', async () => {
  const entries = [
    { id: 'other', question: 'other' },
    { id: 'p', reflections: { feelings: 'SECRET_NOTE' } },
  ];
  const first = await parseImport(
    input(JSON.stringify({ exportedAt: 'x', entryCount: 2, entries })),
  );
  const second = await parseImport({
    ...input(JSON.stringify({ exportedAt: 'x', entryCount: 2, entries: [...entries].reverse() })),
    source: { ...source, revision: 'later-revision' },
  });
  const old = first.units.find((u) => u.kind === 'legacy-authored')!,
    newer = second.units.find((u) => u.kind === 'legacy-authored')!;
  expect(newer.identity.recordId).toBe(old.identity.recordId);
  expect(eraseImportUnits([old, newer], old.identity)).toEqual([]);
});

test('portable wrappers cannot hide nested Tarot child text under recomputed raw hashes', async () => {
  const parent = (await parseImport(input(tarot))).units[0]!;
  if (parent.kind !== 'legacy-reading') throw new Error('fixture');
  const page = {
    format: 'reflection-export.v1',
    exportId: source.namespaceId,
    snapshotRevision: 1,
    records: [
      {
        kind: 'reading',
        identity: parent.identity,
        originalId: 'parent',
        value: {
          kind: 'legacy.imported.v1',
          editionId: source.namespaceId,
          sessionId: source.namespaceId,
          editionNumber: 1,
          record: parent.record,
          importedAt: '2026-10-26T00:00:00Z',
        },
      },
    ],
    nextCursor: null,
    exportedAt: '2026-10-26T00:00:00Z',
    account: null,
  };
  const unit = (await parseImportFile(input(JSON.stringify(page), 'reflection-export.v1')))
    .units[0]!;
  if (
    unit.kind !== 'portable' ||
    unit.record.kind !== 'reading' ||
    unit.record.value.kind !== 'legacy.imported.v1'
  )
    throw new Error('fixture');
  unit.record.value.record.originalJsonText = '{"followUps":[{"answer":"UNSELECTED_CHILD"}]}';
  unit.record.value.record.originalSha256 = await rawHash(
    unit.record.value.record.originalJsonText,
  );
  unit.originalJsonText = JSON.stringify(unit.record);
  unit.originalSha256 = await rawHash(unit.originalJsonText);
  await expect(validateUnit(unit)).rejects.toThrow('IMPORT_INVALID');
});

test.each([
  '{"reflections":["UNSELECTED"]}',
  '{"context":{"patterns":["UNSELECTED"]}}',
  '{"cards":[{"name":"The Fool","meaning":{"private":"UNSELECTED"}}]}',
])('malformed nested raw fields cannot bypass projected selection: %s', async (original) => {
  const parent = (await parseImport(input(tarot))).units[0]!;
  if (parent.kind !== 'legacy-reading') throw new Error('fixture');
  parent.record.originalJsonText = original;
  parent.record.originalSha256 = await rawHash(original);
  await expect(validateUnit(parent)).rejects.toThrow('IMPORT_INVALID');
});
