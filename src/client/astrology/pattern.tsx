import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { z } from 'zod';
import {
  BirthProfileView,
  PatternPreview,
  PatternSavedIdentity,
  type PatternSaveInput,
  type ChapterId,
  type BirthDraft,
} from '../../contracts/astrology.ts';
import { apiSchemas } from '../../contracts/index.ts';
import { api, ApiFailure } from '../api.ts';
import { Button, ReflectionField, TopicChip } from '../design/components.tsx';
import { Notice } from '../notice.tsx';
import { Art } from '../art.tsx';
import { BirthDetails, type BirthDetailsHandle } from './birth-details.tsx';
import { ChartDetails, capitalize, timeLabel } from './chart-context.tsx';
import { useAstrologyAction } from './use-action.ts';
import {
  deletionIntent,
  DeletionReceiptPanel,
  type DeletionProof,
  type DeletionStatus,
} from '../deletion.tsx';
import './astrology.css';
type View = z.infer<typeof BirthProfileView>;
type Saved = z.infer<typeof PatternSavedIdentity>;
export interface PatternHandle {
  confirmLeave(): boolean;
  hasUnsavedChanges(): boolean;
}
export function PatternWorkspace({
  ref,
  csrf,
  enabled,
  initialBirth,
  onRestoreConsumed,
  onOpen,
  onTarot,
  onJournal,
  onExpired,
}: {
  ref?: Ref<PatternHandle>;
  csrf: string;
  enabled: boolean;
  initialBirth?: BirthDraft | null;
  onRestoreConsumed?: () => void;
  onOpen: (saved: Saved, draft?: string) => void;
  onTarot: (question: string) => void;
  onJournal: () => void;
  onExpired: () => void;
}) {
  const restore = useRef(initialBirth ?? undefined),
    consumed = useRef(onRestoreConsumed);
  const [profile, setProfile] = useState<View | null>(null),
    [preview, setPreview] = useState<PatternPreview | null>(null),
    [editing, setEditing] = useState(false);
  const [chapterId, setChapterId] = useState<ChapterId>('self'),
    [drafts, setDrafts] = useState<Partial<Record<ChapterId, string>>>({});
  const [saved, setSaved] = useState<Saved | null>(null),
    [existing, setExisting] = useState<Saved | null>(null),
    [stale, setStale] = useState(false);
  const birth = useRef<BirthDetailsHandle>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const intent = useRef<{ payload: string; key: string } | null>(null);
  const { busy, notice, setNotice, run } = useAstrologyAction(onExpired);
  const [removeChecked, setRemoveChecked] = useState(false),
    [deletion, setDeletion] = useState<{
      proof: DeletionProof;
      initial: DeletionStatus | null;
    } | null>(null);
  const removal = useRef<{ revision: number; intent: ReturnType<typeof deletionIntent> } | null>(
    null,
  );
  const hasUnsavedChanges = () =>
    busy ||
    Boolean(birth.current?.hasUnsavedChanges()) ||
    Object.values(drafts).some((text) => Boolean(text));
  const confirmLeave = () =>
    !busy &&
    (!hasUnsavedChanges() ||
      window.confirm(
        'Discard your unsaved birth details or reflections? Choose Cancel to keep editing.',
      ));
  useImperativeHandle(ref, () => ({ confirmLeave, hasUnsavedChanges }));
  const loadChart = useCallback(async (current: () => boolean) => {
    const value = await api('/astrology/pattern', PatternPreview);
    if (current()) {
      setPreview(value);
      setStale(false);
      setExisting(null);
    }
  }, []);
  const load = useCallback(
    () =>
      void run(async (current) => {
        const value = await api('/astrology/profile', BirthProfileView);
        if (!current()) return;
        setProfile(value);
        if (!value.profile || restore.current) {
          setEditing(true);
          return;
        }
        await loadChart(current);
      }),
    [loadChart, run],
  );
  useEffect(() => {
    consumed.current?.();
    if (enabled) load();
  }, [enabled, load]);
  useEffect(() => {
    // Focus the committed screen: a frame callback can run before React replaces
    // the loading heading, leaving keyboard focus on a detached element.
    if (!busy && !editing && (preview || saved)) heading.current?.focus();
  }, [busy, editing, preview, saved]);
  const state = preview?.chapters.find(
    (c) => (c.status === 'available' ? c.chapter.id : c.id) === chapterId,
  );
  const chapter = state?.status === 'available' ? state.chapter : null;
  const draft = drafts[chapterId] ?? '';
  const savedChapter = preview?.saved.find((s) => s.chapterId === chapterId);
  const save = () => {
    if (!preview || !chapter || stale || existing) return;
    void run(async (current) => {
      const body: PatternSaveInput = {
        chapterId,
        expectedProfileRevision: preview.profileRevision,
        basisHash: preview.basisHash,
        releaseHash: preview.releaseHash,
        reflection: draft.trim() ? { text: draft, stance: 'unspecified' } : null,
      };
      const payload = JSON.stringify(body);
      if (intent.current?.payload !== payload)
        intent.current = { payload, key: crypto.randomUUID() };
      try {
        const value = await api('/astrology/pattern/saves', PatternSavedIdentity, body, csrf, {
          key: intent.current.key,
        });
        if (current()) {
          setSaved(value);
          setDrafts((prev) => ({ ...prev, [chapterId]: '' }));
          setPreview((prev) =>
            prev
              ? {
                  ...prev,
                  saved: [
                    ...prev.saved.filter((s) => s.chapterId !== chapterId),
                    { ...value, chapterId },
                  ],
                }
              : prev,
          );
        }
      } catch (error) {
        if (current() && error instanceof ApiFailure && error.code === 'CONFLICT') {
          if (error.existingPattern) {
            setExisting(error.existingPattern);
            setNotice({
              tone: 'error',
              text: 'This chapter is already in your journal. Your draft has not been saved. Review the saved reflection before choosing how to keep these words.',
            });
          } else {
            setStale(true);
            setNotice({
              tone: 'error',
              text: 'Your birth details or chart content changed. Your draft is still here. Refresh the chart and review it before saving.',
            });
          }
        } else throw error;
      }
    });
  };
  const remove = () => {
    if (!profile?.profile || !removeChecked) return;
    void run(async (current) => {
      if (removal.current?.revision !== profile.revision)
        removal.current = { revision: profile.revision, intent: deletionIntent() };
      const { intent: proof, revision } = removal.current;
      let initial: DeletionStatus | null = null;
      try {
        const receipt = await api(
          '/astrology/profile',
          apiSchemas.DeletionReceipt,
          { receiptId: proof.receiptId, receiptToken: proof.receiptToken },
          csrf,
          { method: 'DELETE', revision, key: proof.key },
        );
        initial = { state: receipt.state, backupExpiresBy: receipt.backupExpiresBy };
      } catch (error) {
        if (error instanceof ApiFailure && error.status < 500) throw error;
      }
      if (current()) {
        setDeletion({ proof, initial });
        setPreview(null);
        setEditing(false);
        setRemoveChecked(false);
        setProfile(null);
        restore.current = undefined;
      }
    });
  };
  if (!enabled)
    return (
      <section className="pattern-workspace">
        <header className="pattern-page-heading">
          <h2>Your pattern</h2>
          <p>
            Your Pattern is not available in this environment yet. Saved chapters and your writing
            remain in your journal.
          </p>
        </header>
        <Button
          onClick={() => {
            if (confirmLeave()) onJournal();
          }}
        >
          Open journal
        </Button>
      </section>
    );
  return (
    <section className="pattern-workspace" aria-label="Your Pattern workspace" aria-busy={busy}>
      <Notice message={notice} />
      {deletion ? (
        <>
          <DeletionReceiptPanel
            {...deletion}
            title="Birth profile removal"
            summary="Check this receipt to confirm removal of the current birth profile. Saved chapters keep their original details until you delete those readings separately."
            onDismiss={() => {
              setDeletion(null);
              load();
            }}
          />
          <Button
            onClick={() => {
              if (confirmLeave()) onJournal();
            }}
          >
            Open journal
          </Button>
        </>
      ) : editing && profile ? (
        <>
          <BirthDetails
            ref={birth}
            view={profile}
            {...(restore.current ? { initialBirth: restore.current } : {})}
            csrf={csrf}
            onExpired={onExpired}
            onSaved={(value) => {
              restore.current = undefined;
              setProfile(value);
              setEditing(false);
              setPreview(null);
              setSaved(null);
              setExisting(null);
              void run(loadChart);
            }}
            onCancel={() => {
              if (!confirmLeave()) return;
              restore.current = undefined;
              if (profile.profile) {
                setEditing(false);
                if (!preview) void run(loadChart);
              } else onJournal();
            }}
          />
          {profile.profile && (
            <details className="profile-removal">
              <summary>Remove current birth details</summary>
              <p>
                This removes your current profile. Saved chapters keep their original chart details;
                delete those readings separately to remove their copies.
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={removeChecked}
                  disabled={busy}
                  onChange={(e) => setRemoveChecked(e.target.checked)}
                />
                Remove my current birth profile.
              </label>
              <Button variant="danger" disabled={!removeChecked || busy} onClick={remove}>
                Remove birth profile
              </Button>
            </details>
          )}
        </>
      ) : saved ? (
        <section className="pattern-saved">
          <TopicChip tone="mint">Astrology · Your Pattern</TopicChip>
          <h2 ref={heading} tabIndex={-1}>
            Saved to your journal
          </h2>
          <p>
            This chapter and any reflection you added are kept together. You can return to these
            exact words and add a revisit later.
          </p>
          <div className="actions">
            <Button
              onClick={() => {
                if (confirmLeave()) onOpen(saved);
              }}
            >
              View saved chapter
            </Button>
            <Button variant="secondary" onClick={() => setSaved(null)}>
              Keep exploring
            </Button>
          </div>
        </section>
      ) : preview ? (
        <>
          <header className="pattern-page-heading pattern-hero">
            <div>
              <p className="eyebrow">Your birth chart</p>
              <h2 ref={heading} tabIndex={-1}>
                Your pattern
              </h2>
              <p>Themes to explore, with room for your own experience.</p>
            </div>
            <Art name="account-sprig" className="pattern-sprig" sizes="320px" />
          </header>
          <p className="field-hint">
            Local preview · Calculated chart positions with chapter text awaiting editorial review.
          </p>
          <div className="pattern-columns">
            <div className="pattern-main">
              <fieldset className="pattern-chapters">
                <legend className="sr-only">Choose a chapter</legend>
                {(['self', 'connection', 'rest', 'growth'] as const).map((id) => (
                  <Button
                    key={id}
                    variant="text-button"
                    aria-pressed={chapterId === id}
                    disabled={busy}
                    onClick={() => {
                      setChapterId(id);
                      setExisting(null);
                      setNotice(null);
                    }}
                  >
                    {capitalize(id)}
                  </Button>
                ))}
              </fieldset>
              {chapter ? (
                <section
                  className="pattern-chapter"
                  aria-label={`${capitalize(chapterId)} chapter`}
                >
                  <p className="eyebrow">
                    Chapter{' '}
                    {(['self', 'connection', 'rest', 'growth'].indexOf(chapterId) + 1)
                      .toString()
                      .padStart(2, '0')}{' '}
                    · {capitalize(chapterId)}
                  </p>
                  <h3>{chapter.title}</h3>
                  <p className="pattern-prose">{chapter.text}</p>
                  <p className="field-hint">Symbolic reflection · Your experience comes first.</p>
                  <div className="pattern-writing">
                    <h3>{chapter.prompt}</h3>
                    <ReflectionField
                      id="pattern-reflection"
                      label="Your reflection"
                      rows={4}
                      maxLength={10000}
                      value={draft}
                      disabled={busy}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [chapterId]: e.target.value }))
                      }
                      hint="Optional. Unsaved words stay in this window until you leave or reload."
                    />
                    {savedChapter && (
                      <p>
                        This chapter is already saved. New words need your review alongside the
                        saved reflection.
                      </p>
                    )}
                    {existing && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          const otherDrafts = Object.entries(drafts).some(
                            ([id, text]) => id !== chapterId && Boolean(text),
                          );
                          if (
                            !otherDrafts ||
                            window.confirm(
                              'Leave unsaved words in other chapters? This chapter’s draft will be kept for review.',
                            )
                          )
                            onOpen(existing, draft);
                        }}
                      >
                        Review saved chapter with my draft
                      </Button>
                    )}
                    {stale && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void run(loadChart)}
                      >
                        Refresh chart and keep draft
                      </Button>
                    )}
                    <div className="pattern-actions">
                      <Button disabled={busy || stale || !!existing} onClick={save}>
                        {busy ? 'Saving…' : 'Save to journal'}
                      </Button>
                      {savedChapter && !draft && (
                        <Button
                          variant="text-button"
                          onClick={() => {
                            if (confirmLeave()) onOpen(savedChapter);
                          }}
                        >
                          View saved chapter
                        </Button>
                      )}
                      <Button
                        variant="text-button"
                        disabled={busy}
                        onClick={() => {
                          if (confirmLeave()) onTarot(chapter.prompt);
                        }}
                      >
                        Explore with tarot
                      </Button>
                    </div>
                    <p className="field-hint">
                      Explore with tarot carries only this question. You review it before starting a
                      reading.
                    </p>
                  </div>
                </section>
              ) : (
                <section className="pattern-chapter" aria-label="Unavailable chapter">
                  <p className="eyebrow">{capitalize(chapterId)}</p>
                  <h3>This chapter needs more certainty.</h3>
                  <p>
                    We cannot support the placement behind this chapter for the birth information
                    you supplied. Explore another chapter or review your birth details.
                  </p>
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    Review birth details
                  </Button>
                  <div className="pattern-writing">
                    <h3>There is still room for your own words.</h3>
                    <ReflectionField
                      id="pattern-reflection"
                      label="Your reflection"
                      rows={4}
                      maxLength={10000}
                      value={draft}
                      disabled={busy}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [chapterId]: e.target.value }))
                      }
                      hint="This chapter cannot be saved without a supported placement. Your unsaved words stay in this window until you leave or reload; you can copy them before leaving."
                    />
                  </div>
                </section>
              )}
            </div>
            <aside className="pattern-context pattern-chart" data-theme="evening">
              <h3>Your chart</h3>
              <section className="pattern-facts" aria-label="Supported chapter placements">
                {preview.chapters.map((c) => (
                  <div key={c.status === 'available' ? c.chapter.id : c.id}>
                    <span>{capitalize(c.status === 'available' ? c.chapter.id : c.id)}</span>
                    <p>
                      {c.status === 'available' ? c.chapter.factualLabel : 'Placement left out'}
                    </p>
                  </div>
                ))}
              </section>
              <p>
                <strong>{timeLabel(preview.basis.calculation.input.birth)}</strong>
              </p>
              <p>Only supported chart details are included.</p>
              <Button
                variant="text-button"
                disabled={busy}
                onClick={() => {
                  setEditing(true);
                  setNotice(null);
                }}
              >
                Review birth details
              </Button>
              <ChartDetails basis={preview.basis} />
            </aside>
          </div>
        </>
      ) : (
        <section className="pattern-loading">
          <h2 ref={heading} tabIndex={-1}>
            Your pattern
          </h2>
          {busy ? (
            <p role="status">Preparing your chart…</p>
          ) : (
            <>
              <p>Your chart could not be loaded.</p>
              <Button onClick={load}>Try loading your chart again</Button>
            </>
          )}
        </section>
      )}
    </section>
  );
}
