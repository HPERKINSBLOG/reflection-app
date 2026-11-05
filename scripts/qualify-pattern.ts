// Research runner only. Swiss Ephemeris remains outside the application dependency tree.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { AstrologyInputV2 } from '../src/contracts/astrology.ts';
import { NATAL_BODIES, ZODIAC_SIGNS } from '../src/contracts/astrology-policy.ts';
import {
  calculateNatal,
  natalLongitude,
  CALCULATION_IDENTITY,
} from '../src/domain/astrology/calculate.ts';
import { resolveBirthTime } from '../src/domain/astrology/civil-time.ts';
import { circularDistance } from '../src/domain/astrology/reliability.ts';

const [researchDirectory, outputFile] = process.argv.slice(2);
assert(
  researchDirectory && outputFile,
  'Usage: tsx scripts/qualify-pattern.ts RESEARCH_DIRECTORY OUTPUT',
);
const requireReference = createRequire(resolve(researchDirectory, 'probe.cjs'));
const swiss = requireReference('sweph');
assert.equal(swiss.version(), '2.10.03');
assert.equal(
  JSON.parse(readFileSync(resolve(researchDirectory, 'node_modules/sweph/package.json'), 'utf8'))
    .version,
  '2.10.3-7',
);
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const toleranceDeg = 0.05;
const asOf = '2026-11-05T00:00:00.000Z';
const day = 86400000;
type Body = (typeof NATAL_BODIES)[number];
function reference(body: Body, at: number) {
  const result = swiss.calc_ut(
    at / day + 2440587.5,
    swiss.constants[`SE_${body.toUpperCase()}`],
    swiss.constants.SEFLG_MOSEPH | swiss.constants.SEFLG_SPEED,
  );
  assert.equal(result.error, '');
  assert.equal(result.flag & swiss.constants.SEFLG_MOSEPH, swiss.constants.SEFLG_MOSEPH);
  return { longitude: result.data[0] as number, speed: result.data[3] as number };
}
type Comparison = {
  body: Body;
  instant: string;
  actual: number;
  expected: number;
  differenceDeg: number;
};
const comparisons: Comparison[] = [];
for (let year = 1900; year <= 2100; year++) {
  for (let month = 0; month < 12; month++) {
    const at = new Date(Date.UTC(year, month, 15, 12));
    for (const body of NATAL_BODIES) {
      const actual = natalLongitude(body, at),
        expected = reference(body, +at).longitude;
      comparisons.push({
        body,
        instant: at.toISOString(),
        actual,
        expected,
        differenceDeg: circularDistance(actual, expected),
      });
    }
  }
}
function summary(rows: Comparison[]) {
  return {
    count: rows.length,
    maximumDifferenceDeg: Math.max(...rows.map((r) => r.differenceDeg)),
    passed: rows.every((r) => r.differenceDeg < toleranceDeg),
    corpusSha256: hash(JSON.stringify(rows)),
    worst: [...rows].sort((a, b) => b.differenceDeg - a.differenceDeg).slice(0, 10),
    perBody: Object.fromEntries(
      NATAL_BODIES.map((body) => {
        const selected = rows.filter((r) => r.body === body);
        return [
          body,
          {
            count: selected.length,
            maximumDifferenceDeg: Math.max(...selected.map((r) => r.differenceDeg)),
          },
        ];
      }),
    ),
  };
}

const horizons: Comparison[] = [];
const horizonsSources: { body: Body; sha256: string; header: string[] }[] = [];
for (const body of NATAL_BODIES) {
  const base = `artifacts/your-pattern/qualification/horizons/${body}`;
  const raw = readFileSync(`${base}.json`);
  const request = JSON.parse(readFileSync(`${base}.request.json`, 'utf8'));
  assert.equal(hash(raw), request.responseSha256);
  const response = JSON.parse(raw.toString()).result as string;
  assert.match(response, /Center-site name: GEOCENTRIC/);
  assert.match(response, /ObsEcLon/);
  const rows = response.split('$$SOE')[1]!.split('$$EOE')[0]!.trim().split('\n');
  assert.equal(rows.length, request.dates.length);
  horizonsSources.push({
    body,
    sha256: hash(raw),
    header: response
      .split('\n')
      .filter((l) => /Target body name:|Center body name:|EOP file/.test(l)),
  });
  rows.forEach((row, i) => {
    const fields = row.split(',');
    const at = new Date(request.dates[i]);
    assert(Math.abs(Number(fields[1]) - (+at / day + 2440587.5)) < 1e-7);
    const expected = Number(fields[4]),
      actual = natalLongitude(body, at);
    assert(Number.isFinite(expected));
    horizons.push({
      body,
      instant: at.toISOString(),
      expected,
      actual,
      differenceDeg: circularDistance(actual, expected),
    });
  });
}

