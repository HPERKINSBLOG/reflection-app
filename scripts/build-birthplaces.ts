import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import moment from 'moment-timezone';
import { PlaceCandidate } from '../src/contracts/astrology.ts';

export type GazetteerRow = Omit<PlaceCandidate, 'source' | 'datasetHash'> & {
  aliases: string[];
  population: number;
};
const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
export function verifySource(source: string | Uint8Array, expectedHash: string): void {
  if (sha(source) !== expectedHash) throw Error('Gazetteer source hash mismatch');
}
export function buildGazetteer(cities: string, admins: string, countries: string): GazetteerRow[] {
  const lines = (s: string) =>
    s
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('\t'));
  const adminNames = new Map(lines(admins).map((r) => [r[0]!, r[1]!]));
  const countryNames = new Map(lines(countries).map((r) => [r[0]!, r[4]!]));
  const ids = new Set<string>();
  return lines(cities)
    .map((r) => {
      const country = countryNames.get(r[8]!) ?? r[8]!;
      const administrativeArea = adminNames.get(`${r[8]}.${r[10]}`) ?? '';
      const candidate = PlaceCandidate.parse({
        source: 'geonames',
        datasetHash: '0'.repeat(64),
        sourceId: r[0],
        label: [r[1], administrativeArea, country].filter(Boolean).join(', '),
        country,
        administrativeArea,
        latitudeDeg: r[4]?.trim() ? Number(r[4]) : NaN,
        longitudeEastDeg: r[5]?.trim() ? Number(r[5]) : NaN,
        zone: r[17],
      });
      if (!moment.tz.zone(candidate.zone)) throw Error(`Unsupported zone: ${candidate.zone}`);
      if (ids.has(candidate.sourceId)) throw Error('Duplicate source ID');
      ids.add(candidate.sourceId);
      const { source: _source, datasetHash: _hash, ...value } = candidate;
      return {
        ...value,
        aliases: [...new Set([r[1]!, r[2]!, ...(r[3]?.split(',') ?? [])])].filter(Boolean),
        population: Number(r[14]) || 0,
      };
    })
    .sort((a, b) => b.population - a.population || a.sourceId.localeCompare(b.sourceId));
}

// Acquisition is explicit: pass the local downloaded source directory; runtime never calls GeoNames.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const directory = process.argv[2];
  if (!directory) throw Error('Usage: tsx scripts/build-birthplaces.ts <download-directory>');
  const names = ['cities15000.txt', 'admin1CodesASCII.txt', 'countryInfo.txt'] as const;
  const sources = names.map((name) => readFileSync(`${directory}/${name}`, 'utf8'));
  const output = `${JSON.stringify(buildGazetteer(sources[0]!, sources[1]!, sources[2]!))}\n`;
  const manifest = {
    version: 'geonames-cities15000.v1',
    retrievedAt: new Date().toISOString(),
    sources: names.map((name, i) => ({
      url: `https://download.geonames.org/export/dump/${name === 'cities15000.txt' ? 'cities15000.zip' : name}`,
      extractedFile: name,
      sha256: sha(sources[i]!),
    })),
    archiveSha256: sha(readFileSync(`${directory}/cities15000.zip`)),
    artifactSha256: sha(output),
    tzdbVersion: moment.tz.dataVersion,
    attribution:
      'GeoNames, CC BY 4.0. https://www.geonames.org/ https://creativecommons.org/licenses/by/4.0/',
    scope:
      'Cities over 15,000 population or capitals. Missing localities require manual confirmation; coordinates and historical time zones may need correction.',
  };
  writeFileSync('content/astrology/places.json', output);
  writeFileSync('content/astrology/places-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
}
