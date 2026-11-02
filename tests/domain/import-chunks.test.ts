import { expect, test } from 'vitest';
import { parseImport, parseImportFile } from '../../src/domain/imports/parse.ts';
import {
  buildImportGroups,
  runImportGroups,
  verifyImportGroup,
} from '../../src/domain/imports/chunks.ts';
import { identityKey } from '../../src/domain/imports/identity.ts';
import { rawHash } from '../../src/domain/imports/legacy.ts';

const source = { namespaceId: '11111111-1111-4111-8111-111111111111', revision: 'original' };
const groupId = '22222222-2222-4222-8222-222222222222';
test('a large selected family spans bounded previews without losing identity, lexical text or ordering', async () => {
  const document = JSON.stringify({
    exportedAt: '2026-10-26T00:00:00Z',
    entryCount: 1,
    entries: [
      {
        id: 'root',
        personalReading: 'Root',
        followUps: Array.from({ length: 101 }, (_, i) => ({
          turnNumber: i + 1,
          question: `Q${i}`,
          answer: '😀\\"'.repeat(1100),
        })),
      },
    ],
  });
  const file = await parseImportFile({
    format: 'tarot-json',
    source,
    recovery: { kind: 'none' },
    document,
  });
  const groups = await buildImportGroups(file.units, () => groupId);
  expect(groups).toHaveLength(1);
  const group = groups[0]!;
  expect(group.units).toHaveLength(102);
  expect(group.chunks.length).toBeGreaterThan(1);
  const reopened = [];
  for (const request of group.chunks) {
    expect(new TextEncoder().encode(JSON.stringify(request)).length).toBeLessThanOrEqual(
      2 * 1024 * 1024,
    );
    expect(request.document.length).toBeLessThanOrEqual(200000);
    reopened.push(...(await parseImport(request)).units);
  }
  expect(reopened).toEqual(group.units);
  expect(new Set(reopened.map((u) => u.key)).size).toBe(102);
  expect(await verifyImportGroup(group.chunks)).toEqual(group.units);
  await expect(verifyImportGroup(group.chunks.slice(1))).rejects.toThrow('IMPORT_INVALID');
  const forged = structuredClone(group.chunks);
  const carrier = JSON.parse(forged[0]!.document) as {
    items: { unit: { record: { question: string } } }[];
  };
  carrier.items[0]!.unit.record.question = 'changed after preview';
  forged[0]!.document = JSON.stringify(carrier);
  await expect(verifyImportGroup(forged)).rejects.toThrow('IMPORT_INVALID');
});

test('cancellation prevents the next group while reconciling the submitted group', async () => {
  const controller = new AbortController(),
    submitted: string[] = [],
    reconciled: string[] = [];
  const result = await runImportGroups(
    ['a', 'b'],
    controller.signal,
    async (id) => {
      submitted.push(id);
      controller.abort();
      return { groupId: id };
    },
    async (id) => {
      reconciled.push(id);
      return 'complete';
    },
  );
  expect(submitted).toEqual(['a']);
  expect(reconciled).toEqual(['a']);
  expect(result).toEqual([{ groupId: 'a', outcome: 'complete' }]);
});

test('already cancelled submission does nothing and an uncertain submitted outcome is not retried', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(
    await runImportGroups(
      ['a'],
      controller.signal,
      async () => {
        throw new Error('must not submit');
      },
      async () => 'complete',
    ),
  ).toEqual([]);
  const live = new AbortController();
  let calls = 0;
  await expect(
    runImportGroups(
      ['a', 'b'],
      live.signal,
      async (id) => ({ groupId: id }),
      async () => {
        calls++;
        throw new Error('unresolved');
      },
    ),
  ).rejects.toThrow('unresolved');
  expect(calls).toBe(1);
});

test('lost commit acknowledgement reconciles that same group without another submission', async () => {
  const calls: string[] = [];
  const result = await runImportGroups(
    ['a'],
    new AbortController().signal,
    async (id) => {
      calls.push(id);
      throw new Error('connection lost after commit');
    },
    async (id) => {
      expect(id).toBe('a');
      return 'complete';
    },
  );
  expect(result).toEqual([{ groupId: 'a', outcome: 'complete' }]);
  expect(calls).toEqual(['a']);
});

test('a missing selected parent remains explicit rather than being silently selected', async () => {
  const file = await parseImportFile({
    format: 'tarot-json',
    source,
    recovery: { kind: 'none' },
    document: JSON.stringify({
      exportedAt: 'x',
      entryCount: 1,
      entries: [{ id: 'p', question: 'Parent', followUps: [{ turnNumber: 1, question: 'Child' }] }],
    }),
  });
  const child = file.units.find((u) => u.parentIdentity !== null)!;
  const groups = await buildImportGroups([child], () => groupId);
  expect(groups[0]!.units.map((u) => u.key)).toEqual([child.key]);
  expect(
    groups[0]!.unresolved.map((d) =>
      d.recordRevision === null
        ? 'unknown'
        : identityKey({ ...d, recordRevision: d.recordRevision }),
    ),
  ).toContain(identityKey(child.parentIdentity!));
});

