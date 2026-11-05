import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { apiSchemas, type Grant } from '../contracts/index.ts';
import { CONTEXT_LIMITS, codePointLength } from '../contracts/context-policy.ts';
import { editionContextPassages, type ContextPassage } from '../contracts/context-reading.ts';
import { api, ApiFailure } from './api.ts';
import { date } from './date.ts';
import { Button, Input, TextArea } from './design/components.tsx';
import { Notice, type NoticeMessage } from './notice.tsx';
import './context-selection.css';

type PreviewWrite = z.infer<typeof apiSchemas.ContextPreviewWrite>;
type Preview = z.infer<typeof apiSchemas.ContextPreview>;
type GrantValue = z.infer<typeof Grant>;
type Family = z.infer<typeof apiSchemas.SessionRecord>;
type Binding = Omit<PreviewWrite, 'items'>;
type Range = PreviewWrite['items'][number];
type Choice = { source: GrantValue['source']; title: string; at: string; passage: ContextPassage };
type Picked = { range: Range; title: string; at: string; source: string };
export interface ContextSubmission {
  count: number;
  reviewedExcerpts?: Array<{
    id: string;
    title: string;
    at: string;
    text: string;
    authorship: 'generated' | 'user' | 'unknown';
  }>;
  confirmation?: {
    binding: string;
    selection: z.infer<typeof apiSchemas.StartRequest>['selection'];
    acknowledgement: string;
  };
}

export function contextBinding(binding: Binding) {
  return JSON.stringify([
    binding.clientIntentId,
    binding.question,
    binding.parentEditionId,
    binding.permissionRevision,
  ]);
}
function sourceKey(source: GrantValue['source']) {
  switch (source.kind) {
    case 'edition':
      return source.editionId;
    case 'reflection_revision':
      return `reflection/${source.reflectionId}/${source.revision}`;
    case 'revisit_revision':
      return `revisit/${source.revisitId}/${source.revision}`;
  }
}
function choiceKey(choice: Choice) {
  return `${sourceKey(choice.source)}/${choice.passage.start}`;
}
function noteChoices(notes: z.infer<typeof apiSchemas.Revisit>[]): Choice[] {
  return notes.map((note) => ({
    source: { kind: 'revisit_revision', revisitId: note.id, revision: note.revision },
    title: `Your revisit note · revision ${note.revision}`,
    at: note.updatedAt,
    passage: { text: note.note, start: 0, end: codePointLength(note.note), authorship: 'user' },
  }));
}

/** Textarea selection offsets count UTF-16 and normalize CR/CRLF; the stored source uses exact code points. */
function originalOffset(text: string, browserOffset: number) {
  let browser = 0,
    original = 0;
  for (const [part] of text.matchAll(/\r\n|[\s\S]/gu)) {
    if (browser === browserOffset) return original;
    browser += part === '\r\n' ? 1 : part.length;
    original += part === '\r\n' ? 2 : 1;
  }
  return browser === browserOffset ? original : null;
}
type Props = { csrfToken: string; onExpired: () => void } & (
  | { mode: 'manage'; family: Family; editionId: string }
  | {
      mode: 'choose';
      binding: Binding;
      initialSource?: { family: Family; editionId: string };
      onChange: (result: ContextSubmission) => void;
    }
);

