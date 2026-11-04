import type { MouseEvent } from 'react';
import type { z } from 'zod';
import type { AnyAcceptedReading } from '../contracts/index.ts';
import { cardName } from './card-names.ts';
import { date } from './date.ts';
import { TextLink } from './design/components.tsx';

type Reading = z.infer<typeof AnyAcceptedReading>;
export const editionPath = (sessionId: string, editionId: string) =>
  `/saved/${sessionId}/${editionId}`;

/** Ordinary links keep exact, reloadable edition identities, including modified/new-tab clicks. */
export function editionNavigation(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  window.history.pushState(null, '', event.currentTarget.pathname);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
export function FollowUp({ parent }: { parent: Reading }) {
  return (
    <section className="follow-up-basis" aria-label="Original draw">
      <h3>No new draw</h3>
      <p>
        Following edition {parent.editionNumber} ·{' '}
        <time dateTime={parent.acceptedAt}>{date(parent.acceptedAt)}</time>
      </p>
      <blockquote>{parent.question}</blockquote>
      <ol>
        {parent.basis.cards.map((card, index) => (
          <li key={card.position}>
            {card.position} ·{' '}
            {parent.kind === 'tarot.accepted.v2'
              ? parent.draw[index]?.name
              : (cardName(parent.basis.deckEdition, card.cardId) ?? card.cardId)}{' '}
            · {card.orientation}
          </li>
        ))}
      </ol>
      <p>
        The follow-up uses these same three cards and orientations. It is kept with the original
        saved reading.
      </p>
    </section>
  );
}
export function EditionHistory({ ids, reading }: { ids: string[]; reading: Reading }) {
  if (ids.length < 2) return null;
  const path = (id: string) => editionPath(reading.sessionId, id);
  return (
    <nav className="edition-history" aria-label="Edition history">
      <h3>Edition history</h3>
      <ol>
        {ids.map((id, i) => (
          <li key={id}>
            {id === reading.editionId ? (
              <span aria-current="page">Edition {i + 1} · Current edition</span>
            ) : (
              <TextLink href={path(id)} onClick={editionNavigation}>
                Edition {i + 1}
                {i === 0 ? ' · Original' : ''}
              </TextLink>
            )}
          </li>
        ))}
      </ol>
      {reading.parentEditionId && (
        <div className="actions">
          <TextLink href={path(reading.parentEditionId)} onClick={editionNavigation}>
            Open parent edition
          </TextLink>
          {ids[0] && (
            <TextLink href={path(ids[0])} onClick={editionNavigation}>
              Back to original reading
            </TextLink>
          )}
        </div>
      )}
    </nav>
  );
}
