import moment from 'moment-timezone';
import { sha256Bytes } from '../../domain/json.ts';
import { BirthPlace, type PlaceCandidate } from '../../contracts/astrology.ts';
import { ASTROLOGY_LIMITS } from '../../contracts/astrology-policy.ts';
import compressed from '../../../content/astrology/places/index.ts';
import manifest from '../../../content/astrology/places-manifest.json';

const normalize = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
type Row = Omit<PlaceCandidate, 'source' | 'datasetHash'> & {
  aliases: string[];
  population: number;
};
let loaded:
  | Promise<{
      places: { place: PlaceCandidate; searchable: string }[];
      byId: Map<string, PlaceCandidate>;
    }>
  | undefined;
function index() {
  loaded ??= (async () => {
    const packed = Uint8Array.from(atob(compressed), (c) => c.charCodeAt(0));
    const bytes = new Uint8Array(
      await new Response(
        new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')),
      ).arrayBuffer(),
    );
    if (bytes.length > 16 * 1024 * 1024 || (await sha256Bytes(bytes)) !== manifest.artifactSha256)
      throw new Error('Birthplace artifact unavailable');
    const data = JSON.parse(new TextDecoder().decode(bytes)) as Row[];
    const places = data.map(({ aliases, population: _population, ...place }) => ({
      place: { ...place, source: 'geonames' as const, datasetHash: manifest.artifactSha256 },
      searchable: normalize(`${place.label} ${aliases.join(' ')}`),
    }));
    return { places, byId: new Map(places.map(({ place }) => [place.sourceId, place])) };
  })();
  return loaded;
}

export async function findBirthplaces(
  query: string,
  limit: number = ASTROLOGY_LIMITS.placeResults,
): Promise<PlaceCandidate[]> {
  const q = normalize(query.trim());
  const length = [...q].length;
  if (length < ASTROLOGY_LIMITS.queryMinCodePoints || length > ASTROLOGY_LIMITS.queryMaxCodePoints)
    return [];
  const take = Math.min(ASTROLOGY_LIMITS.placeResults, Math.max(0, Math.floor(limit)));
  if (!Number.isFinite(take) || take === 0) return [];
  const tokens = q.split(/\s+/);
  const result: PlaceCandidate[] = [];
  for (const entry of (await index()).places) {
    if (tokens.every((token) => entry.searchable.includes(token))) result.push(entry.place);
    if (result.length === take) break;
  }
  return result;
}

/** A source ID is not authority for client-supplied coordinates. Manual input is explicit. */
export async function validateBirthplace(input: unknown): Promise<boolean> {
  const parsed = BirthPlace.safeParse(input);
  if (!parsed.success || !moment.tz.zone(parsed.data.zone)) return false;
  const p = parsed.data;
  if (p.source === 'manual') return true;
  const original = (await index()).byId.get(p.sourceId);
  return (
    !!original &&
    Object.entries(original).every(([key, value]) => p[key as keyof typeof p] === value)
  );
}
