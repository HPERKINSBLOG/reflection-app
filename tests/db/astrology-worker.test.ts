import { expect, test } from 'vitest';
import {
  calculateNatal,
  natalLongitude,
  CALCULATION_IDENTITY,
} from '../../src/domain/astrology/calculate.ts';
import { resolveBirthTime } from '../../src/domain/astrology/civil-time.ts';
import { AstrologyInputV2, ResolvedBirthTime } from '../../src/contracts/astrology.ts';
import { semanticBasisHash } from '../../src/domain/astrology/identity.ts';
import parity from '../fixtures/astrology-node-parity.json';
import reference from '../fixtures/astrology-reference.json';

test('workerd semantic results match the frozen Node exact, approximate and unknown cases', async () => {
  for (const row of parity) {
    const result = calculateNatal(
      AstrologyInputV2.parse(row.input),
      ResolvedBirthTime.parse(row.resolved),
      CALCULATION_IDENTITY,
    );
    if (result.kind === 'calculated') expect(result.placements).toEqual(row.placements);
    expect(await semanticBasisHash(result)).toBe(row.semanticHash);
  }
});

test('workerd uses pinned model and tzdb without network or writer calls', () => {
  const row = reference.samples.find(
    (r) => r.body === 'venus' && r.instant.startsWith('1992-10-12'),
  )!;
  expect(Math.abs(natalLongitude('venus', new Date(row.instant)) - row.longitudeDeg)).toBeLessThan(
    0.05,
  );
  const input = AstrologyInputV2.parse({
    kind: 'astrology.natal.v2',
    calendar: 'gregorian',
    zodiac: 'tropical',
    houses: 'not_calculated',
    birth: {
      date: '2026-11-02',
      place: {
        source: 'manual',
        label: 'Havana',
        latitudeDeg: 23,
        longitudeEastDeg: -82,
        zone: 'America/Havana',
      },
      time: { certainty: 'exact', localTime: '12:00' },
      historicalZoneConfirmed: false,
    },
  });
  const resolved = resolveBirthTime(input.birth, new Date('2026-11-05T00:00:00Z'));
  expect(resolved).toMatchObject({
    kind: 'resolved',
    time: { at: '2026-11-02T16:00:00.000Z', offsetSeconds: -14400 },
  });
  if (resolved.kind !== 'resolved') throw Error(resolved.kind);
  const result = calculateNatal(input, resolved.time, CALCULATION_IDENTITY);
  expect(result.kind).toBe('calculated');
  expect(CALCULATION_IDENTITY.tzdbVersion).toBe('2026f');
});
