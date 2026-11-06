import { AstroTime, Body, Ecliptic, GeoVector, e_tilt } from 'astronomy-engine';
import {
  AstrologyInputV2,
  CalculationIdentity,
  type NatalCalculationResult,
  type NatalPlacement,
  ResolvedBirthTime,
} from '../../contracts/astrology.ts';
import { ASTROLOGY_LIMITS, NATAL_BODIES } from '../../contracts/astrology-policy.ts';
import manifest from '../../../content/astrology/calculation-manifest.json';
import { exactPlacement, qualifyInterval, type NatalBody } from './reliability.ts';
import { resolveBirthTime } from './civil-time.ts';
import { canonicalJson } from '../json.ts';

export const CALCULATION_IDENTITY = CalculationIdentity.parse(manifest.identity);
const bodies: Record<NatalBody, Body> = {
  sun: Body.Sun,
  moon: Body.Moon,
  mercury: Body.Mercury,
  venus: Body.Venus,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
  pluto: Body.Pluto,
};
export function natalLongitude(body: NatalBody, at: Date): number {
  e_tilt(new AstroTime(at).AddDays(1));
  return Ecliptic(GeoVector(bodies[body], at, true)).elon;
}
const budgetError = new Error('calculation instant budget');
type Point = { longitude: number; projectedRadius: number };
export function calculateNatal(
  input: AstrologyInputV2,
  resolved: ResolvedBirthTime,
  identity: CalculationIdentity,
): NatalCalculationResult {
  if (
    !AstrologyInputV2.safeParse(input).success ||
    !ResolvedBirthTime.safeParse(resolved).success ||
    !CalculationIdentity.safeParse(identity).success ||
    canonicalJson(identity) !== canonicalJson(CALCULATION_IDENTITY)
  )
    return { kind: 'unavailable', reason: 'invalid_input' };
  const expected = resolveBirthTime(input.birth, new Date('2101-01-03T00:00:00Z'));
  if (expected.kind !== 'resolved' || canonicalJson(expected.time) !== canonicalJson(resolved))
    return { kind: 'unavailable', reason: 'invalid_input' };
  const dates =
    resolved.kind === 'instant'
      ? [resolved.at]
      : resolved.intervals.flatMap((r) => [r.startsAt, r.endsAt]);
  if (dates.some((at) => at < '1899-12-30' || at > '2101-01-02'))
    return { kind: 'unavailable', reason: 'invalid_input' };
  const cache = new Map<number, Map<NatalBody, Point>>();
  function point(body: NatalBody, at: number): Point {
    let instant = cache.get(at);
    if (!instant) {
      if (cache.size >= ASTROLOGY_LIMITS.evaluatedInstants) throw budgetError;
      instant = new Map();
      cache.set(at, instant);
    }
    let value = instant.get(body);
    if (!value) {
      // Displace the engine's sub-second obliquity cache before evaluation so a
      // saved semantic identity does not depend on a previous calculation's order.
      e_tilt(new AstroTime(new Date(at)).AddDays(1));
      const result = Ecliptic(GeoVector(bodies[body], new Date(at), true));
      value = { longitude: result.elon, projectedRadius: Math.hypot(result.vec.x, result.vec.y) };
      instant.set(body, value);
    }
    return value;
  }
  const placements: NatalPlacement[] = [];
  for (const body of NATAL_BODIES) {
    try {
      if (resolved.kind === 'instant') {
        placements.push(exactPlacement(body, point(body, Date.parse(resolved.at)).longitude));
        continue;
      }
      const policy = manifest.reliability;
      const bounds = policy.bounds as Record<string, { radiusAu: number; speedAuPerDay: number }>;
      const target = body === 'sun' ? { radiusAu: 0, speedAuPerDay: 0 } : bounds[body];
      const earth = bounds.earth!;
      // The VSOP coefficient triangle bounds apply to these bodies only. Moon and Pluto
      // use different engine algorithms and remain explicitly unqualified for intervals.
      const speed = target
        ? policy.vsopRotationNormFactor *
          (policy.retardedAndTerrestrialTimeFactor * (target.speedAuPerDay + earth.speedAuPerDay) +
            policy.frameRateRadiansPerDay * (target.radiusAu + earth.radiusAu))
        : 0;
      placements.push(
        qualifyInterval(
          body,
          resolved.intervals,
          (at) => point(body, at),
          target
            ? (at, radiusDays) => {
                const displacement =
                  speed * (radiusDays + policy.discontinuityAllowanceSeconds / 86400);
                const ratio = displacement / point(body, at).projectedRadius;
                return ratio >= 1 ? Infinity : (Math.asin(ratio) * 180) / Math.PI;
              }
            : null,
          ASTROLOGY_LIMITS.evaluatedInstants,
        ),
      );
    } catch (error) {
      placements.push({
        status: 'suppressed',
        body,
        reason: error === budgetError ? 'budget_exhausted' : 'engine_unavailable',
      });
    }
  }
  if (!cache.size) return { kind: 'unavailable', reason: 'engine_unavailable' };
  return {
    kind: 'calculated',
    input,
    resolved,
    identity,
    // Normalize only after interval qualification. Cross-runtime trig results can
    // differ by machine epsilon; saved identities use a declared nanodegree grid.
    placements: placements.map((p) =>
      p.status === 'suppressed'
        ? p
        : {
            ...p,
            representativeLongitudeDeg: Math.round(p.representativeLongitudeDeg * 1e9) / 1e9,
            maximumDeviationDeg: Math.ceil((p.maximumDeviationDeg + 1e-9) * 1e9) / 1e9,
          },
    ),
    evaluatedInstants: cache.size,
  };
}