/** Mounted private draft. Only server-issued selection coordinates and proofs leave it on confirmation. */
export function ContextSelection(props: Props) {
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<z.infer<typeof apiSchemas.HistoryPage> | null>(null);
  const [family, setFamily] = useState<Family | null>(
    props.mode === 'manage' ? props.family : (props.initialSource?.family ?? null),
  );
  const [edition, setEdition] = useState(
    props.mode === 'manage' ? props.editionId : (props.initialSource?.editionId ?? ''),
  );
  const [partial, setPartial] = useState(false);
  const [editionSummary, setEditionSummary] = useState<{
    question: string | null;
    at: string;
  } | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]),
    [grants, setGrants] = useState<GrantValue[]>([]);
  const [nextGrants, setNextGrants] = useState<string | null>(null);
  const [nextNotes, setNextNotes] = useState<string | null>(null),
    [refOffset, setRefOffset] = useState(0);
  const [choiceId, setChoiceId] = useState(''),
    [first, setFirst] = useState(''),
    [last, setLast] = useState('');
  const [picks, setPicks] = useState<Picked[]>([]),
    [review, setReview] = useState<{ binding: string; value: Preview } | null>(null);
  const [ack, setAck] = useState(false),
    [message, setMessage] = useState<NoticeMessage | null>(null);
  const sequence = useRef(0),
    active = useRef(false),
    actions = useRef(new Map<string, string>());
  const propsRef = useRef(props),
    selectionVersion = useRef(0);
  const opener = useRef<HTMLButtonElement>(null),
    reviewHeading = useRef<HTMLHeadingElement>(null);
  propsRef.current = props;
  useEffect(
    () => () => {
      sequence.current++;
      actions.current.clear();
    },
    [],
  );
  const choice = choices.find((c) => choiceKey(c) === choiceId);
  const matching = choice
    ? grants.filter(
        (g) => g.state === 'allowed' && sourceKey(g.source) === sourceKey(choice.source),
      )
    : [];
  const binding = props.mode === 'choose' ? contextBinding(props.binding) : '';
  const visibleReview = review?.binding === binding ? review.value : null;
  useEffect(() => {
    if (visibleReview) reviewHeading.current?.focus();
  }, [visibleReview]);
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const previousBinding = useRef(binding);
  useLayoutEffect(() => {
    if (previousBinding.current === binding) return;
    previousBinding.current = binding;
    if (propsRef.current.mode === 'choose')
      propsRef.current.onChange({ count: picksRef.current.length });
    setReview(null);
    setAck(false);
    selectionVersion.current++;
  }, [binding]);

  function invalidate(next = picks) {
    selectionVersion.current++;
    setReview(null);
    setAck(false);
    if (props.mode === 'choose') props.onChange({ count: next.length });
  }
  function updatePicks(next: Picked[]) {
    setPicks(next);
    invalidate(next);
  }
  async function run(fn: (current: () => boolean) => Promise<void>) {
    if (active.current) return;
    const id = ++sequence.current,
      current = () => id === sequence.current;
    active.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await fn(current);
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiFailure && error.status === 401) return propsRef.current.onExpired();
      const changed = error instanceof ApiFailure && [404, 409, 410].includes(error.status);
      if (changed) invalidate();
      setMessage({
        tone: 'error',
        text: changed
          ? 'A selected source changed or is unavailable. Remove the old excerpt and review your selection again.'
          : error instanceof Error
            ? error.message
            : 'The sources could not be loaded. Try again.',
      });
    } finally {
      if (current()) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  function actionKey(action: string) {
    let key = actions.current.get(action);
    if (!key) {
      key = crypto.randomUUID();
      actions.current.set(action, key);
    }
    return key;
  }
  async function listHistory(current: () => boolean, cursor: string | null = null) {
    const page = await api(
      `/sessions?status=saved${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      apiSchemas.HistoryPage,
    );
    if (current())
      setHistory((previous) => ({
        items: [...(cursor ? (previous?.items ?? []) : []), ...page.items],
        nextCursor: page.nextCursor,
      }));
  }
  async function reflections(record: Family, id: string, start: number): Promise<Choice[]> {
    const rows = await Promise.all(
      record.reflectionIds.slice(start, start + 10).map((key) =>
        api(`/reflections/${key}`, apiSchemas.Reflection).catch((error: unknown) => {
          if (error instanceof ApiFailure && [404, 410].includes(error.status)) return null;
          throw error;
        }),
      ),
    );
    return rows.flatMap((r): Choice[] =>
      r && r.sessionId === record.id && r.editionId === id
        ? [
            {
              source: { kind: 'reflection_revision', reflectionId: r.id, revision: r.revision },
              title: `Your reflection · revision ${r.revision}`,
              at: r.updatedAt,
              passage: { text: r.text, start: 0, end: codePointLength(r.text), authorship: 'user' },
            },
          ]
        : [],
    );
  }
  function listGrants(id: string, cursor: string | null = null) {
    return api(
      `/context-grants?limit=50&editionId=${id}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      apiSchemas.GrantPage,
    );
  }
  function resetSources() {
    setEditionSummary(null);
    setChoices([]);
    setGrants([]);
    setNextGrants(null);
    setChoiceId('');
    setFirst('');
    setLast('');
    setRefOffset(0);
    setNextNotes(null);
  }
  async function loadEdition(record: Family, id: string, current: () => boolean) {
    setEdition(id);
    resetSources();
    if (!id) return;
    const [reading, saved, notes, authored] = await Promise.all([
      api(`/readings/${id}`, apiSchemas.Reading).catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 410) return null;
        throw error;
      }),
      listGrants(id),
      api(`/revisits?editionId=${id}`, apiSchemas.RevisitPage),
      reflections(record, id, 0),
    ]);
    if (!current()) return;
    if (
      (reading && (reading.editionId !== id || reading.sessionId !== record.id)) ||
      notes.items.some((n) => n.sessionId !== record.id || n.editionId !== id)
    )
      throw new Error('The source did not match this edition. Refresh to try again.');
    if (reading && reading.kind !== 'reading.unavailable.v1') {
      setEditionSummary({
        question:
          reading.kind === 'legacy.imported.v1' ? reading.record.question : reading.question,
        at: 'acceptedAt' in reading ? reading.acceptedAt : reading.importedAt,
      });
    }
    const rendered: Choice[] = reading
      ? editionContextPassages(reading).map((passage) => ({
          source: { kind: 'edition', editionId: id },
          title:
            passage.authorship === 'user'
              ? 'Your saved question'
              : passage.authorship === 'generated'
                ? 'Reading interpretation'
                : 'Imported writing · unknown authorship',
          at:
            'acceptedAt' in reading
              ? reading.acceptedAt
              : 'importedAt' in reading
                ? reading.importedAt
                : record.createdAt,
          passage,
        }))
      : [];
    setChoices([...rendered, ...authored, ...noteChoices(notes.items)]);
    setGrants(saved.items);
    setNextGrants(saved.nextCursor);
    setRefOffset(10);
    setNextNotes(notes.nextCursor);
  }
  async function loadFamily(id: string, current: () => boolean) {
    setFamily(null);
    setEdition('');
    resetSources();
    if (!id) return;
    const selected = await api(`/sessions/${id}`, apiSchemas.SessionRecord);
    if (!current()) return;
    if (selected.id !== id || selected.status !== 'saved')
      throw new Error('This saved reading is unavailable.');
    setFamily(selected);
    if (selected.editionIds.length === 1)
      await loadEdition(selected, selected.editionIds[0]!, current);
  }
  function toggle() {
    if (opened) {
      setOpened(false);
      opener.current?.focus();
      return;
    }
    setOpened(true);
    if (props.mode === 'manage')
      void run((current) => loadEdition(props.family, props.editionId, current));
    else if (family && edition && !choices.length)
      void run((current) => loadEdition(family, edition, current));
    else if (!history) void run((current) => listHistory(current));
  }
  async function allow(current: () => boolean) {
    if (!choice) return;
    const action = `allow/${sourceKey(choice.source)}`;
    const result = await api(
      '/context-grants',
      apiSchemas.Grant,
      { source: choice.source },
      props.csrfToken,
      { key: actionKey(action) },
    );
    if (current()) {
      actions.current.delete(action);
      setGrants((previous) => [result, ...previous.filter((g) => g.id !== result.id)]);
      setMessage({
        tone: 'success',
        text: 'Eligibility saved. Choose an excerpt to use it in a reading.',
      });
    }
  }
  async function revoke(grant: GrantValue, current: () => boolean) {
    const action = `revoke/${grant.id}/${grant.revision}`;
    const value = await api(`/context-grants/${grant.id}`, apiSchemas.Grant, {}, props.csrfToken, {
      method: 'DELETE',
      revision: grant.revision,
      key: actionKey(action),
    });
    if (current()) {
      actions.current.delete(action);
      setGrants((previous) => previous.map((g) => (g.id === value.id ? value : g)));
      updatePicks(picks.filter((p) => p.range.grantId !== grant.id));
      setMessage({
        tone: 'success',
        text: 'Eligibility revoked for future use. Any excerpt already sent remains subject to the recipient’s retention policy.',
      });
    }
  }
  function addRange(selected: Choice, a: number, b: number) {
    const grant = grants.find(
      (g) => g.state === 'allowed' && sourceKey(g.source) === sourceKey(selected.source),
    );
    if (!grant) return;
    if (
      !Number.isSafeInteger(a) ||
      !Number.isSafeInteger(b) ||
      a < 1 ||
      b < a ||
      b > selected.passage.end - selected.passage.start ||
      b - a + 1 > CONTEXT_LIMITS.perSource
    ) {
      setMessage({
        tone: 'error',
        text: 'Choose a complete range of 1 to 1,200 characters within this passage.',
      });
      return;
    }
    const source = sourceKey(selected.source);
    const next = picks.filter((p) => p.source !== source);
    const range = {
      grantId: grant.id,
      grantRevision: grant.revision,
      start: selected.passage.start + a - 1,
      end: selected.passage.start + b,
    };
    if (
      next.length >= CONTEXT_LIMITS.sources ||
      next.reduce((n, p) => n + p.range.end - p.range.start, range.end - range.start) >
        CONTEXT_LIMITS.total
    ) {
      setMessage({
        tone: 'error',
        text: 'Choose up to three different sources and 3,000 characters in total.',
      });
      return;
    }
    updatePicks([...next, { range, source, title: selected.title, at: selected.at }]);
    setMessage({
      tone: 'success',
      text: 'Excerpt added. Review your selected excerpts before starting.',
    });
  }
  function add() {
    if (choice) addRange(choice, Number(first), Number(last));
  }
  async function preview(current: () => boolean) {
    if (props.mode !== 'choose') return;
    const version = selectionVersion.current;
    const result = await api(
      '/context-preview',
      apiSchemas.ContextPreview,
      { ...props.binding, items: picks.map((p) => p.range) },
      props.csrfToken,
    );
    if (
      !current() ||
      version !== selectionVersion.current ||
      propsRef.current.mode !== 'choose' ||
      contextBinding(propsRef.current.binding) !== binding
    )
      return;
    if (
      result.items.length !== picks.length ||
      result.items.some(({ selection }, i) => {
        const requested = picks[i]!.range;
        return (
          selection.grantId !== requested.grantId ||
          selection.grantRevision !== requested.grantRevision ||
          selection.start !== requested.start ||
          selection.end !== requested.end
        );
      })
    )
      throw new Error('The preview did not match your selection. Review again.');
    setReview({ binding, value: result });
    setAck(false);
    props.onChange({ count: picks.length });
  }
  const selectChoice = (id: string) => {
    setChoiceId(id);
    setFirst('');
    setLast('');
    setPartial(false);
    setMessage(null);
  };
  return (
    <section
      className="context-selection"
      aria-label={props.mode === 'choose' ? 'Selected context' : 'Sharing eligibility'}
    >
      {!visibleReview && (
        <Button
          ref={opener}
          variant="secondary"
          aria-expanded={opened}
          disabled={busy}
          onClick={toggle}
        >
          {props.mode === 'choose' ? 'Choose excerpts' : 'Sharing eligibility'}
        </Button>
      )}
      {props.mode === 'choose' && (
        <p className="muted">
          {picks.length ? `${picks.length} of 3 sources selected.` : 'No excerpts selected.'}
        </p>
      )}
      {opened && !visibleReview && (
        <div className="context-controls">
          <p>
            {props.mode === 'manage'
              ? 'Choose which saved sources may be selected for future readings.'
              : 'Choose a source, then choose the exact words for this reading.'}{' '}
            Allowing a source sends nothing.
          </p>
          {props.mode === 'choose' && (
            <>
              {family && (
                <div className="context-origin">
                  <h3>{editionSummary?.question ?? family.question ?? 'Saved reading'}</h3>
                  <p>
                    {date(editionSummary?.at ?? family.createdAt)}
                    {edition &&
                      ` · ${
                        family.editionIds.indexOf(edition) === 0
                          ? 'Original reading'
                          : `Follow-up ${family.editionIds.indexOf(edition)}`
                      }`}
                  </p>
                </div>
              )}
              <details
                className="context-browse"
                open={!family}
                onToggle={(event) => {
                  if (event.currentTarget.open && !history)
                    void run((current) => listHistory(current));
                }}
              >
                <summary>Choose another saved reading or edition</summary>
                <div className="context-field">
                  <label htmlFor="context-family">Saved reading</label>
                  <select
                    id="context-family"
                    value={family?.id ?? ''}
                    disabled={busy}
                    onChange={(e) => {
                      const id = e.target.value;
                      void run((current) => loadFamily(id, current));
                    }}
                  >
                    <option value="">Choose a saved reading</option>
                    {family && !history?.items.some((row) => row.id === family.id) && (
                      <option value={family.id}>
                        {date(family.createdAt)} · {family.question ?? 'Saved reading'}
                      </option>
                    )}
                    {history?.items.map((row) => (
                      <option key={row.id} value={row.id}>
                        {date(row.createdAt, true)} · {row.questionPreview ?? 'Saved reading'}
                      </option>
                    ))}
                  </select>
                </div>
                {history && history.items.length === 0 && <p>No saved readings available.</p>}
                {history?.nextCursor && (
                  <Button
                    variant="text-button"
                    disabled={busy}
                    onClick={() => void run((current) => listHistory(current, history.nextCursor))}
                  >
                    More saved readings
                  </Button>
                )}
                {family && family.editionIds.length > 1 && (
                  <div className="context-field">
                    <label htmlFor="context-edition">Edition</label>
                    <select
                      id="context-edition"
                      value={edition}
                      disabled={busy}
                      onChange={(e) => {
                        const id = e.target.value;
                        void run((current) => loadEdition(family, id, current));
                      }}
                    >
                      <option value="">Choose an edition</option>
                      {family.editionIds.map((id, i) => (
                        <option key={id} value={id}>
                          {i === 0 ? 'Original reading' : `Follow-up ${i}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </details>
            </>
          )}
          {edition && (
            <>
              {props.mode === 'manage' ? (
                <div className="context-field">
                  <label htmlFor="context-source">Source</label>
                  <select
                    id="context-source"
                    disabled={busy}
                    value={choiceId}
                    onChange={(e) => selectChoice(e.target.value)}
                  >
                    <option value="">Choose a source</option>
                    {choices.map((c, i) => (
                      <option key={choiceKey(c)} value={choiceKey(c)}>
                        {c.title} · {date(c.at)} · source {i + 1}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <fieldset className="context-source-list">
                  <legend>Choose a passage</legend>
                  {choices.map((source) => (
                    <div className="context-source-row" key={choiceKey(source)}>
                      <label
                        className="context-source-choice"
                        htmlFor={`context-source-${choiceKey(source)}`}
                      >
                        <Input
                          type="radio"
                          id={`context-source-${choiceKey(source)}`}
                          name="context-source-choice"
                          checked={choiceId === choiceKey(source)}
                          disabled={busy}
                          onChange={() => selectChoice(choiceKey(source))}
                        />
                        <span>
                          <strong>{source.title}</strong>
                          <span className="context-source-date">
                            {source.passage.authorship === 'user'
                              ? 'Your words'
                              : source.passage.authorship === 'generated'
                                ? 'Generated text'
                                : 'Unknown authorship'}{' '}
                            · {date(source.at)}
                          </span>
                        </span>
                      </label>
                      <details className="context-source-text">
                        <summary>Read passage</summary>
                        <blockquote>{source.passage.text}</blockquote>
                      </details>
                    </div>
                  ))}
                  {!choices.length && !busy && <p>No passages are available in this edition.</p>}
                </fieldset>
              )}
              {family && refOffset < family.reflectionIds.length && (
                <Button
                  variant="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async (current) => {
                      const extra = await reflections(family, edition, refOffset);
                      if (current()) {
                        setChoices((old) => [...old, ...extra]);
                        setRefOffset(refOffset + 10);
                      }
                    })
                  }
                >
                  More reflection sources
                </Button>
              )}
              {nextGrants && (
                <Button
                  variant="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async (current) => {
                      const page = await listGrants(edition, nextGrants);
                      if (current()) {
                        setGrants((old) => [...old, ...page.items]);
                        setNextGrants(page.nextCursor);
                      }
                    })
                  }
                >
                  More eligibility records
                </Button>
              )}
              {nextNotes && (
                <Button
                  variant="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async (current) => {
                      const page = await api(
                        '/revisits?editionId=' +
                          edition +
                          '&cursor=' +
                          encodeURIComponent(nextNotes),
                        apiSchemas.RevisitPage,
                      );
                      if (
                        current() &&
                        page.items.every(
                          (n) => n.sessionId === family?.id && n.editionId === edition,
                        )
                      ) {
                        setChoices((old) => [...old, ...noteChoices(page.items)]);
                        setNextNotes(page.nextCursor);
                      }
                    })
                  }
                >
                  More revisit notes
                </Button>
              )}
            </>
          )}
          {choice && (
            <>
              <label htmlFor="context-passage">
                Saved passage
                <TextArea
                  id="context-passage"
                  readOnly
                  rows={4}
                  value={choice.passage.text}
                  onSelect={(event) => {
                    const el = event.currentTarget;
                    if (props.mode !== 'choose' || el.selectionStart === el.selectionEnd) return;
                    const a = originalOffset(choice.passage.text, el.selectionStart),
                      b = originalOffset(choice.passage.text, el.selectionEnd);
                    if (a !== null && b !== null) {
                      setPartial(true);
                      setFirst(String(a + 1));
                      setLast(String(b));
                      invalidate();
                    }
                  }}
                />
              </label>
              {!matching.length ? (
                <Button
                  variant="secondary"
                  disabled={busy || Boolean(nextGrants)}
                  onClick={() => void run(allow)}
                >
                  Allow this source
                </Button>
              ) : (
                <>
                  <p>Eligible for explicit selection.</p>
                  {matching.map((grant, i) => (
                    <Button
                      key={grant.id}
                      variant="text-button"
                      disabled={busy}
                      onClick={() => void run((current) => revoke(grant, current))}
                    >
                      Revoke eligibility{matching.length > 1 ? ` ${i + 1}` : ''}
                    </Button>
                  ))}
                  {props.mode === 'choose' && (
                    <>
                      <div className="context-passage-actions">
                        {choice.passage.end - choice.passage.start <= CONTEXT_LIMITS.perSource && (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              addRange(choice, 1, choice.passage.end - choice.passage.start)
                            }
                          >
                            Use whole passage
                          </Button>
                        )}
                        <Button
                          variant="text-button"
                          aria-expanded={partial}
                          onClick={() => setPartial(!partial)}
                        >
                          Choose part of passage
                        </Button>
                      </div>
                      {partial && (
                        <div className="context-partial">
                          <p>Select the exact words in the saved passage above.</p>
                          <details className="context-character-controls">
                            <summary>Set first and last characters</summary>
                            <p>
                              This passage has {choice.passage.end - choice.passage.start}{' '}
                              characters.
                            </p>
                            <div className="context-range">
                              <label htmlFor="context-first">
                                First character
                                <Input
                                  id="context-first"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.preventDefault();
                                  }}
                                  type="number"
                                  inputMode="numeric"
                                  min="1"
                                  value={first}
                                  onChange={(e) => {
                                    setFirst(e.target.value);
                                    invalidate();
                                  }}
                                />
                              </label>
                              <label htmlFor="context-last">
                                Last character
                                <Input
                                  id="context-last"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.preventDefault();
                                  }}
                                  type="number"
                                  inputMode="numeric"
                                  min="1"
                                  value={last}
                                  onChange={(e) => {
                                    setLast(e.target.value);
                                    invalidate();
                                  }}
                                />
                              </label>
                            </div>
                          </details>
                          {first && last && (
                            <p className="context-range-preview">
                              {Array.from(choice.passage.text)
                                .slice(Number(first) - 1, Number(last))
                                .join('')}
                            </p>
                          )}
                          <Button
                            variant="secondary"
                            disabled={busy || !first || !last}
                            onClick={add}
                          >
                            Add excerpt
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
          {props.mode === 'manage' && grants.length > 0 && (
            <details>
              <summary>Eligibility history</summary>
              <ul>
                {grants.map((g) => (
                  <li key={g.id}>
                    {choices.find((c) => sourceKey(c.source) === sourceKey(g.source))?.title ??
                      'Earlier source'}{' '}
                    · {g.state === 'allowed' ? 'Allowed' : 'Revoked'} · permission revision{' '}
                    {g.revision}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {props.mode === 'choose' && (
            <p className="muted">Up to three sources, 1,200 characters each and 3,000 in total.</p>
          )}
          {busy && <p role="status">Loading your selection…</p>}
          <Notice message={message} />
          {message?.tone === 'error' && (
            <Button
              variant="text-button"
              disabled={busy}
              onClick={() =>
                void run((current) =>
                  edition && family ? loadEdition(family, edition, current) : listHistory(current),
                )
              }
            >
              Refresh sources
            </Button>
          )}
        </div>
      )}
      {props.mode === 'choose' && picks.length > 0 && (
        <div className="context-review">
          {!visibleReview && (
            <ol>
              {picks.map((p, i) => (
                <li key={p.source}>
                  <span>
                    {p.title} · {date(p.at)} · {p.range.end - p.range.start} characters
                  </span>{' '}
                  <Button
                    variant="text-button"
                    aria-label={`Remove excerpt ${i + 1}`}
                    onClick={() => {
                      updatePicks(picks.filter((item) => item !== p));
                      setMessage({ tone: 'notice', text: 'Excerpt removed from this reading.' });
                    }}
                  >
                    Remove excerpt
                  </Button>
                </li>
              ))}
            </ol>
          )}
          {!visibleReview && (
            <Button
              variant="secondary"
              disabled={busy || !props.binding.question.trim()}
              onClick={() => void run(preview)}
            >
              Review selected excerpts
            </Button>
          )}
          {visibleReview && (
            <section aria-labelledby="context-review-heading">
              <h3 ref={reviewHeading} tabIndex={-1} id="context-review-heading">
                Review selected excerpts
              </h3>
              <Button
                variant="text-button"
                onClick={() => {
                  invalidate();
                  setOpened(true);
                }}
              >
                Change selected excerpts
              </Button>
              {visibleReview.items.map((item, i) => (
                <div key={item.selection.grantId}>
                  <p>
                    {item.authorship === 'generated'
                      ? 'Generated text'
                      : item.authorship === 'user'
                        ? 'Your words'
                        : 'Unknown authorship'}{' '}
                    · {picks[i]?.title} · {picks[i] && date(picks[i]!.at)}
                  </p>
                  <blockquote>{item.text}</blockquote>
                  <Button
                    variant="text-button"
                    aria-label={`Remove excerpt ${i + 1}`}
                    onClick={() => updatePicks(picks.filter((_, index) => index !== i))}
                  >
                    Remove excerpt
                  </Button>
                </div>
              ))}
              <p>
                This simulation uses the excerpts above with your current question and cards. It
                does not contact an AI provider. The service keeps the reviewed excerpts with the
                request and saved reading.
              </p>
              <label className="check" htmlFor="context-consent">
                <Input
                  id="context-consent"
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAck(checked);
                    props.onChange(
                      checked
                        ? {
                            count: picks.length,
                            reviewedExcerpts: visibleReview.items.map((item, index) => ({
                              id: item.selection.grantId,
                              title: picks[index]!.title,
                              at: picks[index]!.at,
                              text: item.text,
                              authorship:
                                item.authorship === 'generated' || item.authorship === 'user'
                                  ? item.authorship
                                  : 'unknown',
                            })),
                            confirmation: {
                              binding,
                              selection: visibleReview.items.map((i) => i.selection),
                              acknowledgement: visibleReview.acknowledgementHash,
                            },
                          }
                        : { count: picks.length },
                    );
                  }}
                />
                I agree to use these exact excerpts for this reading.
              </label>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
