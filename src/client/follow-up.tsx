import { type MouseEvent, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { apiSchemas, type AnyAcceptedReading } from '../contracts/index.ts';
import { api, ApiFailure } from './api.ts';
import { cardName } from './card-names.ts';
import { date } from './date.ts';
import { TextLink } from './design/components.tsx';

type Reading = z.infer<typeof AnyAcceptedReading>;
type EditionSummary = { question: string | null; at: string | null; unavailable?: boolean };
type EditionDetails = Record<string, EditionSummary>;

/** Owner-scoped display metadata only; aborted on navigation and never persisted in the browser. */
export function useEditionDetails(reading: Reading | null, ids: string[], onExpired: () => void) {
  const [retry, setRetry] = useState(0);
  const editionIds = ids.join(',');
  const scope = reading ? `${reading.sessionId}/${editionIds}/${retry}` : '';
  const [loaded, setLoaded] = useState<{ scope: string; details: EditionDetails; failed: boolean }>(
    { scope: '', details: {}, failed: false },
  );
  const expired = useRef(onExpired);
  expired.current = onExpired;
  useEffect(() => {
    if (!reading) {
      setLoaded({ scope: '', details: {}, failed: false });
      return;
    }
    const controller = new AbortController();
    const details: EditionDetails = {
      [reading.editionId]: { question: reading.question, at: reading.acceptedAt },
    };
    let failed = false;
    setLoaded({ scope, details: { ...details }, failed });
    const queue = [...new Set([reading.parentEditionId, ...editionIds.split(',')])].filter(
      (id): id is string => Boolean(id) && id !== reading.editionId,
    );
    const load = async () => {
      while (queue.length && !controller.signal.aborted) {
        const id = queue.shift()!;
        try {
          const value = await api(`/readings/${id}`, apiSchemas.Reading, undefined, undefined, {
            signal: controller.signal,
          });
          if (
            value.kind.startsWith('tarot.accepted.') &&
            'sessionId' in value &&
            value.sessionId === reading.sessionId &&
            value.editionId === id &&
            'question' in value &&
            'acceptedAt' in value
          )
            details[id] = { question: value.question, at: value.acceptedAt };
          else details[id] = { question: null, at: null, unavailable: true };
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof ApiFailure && error.status === 401) {
            controller.abort();
            expired.current();
            return;
          }
          if (error instanceof ApiFailure && [404, 410].includes(error.status))
            details[id] = { question: null, at: null, unavailable: true };
          else failed = true;
        }
        if (!controller.signal.aborted) setLoaded({ scope, details: { ...details }, failed });
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, load));
    return () => controller.abort();
  }, [scope, reading, editionIds]);
  return {
    details: loaded.scope === scope ? loaded.details : {},
    failed: loaded.scope === scope && loaded.failed,
    retry: () => setRetry((value) => value + 1),
  };
}
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
export function ReadingOrigin({ reading, details }: { reading: Reading; details: EditionDetails }) {
  if (!reading.parentEditionId) return null;
  const parent = details[reading.parentEditionId];
  return (
    <div className="reading-origin">
      <p>
        <strong>No new draw</strong> · The original three cards and orientations are reused.
      </p>
      <p>
        Follow-up to:{' '}
        <TextLink
          href={editionPath(reading.sessionId, reading.parentEditionId)}
          onClick={editionNavigation}
        >
          {parent?.question ??
            (parent?.unavailable ? 'Parent edition unavailable' : 'View parent reading')}
        </TextLink>
      </p>
    </div>
  );
}

export function EditionHistory({
  ids,
  reading,
  details = {},
}: {
  ids: string[];
  reading: Reading;
  details?: EditionDetails;
}) {
  if (ids.length < 2) return null;
  const path = (id: string) => editionPath(reading.sessionId, id);
  return (
    <nav className="edition-history" aria-label="Edition history">
      <h3>Reading editions</h3>
      <details open={ids.length <= 4}>
        <summary>{ids.length} editions · Choose an original or follow-up</summary>
        <ol>
          {ids.map((id, i) => (
            <li key={id}>
              {id === reading.editionId ? (
                <span className="edition-choice" aria-current="page">
                  <strong>
                    {i === 0 ? 'Original reading' : `Follow-up ${i}`} · Current edition
                  </strong>
                  <span>
                    {details[id]?.at ? date(details[id].at, true) : date(reading.acceptedAt, true)}
                  </span>
                  <span>{reading.question}</span>
                </span>
              ) : (
                <TextLink className="edition-choice" href={path(id)} onClick={editionNavigation}>
                  <strong>{i === 0 ? 'Original reading' : `Follow-up ${i}`}</strong>
                  {details[id] && (
                    <>
                      {details[id].at && <span>{date(details[id].at, true)}</span>}
                      <span>{details[id].question ?? 'Edition unavailable'}</span>
                    </>
                  )}
                </TextLink>
              )}
            </li>
          ))}
        </ol>
      </details>
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
