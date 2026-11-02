import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { apiSchemas, Grant, type Selection } from '../contracts/index.ts';
import { CONTEXT_LIMITS, codePointLength, contextExcerpt } from '../contracts/context-policy.ts';
import { CONTEXT_PRODUCT_COPY } from '../contracts/product-copy.ts';
import { editionContextText } from '../domain/tarot/continuity.ts';
import { api, ApiFailure } from './api.ts';
import { Button, Input, TextArea } from './design/components.tsx';

type Source = {
  source: z.infer<typeof Grant>['source'];
  label: string;
  text: string;
  authorship: 'user' | 'generated' | 'legacy_unknown';
};
type Chosen = { source: Source; grant: z.infer<typeof Grant>; start: number; end: number };
export type ContextRequestBinding = Pick<
  z.infer<typeof apiSchemas.ContextPreviewWrite>,
  'clientIntentId' | 'question' | 'parentEditionId' | 'permissionRevision'
>;
export type ContextSelectionValue = {
  selection: z.infer<typeof Selection>[];
  contextAcknowledgement: string;
  binding: ContextRequestBinding;
  reviewScope: string;
};
const sourceKey = (value: Source['source']) => JSON.stringify(value);
/** Textareas normalize CRLF/lone CR to LF. Map their UTF-16 boundaries back to
 * the original source's code-point offsets without changing a single source byte. */
