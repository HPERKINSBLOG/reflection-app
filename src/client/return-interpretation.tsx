import type { z } from 'zod';
import type { AnyAcceptedReading } from '../contracts/index.ts';
import { CardFace } from './card-face.tsx';
import { TopicChip } from './design/components.tsx';
import { drawnCards } from './drawn-cards.ts';

type Reading = z.infer<typeof AnyAcceptedReading>;

export function ReturnInterpretation({
  reading,
  runtimeMode,
  localRuntime,
}: {
  reading: Reading;
  runtimeMode: string | null;
  localRuntime: boolean;
}) {
  const drawn = drawnCards(reading);
  const interpretationLabel =
    reading.mode === 'template'
      ? 'Prepared reflection template'
      : reading.provenance.provider === 'openai'
        ? 'AI interpretation'
        : localRuntime
          ? 'Local simulated interpretation'
          : 'Simulated interpretation';
  return (
    <div className="reading-return-interpretation">
      <div className="return-section-label">
        <h3>
          <TopicChip tone="sage">{interpretationLabel}</TopicChip>
        </h3>
      </div>
      {reading.units.map((unit, index) => {
        const card = reading.basis.cards.find((item) => item.position === unit.position);
        const name = drawn.find((item) => item.position === unit.position)?.name;
        return (
          <section key={unit.position} className="return-position">
            <span className="position-number" aria-hidden="true">
              {index + 1}
            </span>
            <div className="return-position-copy">
              <h3>{unit.position}</h3>
              <p className="return-card-line">
                {name ?? card?.cardId ?? 'Card unavailable'}
                {card && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="orientation">{card.orientation}</span>
                  </>
                )}
              </p>
              <p className="return-interpretation-text">{unit.interpretation}</p>
              {'reflectionQuestion' in unit && (
                <div className="return-unit-prompt">
                  <h4>Reflection prompt</h4>
                  <p>{unit.reflectionQuestion}</p>
                </div>
              )}
            </div>
          </section>
        );
      })}
      {reading.kind === 'tarot.accepted.v2' ? (
        <div className="reading-closing return-closing">
          <section>
            <h3>Putting it together</h3>
            <p>{reading.synthesis.text}</p>
          </section>
          <section>
            <h3>An optional next step</h3>
            <p>{reading.action.text}</p>
          </section>
          {reading.reflectionQuestion && (
            <section>
              <h3>A question to consider</h3>
              <p>{reading.reflectionQuestion.text}</p>
            </section>
          )}
        </div>
      ) : (
        <p className="reading-closing return-closing">{reading.closing}</p>
      )}
      <details className="reading-sources return-reading-sources">
        <summary>Cards, sources and shared context</summary>
        {reading.spreadPhoto && (
          <figure
            className="card spread-photo-card"
            data-testid="spread-photo-card"
            aria-labelledby="reading-spread-caption"
          >
            <img
              src={reading.spreadPhoto}
              alt="Uploaded tarot spread for this reading"
              className="spread-photo-image"
            />
            <figcaption id="reading-spread-caption" className="muted">
              Uploaded spread photo · Recognized 3-card spread
            </figcaption>
          </figure>
        )}
        <h3>Traditional source material</h3>
        <p className="muted">
          These sources are saved with the reading. They are separate from the interpretation and
          your own reflection. These meanings are unapproved development material.
        </p>
        {reading.basis.cards.map((card, index) => {
          const name = drawn.find((item) => item.position === card.position)?.name;
          const unit = reading.units.find((value) => value.position === card.position);
          const position = card.position[0]!.toUpperCase() + card.position.slice(1);
          return (
            <div key={card.id} className="source return-source">
              <CardFace cardId={card.cardId} orientation={card.orientation} name={name} />
              <div className="source-copy">
                <h3>
                  {position}: {name ? `${name} (${card.cardId})` : card.cardId} · {card.orientation}
                </h3>
                {unit && (
                  <div className="return-saved-basis">
                    <h4>
                      {reading.spreadPhoto
                        ? 'Recognized card'
                        : reading.parentEditionId
                          ? 'Original card'
                          : 'Drawn card'}
                    </h4>
                    <p className="basis-text">{unit.basisText}</p>
                  </div>
                )}
                {reading.kind === 'tarot.accepted.v2' ? (
                  <>
                    <p>{reading.sources[index]!.meaning.core}</p>
                    <ul>
                      {reading.sources[index]!.meaning.distinctions.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                    <p>{reading.sources[index]!.meaning.positive}</p>
                    <p>{reading.sources[index]!.meaning.limits.join(' ')}</p>
                    {reading.sources[index]!.meaning.imagery && (
                      <p>
                        {reading.sources[index]!.meaning.imagery!.text} —{' '}
                        {reading.sources[index]!.meaning.imagery!.reference}
                      </p>
                    )}
                  </>
                ) : (
                  <p>{reading.sources[index]!.text}</p>
                )}
                <p className="source-attribution">{reading.sources[index]!.rights.attribution}</p>
                <p className="muted source-id">
                  Source {reading.sources[index]!.id} · version {reading.sources[index]!.version}
                </p>
              </div>
            </div>
          );
        })}
        <div className="return-shared-context">
          <h3>Shared context</h3>
          {reading.kind === 'tarot.accepted.v3' && reading.contextReceipt ? (
            <p>
              {reading.contextReceipt.shared.length
                ? `${reading.contextReceipt.shared.length} explicitly selected ${reading.contextReceipt.shared.length === 1 ? 'excerpt was' : 'excerpts were'} included with this reading.`
                : 'No earlier writing was selected for this reading.'}
            </p>
          ) : (
            <p>Shared context details are not available for this saved edition.</p>
          )}
        </div>
        <p className="muted">
          {reading.mode === 'template'
            ? 'Prepared reflection template.'
            : reading.provenance.provider === 'openai'
              ? 'Generated by OpenAI.'
              : runtimeMode === 'hosted-synthetic'
                ? 'Generated by the hosted simulation.'
                : localRuntime
                  ? 'Generated by the local simulation.'
                  : 'Generated by a simulation.'}{' '}
          This saved text is not rewritten when you return.
        </p>
      </details>
    </div>
  );
}
