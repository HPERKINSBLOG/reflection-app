import type { AstrologyBasisV2, BirthDraft } from '../../contracts/astrology.ts';
export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** "1992-10-12" reads as "12 October 1992". A civil date has no zone, so no Date is involved. */
export function civilDateLabel(civilDate: string) {
  const [year, month, day] = civilDate.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}
/** "08:30" or "08:30:15" on a 12-hour clock, split into its time and meridiem. */
function clock(civilClock: string) {
  const [hours, minutes, seconds] = civilClock.split(':');
  const hour = Number(hours);
  return {
    time: `${hour % 12 || 12}:${minutes}${seconds ? `:${seconds}` : ''}`,
    meridiem: hour < 12 ? 'AM' : 'PM',
  };
}
export function timeLabel(birth: BirthDraft) {
  const t = birth.time;
  if (t.certainty === 'exact') {
    const at = clock(t.localTime);
    const occurrence = t.fold === 'earlier' || t.fold === 'later' ? ` · ${t.fold} occurrence` : '';
    return `Exact · ${at.time} ${at.meridiem}${occurrence}`;
  }
  if (t.certainty === 'approximate') {
    const from = clock(t.earliestLocalTime);
    const to = clock(t.latestLocalTime);
    // A range within one half of the day names its meridiem once: "8:00–10:00 AM".
    const start = from.meridiem === to.meridiem ? from.time : `${from.time} ${from.meridiem}`;
    return `Approximate · ${start}–${to.time} ${to.meridiem}`;
  }
  return 'Birth time unknown · full local day';
}
export function ChartDetails({ basis }: { basis: AstrologyBasisV2 }) {
  const { input, resolved, placements, identity } = basis.calculation;
  return (
    <details className="chart-details">
      <summary>Explore chart details</summary>
      <p>
        {civilDateLabel(input.birth.date)} · {input.birth.place.label}
      </p>
      <p>Time zone: {input.birth.place.zone}</p>
      <p>{timeLabel(input.birth)}</p>
      {resolved.historicalZone && (
        <p>Historical time zone confirmed. Earlier local clock records may be incomplete.</p>
      )}
      <ul>
        {placements.map((p) => (
          <li key={p.body}>
            {capitalize(p.body)}:{' '}
            {p.status === 'supported'
              ? `${capitalize(p.sign)} · supported sign`
              : 'left out because the placement could not be qualified'}
          </li>
        ))}
      </ul>
      <p>Houses, angles and aspects are not calculated.</p>
      <p>
        Birth profile version {basis.profileRevision} · {identity.engine} {identity.engineVersion} ·
        IANA {identity.tzdbVersion}
      </p>
      <p>
        Calculated facts describe chart positions. Chapters offer symbolic perspectives for your own
        reflection.
      </p>
    </details>
  );
}
