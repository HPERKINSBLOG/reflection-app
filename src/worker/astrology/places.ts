import moment from 'moment-timezone';
import { BirthPlace, type PlaceCandidate } from '../../contracts/astrology.ts';
import { ASTROLOGY_LIMITS } from '../../contracts/astrology-policy.ts';
import data from '../../../content/astrology/places.json';
import manifest from '../../../content/astrology/places-manifest.json';

const normalize = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const places = data.map(({ aliases, population: _population, ...place }) => ({
  place: { ...place, source: 'geonames' as const, datasetHash: manifest.artifactSha256 },
  searchable: normalize(`${place.label} ${aliases.join(' ')}`),
}));
const byId = new Map(places.map(({ place }) => [place.sourceId, place]));

export function findBirthplaces(
  query: string,
  limit: number = ASTROLOGY_LIMITS.placeResults,
): PlaceCandidate[] {
  const q = normalize(query.trim());
  const length = [...q].length;
  if (length < ASTROLOGY_LIMITS.queryMinCodePoints || length > ASTROLOGY_LIMITS.queryMaxCodePoints)
    return [];
  const take = Math.min(ASTROLOGY_LIMITS.placeResults, Math.max(0, Math.floor(limit)));
  if (!Number.isFinite(take) || take === 0) return [];
  const tokens = q.split(/\s+/);
  const result: PlaceCandidate[] = [];
  for (const entry of places) {
    if (tokens.every((token) => entry.searchable.includes(token))) result.push(entry.place);
    if (result.length === take) break;
  }
  return result;
}

/** A source ID is not authority for client-supplied coordinates. Manual input is explicit. */
export function validateBirthplace(input: unknown): boolean {
  const parsed = BirthPlace.safeParse(input);
  if (!parsed.success || !moment.tz.zone(parsed.data.zone)) return false;
  const p = parsed.data;
  if (p.source === 'manual') return true;
  const original = byId.get(p.sourceId);
  return (
    !!original &&
    Object.entries(original).every(([key, value]) => p[key as keyof typeof p] === value)
  );
}
