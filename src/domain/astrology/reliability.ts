import type { NatalPlacement } from '../../contracts/astrology.ts';
import { ASTROLOGY_LIMITS, ZODIAC_SIGNS } from '../../contracts/astrology-policy.ts';

export type NatalBody = NatalPlacement['body'];
export const circularDistance = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const margin = (angle: number) => Math.min(angle % 30, 30 - (angle % 30));
export function exactPlacement(body: NatalBody, longitude: number): NatalPlacement {
  if (margin(longitude) <= ASTROLOGY_LIMITS.minimumGuardDeg)
    return { status: 'suppressed', body, reason: 'boundary' };
  return {
    status: 'supported',
    id: `sign:${body}`,
    body,
    sign: ZODIAC_SIGNS[Math.floor(longitude / 30)]!,
    representativeLongitudeDeg: longitude,
    maximumDeviationDeg: 0,
    guardDeg: ASTROLOGY_LIMITS.minimumGuardDeg,
  };
}

/** Every accepted leaf encloses its entire interval. Subdivision improves a bound;
 * it never converts endpoint agreement into a stability claim.
 */
export function qualifyInterval(
  body: NatalBody,
  intervals: Array<{ startsAt: string; endsAt: string }>,
  sample: (at: number) => { longitude: number },
  deviationBound: ((at: number, radiusDays: number) => number) | null,
  maxEvaluations: number,
): NatalPlacement {
  const suppressed = (
    reason: Extract<NatalPlacement, { status: 'suppressed' }>['reason'],
  ): NatalPlacement => ({ status: 'suppressed', body, reason });
  if (!deviationBound) return suppressed('interval_unqualified');
  const pending = intervals.map((r) => [Date.parse(r.startsAt), Date.parse(r.endsAt)] as const);
  let representative: number | undefined;
  let signIndex = -1;
  let evaluations = 0;
  let maximumDeviationDeg = 0;
  while (pending.length) {
    if (++evaluations > maxEvaluations) return suppressed('budget_exhausted');
    const [start, end] = pending.pop()!;
    const mid = Math.floor((start + end) / 2);
    const { longitude } = sample(mid);
    if (!Number.isFinite(longitude) || longitude < 0 || longitude >= 360)
      return suppressed('engine_unavailable');
    representative ??= longitude;
    const currentSign = Math.floor(longitude / 30);
    if (signIndex < 0) signIndex = currentSign;
    if (signIndex !== currentSign || margin(longitude) <= ASTROLOGY_LIMITS.minimumGuardDeg)
      return suppressed('boundary');
    const radius = Math.max(mid - start, end - mid) / 86400000;
    const bound = deviationBound(mid, radius);
    if (
      Number.isFinite(bound) &&
      bound >= 0 &&
      bound + ASTROLOGY_LIMITS.minimumGuardDeg < margin(longitude)
    ) {
      maximumDeviationDeg = Math.max(
        maximumDeviationDeg,
        circularDistance(longitude, representative) + bound,
      );
    } else {
      if (end - start <= 2) return suppressed('interval_unqualified');
      pending.push([start, mid], [mid, end]);
    }
  }
  if (representative === undefined) return suppressed('interval_unqualified');
  return {
    status: 'supported',
    body,
    id: `sign:${body}`,
    sign: ZODIAC_SIGNS[signIndex]!,
    representativeLongitudeDeg: representative,
    maximumDeviationDeg,
    guardDeg: ASTROLOGY_LIMITS.minimumGuardDeg,
  };
}
