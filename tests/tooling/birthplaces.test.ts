import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import manifest from '../../content/astrology/places-manifest.json';
import { buildGazetteer, verifySource } from '../../scripts/build-birthplaces.ts';
import { findBirthplaces, validateBirthplace } from '../../src/worker/astrology/places.ts';

function row(id: string, name: string, lat = '45.5', zone = 'America/Los_Angeles') {
  return [
    id,
    name,
    name,
    '',
    lat,
    '-122.6',
    'P',
    'PPL',
    'US',
    '',
    'OR',
    '',
    '',
    '',
    '100000',
    '',
    '',
    zone,
    '2026-11-05',
  ].join('\t');
}
test('build preserves distinct places and rejects corrupt coordinates, zones and source hashes', () => {
  const rows = buildGazetteer(
    [row('1', 'Portland'), row('2', 'Portland'), row('3', '東京')].join('\n'),
    'US.OR\tOregon\tOregon\t1',
    'US\tUSA\t840\tUS\tUnited States',
  );
  expect(rows).toHaveLength(3);
  expect(rows[0]!.label).toContain('Oregon');
  expect(() => buildGazetteer(row('4', 'Bad', 'NaN'), '', '')).toThrow();
  expect(() => buildGazetteer(row('4', 'Bad', '0', 'Not/AZone'), '', '')).toThrow();
  expect(() => verifySource('text', '0'.repeat(64))).toThrow(/hash/i);
});
test('search is bounded, supports alternate scripts and does not invent small localities', () => {
  verifySource(readFileSync('content/astrology/places.json'), manifest.artifactSha256);
  expect(findBirthplaces('Portland', 20).length).toBeGreaterThanOrEqual(2);
  expect(findBirthplaces('東京', 20).length).toBeGreaterThan(0);
  expect(findBirthplaces('Definitely nonexistent hamlet', 20)).toEqual([]);
  expect(findBirthplaces('a', 20)).toEqual([]);
  expect(findBirthplaces('London', 100).length).toBeLessThanOrEqual(20);
  const place = findBirthplaces('Portland', 1)[0]!;
  expect(validateBirthplace(place)).toBe(true);
  expect(validateBirthplace({ ...place, latitudeDeg: 0 })).toBe(false);
  expect(
    validateBirthplace({
      source: 'manual',
      label: 'My small locality',
      zone: 'UTC',
      latitudeDeg: 1,
      longitudeEastDeg: 2,
    }),
  ).toBe(true);
});
