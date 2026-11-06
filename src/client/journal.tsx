import type { ReactNode, Ref } from 'react';
import type { z } from 'zod';
import type { apiSchemas } from '../contracts/index.ts';
import { Button } from './design/components.tsx';
import { Art } from './art.tsx';
import { Notice } from './notice.tsx';
import { date } from './date.ts';
import './astrology/astrology.css';
export type JournalMethod = 'all' | 'tarot' | 'astrology' | 'imported';
type History = z.infer<typeof apiSchemas.HistoryPage>;
const labels = {
  tarot: 'Tarot',
  astrology: 'Astrology · Your Pattern',
  imported: 'Imported · original source',
};
export function Journal({
  history,
  method,
  busy,
  loading,
  failed,
  headingRef,
  onMethod,
  onOpen,
  onMore,
  onRetry,
  children,
}: {
  history: History | null;
  method: JournalMethod;
  busy: boolean;
  loading: boolean;
  failed: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onMethod: (method: JournalMethod) => void;
  onOpen: (id: string) => void;
  onMore: () => void;
  onRetry: () => void;
  children?: ReactNode;
}) {
  return (
    <section className="history-section journal" aria-label="Saved reading history">
      <header className="pattern-page-heading">
        <p className="eyebrow">One personal journal</p>
        <h2 id="saved-readings-heading" ref={headingRef} tabIndex={-1}>
          Your journal
        </h2>
        <p>Astrology, tarot, and your own words—kept together over time.</p>
      </header>
      {children}
      <fieldset className="journal-filters">
        <legend className="sr-only">Filter journal by source</legend>
        {(['all', 'tarot', 'astrology', 'imported'] as const).map((value) => (
          <Button
            key={value}
            variant={method === value ? 'primary' : 'text-button'}
            aria-pressed={method === value}
            disabled={busy}
            onClick={() => onMethod(value)}
          >
            {value === 'all'
              ? 'All'
              : value === 'imported'
                ? 'Imported'
                : value === 'tarot'
                  ? 'Tarot'
                  : 'Astrology'}
          </Button>
        ))}
      </fieldset>
      {loading && <p role="status">Loading saved readings…</p>}
      {failed && (
        <>
          <Notice message={{ tone: 'error', text: 'Your saved readings could not be loaded.' }} />
          <Button variant="secondary" disabled={busy} onClick={onRetry}>
            Retry loading saved readings
          </Button>
        </>
      )}
      <div className="journal-columns">
        <div>
          <p className="field-hint">Newest readings first</p>
          {history?.items.length === 0 && !failed && !busy && (
            <div className="empty-history">
              <Art name="spiral-bloom" className="empty-history-art" />
              <h3>
                {method === 'all'
                  ? 'A place to return to.'
                  : 'No saved ' +
                    (method === 'astrology'
                      ? 'astrology'
                      : method === 'tarot'
                        ? 'tarot'
                        : 'imported') +
                    ' readings yet.'}
              </h3>
              <p>
                {method === 'all'
                  ? 'No saved readings yet. Save a reading and your words will have a home here.'
                  : 'Choose All to see the rest of your journal.'}
              </p>
            </div>
          )}
          {history && history.items.length > 0 && (
            <ol className="reading-history journal-entries">
              {history.items.map((item) => (
                <li key={item.id} className="journal-entry">
                  <p className="eyebrow">{labels[item.method]}</p>
                  <Button
                    type="button"
                    variant="text-button"
                    className="history-link"
                    id={`saved-reading-${item.id}`}
                    disabled={busy}
                    onClick={() => onOpen(item.id)}
                  >
                    <span>
                      {item.questionPreview ?? 'Saved reading'}
                      {item.imported && <small> · Imported reading</small>}
                    </span>
                  </Button>
                  <p className="field-hint">
                    Started <time dateTime={item.createdAt}>{date(item.createdAt)}</time>
                    {item.savedAt && (
                      <>
                        {' '}
                        · Saved <time dateTime={item.savedAt}>{date(item.savedAt)}</time>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {history?.nextCursor && !failed && (
            <Button variant="secondary" disabled={busy} onClick={onMore}>
              Load more readings
            </Button>
          )}
        </div>
        <aside className="pattern-context journal-context" data-theme="evening">
          <h3>Return with fresh eyes.</h3>
          <p>
            An earlier question can mean something different today. Keep the original close while
            you notice what has changed.
          </p>
          <p>
            Opening a saved reading does not start a new reading. Your words stay out of new
            readings unless you choose to include them.
          </p>
        </aside>
      </div>
    </section>
  );
}
