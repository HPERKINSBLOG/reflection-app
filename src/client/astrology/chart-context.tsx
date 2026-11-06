import type { AstrologyBasisV2, BirthDraft } from '../../contracts/astrology.ts';
export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
export function timeLabel(birth: BirthDraft) {
  const t = birth.time;
  return t.certainty === 'exact'
    ? `Exact · ${t.localTime}${t.fold === 'earlier' || t.fold === 'later' ? ` · ${t.fold} occurrence` : ''}`
    : t.certainty === 'approximate'
      ? `Approximate · ${t.earliestLocalTime}–${t.latestLocalTime}`
      : 'Birth time unknown · full local day';
}
export function ChartDetails({ basis }: { basis: AstrologyBasisV2 }) {
  const { input, resolved, placements, identity } = basis.calculation;
  return (
    <details className="chart-details">
      <summary>Explore chart details</summary>
      <p>
        {input.birth.date} · {input.birth.place.label}
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