export function codePointRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const boundaries = new Map<number, number>([[0, 0]]);
  let domOffset = 0,
    originalPoints = 0;
  for (let offset = 0; offset < text.length; ) {
    if (text[offset] === '\r') {
      offset++;
      originalPoints++;
      if (text[offset] === '\n') {
        offset++;
        originalPoints++;
      }
      domOffset++;
    } else {
      const width = text.codePointAt(offset)! > 0xffff ? 2 : 1;
      offset += width;
      domOffset += width;
      originalPoints++;
    }
    boundaries.set(domOffset, originalPoints);
  }
  const mappedStart = boundaries.get(start),
    mappedEnd = boundaries.get(end);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    end <= start ||
    mappedStart === undefined ||
    mappedEnd === undefined
  )
    throw new Error('Choose a complete text range.');
  return { start: mappedStart, end: mappedEnd };
}
/** No request lifecycle here: C4 consumes only server-issued, acknowledged values. */
export function ContextSelection({
  request,
  csrfToken,
  recipient,
  onChange,
  onSelectionCount,
  onExpired,
  disabled = false,
  reviewScope = '',
}: {
  request: ContextRequestBinding;
  csrfToken: string;
  recipient: 'synthetic' | 'openai' | 'unavailable';
  onChange: (value: ContextSelectionValue | null) => void;
  onSelectionCount: (count: number) => void;
  onExpired: () => void;
  disabled?: boolean;
  reviewScope?: string;
}) {
  const uid = useId();
  const mutationKeys = useRef(new Map<string, string>());
  const mutationKey = (identity: unknown) => {
    const bound = JSON.stringify(identity);
    let key = mutationKeys.current.get(bound);
    if (!key) {
      key = crypto.randomUUID();
      mutationKeys.current.set(bound, key);
    }
    return key;
  };
  const [history, setHistory] = useState<z.infer<typeof apiSchemas.HistoryPage> | null>(null);
  const [sources, setSources] = useState<Source[]>([]),
    [active, setActive] = useState<Source | null>(null);
  const [grants, setGrants] = useState<z.infer<typeof Grant>[]>([]),
    [chosen, setChosen] = useState<Chosen[]>([]);
  const [range, setRange] = useState({ start: 0, end: 0 }),
    [preview, setPreview] = useState<z.infer<typeof apiSchemas.ContextPreview> | null>(null);
  const [acknowledged, setAcknowledged] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const alive = useRef(true),
    serial = useRef(0),
    reviewHeading = useRef<HTMLHeadingElement>(null),
    browseButton = useRef<HTMLButtonElement>(null);
  const latest = useRef({ request, recipient, onChange, onSelectionCount, onExpired });
  latest.current = { request, recipient, onChange, onSelectionCount, onExpired };
  const binding = JSON.stringify([request, recipient, reviewScope]),
    bindingRef = useRef(binding);
  bindingRef.current = binding;
  const invalidate = useCallback(() => {
    serial.current++;
    setPreview(null);
    setAcknowledged(false);
    latest.current.onChange(null);
  }, []);
  const previousBinding = useRef<string | null>(null);
  useEffect(() => {
    if (previousBinding.current === binding) return;
    previousBinding.current = binding;
    invalidate();
  }, [binding, invalidate]);
  useLayoutEffect(() => {
    if (preview) reviewHeading.current?.focus();
  }, [preview]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      serial.current++;
      latest.current.onChange(null);
      latest.current.onSelectionCount(0);
    };
  }, []);
  const setSelection = (next: Chosen[]) => {
    invalidate();
    setChosen(next);
    latest.current.onSelectionCount(next.length);
  };
  const run = async (action: (current: () => boolean) => Promise<void>) => {
    if (busy || disabled) return;
    const sequence = ++serial.current,
      bound = bindingRef.current;
    const current = () =>
      alive.current && serial.current === sequence && bindingRef.current === bound;
    setBusy(true);
    setError(null);
    try {
      await action(current);
    } catch (cause) {
      if (!current()) return;
      invalidate();
      if (cause instanceof ApiFailure && cause.status === 401) {
        latest.current.onExpired();
        return;
      }
      setError(
        cause instanceof ApiFailure && [409, 410].includes(cause.status)
          ? 'The context source changed or is unavailable. Review the source again; your question is still here.'
          : cause instanceof Error
            ? cause.message
            : 'Context could not be loaded. Your question is still here.',
      );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const browse = () =>
    void run(async (current) => {
      const page = await api('/sessions?status=saved', apiSchemas.HistoryPage);
      if (current()) setHistory(page);
    });
  const openSources = (sessionId: string) =>
    void run(async (current) => {
      const session = await api(`/sessions/${sessionId}`, apiSchemas.SessionRecord),
        loaded: Source[] = [],
        found: z.infer<typeof Grant>[] = [];
      for (const editionId of session.editionIds) {
        const reading = await api(`/readings/${editionId}`, apiSchemas.Reading);
        if (reading.kind !== 'reading.unavailable.v1')
          loaded.push({
            source: { kind: 'edition', editionId },
            label: `Reading edition ${reading.editionNumber}`,
            text: editionContextText(reading),
            authorship: reading.kind === 'legacy.imported.v1' ? 'legacy_unknown' : 'generated',
          });
        let cursor: string | null = null;
        do {
          const page: z.infer<typeof apiSchemas.RevisitPage> = await api(
            `/revisits?editionId=${encodeURIComponent(editionId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
            apiSchemas.RevisitPage,
          );
          for (const note of page.items)
            loaded.push({
              source: { kind: 'revisit_revision', revisitId: note.id, revision: note.revision },
              label: `Revisit note ${new Date(note.createdAt).toLocaleString()} · revision ${note.revision}`,
              text: note.note,
              authorship: 'user',
            });
          cursor = page.nextCursor;
          if (!current()) return;
        } while (cursor);
        do {
          const page: z.infer<typeof apiSchemas.GrantPage> = await api(
            `/context-grants?editionId=${encodeURIComponent(editionId)}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
            apiSchemas.GrantPage,
          );
          found.push(...page.items);
          cursor = page.nextCursor;
          if (!current()) return;
        } while (cursor);
      }
      for (const reflectionId of session.reflectionIds) {
        const reflection = await api(`/reflections/${reflectionId}`, apiSchemas.Reflection);
        loaded.push({
          source: { kind: 'reflection_revision', reflectionId, revision: reflection.revision },
          label: `Reflection revision ${reflection.revision}`,
          text: reflection.text,
          authorship: 'user',
        });
        if (!current()) return;
      }
      if (current()) {
        setSources(loaded);
        setGrants(found);
        setActive(null);
        setRange({ start: 0, end: 0 });
        setPreview(null);
        setAcknowledged(false);
        latest.current.onChange(null);
      }
    });
  const activeGrant = active
    ? grants.find((g) => g.state === 'allowed' && sourceKey(g.source) === sourceKey(active.source))
    : undefined;
  let excerpt: string | null = null;
  if (active) {
    try {
      excerpt = contextExcerpt(active.text, range.start, range.end);
    } catch {}
  }
  const allowed = !busy && !disabled;
  return (
    <section className="context-selection" aria-label="Selected context">
      <h3>Choose context deliberately</h3>
      <p>{CONTEXT_PRODUCT_COPY.eligibility}</p>
      <p className="muted">{CONTEXT_PRODUCT_COPY.limits}</p>
      <Button
        ref={browseButton}
        type="button"
        variant="secondary"
        disabled={!allowed}
        onClick={browse}
      >
        Browse saved context
      </Button>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {history && (
        <div className="context-source-list">
          {history.items.length === 0 && <p>No saved sources are available.</p>}
          {history.items.map((item) => (
            <div key={item.id}>
              <p>{item.questionPreview ?? 'Saved reading'}</p>
              <Button
                type="button"
                variant="secondary"
                disabled={!allowed}
                onClick={() => openSources(item.id)}
              >
                Open context sources
              </Button>
            </div>
          ))}
          {history.nextCursor && (
            <Button
              type="button"
              variant="secondary"
              disabled={!allowed}
              onClick={() =>
                void run(async (current) => {
                  const page = await api(
                    `/sessions?status=saved&cursor=${encodeURIComponent(history.nextCursor!)}`,
                    apiSchemas.HistoryPage,
                  );
                  if (current())
                    setHistory({
                      items: [...history.items, ...page.items],
                      nextCursor: page.nextCursor,
                    });
                })
              }
            >
              More saved context
            </Button>
          )}
        </div>
      )}
      {sources.length > 0 && (
        <div className="context-source-list">
          {sources.map((source) => (
            <Button
              key={sourceKey(source.source)}
              type="button"
              variant="secondary"
              disabled={!allowed}
              onClick={() => {
                invalidate();
                setActive(source);
                setRange({ start: 0, end: 0 });
                setError(null);
              }}
              aria-label={`Review ${source.label.toLowerCase()}`}
            >
              {source.label} ·{' '}
              {source.authorship === 'user'
                ? 'Your writing'
                : source.authorship === 'generated'
                  ? 'Generated text'
                  : 'Unknown authorship'}
            </Button>
          ))}
        </div>
      )}
      {active && (
        <div className="context-source-review">
          <h4>{active.label}</h4>
          <p>
            {active.authorship === 'user'
              ? 'Your writing'
              : active.authorship === 'generated'
                ? 'Generated interpretation'
                : 'Legacy text · authorship unknown'}
          </p>
          <label htmlFor={`${uid}-text`}>Complete source text</label>
          <TextArea
            id={`${uid}-text`}
            readOnly
            disabled={!allowed}
            rows={8}
            value={active.text}
            onSelect={(event) => {
              const field = event.currentTarget;
              if (field.selectionStart === field.selectionEnd) {
                invalidate();
                setRange({ start: 0, end: 0 });
                return;
              }
              try {
                const next = codePointRange(active.text, field.selectionStart, field.selectionEnd);
                invalidate();
                setRange(next);
                setError(null);
              } catch (cause) {
                invalidate();
                setError((cause as Error).message);
              }
            }}
          />
          <p className="muted">
            Select text above with the pointer, or use the keyboard to enter code-point offsets
            below. Emoji count as one; combining marks count separately.
          </p>
          <div className="context-range">
            <label htmlFor={`${uid}-start`}>Excerpt start (code points)</label>
            <Input
              id={`${uid}-start`}
              type="number"
              min={0}
              max={codePointLength(active.text)}
              value={range.start}
              disabled={!allowed}
              onChange={(event) => {
                invalidate();
                setRange({ ...range, start: Number(event.target.value) });
              }}
            />
            <label htmlFor={`${uid}-end`}>Excerpt end (code points)</label>
            <Input
              id={`${uid}-end`}
              type="number"
              min={0}
              max={codePointLength(active.text)}
              value={range.end}
              disabled={!allowed}
              onChange={(event) => {
                invalidate();
                setRange({ ...range, end: Number(event.target.value) });
              }}
            />
          </div>
          {excerpt !== null ? (
            <>
              <p>Chosen range · {codePointLength(excerpt)} code points</p>
              <blockquote className="context-excerpt">{excerpt}</blockquote>
            </>
          ) : (
            <p>Choose a nonempty range of at most 1,200 code points.</p>
          )}
          {!activeGrant ? (
            <Button
              type="button"
              disabled={!allowed}
              onClick={() =>
                void run(async (current) => {
                  const grant = await api(
                    '/context-grants',
                    Grant,
                    { source: active.source },
                    csrfToken,
                    {
                      key: mutationKey([
                        'grant',
                        active.source,
                        grants
                          .filter((g) => sourceKey(g.source) === sourceKey(active.source))
                          .map((g) => [g.id, g.revision]),
                      ]),
                    },
                  );
                  if (current()) {
                    setGrants([...grants, grant]);
                    invalidate();
                  }
                })
              }
            >
              Allow this source as context
            </Button>
          ) : (
            <>
              <p>Eligible for context · nothing is sent by granting eligibility.</p>
              <Button
                type="button"
                variant="secondary"
                disabled={!allowed}
                onClick={() =>
                  void run(async (current) => {
                    const grant = await api(
                      `/context-grants/${activeGrant.id}`,
                      Grant,
                      {},
                      csrfToken,
                      {
                        method: 'DELETE',
                        revision: activeGrant.revision,
                        key: mutationKey(['revoke', activeGrant.id, activeGrant.revision]),
                      },
                    );
                    if (current()) {
                      setGrants(grants.map((g) => (g.id === grant.id ? grant : g)));
                      setSelection(chosen.filter((c) => c.grant.id !== grant.id));
                    }
                  })
                }
              >
                Revoke context eligibility
              </Button>
            </>
          )}
          <Button
            type="button"
            disabled={!allowed || !activeGrant || excerpt === null}
            onClick={() => {
              const next = chosen.filter(
                (c) => sourceKey(c.source.source) !== sourceKey(active.source),
              );
              next.push({ source: active, grant: activeGrant!, ...range });
              if (
                next.length > CONTEXT_LIMITS.sources ||
                next.reduce((n, c) => n + c.end - c.start, 0) > CONTEXT_LIMITS.total
              ) {
                invalidate();
                setError(
                  'Choose at most 3 sources and 3,000 code points total. Nothing was truncated.',
                );
                return;
              }
              setSelection(next);
              setError(null);
            }}
          >
            Add excerpt to this request
          </Button>
        </div>
      )}
      {chosen.length === 0 ? (
        <p>No context selected.</p>
      ) : (
        <ul className="context-chosen">
          {chosen.map((item) => (
            <li key={item.grant.id}>
              <p>
                {item.source.label} ·{' '}
                {item.source.authorship === 'user'
                  ? 'Your writing'
                  : item.source.authorship === 'generated'
                    ? 'Generated text'
                    : 'Unknown authorship'}{' '}
                · {item.end - item.start} code points
              </p>
              <Button
                type="button"
                variant="text-button"
                disabled={!allowed}
                onClick={() => {
                  setSelection(chosen.filter((c) => c.grant.id !== item.grant.id));
                  browseButton.current?.focus();
                }}
              >
                Remove from this request
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">{CONTEXT_PRODUCT_COPY.removeRevoke}</p>
      {chosen.length > 0 && (
        <Button
          type="button"
          disabled={!allowed || !request.question.trim() || recipient === 'unavailable'}
          onClick={() =>
            void run(async (current) => {
              setPreview(null);
              setAcknowledged(false);
              latest.current.onChange(null);
              const value = await api(
                '/context-preview',
                apiSchemas.ContextPreview,
                {
                  ...request,
                  items: chosen.map((c) => ({
                    grantId: c.grant.id,
                    grantRevision: c.grant.revision,
                    start: c.start,
                    end: c.end,
                  })),
                },
                csrfToken,
              );
              if (current()) {
                setPreview(value);
              }
            })
          }
        >
          Review complete request
        </Button>
      )}
      {preview && (
        <section className="context-complete-review" aria-label="Complete context review">
          <h4 ref={reviewHeading} tabIndex={-1}>
            Complete context review
          </h4>
          <p>Current question</p>
          <blockquote className="context-excerpt">{request.question}</blockquote>
          {request.parentEditionId && (
            <p>
              This request uses the original cards and eligible source canon. Previous generated
              prose is included only if selected below.
            </p>
          )}
          {preview.items.map((item, i) => (
            <div key={item.selection.grantId}>
              <h5>
                Excerpt {i + 1} · {chosen[i]?.source.label}
              </h5>
              <p>
                {item.authorship === 'user'
                  ? 'Your writing'
                  : item.authorship === 'generated'
                    ? 'Generated interpretation'
                    : 'Legacy text · authorship unknown'}
              </p>
              <blockquote className="context-excerpt">{item.text}</blockquote>
            </div>
          ))}
          <p>
            {recipient === 'openai'
              ? CONTEXT_PRODUCT_COPY.recipient
              : CONTEXT_PRODUCT_COPY.synthetic}
          </p>
          <p>{CONTEXT_PRODUCT_COPY.retention}</p>
          <label className="check" htmlFor={`${uid}-ack`}>
            <Input
              id={`${uid}-ack`}
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => {
                setAcknowledged(event.target.checked);
                latest.current.onChange(
                  event.target.checked
                    ? {
                        selection: preview.items.map((i) => i.selection),
                        contextAcknowledgement: preview.acknowledgementHash,
                        binding: { ...request },
                        reviewScope,
                      }
                    : null,
                );
              }}
            />
            I reviewed this question and every selected excerpt for this request.
          </label>
          {acknowledged && <p role="status">Context review acknowledged.</p>}
        </section>
      )}
    </section>
  );
}
