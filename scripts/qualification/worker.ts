/** Operator-only synthetic benchmark. Never exposes the application router. */
import application from '../../src/worker/index.ts';
import { AstrologyInputV2 } from '../../src/contracts/astrology.ts';
import { calculateNatal, CALCULATION_IDENTITY } from '../../src/domain/astrology/calculate.ts';
import { resolveBirthTime } from '../../src/domain/astrology/civil-time.ts';
import { sha256Json } from '../../src/domain/json.ts';
import { findBirthplaces } from '../../src/worker/astrology/places.ts';

let bootId: string | undefined;
let calls = 0;
let searches = 0;
function calculation(name: string) {
  const budgetDates: Record<string, string> = {
    'budget-sun': '2026-01-20',
    'budget-jupiter': '2026-06-30',
    'budget-saturn': '2026-02-14',
  };
  const input = AstrologyInputV2.parse({
    kind: 'astrology.natal.v2',
    calendar: 'gregorian',
    zodiac: 'tropical',
    houses: 'not_calculated',
    birth: {
      date:
        budgetDates[name] ??
        (name === 'fold' ? '2025-11-02' : name === 'boundary' ? '2000-03-20' : '1992-10-12'),
      place: {
        source: 'manual',
        label: 'Synthetic fixture',
        latitudeDeg: 0,
        longitudeEastDeg: 0,
        zone: name === 'fold' ? 'America/New_York' : 'Etc/UTC',
      },
      historicalZoneConfirmed: true,
      time:
        name === 'exact'
          ? { certainty: 'exact', localTime: '15:30:00' }
          : name === 'fold'
            ? {
                certainty: 'approximate',
                earliestLocalTime: '01:15:00',
                latestLocalTime: '01:45:00',
              }
            : { certainty: 'unknown' },
    },
  });
  const resolved = resolveBirthTime(input.birth, new Date('2026-11-05T00:00:00Z'));
  if (resolved.kind !== 'resolved') throw Error('Fixture time did not resolve');
  return calculateNatal(input, resolved.time, CALCULATION_IDENTITY);
}

export default {
  async fetch(request: Request, env: { TOKEN_SHA256: string }) {
    const token = request.headers.get('Authorization') ?? '';
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
    ]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (digest !== env.TOKEN_SHA256 || request.method !== 'POST')
      return new Response(null, { status: 404 });
    const name = new URL(request.url).pathname.slice(1);
    if (
      ![
        'places',
        'exact',
        'unknown',
        'fold',
        'boundary',
        'mixed',
        'budget-sun',
        'budget-jupiter',
        'budget-saturn',
      ].includes(name)
    )
      return new Response(null, { status: 404 });
    bootId ??= crypto.randomUUID();
    const call = ++calls;
    const coldPlaces = searches === 0 && ['places', 'mixed'].includes(name);
    let result: unknown;
    if (name === 'places' || name === 'mixed') {
      searches++;
      const matches = await Promise.all(
        ['Paris', 'New York', 'Kathmandu', 'San José'].map((q) => findBirthplaces(q)),
      );
      if (matches.some((v) => !v.length)) throw Error('Synthetic place lookup returned no result');
      result = {
        counts: matches.map((v) => v.length),
        hash: await sha256Json(matches),
        ...(name === 'mixed'
          ? { calculations: ['exact', 'unknown', 'fold', 'boundary'].map(calculation) }
          : {}),
      };
    } else result = calculation(name);
    return Response.json(
      {
        name,
        bootId,
        call,
        coldPlaces,
        result,
        identity: CALCULATION_IDENTITY,
        applicationFetchType: typeof application.fetch,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  },
};
