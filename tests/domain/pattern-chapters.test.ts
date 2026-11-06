import { expect, test } from 'vitest';
import {
  buildPatternChapters,
  syntheticPatternRelease,
  validatePatternCatalogue,
} from '../../src/domain/astrology/chapters.ts';
import { AstrologyBasisV2 } from '../../src/contracts/astrology.ts';
import {
  CHAPTER_BODIES,
  NATAL_BODIES,
  ZODIAC_SIGNS,
} from '../../src/contracts/astrology-policy.ts';
import { CALCULATION_IDENTITY } from '../../src/domain/astrology/calculate.ts';
import { sha256Json } from '../../src/domain/json.ts';
import draft from '../../content/pattern-draft.json';
import parity from '../fixtures/astrology-node-parity.json';

const id = '11111111-1111-4111-8111-111111111111';
function basis(signIndex = 0) {
  return AstrologyBasisV2.parse({
    kind: 'astrology.natal.v2',
    schemaVersion: 2,
    basisId: id,
    calculationId: id,
    profileId: id,
    profileRevision: 1,
    calculatedAt: '2026-11-05T00:00:00Z',
    semanticHash: 'a'.repeat(64),
    calculation: {
      kind: 'calculated',
      input: parity[0]!.input,
      resolved: parity[0]!.resolved,
      identity: CALCULATION_IDENTITY,
      placements: NATAL_BODIES.map((body) => ({
        status: 'supported',
        body,
        id: `sign:${body}`,
        sign: ZODIAC_SIGNS[signIndex],
        representativeLongitudeDeg: signIndex * 30 + 15,
        maximumDeviationDeg: 0,
        guardDeg: 0.05,
      })),
      evaluatedInstants: 1,
    },
  });
}
test('all 48 body/sign combinations produce deterministic separately labeled chapters', async () => {
  const release = await syntheticPatternRelease(draft);
  for (let i = 0; i < 12; i++) {
    const chapters = await buildPatternChapters(basis(i), release, { allowSynthetic: true });
    expect(chapters).toEqual(
      await buildPatternChapters(basis(i), release, { allowSynthetic: true }),
    );
    expect(chapters.map((c) => (c.status === 'available' ? c.chapter.id : c.id))).toEqual(
      Object.keys(CHAPTER_BODIES),
    );
    for (const state of chapters) {
      expect(state.status).toBe('available');
      if (state.status !== 'available') throw Error(state.status);
      expect(state.chapter.sign).toBe(ZODIAC_SIGNS[i]);
      expect(state.chapter.body).toBe(CHAPTER_BODIES[state.chapter.id]);
      expect(state.chapter.factualLabel).not.toBe(state.chapter.text);
      expect(state.chapter.editorialStatus).toBe('synthetic_local');
    }
  }
});
test('suppressed Venus never produces a Connection sign claim', async () => {
  const b = basis();
  b.calculation.placements = b.calculation.placements.map((p) =>
    p.body === 'venus' ? { status: 'suppressed', body: 'venus', reason: 'boundary' } : p,
  );
  const chapters = await buildPatternChapters(b, await syntheticPatternRelease(draft), {
    allowSynthetic: true,
  });
  expect(chapters[1]).toEqual({
    status: 'unavailable',
    id: 'connection',
    reason: 'placement_suppressed',
  });
  expect(chapters[0]!.status).toBe('available');
});
test('withdrawn, unreviewed, changed or synthetic production content is unavailable', async () => {
  const release = await syntheticPatternRelease(draft);
  expect(
    (await buildPatternChapters(basis(), release)).every((c) => c.status === 'unavailable'),
  ).toBe(true);
  for (const edited of [
    { ...release, state: 'withdrawn' },
    { ...release, review: { ...release.review, kind: 'unreviewed' } },
    { ...release, catalogue: { ...release.catalogue, version: 2 } },
  ])
    expect(
      (await buildPatternChapters(basis(), edited as never, { allowSynthetic: true })).every(
        (c) => c.status === 'unavailable',
      ),
    ).toBe(true);
});
test.each(['title', 'text', 'prompt'] as const)(
  'catalogue rejects unsupported claims in %s even with a valid source hash',
  async (field) => {
    const altered = structuredClone(draft);
    const entry = altered.entries[0]!;
    entry[field] = 'Your ascendant is changing.';
    const { sourceHash: _sourceHash, ...source } = entry;
    entry.sourceHash = await sha256Json(source);
    await expect(validatePatternCatalogue(altered)).rejects.toThrow(
      'Unsupported technical or deterministic claim',
    );
  },
);
test('catalogue rejects a body that does not belong to its chapter', async () => {
  const altered = structuredClone(draft);
  altered.entries[0]!.body = 'venus';
  await expect(validatePatternCatalogue(altered)).rejects.toThrow(
    'Catalogue source binding mismatch',
  );
});
test('catalogue rejects stale source hashes', async () => {
  const altered = structuredClone(draft);
  altered.entries[0]!.text = 'Edited after review';
  await expect(validatePatternCatalogue(altered)).rejects.toThrow('Pattern source hash mismatch');
});
test('catalogue accepts supported wording with a matching source hash', async () => {
  const altered = structuredClone(draft);
  const entry = altered.entries[0]!;
  entry.text = 'A different reflection to consider.';
  const { sourceHash: _sourceHash, ...source } = entry;
  entry.sourceHash = await sha256Json(source);
  await expect(validatePatternCatalogue(altered)).resolves.toEqual(altered);
});
