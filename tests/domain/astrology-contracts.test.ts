import { expect, test } from 'vitest';
import {
  AstrologyInputV2,
  BirthDraft,
  PatternChapterV1,
  PatternReadingV1,
  PatternSaveInput,
  ResolvedBirthTime,
} from '../../src/contracts/astrology.ts';
import { AnyAcceptedReading, ImportedReading } from '../../src/contracts/index.ts';
import { Reading, PortableRecord } from '../../src/contracts/index.ts';
import { patternFixture } from '../fixtures/pattern.ts';
import { editionContextPassages } from '../../src/contracts/context-reading.ts';

const hash = 'a'.repeat(64);
const place = {
  source: 'manual',
  label: 'Portland, Oregon',
  latitudeDeg: 45.52,
  longitudeEastDeg: -122.68,
  zone: 'America/Los_Angeles',
};
const birth = {
  date: '2000-02-29',
  place,
  time: { certainty: 'unknown' },
  historicalZoneConfirmed: false,
};

test('native Pattern joins Reading while the frozen v1 portability and tarot contracts remain distinct', async () => {
  const { reading } = await patternFixture();
  expect(Reading.parse(reading)).toEqual(reading);
  expect(editionContextPassages(reading)).toEqual([]);
  expect(AnyAcceptedReading.safeParse(reading).success).toBe(false);
  expect(ImportedReading.safeParse(reading).success).toBe(false);
  expect(
    PatternReadingV1.safeParse({ ...reading, chapter: { ...reading.chapter, sign: 'aries' } })
      .success,
  ).toBe(false);
  expect(
    PortableRecord.safeParse({
      kind: 'reading',
      originalId: reading.editionId,
      value: reading,
      identity: {
        source: { namespaceId: reading.sessionId, revision: 'v1' },
        kind: 'reading',
        recordId: reading.editionId,
        recordRevision: 1,
      },
    }).success,
  ).toBe(false);
});

test('birth drafts distinguish all three certainties without a noon surrogate', () => {
  for (const time of [
    { certainty: 'unknown' },
    { certainty: 'exact', localTime: '08:30:00' },
    { certainty: 'approximate', earliestLocalTime: '08:00', latestLocalTime: '09:00' },
  ]) {
    expect(BirthDraft.parse({ ...birth, time }).time).toEqual(time);
  }
  for (const time of [
    { certainty: 'unknown', localTime: '12:00' },
    { certainty: 'exact', localTime: '24:00' },
    { certainty: 'approximate', earliestLocalTime: '10:00', latestLocalTime: '09:00' },
  ])
    expect(BirthDraft.safeParse({ ...birth, time }).success).toBe(false);
});

test('rejects invalid dates, coordinates and unrecognized fields before timezone resolution', () => {
  for (const date of [
    '1900-02-29',
    '2025-02-29',
    '2000-13-01',
    '2025-04-31',
    '25-01-01',
    '1899-12-31',
  ])
    expect(BirthDraft.safeParse({ ...birth, date }).success).toBe(false);
  for (const latitudeDeg of [NaN, Infinity, -91, 91])
    expect(BirthDraft.safeParse({ ...birth, place: { ...place, latitudeDeg } }).success).toBe(
      false,
    );
  expect(
    BirthDraft.safeParse({ ...birth, place: { ...place, longitudeEastDeg: 181 } }).success,
  ).toBe(false);
  expect(BirthDraft.safeParse({ ...birth, ownerId: 'injected' }).success).toBe(false);
  const input = {
    kind: 'astrology.natal.v2',
    birth,
    calendar: 'gregorian',
    zodiac: 'tropical',
    houses: 'not_calculated',
  };
  expect(AstrologyInputV2.safeParse(input).success).toBe(true);
  expect(AstrologyInputV2.safeParse({ ...input, houses: 'whole-sign' }).success).toBe(false);
});

test('resolved uncertainty requires a nonempty ordered UTC union', () => {
  const range = {
    kind: 'intervals',
    certainty: 'unknown',
    intervals: [{ startsAt: '2025-11-02T04:00:00Z', endsAt: '2025-11-03T05:00:00Z' }],
    historicalZone: false,
  };
  expect(ResolvedBirthTime.safeParse(range).success).toBe(true);
  expect(ResolvedBirthTime.safeParse({ ...range, intervals: [] }).success).toBe(false);
  expect(
    ResolvedBirthTime.safeParse({ ...range, intervals: [range.intervals[0], range.intervals[0]] })
      .success,
  ).toBe(false);
});

test('chapter source bindings cannot substitute a different planet', () => {
  const chapter = {
    kind: 'pattern.chapter.v1',
    id: 'connection',
    body: 'venus',
    factId: 'sign:venus',
    sign: 'taurus',
    title: 'Making room for connection',
    text: 'A symbolic invitation to notice how you connect.',
    prompt: 'What helps you feel connected?',
    factualLabel: 'Venus in Taurus',
    sourceId: 'connection.taurus',
    releaseHash: hash,
    editorialStatus: 'synthetic_local',
  };
  expect(PatternChapterV1.safeParse(chapter).success).toBe(true);
  for (const change of [{ body: 'sun' }, { factId: 'sign:sun' }, { id: 'unknown' }])
    expect(PatternChapterV1.safeParse({ ...chapter, ...change }).success).toBe(false);
  expect(AnyAcceptedReading.safeParse({ kind: 'astrology.pattern.accepted.v1' }).success).toBe(
    false,
  );
  expect(ImportedReading.safeParse({ kind: 'astrology.pattern.accepted.v1' }).success).toBe(false);
  expect(PatternReadingV1.safeParse({ kind: 'tarot.accepted.v1' }).success).toBe(false);
});

test('save accepts only identities and optional own writing, never client chart facts', () => {
  const save = {
    chapterId: 'self',
    expectedProfileRevision: 1,
    basisHash: hash,
    releaseHash: hash,
    reflection: null,
  };
  expect(PatternSaveInput.safeParse(save).success).toBe(true);
  expect(PatternSaveInput.safeParse({ ...save, facts: [] }).success).toBe(false);
  expect(
    PatternSaveInput.safeParse({
      ...save,
      reflection: { text: 'x'.repeat(10001), stance: 'unsure' },
    }).success,
  ).toBe(false);
});