function input(date: string, zone = 'Etc/UTC', time: unknown = { certainty: 'unknown' }) {
  return AstrologyInputV2.parse({
    kind: 'astrology.natal.v2',
    calendar: 'gregorian',
    zodiac: 'tropical',
    houses: 'not_calculated',
    birth: {
      date,
      place: {
        source: 'manual',
        label: 'Synthetic qualification fixture',
        latitudeDeg: 0,
        longitudeEastDeg: 0,
        zone,
      },
      time,
      historicalZoneConfirmed: true,
    },
  });
}
const intervals: Array<{ name: string; result: unknown }> = [];
let independentIntervalSamples = 0;
let supportedPlacements = 0;
const intervalFailures: unknown[] = [];
function checkInterval(name: string, candidate: AstrologyInputV2) {
  const resolved = resolveBirthTime(candidate.birth, new Date('2101-01-03T00:00:00Z'));
  assert.equal(resolved.kind, 'resolved');
  if (resolved.kind !== 'resolved') throw Error(name);
  const start = performance.now();
  const result = calculateNatal(candidate, resolved.time, CALCULATION_IDENTITY);
  const wallMs = performance.now() - start;
  assert.equal(result.kind, 'calculated');
  if (result.kind !== 'calculated' || resolved.time.kind !== 'intervals') throw Error(name);
  assert(result.evaluatedInstants <= 2048);
  for (const body of ['moon', 'pluto'])
    assert.equal(result.placements.find((p) => p.body === body)?.status, 'suppressed');
  for (const p of result.placements) {
    if (p.status !== 'supported') continue;
    supportedPlacements++;
    for (const range of resolved.time.intervals) {
      const a = Date.parse(range.startsAt),
        b = Date.parse(range.endsAt);
      // Full union, including both limiting endpoints, at no more than 5-minute spacing.
      const count = Math.ceil((b - a) / 300000);
      for (let j = 0; j <= count; j++) {
        const at = Math.round(a + ((b - a) * j) / count);
        const ref = reference(p.body, at).longitude;
        const model = natalLongitude(p.body, new Date(at));
        independentIntervalSamples++;
        if (
          ZODIAC_SIGNS[Math.floor(ref / 30)] !== p.sign ||
          circularDistance(ref, model) >= toleranceDeg ||
          circularDistance(model, p.representativeLongitudeDeg) > p.maximumDeviationDeg + 1e-8
        )
          intervalFailures.push({
            name,
            body: p.body,
            at: new Date(at).toISOString(),
            ref,
            model,
            placement: p,
          });
      }
    }
  }
  intervals.push({
    name,
    result: {
      birth: candidate.birth,
      resolved: resolved.time,
      placements: result.placements,
      evaluatedInstants: result.evaluatedInstants,
      wallMs,
    },
  });
}
for (const year of [1900, 1925, 1950, 1975, 2000, 2026, 2050, 2100])
  for (const month of [1, 4, 7, 10])
    checkInterval(
      `whole-day-${year}-${month}`,
      input(`${year}-${String(month).padStart(2, '0')}-15`),
    );
checkInterval('spring-day-23h', input('2025-03-09', 'America/New_York'));
checkInterval('fall-day-25h', input('2025-11-02', 'America/New_York'));
checkInterval(
  'disconnected-fold',
  input('2025-11-02', 'America/New_York', {
    certainty: 'approximate',
    earliestLocalTime: '01:15',
    latestLocalTime: '01:45',
  }),
);
checkInterval(
  'half-hour-fold',
  input('2025-04-06', 'Australia/Lord_Howe', {
    certainty: 'approximate',
    earliestLocalTime: '01:30',
    latestLocalTime: '01:59',
  }),
);
checkInterval('historical-second-offset', input('1900-01-15', 'Europe/Paris'));
checkInterval('quarter-hour-zone', input('1992-10-12', 'Asia/Kathmandu'));

