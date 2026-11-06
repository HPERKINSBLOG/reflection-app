import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Build-time analysis of the exact pinned engine coefficient table. Never evaluated at runtime.
const enginePath = 'node_modules/astronomy-engine/esm/astronomy.js';
const source = readFileSync(enginePath, 'utf8');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
for (const [name, version] of [
  ['astronomy-engine', '2.1.19'],
  ['moment-timezone', '0.6.6'],
  ['moment', '2.31.0'],
]) {
  if (JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version !== version)
    throw Error(`Unexpected ${name} version`);
}
type Formula = Array<Array<[number, number, number]>>;
const literal = source.match(/const vsop = (\{[\s\S]*?\n\});/)?.[1];
if (!literal) throw Error('Pinned VSOP table missing');
const models = runInNewContext(`(${literal})`, {}, { timeout: 1000 }) as Record<
  string,
  [Formula, Formula, Formula]
>;
const tMax = 0.2; // ±200 Julian years, containing the 1900–2100 calculation range and light travel.
const absValue = (f: Formula) =>
  f.reduce((sum, terms, n) => sum + tMax ** n * terms.reduce((s, [a]) => s + Math.abs(a), 0), 0);
const derivative = (f: Formula) =>
  f.reduce(
    (sum, terms, n) =>
      sum +
      terms.reduce(
        (s, [a, _b, c]) =>
          s + Math.abs(a) * (tMax ** n * Math.abs(c) + (n ? n * tMax ** (n - 1) : 0)),
        0,
      ),
    0,
  ) / 365250;
const bounds = Object.fromEntries(
  Object.entries(models).map(([body, [lon, lat, rad]]) => {
    const radiusAu = absValue(rad);
    const speedAuPerDay = derivative(rad) + radiusAu * (derivative(lon) + derivative(lat));
    return [body.toLowerCase(), { radiusAu, speedAuPerDay }];
  }),
);
const reliability = {
  version: 'vsop-vector-enclosure.v1',
  range: ['1900-01-01', '2100-12-31'],
  coefficientTimeAbsMillennia: tMax,
  frameRateRadiansPerDay: 1,
  vsopRotationNormFactor: 1.001,
  retardedAndTerrestrialTimeFactor: 1.01,
  discontinuityAllowanceSeconds: 60,
  minimumGuardDeg: 0.05,
  resultPrecisionDeg: 0.000000001,
  evaluatedInstants: 2048,
  intervalBodies: ['sun', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'],
  unqualifiedIntervalBodies: ['moon', 'pluto'],
  bounds,
};
const timezone = readFileSync('node_modules/moment-timezone/data/packed/latest.json', 'utf8');
if (JSON.parse(timezone).version !== '2026f') throw Error('Expected IANA 2026f');
const manifest = {
  identity: {
    engine: 'astronomy-engine',
    engineVersion: '2.1.19',
    engineArtifactHash: hash(source),
    tzdbVersion: '2026f',
    tzdbHash: hash(timezone),
    adapterVersion: 'natal.v2.1',
    reliabilityPolicy: reliability.version,
    reliabilityHash: hash(JSON.stringify(reliability)),
  },
  engineArtifact: enginePath,
  reliability,
  qualification:
    'local-preview; full production numerical and editorial qualification remains required',
};
const path = 'content/astrology/calculation-manifest.json';
const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== bytes)
    throw Error('Calculation manifest or packaged dependency drift');
} else writeFileSync(path, bytes);
