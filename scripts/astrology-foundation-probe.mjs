// Research probe only. No application routes, account data, or network calls.
// See docs/architecture/ASTROLOGY_FOUNDATION.md for the isolated dependency setup.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';

const [dependencyDirectory, outputFile] = process.argv.slice(2);
if (!dependencyDirectory || !outputFile) {
  throw new Error('Usage: node scripts/astrology-foundation-probe.mjs DEPENDENCY_DIRECTORY OUTPUT_JSON');
}
const requireProbe = createRequire(resolve(dependencyDirectory, 'probe.cjs'));
const astronomy = requireProbe('astronomy-engine');
const moment = requireProbe('moment-timezone');
const swiss = requireProbe('sweph');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const packageInfo = (name) => JSON.parse(readFileSync(resolve(dependencyDirectory, 'node_modules', name, 'package.json'), 'utf8'));
for (const [name, version] of [['astronomy-engine', '2.1.19'], ['moment-timezone', '0.6.6'], ['moment', '2.31.0'], ['sweph', '2.10.3-7']]) {
  assert.equal(packageInfo(name).version, version, name);
}
assert.equal(moment.tz.dataVersion, '2026f');
assert.equal(swiss.version(), '2.10.03');

const bodies = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
const longitude = (body, at) => astronomy.Ecliptic(astronomy.GeoVector(astronomy.Body[body], at, true)).elon;
const difference = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const dates = Array.from({ length: 51 }, (_, i) => `${1850 + i * 5}-06-15T12:00:00.000Z`);
dates.push('1990-05-15T19:34:00.000Z', '1992-10-12T15:30:00.000Z', '2000-02-29T00:00:00.000Z', '2026-11-05T00:00:00.000Z');
const toleranceDeg = 0.05;
const comparisons = [];
for (const instant of dates) {
  const at = new Date(instant);
  const jd = at.getTime() / 86_400_000 + 2_440_587.5;
  for (const body of bodies) {
    const result = swiss.calc_ut(jd, swiss.constants[`SE_${body.toUpperCase()}`], swiss.constants.SEFLG_MOSEPH | swiss.constants.SEFLG_SPEED);
    assert.equal(result.flag & swiss.constants.SEFLG_MOSEPH, swiss.constants.SEFLG_MOSEPH);
    assert.equal(result.error, '');
    const actual = longitude(body, at);
    assert.ok(Number.isFinite(actual) && actual >= 0 && actual < 360);
    comparisons.push({ instant, body: body.toLowerCase(), astronomyDeg: actual, swissMoshierDeg: result.data[0], differenceDeg: difference(actual, result.data[0]) });
  }
}

// Enumerate offsets and validate each candidate against the pinned transition table.
// Do not use Moment's default parser: it chooses a fold and shifts a gap silently.
function candidates(local, zoneName) {
  const zone = moment.tz.zone(zoneName);
  assert.ok(zone, zoneName);
  const wall = Date.parse(`${local}Z`);
  return [...new Set(zone.offsets)].map((offset) => Math.round(wall + offset * 60_000))
    .filter((at) => Math.round(at - zone.utcOffset(at) * 60_000) === wall)
    .sort((a, b) => a - b).map((at) => new Date(at).toISOString());
}
function localDayHours(day, zoneName) {
  const zone = moment.tz.zone(zoneName);
  const wallStart = Date.parse(`${day}T00:00:00Z`);
  const wallEnd = wallStart + 86_400_000;
  let milliseconds = 0;
  for (let i = 0; i < zone.untils.length; i++) {
    const offset = zone.offsets[i] * 60_000;
    const start = Math.max(i === 0 ? -Infinity : zone.untils[i - 1], wallStart + offset);
    const end = Math.min(zone.untils[i], wallEnd + offset);
    milliseconds += Math.max(0, end - start);
  }
  return milliseconds / 3_600_000;
}
const timezoneChecks = [];
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  timezoneChecks.push({ name, actual, expected, passed: true });
}
check('fall-back has two candidates', candidates('2025-11-02T01:30:00', 'America/New_York'), ['2025-11-02T05:30:00.000Z', '2025-11-02T06:30:00.000Z']);
check('spring gap has no candidate', candidates('2025-03-09T02:30:00', 'America/New_York'), []);
check('half-hour fold', candidates('2025-04-06T01:45:00', 'Australia/Lord_Howe'), ['2025-04-05T14:45:00.000Z', '2025-04-05T15:15:00.000Z']);
check('quarter-hour offset', candidates('1992-10-12T08:30:00', 'Asia/Kathmandu'), ['1992-10-12T02:45:00.000Z']);
check('skipped local date', candidates('2011-12-30T12:00:00', 'Pacific/Apia'), []);
check('historical second offset', candidates('1880-01-01T00:00:00', 'America/Los_Angeles'), ['1880-01-01T07:52:58.000Z']);
check('2026f Havana rule', candidates('2026-11-02T12:00:00', 'America/Havana'), ['2026-11-02T16:00:00.000Z']);
check('unknown-time spring day is 23 hours', localDayHours('2025-03-09', 'America/New_York'), 23);
check('unknown-time autumn day is 25 hours', localDayHours('2025-11-02', 'America/New_York'), 25);
check('unknown-time skipped date is empty', localDayHours('2011-12-30', 'Pacific/Apia'), 0);
check('ordinary local day is 24 hours', localDayHours('1992-10-12', 'Asia/Kathmandu'), 24);