test('near-1-MiB mixed-source export pages rechunk without retaining account metadata or changing record identity', async () => {
  const second = { ...source, namespaceId: '33333333-3333-4333-8333-333333333333' };
  const raw = JSON.stringify({ text: 'x'.repeat(6500) }),
    hash = await rawHash(raw);
  const records = Array.from({ length: 100 }, (_, i) => {
    const identity = {
      source: i < 50 ? source : second,
      kind: 'reading',
      recordId: `upstream-${i}`,
      recordRevision: 1,
    };
    return {
      kind: 'reading',
      identity,
      originalId: identity.recordId,
      value: {
        kind: 'legacy.imported.v1',
        editionId: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
        sessionId: groupId,
        editionNumber: i + 1,
        record: {
          format: 'reflection-import.v1',
          identity,
          parentIdentity: null,
          source: 'successor',
          originalId: identity.recordId,
          originalParentId: null,
          originalTimestamp: null,
          occurredAt: null,
          question: 'q',
          generatedText: 'x'.repeat(1500),
          userStatements: [],
          basis: {
            method: 'unknown',
            cards: [],
            sourceIds: [],
            rawBasisJson: null,
            verification: 'legacy_unverified',
          },
          originalJsonText: raw,
          originalSha256: hash,
          provenanceGaps: ['basis'],
          review: 'legacy_unknown',
        },
        importedAt: '2026-10-26T00:00:00Z',
      },
    };
  });
  const page = {
    format: 'reflection-export.v1',
    exportId: groupId,
    snapshotRevision: 1,
    records,
    nextCursor: null,
    exportedAt: '2026-10-26T00:00:00Z',
    account: {
      subjectId: source.namespaceId,
      createdAt: '2026-10-26T00:00:00Z',
      credentials: [
        { id: 'PRIVATE_CREDENTIAL_MARKER', createdAt: '2026-10-26T00:00:00Z', backedUp: true },
      ],
    },
  };
  const document = JSON.stringify(page);
  expect(document.length).toBeGreaterThan(800000);
  expect(document.length).toBeLessThan(1024 * 1024);
  const parsed = await parseImportFile({
    format: 'reflection-export.v1',
    source,
    recovery: { kind: 'none' },
    document,
  });
  expect(parsed.units).toHaveLength(100);
  let next = 0;
  const groups = await buildImportGroups(
    parsed.units,
    () => `55555555-5555-4555-8555-${String(++next).padStart(12, '0')}`,
  );
  expect(groups).toHaveLength(2);
  const roundtrip = [];
  for (const group of groups) roundtrip.push(...(await verifyImportGroup(group.chunks)));
  expect(new Set(roundtrip.map((u) => u.key))).toEqual(new Set(parsed.units.map((u) => u.key)));
  expect(JSON.stringify(groups)).not.toContain('PRIVATE_CREDENTIAL_MARKER');
});

test('normalized near-limit records including Unicode/escaping fit the request envelope and over-limit records are reported', async () => {
  const raw = (length: number) =>
    JSON.stringify({
      exportedAt: 'x',
      entryCount: 1,
      entries: [{ id: 'edge', personalReading: 'x'.repeat(length), question: '😀\\"' }],
    });
  // Long generated prose alone has its own 30k field cap; a structured artifact exercises the byte boundary.
  const pattern = (length: number) => ({
    format: 'patternlike-export',
    source,
    recovery: { kind: 'none' as const },
    document: JSON.stringify({
      schema_version: '0.7.0',
      readings: { items: [{ id: 'edge', artifact: { data: 'x'.repeat(length) }, evidence: null }] },
    }),
  });
  const valid = await parseImportFile(pattern(96000));
  expect(valid.errors).toEqual([]);
  const groups = await buildImportGroups(valid.units, () => groupId);
  expect(await verifyImportGroup(groups[0]!.chunks)).toEqual(valid.units);
  const tooLarge = await parseImportFile(pattern(100000));
  expect(tooLarge.errors).toEqual([{ pointer: '/readings/items/0', code: 'INPUT_TOO_LARGE' }]);
  const unicode = await parseImportFile({
    format: 'tarot-json',
    source,
    recovery: { kind: 'none' },
    document: raw(1000),
  });
  expect(
    await verifyImportGroup((await buildImportGroups(unicode.units, () => groupId))[0]!.chunks),
  ).toEqual(unicode.units);
});
