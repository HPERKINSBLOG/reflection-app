import type { Ref } from 'react';
import { CardFace } from './card-face.tsx';
import { Button } from './design/components.tsx';
import type { DrawnCard } from './drawn-cards.ts';
import { Icon } from './icon.tsx';
import { ReadingSteps } from './tarot-steps.tsx';

/** A newly drawn spread on its own, before anyone else's interpretation of it. */
export function CardsStep({
  headingRef,
  question,
  cards,
  onRead,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  question: string;
  cards: DrawnCard[];
  onRead: () => void;
}) {
  return (
    <section className="card new-reading tarot-cards-step" aria-labelledby="tarot-cards-heading">
      <ReadingSteps current="cards" />
      <div className="new-reading-layout tarot-step tarot-step-cards">
        <div className="new-reading-content">
          <header className="tarot-step-heading">
            <p className="eyebrow">Your three cards</p>
            <h2 id="tarot-cards-heading" ref={headingRef} tabIndex={-1}>
              Take a moment with the spread.
            </h2>
            <p className="tarot-step-lead">
              Each position offers a different way into your question.
            </p>
          </header>
          <p className="tarot-cards-question">{question}</p>
          <div className="tarot-cards">
            {cards.map((card) => (
              <figure key={card.position} className="tarot-card">
                <CardFace cardId={card.cardId} orientation={card.orientation} name={card.name} />
                <figcaption>
                  {card.label}: {card.name ?? card.cardId}, {card.orientation}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="muted tarot-cards-note">
            Illustration only. The card names identify the draw.
          </p>
          <div className="actions tarot-step-actions">
            <Button onClick={onRead}>
              Read the interpretation
              <Icon name="chevron" />
            </Button>
          </div>
        </div>
        <aside className="reading-preflight tarot-step-aside" aria-labelledby="cards-step-aside">
          <h3 id="cards-step-aside">Notice before interpreting.</h3>
          <p>
            What catches your eye? You can take your time with the cards before reading another
            perspective.
          </p>
        </aside>
      </div>
    </section>
  );
}
