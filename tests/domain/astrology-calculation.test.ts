import { expect, test } from 'vitest';
import {
  calculateNatal,
  natalLongitude,
  CALCULATION_IDENTITY,
} from '../../src/domain/astrology/calculate.ts';
import { qualifyInterval } from '../../src/domain/astrology/reliability.ts';
import { semanticBasisHash } from '../../src/domain/astrology/identity.ts';
import { resolveBirthTime } from '../../src/domain/astrology/civil-time.ts';
import { AstrologyInputV2, NatalCalculationResult } from '../../src/contracts/astrology.ts';
import reference from '../fixtures/astrology-reference.json';

const angleDistance = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const input = AstrologyInputV2.parse({
  kind: 'astrology.natal.v2',
  calendar: 'gregorian',
  zodiac: 'tropical',
  houses: 'not_calculated',
  birth: {
    date: '1992-10-12',
    place: {
      source: 'manual',
      label: 'Kathmandu',
      latitudeDeg: 27.7,
      longitudeEastDeg: 85.3,
      zone: 'Asia/Kathmandu',
    },
    time: { certainty: 'exact', localTime: '08:30' },
    historicalZoneConfirmed: false,
  },
});
test('apparent true-ecliptic longitudes agree with frozen independent Moshier fixtures', () => {
  for (const row of reference.samples)
    expect(
      angleDistance(
        natalLongitude(row.body as Parameters<typeof natalLongitude>[0], new Date(row.instant)),
        row.longitudeDeg,
      ),
    ).toBeLessThan(reference.toleranceDeg);
});
test('stable intervals need a bound; endpoints alone cannot hide an interior crossing', () => {
  const ranges = [{ startsAt: '2000-01-01T00:00:00Z', endsAt: '2000-01-02T00:00:00Z' }];
  const start = Date.parse(ranges[0]!.startsAt);
  const sample = (at: number) => ({
    longitude: 29 + 2 * Math.sin((Math.PI * (at - start)) / 86400000),
    deviation: 0,
  });
  const result = qualifyInterval('sun', ranges, sample, (_at, radiusDays) => radiusDays * 7, 2048);
  expect(result.status).toBe('suppressed');
  expect(
    qualifyInterval('sun', ranges, () => ({ longitude: 15, deviation: 0 }), null, 2048),
  ).toMatchObject({ status: 'suppressed', reason: 'interval_unqualified' });
  expect(
    qualifyInterval(
      'sun',
      ranges,
      () => ({ longitude: 15, deviation: 0 }),
      (_at, radiusDays) => radiusDays * 1000,
      1,
    ),
  ).toMatchObject({ status: 'suppressed', reason: 'budget_exhausted' });
});
test('guard bands handle cusp and zero wrap, while complete-day stable placements qualify', () => {
  const ranges = [{ startsAt: '2000-01-01T00:00:00Z', endsAt: '2000-01-01T01:00:00Z' }];
  for (const longitude of [0.01, 359.99, 29.99, 30.01])
    expect(
      qualifyInterval(
        'sun',
        ranges,
        () => ({ longitude, deviation: 0 }),
        () => 0,
        20,
      ).status,
    ).toBe('suppressed');
  const uncertain = AstrologyInputV2.parse({
    ...input,
    birth: { ...input.birth, time: { certainty: 'unknown' } },
  });
  const resolved = resolveBirthTime(uncertain.birth, new Date('2026-11-05T00:00:00Z'));
  if (resolved.kind !== 'resolved') throw Error(resolved.kind);
  const result = calculateNatal(uncertain, resolved.time, CALCULATION_IDENTITY);
  expect(NatalCalculationResult.safeParse(result).success).toBe(true);
  if (result.kind !== 'calculated') throw Error(result.kind);
  expect(result.placements.find((p) => p.body === 'sun')).toMatchObject({
    status: 'supported',
    sign: 'libra',
  });
  expect(result.placements.find((p) => p.body === 'moon')).toMatchObject({
    status: 'suppressed',
    reason: 'interval_unqualified',
  });
  expect(result.evaluatedInstants).toBeLessThanOrEqual(2048);
});
test('semantic identity is deterministic, input-sensitive and has no timestamp/random identity', async () => {
  const resolved = resolveBirthTime(input.birth, new Date('2026-11-05T00:00:00Z'));
  if (resolved.kind !== 'resolved') throw Error(resolved.kind);
  const a = calculateNatal(input, resolved.time, CALCULATION_IDENTITY);
  const b = calculateNatal(input, resolved.time, CALCULATION_IDENTITY);
  expect(await semanticBasisHash(a)).toBe(await semanticBasisHash(b));
  const changed = calculateNatal(
    {
      ...input,
      birth: { ...input.birth, place: { ...input.birth.place, label: 'Revised place' } },
    },
    resolved.time,
    CALCULATION_IDENTITY,
  );
  expect(await semanticBasisHash(changed)).not.toBe(await semanticBasisHash(a));
  expect(JSON.stringify(a)).not.toMatch(/basisId|calculatedAt|calculationId/);
  expect(
    calculateNatal(input, { ...resolved.time, certainty: 'unknown' } as never, CALCULATION_IDENTITY)
      .kind,
  ).toBe('unavailable');
  const differentClock = {
    ...input,
    birth: { ...input.birth, time: { certainty: 'exact' as const, localTime: '09:30' } },
  };
  expect(calculateNatal(differentClock, resolved.time, CALCULATION_IDENTITY).kind).toBe(
    'unavailable',
  );
});