const durations = [];
for (let i = 0; i < 12; i++) {
  const start = performance.now();
  for (let sample = 0; sample < 49; sample++) {
    const at = new Date(Date.UTC(1992, 9, 12, 0, sample * 30));
    for (const body of bodies) longitude(body, at);
  }
  durations.push(performance.now() - start);
}
const maximumDifferenceDeg = Math.max(...comparisons.map((x) => x.differenceDeg));
// Bundle only the selected MIT runtime dependencies into the existing local workerd harness.
const requireApp = createRequire(new URL('../package.json', import.meta.url));
const { build } = requireApp('esbuild');
const { Miniflare, convertV4MiniflareOptions } = requireApp('miniflare');
const workerSource = `
  import * as astronomy from 'astronomy-engine';
  import moment from 'moment-timezone';
  export default { fetch() {
    const at = new Date('1992-10-12T15:30:00.000Z');
    const positions = ${JSON.stringify(bodies)}.map(body => ({body, degrees: astronomy.Ecliptic(astronomy.GeoVector(astronomy.Body[body], at, true)).elon}));
    return Response.json({positions, tzdb: moment.tz.dataVersion, havanaOffsetMinutesWest: moment.tz.zone('America/Havana').utcOffset(Date.parse('2026-11-02T16:00:00Z'))});
  }};
`;
const bundle = await build({ stdin: { contents: workerSource, resolveDir: resolve(dependencyDirectory) }, bundle: true, platform: 'browser', format: 'esm', minify: true, write: false, metafile: true });
assert.ok(Object.keys(bundle.metafile.inputs).every((path) => !path.includes('/sweph/')));
const workerScript = bundle.outputFiles[0].text;
const worker = new Miniflare(convertV4MiniflareOptions({ modules: true, script: workerScript, compatibilityDate: '2026-10-26' }));
let workerResult;
try {
  const response = await worker.dispatchFetch('https://foundation.test/');
  assert.equal(response.status, 200);
  workerResult = await response.json();
  assert.equal(workerResult.tzdb, '2026f');
  assert.equal(workerResult.havanaOffsetMinutesWest, 240);
  for (const position of workerResult.positions) assert.ok(difference(position.degrees, longitude(position.body, new Date('1992-10-12T15:30:00.000Z'))) < 1e-10);
} finally {
  await worker.dispose();
}
const report = {
  kind: 'astrology.foundation-probe.v1',
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, hostTzdb: process.versions.tz },
  packages: ['astronomy-engine', 'moment-timezone', 'moment', 'sweph'].map((name) => ({ name, version: packageInfo(name).version, license: packageInfo(name).license })),
  identities: { astronomyCommonJsSha256: hash(readFileSync(requireProbe.resolve('astronomy-engine'))), timezoneDataSha256: hash(readFileSync(requireProbe.resolve('moment-timezone/data/packed/latest.json'))), timezoneDataVersion: moment.tz.dataVersion, probeSha256: hash(readFileSync(new URL(import.meta.url))) },
  comparison: { reference: 'Swiss Ephemeris 2.10.03, explicit Moshier mode; not external Swiss ephemeris files or JPL Horizons', coordinateConvention: 'geocentric apparent true ecliptic of date', count: comparisons.length, toleranceDeg, maximumDifferenceDeg, passed: comparisons.every((x) => x.differenceDeg <= toleranceDeg), samples: comparisons },
  timezoneChecks,
  workerProbe: { passed: true, runtime: 'local workerd via Miniflare', compatibilityDate: '2026-10-26', response: workerResult, bundleBytes: Buffer.byteLength(workerScript), gzipBytes: gzipSync(workerScript).byteLength, dependencyInputs: Object.keys(bundle.metafile.inputs).filter((path) => path.includes('node_modules/')).map((path) => path.split('node_modules/').at(-1)) },
  timing: { description: '49 synthetic instants × 10 bodies per run; local Node wall time, not Worker CPU qualification or a proof of interval stability', runs: durations.length, milliseconds: durations, maximumMilliseconds: Math.max(...durations) },
  limitations: ['Finite date sampling does not qualify the entire supported date range.', 'No house, angle, aspect-interval, transit-window, birthplace lookup, storage, or browser implementation tested.', 'The local Worker smoke test is not hosted CPU, concurrency, or deployment acceptance.', 'The local Swiss reference dependency is research-only and is not an application dependency.'],
};
writeFileSync(resolve(outputFile), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ comparisons: comparisons.length, maximumDifferenceDeg, withinTolerance: report.comparison.passed, timezoneChecks: timezoneChecks.length, workerPassed: report.workerProbe.passed, workerGzipBytes: report.workerProbe.gzipBytes, worstLocalRunMs: report.timing.maximumMilliseconds, outputFile: resolve(outputFile) }));
assert.ok(report.comparison.passed, 'Candidate exceeds the declared 0.05 degree comparison threshold');
