import moment from 'moment-timezone';
import {
  BirthDraft,
  type BirthTimeResolution,
  type ResolvedBirthTime,
} from '../../contracts/astrology.ts';

/** Convert a validated wall clock to a coordinate, not an interpreted UTC birth instant. */
function wall(date: string, clock = '00:00:00'): number {
  return Date.parse(`${date}T${clock.length === 5 ? `${clock}:00` : clock}.000Z`);
}

/** Intersect each UTC offset regime with the requested half-open civil interval.
 * Iterating the transition table, rather than parsing a clock, retains every fold branch.
 */
function intervals(zone: moment.MomentZone, start: number, end: number): Array<[number, number]> {
  const matches: Array<[number, number]> = [];
  for (let i = 0; i < zone.untils.length; i++) {
    const offset = Math.round(zone.offsets[i]! * 60000);
    const a = Math.max(i === 0 ? -Infinity : zone.untils[i - 1]!, start + offset);
    const b = Math.min(zone.untils[i]!, end + offset);
    if (a < b) matches.push([a, b]);
  }
  matches.sort((a, b) => a[0] - b[0]);
  const union: Array<[number, number]> = [];
  for (const current of matches) {
    const last = union.at(-1);
    if (last && current[0] <= last[1]) last[1] = Math.max(last[1], current[1]);
    else union.push([...current]);
  }
  return union;
}

export function resolveBirthTime(raw: BirthDraft, now: Date): BirthTimeResolution {
  const parsed = BirthDraft.safeParse(raw);
  if (!parsed.success || !Number.isFinite(now.getTime()))
    return { kind: 'invalid', message: 'Check the birth date, clock and place details.' };
  const draft = parsed.data;
  const zone = moment.tz.zone(draft.place.zone);
  if (!zone) return { kind: 'invalid', message: 'Choose a supported IANA time zone.' };
  if (draft.date > moment(now).tz(zone.name).format('YYYY-MM-DD'))
    return {
      kind: 'invalid',
      message: 'Birth date cannot be in the future in the selected time zone.',
    };
  const historicalZone = draft.date < '1970-01-01';
  if (historicalZone && !draft.historicalZoneConfirmed)
    return {
      kind: 'historical_confirmation_required',
      message:
        'Historical clock records may be incomplete. Confirm this time zone for the birthplace before continuing.',
    };
  const time = draft.time;
  if (time.certainty === 'exact') {
    const local = wall(draft.date, time.localTime);
    const candidates = intervals(zone, local, local + 1).map(([at]) => at);
    if (!candidates.length)
      return {
        kind: 'gap',
        message:
          'The local clock skipped this time. Check the recorded time or choose an interval.',
      };
    const choices: Array<Extract<ResolvedBirthTime, { kind: 'instant' }>> = candidates.map(
      (at, i) => ({
        kind: 'instant',
        certainty: 'exact',
        at: new Date(at).toISOString(),
        offsetSeconds: Math.round(-zone.utcOffset(at) * 60),
        fold: candidates.length === 1 ? 'unambiguous' : i === 0 ? 'earlier' : 'later',
        historicalZone,
      }),
    );
    if (choices.length > 1 && !time.fold) return { kind: 'fold', choices };
    const choice = choices.find((v) => v.fold === (time.fold ?? 'unambiguous'));
    if (
      !choice ||
      (time.offsetSeconds !== undefined && time.offsetSeconds !== choice.offsetSeconds)
    )
      return {
        kind: 'invalid',
        message: 'The selected occurrence or UTC offset does not match this local clock.',
      };
    return { kind: 'resolved', time: choice };
  }
  const start =
    time.certainty === 'unknown' ? wall(draft.date) : wall(draft.date, time.earliestLocalTime);
  const end =
    time.certainty === 'unknown' ? start + 86400000 : wall(draft.date, time.latestLocalTime);
  const union = intervals(zone, start, end);
  if (!union.length)
    return {
      kind: 'gap',
      message: 'This local date or interval was skipped in the selected time zone.',
    };
  return {
    kind: 'resolved',
    time: {
      kind: 'intervals',
      certainty: time.certainty,
      historicalZone,
      intervals: union.map(([a, b]) => ({
        startsAt: new Date(a).toISOString(),
        endsAt: new Date(b).toISOString(),
      })),
    },
  };
}
