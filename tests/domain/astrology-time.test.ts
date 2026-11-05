import { expect, test } from 'vitest';
import { resolveBirthTime } from '../../src/domain/astrology/civil-time.ts';
import type { BirthDraft } from '../../src/contracts/astrology.ts';

const now = new Date('2026-11-05T00:30:00Z');
function draft(date: string, zone: string, time: BirthDraft['time']): BirthDraft {
  return {
    date,
    time,
    historicalZoneConfirmed: true,
    place: { source: 'manual', label: 'Test place', zone, latitudeDeg: 0, longitudeEastDeg: 0 },
  };
}
test.each([
  [
    '2025-11-02',
    'America/New_York',
    '01:30',
    ['2025-11-02T05:30:00.000Z', '2025-11-02T06:30:00.000Z'],
  ],
  [
    '2025-04-06',
    'Australia/Lord_Howe',
    '01:45',
    ['2025-04-05T14:45:00.000Z', '2025-04-05T15:15:00.000Z'],
  ],
])('offers every repeated-clock choice for %s in %s', (date, zone, localTime, at) => {
  const result = resolveBirthTime(draft(date, zone, { certainty: 'exact', localTime }), now);
  expect(result.kind).toBe('fold');
  if (result.kind !== 'fold') throw Error(result.kind);
  expect(result.choices.map((c) => c.at)).toEqual(at);
  const picked = resolveBirthTime(
    draft(date, zone, {
      certainty: 'exact',
      localTime,
      fold: 'later',
      offsetSeconds: result.choices[1]!.offsetSeconds,
    }),
    now,
  );
  expect(picked).toEqual({ kind: 'resolved', time: result.choices[1] });
  expect(
    resolveBirthTime(
      draft(date, zone, { certainty: 'exact', localTime, fold: 'later', offsetSeconds: 0 }),
      now,
    ).kind,
  ).toBe('invalid');
});
test.each([
  ['1992-10-12', 'Asia/Kathmandu', '08:30', '1992-10-12T02:45:00.000Z'],
  ['2026-11-02', 'America/Havana', '12:00', '2026-11-02T16:00:00.000Z'],
  ['2025-10-12', 'US/Eastern', '08:30:15', '2025-10-12T12:30:15.000Z'],
])('uses pinned transition offsets for %s in %s', (date, zone, localTime, at) => {
  const result = resolveBirthTime(draft(date, zone, { certainty: 'exact', localTime }), now);
  expect(result).toMatchObject({ kind: 'resolved', time: { at, fold: 'unambiguous' } });
});
test.each([
  ['2025-03-09', 'America/New_York', '02:30'],
  ['2011-12-30', 'Pacific/Apia', '12:00'],
])('rejects clocks that never occurred on %s', (date, zone, localTime) => {
  expect(resolveBirthTime(draft(date, zone, { certainty: 'exact', localTime }), now).kind).toBe(
    'gap',
  );
});
test.each([
  ['2025-03-09', 23],
  ['2025-11-02', 25],
  ['2025-10-12', 24],
] as const)('unknown %s is the complete %s-hour day', (date, hours) => {
  const result = resolveBirthTime(draft(date, 'America/New_York', { certainty: 'unknown' }), now);
  expect(result.kind).toBe('resolved');
  if (result.kind !== 'resolved' || result.time.kind !== 'intervals')
    throw Error('interval expected');
  expect(
    result.time.intervals.reduce(
      (sum, r) => sum + Date.parse(r.endsAt) - Date.parse(r.startsAt),
      0,
    ) / 3600000,
  ).toBe(hours);
});
test('preserves partial folds and gaps as interval unions and rejects a skipped day', () => {
  const partial = resolveBirthTime(
    draft('2025-04-06', 'Australia/Lord_Howe', {
      certainty: 'approximate',
      earliestLocalTime: '01:40',
      latestLocalTime: '02:10',
    }),
    now,
  );
  expect(partial).toMatchObject({
    kind: 'resolved',
    time: {
      intervals: [
        { startsAt: '2025-04-05T14:40:00.000Z', endsAt: '2025-04-05T15:00:00.000Z' },
        { startsAt: '2025-04-05T15:10:00.000Z', endsAt: '2025-04-05T15:40:00.000Z' },
      ],
    },
  });
  expect(
    resolveBirthTime(
      draft('2025-03-09', 'America/New_York', {
        certainty: 'approximate',
        earliestLocalTime: '02:30',
        latestLocalTime: '03:30',
      }),
      now,
    ),
  ).toMatchObject({
    kind: 'resolved',
    time: {
      intervals: [{ startsAt: '2025-03-09T07:00:00.000Z', endsAt: '2025-03-09T07:30:00.000Z' }],
    },
  });
  expect(
    resolveBirthTime(draft('2011-12-30', 'Pacific/Apia', { certainty: 'unknown' }), now).kind,
  ).toBe('gap');
});
test('validates zone, civil syntax, historical confirmation and local current date', () => {
  for (const [date, zone] of [
    ['2000-02-30', 'UTC'],
    ['1992-01-01', 'missing'],
    ['2026-11-05', 'America/Los_Angeles'],
  ])
    expect(resolveBirthTime(draft(date!, zone!, { certainty: 'unknown' }), now).kind).toBe(
      'invalid',
    );
  expect(
    resolveBirthTime(draft('2026-11-05', 'Asia/Tokyo', { certainty: 'unknown' }), now).kind,
  ).toBe('resolved');
  const old = draft('1900-01-01', 'Europe/Amsterdam', { certainty: 'exact', localTime: '00:00' });
  expect(resolveBirthTime({ ...old, historicalZoneConfirmed: false }, now).kind).toBe(
    'historical_confirmation_required',
  );
  expect(resolveBirthTime(old, now)).toMatchObject({
    kind: 'resolved',
    time: { historicalZone: true },
  });
  expect(
    resolveBirthTime(
      draft('2000-01-01', 'UTC', { certainty: 'exact', localTime: '12:00', fold: 'earlier' }),
      now,
    ).kind,
  ).toBe('invalid');
});
