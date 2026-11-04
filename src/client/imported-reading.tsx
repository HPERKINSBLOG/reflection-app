import type { Ref } from 'react';
import type { z } from 'zod';
import { PortableRecord, type ImportedReading } from '../contracts/index.ts';
import { date } from './date.ts';

export function ImportedReadingDetail({
  reading,
  headingRef,
}: {
  reading: z.infer<typeof ImportedReading>;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const { record } = reading;
  // Successor imports retain the exact portable object. Read the historical
  // claims from that object without granting it native acceptance locally.
  const original = (() => {
    if (record.source !== 'successor') return null;
    try {
      const parsed = PortableRecord.safeParse(JSON.parse(record.originalJsonText));
      if (
        !parsed.success ||
        parsed.data.kind !== 'reading' ||
        parsed.data.originalId !== record.originalId
      )
        return null;
      const value = parsed.data.value;
      return value.kind === 'tarot.accepted.v1' ||
        value.kind === 'tarot.accepted.v2' ||
        value.kind === 'tarot.accepted.v3'
        ? value
        : null;
    } catch {
      return null;
    }
  })();
  return (
    <article className="reading-result imported-reading">
      <header>
        <p className="eyebrow">Imported reading · Edition {reading.editionNumber}</p>
        <h2 ref={headingRef} tabIndex={-1}>
          {record.question ?? 'Question unavailable'}
        </h2>
        <p>
          {record.source} ·{' '}
          {record.originalTimestamp ??
            (record.occurredAt ? date(record.occurredAt) : 'Original date unavailable')}
        </p>
      </header>
      <section>
        <h3>Original interpretation</h3>
        {original ? (
          <>
            {original.units.map((unit) => (
              <section key={unit.position}>
                <h4>{unit.position[0]!.toUpperCase() + unit.position.slice(1)}</h4>
                <p className="kept-text">{unit.basisText}</p>
                <p className="kept-text">{unit.interpretation}</p>
                {'reflectionQuestion' in unit && (
                  <p className="kept-text">{unit.reflectionQuestion}</p>
                )}
              </section>
            ))}
            {original.kind === 'tarot.accepted.v2' ? (
              <>
                <h4>Synthesis</h4>
                <p className="kept-text">{original.synthesis.text}</p>
                <h4>Optional action</h4>
                <p className="kept-text">{original.action.text}</p>
                {original.reflectionQuestion && (
                  <>
                    <h4>Reflection question</h4>
                    <p className="kept-text">{original.reflectionQuestion.text}</p>
                  </>
                )}
              </>
            ) : (
              original.closing && <p className="kept-text">{original.closing}</p>
            )}
          </>
        ) : (
          <p className="kept-text">
            {record.generatedText ?? 'The file did not include an interpretation.'}
          </p>
        )}
      </section>
      {record.userStatements.length > 0 && (
        <section>
          <h3>Reader’s words</h3>
          {record.userStatements.map((entry) => (
            <div key={entry.originalId ?? JSON.stringify(entry)}>
              <p className="kept-text">{entry.text}</p>
              <small>
                {entry.originalTimestamp ?? 'Original date unavailable'}
                {entry.revision !== null && ' · Revision ' + entry.revision}
              </small>
            </div>
          ))}
        </section>
      )}
      <section>
        <h3>Original source</h3>
        <p>
          {record.basis.method === 'unknown' ? 'Method unavailable' : record.basis.method} ·
          Imported, unverified
        </p>
        {record.basis.cards.length > 0 && (
          <ul>
            {record.basis.cards.map((card) => (
              <li key={JSON.stringify(card)}>
                {card.name}
                {card.position && ' · ' + card.position} · {card.orientation}
              </li>
            ))}
          </ul>
        )}
        {record.basis.sourceIds.length > 0 && (
          <p>Source identifiers · {record.basis.sourceIds.join(', ')}</p>
        )}
        {original && (
          <details>
            <summary>Original sources and provenance</summary>
            <p>
              Original edition {original.editionNumber} · {original.mode} ·{' '}
              <time dateTime={original.acceptedAt}>{date(original.acceptedAt)}</time>
            </p>
            {original.sources.map((s, i) => (
              <section key={s.id}>
                <h4>
                  {original.basis.cards[i]!.position} · {s.id}
                </h4>
                <p className="kept-text">{s.text}</p>
              </section>
            ))}
            {original.provenance.selected.length > 0 && (
              <>
                <h4>Excerpts shared in the original request</h4>
                {original.provenance.selected.map((f) => (
                  <p key={f.ordinal} className="kept-text">
                    {f.availability === 'retained' && f.text !== null
                      ? f.text
                      : 'Excerpt unavailable'}
                  </p>
                ))}
              </>
            )}
            <details>
              <summary>Full original record</summary>
              <p className="kept-text">{record.originalJsonText}</p>
            </details>
          </details>
        )}
        {record.provenanceGaps.length > 0 && (
          <p>
            Unavailable in the file ·{' '}
            {record.provenanceGaps.map((g) => g.replaceAll('_', ' ')).join(', ')}
          </p>
        )}
        <p>
          Imported {date(reading.importedAt)} · Source revision {record.identity.source.revision}
        </p>
      </section>
    </article>
  );
}
