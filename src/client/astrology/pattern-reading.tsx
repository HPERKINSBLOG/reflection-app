import type { Ref } from 'react';
import type { PatternReadingV1 } from '../../contracts/astrology.ts';
import { TopicChip } from '../design/components.tsx';
import { timeLabel } from './chart-context.tsx';
import { date } from '../date.ts';

export function PatternReading({
  reading,
  headingRef,
}: {
  reading: PatternReadingV1;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const { chapter, basis } = reading;
  const { input, resolved, identity } = basis.calculation;
  const certainty = timeLabel(input.birth);
  return (
    <article className="pattern-snapshot" data-testid="pattern-reading">
      <header>
        <TopicChip tone="sage">Astrology · Your Pattern</TopicChip>
        <p>
          Saved <time dateTime={reading.acceptedAt}>{date(reading.acceptedAt)}</time>
        </p>
        <h2 ref={headingRef} tabIndex={-1}>
          {chapter.prompt}
        </h2>
      </header>
      <section className="pattern-snapshot-copy" aria-label="Saved chapter">
        <p className="eyebrow">
          {chapter.id} · {chapter.factualLabel}
        </p>
        <h3>{chapter.title}</h3>
        <p>{chapter.text}</p>
        <p className="muted">
          Symbolic reflection
          {chapter.editorialStatus === 'synthetic_local'
            ? ' · Local preview content awaiting review'
            : ''}
        </p>
      </section>
      <aside className="pattern-snapshot-context" aria-label="Saved chart context">
        <h3>The chart you saved</h3>
        <p>{chapter.factualLabel}</p>
        <p>
          <strong>{certainty}</strong>
        </p>
        <p>This chapter keeps its original chart and words when you update your birth details.</p>
        <details>
          <summary>Explore chart details</summary>
          <p>
            {input.birth.date} · {input.birth.place.label}
          </p>
          <p>Time zone: {input.birth.place.zone}</p>
          {resolved.historicalZone && (
            <p>Historical time zone confirmed. Earlier local clock records may be incomplete.</p>
          )}
          <p>Houses, angles and aspects were not calculated.</p>
          <p>
            Birth profile version {basis.profileRevision} · {identity.engine}{' '}
            {identity.engineVersion} · IANA {identity.tzdbVersion}
          </p>
          <p className="muted">
            Calculated facts describe chart positions. The chapter offers a symbolic perspective for
            your own reflection.
          </p>
        </details>
      </aside>
    </article>
  );
}