// Events selected by the independent ephemeris, not by the adapter under test.
const events: Array<{ body: Body; kind: string; instant: string }> = [];
for (const year of [1900, 1950, 2000, 2026, 2099]) {
  for (const body of [
    'sun',
    'mercury',
    'venus',
    'jupiter',
    'saturn',
    'uranus',
    'neptune',
  ] as Body[]) {
    let boundary = false,
      turning = body === 'sun';
    for (
      let at = Date.UTC(year, 0, 2);
      at < Date.UTC(year + 1, 0, 1) && !(boundary && turning);
      at += day
    ) {
      const before = reference(body, at - day),
        after = reference(body, at);
      let kind: 'boundary' | 'turning' | undefined;
      if (!boundary && Math.floor(before.longitude / 30) !== Math.floor(after.longitude / 30)) {
        kind = 'boundary';
        boundary = true;
      } else if (!turning && before.speed * after.speed < 0) {
        kind = 'turning';
        turning = true;
      }
      if (!kind) continue;
      let lo = at - day,
        hi = at;
      while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2),
          value = reference(body, mid);
        const same =
          kind === 'boundary'
            ? Math.floor(value.longitude / 30) === Math.floor(before.longitude / 30)
            : Math.sign(value.speed) === Math.sign(before.speed);
        if (same) lo = mid;
        else hi = mid;
      }
      const eventAt = new Date(Math.round((lo + hi) / 2));
      events.push({ body, kind, instant: eventAt.toISOString() });
      checkInterval(`${kind}-${body}-${year}`, input(eventAt.toISOString().slice(0, 10)));
      if (kind === 'boundary') {
        const candidate = input(eventAt.toISOString().slice(0, 10), 'Etc/UTC', {
          certainty: 'exact',
          localTime: eventAt.toISOString().slice(11, 19),
        });
        const resolved = resolveBirthTime(candidate.birth, new Date('2101-01-03'));
        assert.equal(resolved.kind, 'resolved');
        if (resolved.kind === 'resolved') {
          const result = calculateNatal(candidate, resolved.time, CALCULATION_IDENTITY);
          assert.equal(result.kind, 'calculated');
          if (result.kind === 'calculated')
            assert.equal(
              result.placements.find((p) => p.body === body)?.status,
              'suppressed',
              `Independent cusp ${body} ${eventAt}`,
            );
        }
      }
    }
  }
}
const current = comparisons.filter((r) => r.instant <= asOf);
const future = comparisons.filter((r) => r.instant > asOf);
const currentJpl = horizons.filter((r) => r.instant <= asOf);
const report = {
  kind: 'pattern.numerical-qualification.v1',
  generatedAt: new Date().toISOString(),
  asOf,
  identity: CALCULATION_IDENTITY,
  runnerSha256: hash(readFileSync(new URL(import.meta.url))),
  toleranceDeg,
  moshier: {
    reference:
      'Swiss Ephemeris 2.10.03 / sweph 2.10.3-7, explicit built-in Moshier; apparent geocentric true ecliptic of date, UT input',
    current: summary(current),
    futureStress: summary(future),
  },
  horizons: {
    reference:
      'NASA/JPL Horizons quantity 31, geocentric IAU76/80 apparent ecliptic of date; airless; UT input (UT1 before 1962, UTC afterward); includes gravitational deflection unlike the adapter. Future UTC uses last known leap-second while adapter predicts delta-T.',
    sources: horizonsSources,
    current: summary(currentJpl),
    futureStress: summary(horizons.filter((r) => r.instant > asOf)),
  },
  intervals: {
    fixtures: intervals.length,
    supportedPlacements,
    independentIntervalSamples,
    failures: intervalFailures,
    passed: intervalFailures.length === 0,
    events,
    cases: intervals,
  },
  limitations: [
    'Finite empirical comparisons do not prove a universal 0.05-degree physical error bound.',
    'The analytic interval enclosure applies to the pinned engine model, not ephemeris truth.',
    'Future stress epochs beyond asOf are not currently admitted birth dates.',
    'Node wall timings are not hosted CPU measurements.',
  ],
};
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    currentMoshier: report.moshier.current,
    futureMoshier: report.moshier.futureStress.maximumDifferenceDeg,
    currentJpl: report.horizons.current,
    futureJpl: report.horizons.futureStress.maximumDifferenceDeg,
    intervals: intervals.length,
    supportedPlacements,
    independentIntervalSamples,
    intervalFailures: intervalFailures.length,
    outputFile,
  }),
);
assert(
  report.moshier.current.passed &&
    report.moshier.futureStress.passed &&
    report.horizons.current.passed &&
    report.intervals.passed,
  'Qualification discrepancy; inspect the saved report',
);
