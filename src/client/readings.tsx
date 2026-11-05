import {
  Button,
  Input,
  ReflectionCard,
  ReflectionField,
  TextLink,
  TopicChip,
} from './design/components.tsx';
import {
  type MouseEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { z } from 'zod';
import {
  apiSchemas,
  Id,
  SpreadPhoto,
  type AnyAcceptedReading,
  type ImportedReading,
  type Reflection,
  type PatternReadingV1,
} from '../contracts/index.ts';
import { PatternReading } from './astrology/pattern-reading.tsx';
import { READING_PRODUCT_COPY, SPREAD_PHOTO_COPY } from '../contracts/product-copy.ts';
import { api, ApiFailure } from './api.ts';
import {
  RequestProgress,
  requestFromPath,
  requestPath,
  type ReadingRequest,
} from './request-progress.tsx';
import {
  deletionIntent,
  DeletionReceiptPanel,
  type DeletionProof,
  type DeletionStatus,
} from './deletion.tsx';
import { ReadingDeletion, type ReadingDeletionTarget } from './reading-deletion.tsx';
import { date } from './date.ts';
import { Notice, type NoticeMessage } from './notice.tsx';
import { cardName } from './card-names.ts';
import { Art } from './art.tsx';
import { Icon } from './icon.tsx';
import { CardFace, CardThumbnail } from './card-face.tsx';
import { RevisitNotes, type RevisitNotesHandle } from './revisit-notes.tsx';
import {
  FollowUp,
  EditionHistory,
  ReadingOrigin,
  useEditionDetails,
  editionNavigation,
  editionPath,
} from './follow-up.tsx';
import { FollowUpReview } from './submission-review.tsx';
import './reading-return.css';
import { ImportedReadingDetail } from './imported-reading.tsx';
import { ContextSelection, contextBinding, type ContextSubmission } from './context-selection.tsx';

type View = z.infer<typeof apiSchemas.SessionView>;
type RecordView = z.infer<typeof apiSchemas.SessionRecord>;
type History = z.infer<typeof apiSchemas.HistoryPage>;
type Thought = z.infer<typeof Reflection>;
type Current = () => boolean;
const followUpFromPath = () =>
  window.location.pathname.endsWith('/follow-up') && savedEditionFromPath();
export function savedEditionFromPath() {
  const match = window.location.pathname.match(/^\/saved\/([^/]+)\/([^/]+)(?:\/follow-up)?$/);
  if (!match || !Id.safeParse(match[1]).success || !Id.safeParse(match[2]).success) return null;
  return { sessionId: match[1]!, editionId: match[2]! };
}
const stanceLabels: Record<Thought['stance'], string> = {
  unspecified: 'Not selected',
  resonates: 'Resonates',
  unsure: 'Unsure',
  disagree: 'Disagree',
};
function photoProcessingNotice(live: boolean | null, mode: string | null) {
  if (live === null)
    return 'The reading service is unavailable. Check the connection to continue with your question and photo.';
  if (live) return SPREAD_PHOTO_COPY.spreadPhotoProcessing;
  return mode === 'hosted-synthetic'
    ? 'This preview does not recognize real cards. Use a synthetic image only.'
    : 'This simulation does not recognize real cards. Use a synthetic image only.';
}
function submissionNotice(live: boolean | null, mode: string | null) {
  if (live === null) return null;
  if (live)
    return 'Drafts stay in memory until submitted. Starting a reading sends this question to OpenAI.';
  return mode === 'hosted-synthetic'
    ? 'Drafts stay in memory until submitted. This preview simulates the reading and does not contact an AI provider. Use synthetic text only.'
    : 'Drafts stay in memory until submitted. This simulation does not contact an AI provider. Use synthetic text only.';
}
async function prepareSpreadPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPEG, PNG, or WebP photo of your spread.');
  if (file.size > 10 * 1024 * 1024)
    throw new Error('Spread photo is too large. Choose an image under 10 MB.');
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not read the selected image.'));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
  if (raw.length <= 150_000 && SpreadPhoto.safeParse(raw).success) return raw;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Could not decode the selected image.'));
    element.src = raw;
  });
  const maxDimension = 960;
  const scale = Math.min(1, maxDimension / Math.max(img.width || 1, img.height || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
  canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the selected image.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.8, 0.65, 0.5]) {
    const compressed = canvas.toDataURL('image/jpeg', quality);
    if (SpreadPhoto.safeParse(compressed).success) return compressed;
  }
  throw new Error('Spread photo is too large after compression. Try a smaller image.');
}
/** Only navigation and request identity survive an account-page visit, in memory. */
export interface WorkspaceResume {
  path: string;
  request: { target: ReadingRequest['target']; pending: boolean } | null;
}
export interface WorkspaceHandle {
  /** Asks before discarding unsaved writing; true when the workspace may close. */
  confirmLeave: () => boolean;
  getResumeState: () => WorkspaceResume;
}
/** Mounted only for a verified account. All private state and unfinished actions die on unmount. */
export function ReadingWorkspace({
  ref,
  resume,
  user,
  live = false,
  runtimeMode = null,
  connectionRetry,
  onSession,
  onExpired,
  onAccount,
}: {
  ref?: Ref<WorkspaceHandle>;
  resume: WorkspaceResume | null;
  user: View;
  live?: boolean | null;
  runtimeMode?: string | null;
  connectionRetry: ReactNode;
  onSession: (value: View) => void;
  onExpired: () => void;
  onAccount: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [request, setRequest] = useState<ReadingRequest | null>(
    () =>
      requestFromPath() ??
      (resume?.request ? { target: resume.request.target, focus: false } : null),
  );
  const [requestPending, setRequestPending] = useState(
    () => Boolean(requestFromPath()) || Boolean(resume?.request?.pending),
  );
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [mode, setMode] = useState<'history' | 'new' | 'followup' | 'reading' | 'request'>(() =>
    requestFromPath()
      ? 'request'
      : followUpFromPath()
        ? 'followup'
        : savedEditionFromPath()
          ? 'reading'
          : window.location.pathname === '/new'
            ? 'new'
            : 'history',
  );
  const shownPath = useRef(window.location.pathname);
  const resumeTarget = useRef(request?.target ?? null);
  const replacePath = (path: string) => {
    shownPath.current = path;
    window.history.replaceState(null, '', path);
  };
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const composerHeading = useRef<HTMLHeadingElement>(null);
  const focusResultOnCommit = useRef(false);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const focusHistoryOnCommit = useRef<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [historyRetry, setHistoryRetry] = useState<{ cursor: string | null } | null>(null);
  useLayoutEffect(() => {
    if (mode === 'history' && focusHistoryOnCommit.current) {
      const target =
        document.getElementById(focusHistoryOnCommit.current) ?? historyHeading.current;
      focusHistoryOnCommit.current = null;
      target?.focus();
    }
  }, [mode]);
  const [record, setRecord] = useState<RecordView | null>(null);
  const [selectedEditionId, setSelectedEditionId] = useState<string | null>(null);
  const revisitNotes = useRef<RevisitNotesHandle>(null);
  const selectedTarget = useRef<{
    sessionId: string;
    editionId: string;
    requestId?: string;
  } | null>(null);
  const [unavailable, setUnavailable] = useState<Extract<
    z.infer<typeof apiSchemas.Reading>,
    { kind: 'reading.unavailable.v1' }
  > | null>(null);
  const [imported, setImported] = useState<z.infer<typeof ImportedReading> | null>(null);
  const [reading, setReading] = useState<z.infer<typeof AnyAcceptedReading> | null>(null);
  const [pattern, setPattern] = useState<PatternReadingV1 | null>(null);
  useLayoutEffect(() => {
    const jumpToNotes = window.location.hash === '#revisit-notes';
    if (mode === 'reading' && selectedEditionId && (focusResultOnCommit.current || jumpToNotes)) {
      focusResultOnCommit.current = false;
      if (!document.hidden) {
        const target = jumpToNotes
          ? document.getElementById('revisit-notes')
          : resultHeading.current;
        target?.focus();
      }
    }
  }, [mode, selectedEditionId]);
  useLayoutEffect(() => {
    if (mode === 'followup' && reading && !document.hidden) composerHeading.current?.focus();
  }, [mode, reading]);
  const [reflection, setReflection] = useState<Thought | null>(null);
  const [reflectionEditing, setReflectionEditing] = useState(true);
  const editReflectionTrigger = useRef<HTMLButtonElement>(null);
  const [latestReflection, setLatestReflection] = useState<Thought | null>(null);
  const [revisionChoice, setRevisionChoice] = useState(1),
    [revisionNote, setRevisionNote] = useState<Thought | null>(null),
    [eraseRevisionChecked, setEraseRevisionChecked] = useState(false);
  const [revisionReceipt, setRevisionReceipt] = useState<{
    proof: DeletionProof;
    initial: z.infer<typeof apiSchemas.DeletionStatus> | null;
  } | null>(null);
  const revisionIntent = useRef<{
    payload: string;
    intent: ReturnType<typeof deletionIntent>;
  } | null>(null);
  const [draft, setDraft] = useState(''),
    [stance, setStance] = useState<Thought['stance']>('unspecified');
  const [question, setQuestion] = useState(''),
    [questionSubmitted, setQuestionSubmitted] = useState(false),
    [english, setEnglish] = useState(false),
    [reversals, setReversals] = useState(false),
    [spreadPhoto, setSpreadPhoto] = useState<string | null>(null),
    [spreadPhotoName, setSpreadPhotoName] = useState<string | null>(null),
    [photoAnnouncement, setPhotoAnnouncement] = useState(''),
    [preparingPhoto, setPreparingPhoto] = useState(false),
    spreadInputRef = useRef<HTMLInputElement>(null),
    choosePhotoRef = useRef<HTMLButtonElement>(null);
  const [draftIntent, setDraftIntent] = useState(() => crypto.randomUUID());
  const [reviewedBinding, setReviewedBinding] = useState<string | null>(null);
  const submissionHeading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (reviewedBinding) submissionHeading.current?.focus();
  }, [reviewedBinding]);
  const [context, setContext] = useState<ContextSubmission>({ count: 0 });
  const updateContext = useCallback((next: ContextSubmission) => {
    setContext(next);
    setReviewedBinding(null);
  }, []);
  function resetContext() {
    setDraftIntent(crypto.randomUUID());
    setContext({ count: 0 });
    setReviewedBinding(null);
  }
  const photoSelection = useRef(0),
    photoPreparing = useRef(false);
  const clearPhoto = () => {
    photoSelection.current++;
    photoPreparing.current = false;
    setPreparingPhoto(false);
    setSpreadPhoto(null);
    setSpreadPhotoName(null);
    setPhotoAnnouncement('Photo removed.');
    if (spreadInputRef.current) spreadInputRef.current.value = '';
  };
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<NoticeMessage | null>(null),
    [conflict, setConflict] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<ReadingDeletionTarget | null>(null);
  const activeDeletion = useRef(deletionTarget);
  activeDeletion.current = deletionTarget;
  const [readingDeletionReceipt, setReadingDeletionReceipt] = useState<{
    proof: DeletionProof;
    initial: DeletionStatus;
    single: boolean;
  } | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const importedDeleteTrigger = useRef<HTMLButtonElement>(null);
  const keptDeletionScope = useRef<ReadingDeletionTarget['scope']>('family');
  const restoreDeleteFocus = useRef(false);
  useLayoutEffect(() => {
    if (!deletionTarget && restoreDeleteFocus.current) {
      restoreDeleteFocus.current = false;
      const trigger =
        keptDeletionScope.current === 'imported-edition'
          ? importedDeleteTrigger.current
          : deleteTrigger.current;
      trigger?.focus();
    }
  }, [deletionTarget]);
  const alive = useRef(true),
    epoch = useRef(0),
    inFlight = useRef(false),
    currentUser = useRef(user),
    selected = useRef(record),
    currentMode = useRef(mode);
  currentUser.current = user;
  selected.current = record;
  currentMode.current = mode;
  const dirtyReflection =
    draft !== (reflection?.text ?? '') || stance !== (reflection?.stance ?? 'unspecified');
  const canLeave = () => {
    if (mode === 'followup' && !questionSubmitted && (question.trim() || context.count))
      return window.confirm(
        'Discard your unsaved follow-up? Choose Cancel to stay and keep editing.',
      );
    if (mode !== 'reading') return true;
    if (
      dirtyReflection &&
      !window.confirm('Discard your unsaved reflection? Choose Cancel to stay and keep editing.')
    )
      return false;
    return (
      !revisitNotes.current?.hasUnsavedChanges() ||
      window.confirm('Discard your unsaved revisit note? Choose Cancel to stay and keep editing.')
    );
  };
  const hasUnsavedWriting = useRef<() => boolean>(() => false);
  hasUnsavedWriting.current = () =>
    (mode === 'reading' &&
      (dirtyReflection || Boolean(revisitNotes.current?.hasUnsavedChanges()))) ||
    (!questionSubmitted &&
      Boolean(question.trim() || spreadPhoto || photoPreparing.current || context.count));
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedWriting.current()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  useImperativeHandle(ref, () => ({
    confirmLeave: () => {
      if (
        canLeave() &&
        (mode === 'followup' ||
          questionSubmitted ||
          (!question.trim() && !spreadPhoto && !photoPreparing.current && !context.count) ||
          window.confirm(
            question.trim()
              ? 'Discard your unsaved question? Choose Cancel to stay and keep editing.'
              : 'Discard your unsaved spread photo? Choose Cancel to stay and keep editing.',
          ))
      )
        return true;
      // A cancelled browser Back/Forward must also restore history with a hidden question draft.
      if (window.location.pathname !== shownPath.current)
        window.history.pushState(null, '', shownPath.current);
      return false;
    },
    getResumeState: () => ({
      path: shownPath.current,
      request: request
        ? { target: resumeTarget.current ?? request.target, pending: requestPending }
        : null,
    }),
  }));
  const clearReading = () => {
    focusResultOnCommit.current = false;
    setRecord(null);
    setSelectedEditionId(null);
    selectedTarget.current = null;
    setReading(null);
    setPattern(null);
    setImported(null);
    setUnavailable(null);
    setReflection(null);
    setReflectionEditing(true);
    setLatestReflection(null);
    setDraft('');
    setStance('unspecified');
    setConflict(false);
    setDeletionTarget(null);
    setRevisionNote(null);
    setRevisionReceipt(null);
    setEraseRevisionChecked(false);
    revisionIntent.current = null;
  };
  const intents = useRef(new Map<string, { payload: string; key: string; intent: string }>());
  const actionKey = (action: string, payload: unknown) => {
    const text = JSON.stringify(payload),
      prior = intents.current.get(action);
    if (prior?.payload === text) return prior;
    const next = { payload: text, key: crypto.randomUUID(), intent: crypto.randomUUID() };
    intents.current.set(action, next);
    return next;
  };
  const refreshUser = async (current: Current) => {
    const view = await api('/me', apiSchemas.SessionView);
    if (current()) {
      currentUser.current = view;
      onSession(view);
    }
    return view;
  };
  const loadHistory = async (current: Current, cursor: string | null = null) => {
    setHistoryRetry(null);
    try {
      const result = await api(
        `/sessions?status=saved${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        apiSchemas.HistoryPage,
      );
      if (!current()) return;
      setHistory((prior) =>
        cursor && prior
          ? { items: [...prior.items, ...result.items], nextCursor: result.nextCursor }
          : result,
      );
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) throw error;
      if (current()) setHistoryRetry({ cursor });
    }
  };
  const open = async (
    id: string,
    current: Current,
    keepDraft = false,
    requireReview = false,
    focusResult = false,
    target?: { editionId: string; requestId?: string } | 'latest',
    forFollowUp = false,
  ) => {
    const session = await api(`/sessions/${id}`, apiSchemas.SessionRecord);
    if (!current()) return;
    const chosen =
      target === 'latest'
        ? null
        : (target ?? (selectedTarget.current?.sessionId === id ? selectedTarget.current : null));
    const editionId = chosen?.editionId ?? session.editionIds.at(-1);
    if (editionId && !session.editionIds.includes(editionId))
      throw new Error('This reading edition does not belong to the saved session.');
    if (!editionId) throw new Error('No accepted reading is available yet.');
    const loadReflection = async () => {
      for (const reflectionId of session.reflectionIds) {
        if (!current()) return null;
        const note = await api(`/reflections/${reflectionId}`, apiSchemas.Reflection).catch(
          async (error: unknown) => {
            if (
              !(error instanceof ApiFailure) ||
              error.status !== 410 ||
              error.code !== 'CONTENT_UNAVAILABLE'
            )
              throw error;
            if (!current()) return null;
            // A reflection's 410 can also mean its parent expired or was deleted.
            // Skip only a confirmed deleted candidate from the stale session snapshot.
            const latest = await api(`/sessions/${id}`, apiSchemas.SessionRecord);
            if (!current()) return null;
            if (
              latest.id !== id ||
              !latest.editionIds.includes(editionId) ||
              latest.reflectionIds.includes(reflectionId)
            )
              throw error;
            return null;
          },
        );
        if (note?.sessionId === id && note.editionId === editionId) return note;
      }
      return null;
    };
    const [content, note] = await Promise.all([
      api(`/readings/${editionId}`, apiSchemas.Reading).catch(async (error: unknown) => {
        if (
          error instanceof ApiFailure &&
          error.status === 410 &&
          error.code === 'CONTENT_UNAVAILABLE'
        ) {
          if (!current()) return null;
          // Distinguish withdrawn content from a parent deleted after the first snapshot.
          const latest = await api(`/sessions/${id}`, apiSchemas.SessionRecord);
          if (!current()) return null;
          if (latest.id !== id || !latest.editionIds.includes(editionId)) throw error;
          return null;
        }
        throw error;
      }),
      forFollowUp ? Promise.resolve(null) : loadReflection(),
    ]);
    if (!current()) return;
    if (content && (content.sessionId !== id || content.editionId !== editionId))
      throw new Error('The reading response did not match this edition.');
    const accepted =
      content?.kind === 'tarot.accepted.v1' ||
      content?.kind === 'tarot.accepted.v2' ||
      content?.kind === 'tarot.accepted.v3';
    if (forFollowUp && (!accepted || session.imported || session.status !== 'saved')) {
      setMode('reading');
      replacePath(editionPath(id, editionId));
      setMessage({
        tone: 'notice',
        text: 'Follow-ups are available from an accepted edition of a saved native reading.',
      });
      forFollowUp = false;
    }
    setImported(content?.kind === 'legacy.imported.v1' ? content : null);
    setUnavailable(content?.kind === 'reading.unavailable.v1' ? content : null);
    setRecord(session);
    setSelectedEditionId(editionId);
    setReading(accepted ? content : null);
    setPattern(content?.kind === 'astrology.pattern.accepted.v1' ? content : null);
    setMode(forFollowUp ? 'followup' : 'reading');
    // Session requests are capped and do not identify their edition. Only use a
    // request already associated with this selection or its accepted content.
    const requestId = chosen?.requestId ?? (accepted ? content.provenance.requestId : undefined);
    selectedTarget.current = { sessionId: id, editionId, ...(requestId ? { requestId } : {}) };
    if (target === 'latest') {
      const path = requestId ? `/requests/${requestId}` : `/saved/${id}/${editionId}`;
      window.history.pushState(null, '', path);
      shownPath.current = path;
    } else if (requestId && !savedEditionFromPath()) {
      replacePath(`/requests/${requestId}`);
    }
    focusResultOnCommit.current = focusResult;
    if (keepDraft && (dirtyReflection || conflict || requireReview)) {
      setReflectionEditing(true);
      // Keep the draft's base revision until the user explicitly reconciles a newer version.
      if (note?.id !== reflection?.id || note?.revision !== reflection?.revision || requireReview) {
        setLatestReflection(note);
        setConflict(true);
        setMessage({
          tone: 'notice',
          text: 'The saved reflection changed. Your draft has been kept. Review the current saved text and choose which version to use.',
        });
      }
    } else {
      if (!keepDraft) setReflectionEditing(!note);
      setReflection(note);
      setLatestReflection(null);
      setDraft(note?.text ?? '');
      setStance(note?.stance ?? 'unspecified');
      setConflict(false);
    }
    if (note) setRevisionChoice(note.revision);
    else {
      setRevisionNote(null);
      setEraseRevisionChecked(false);
    }
    setDeletionTarget(null);
  };
  const run = async (action: (current: Current) => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const version = ++epoch.current;
    const current = () => alive.current && epoch.current === version;
    setBusy(true);
    setMessage(null);
    try {
      await action(current);
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiFailure && error.status === 401) {
        onExpired();
        return;
      }
      setMessage({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'This action could not be completed. Your draft is still here.',
      });
      if (error instanceof ApiFailure && error.status === 410) {
        clearReading();
        setHistory(null);
        focusHistoryOnCommit.current = 'saved-readings-heading';
        setMode('history');
        replacePath('/');
        await loadHistory(current).catch(() => undefined);
      }
      if (error instanceof ApiFailure && error.code === 'CONSENT_REQUIRED')
        await refreshUser(current).catch(() => undefined);
    } finally {
      if (current()) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  const runRef = useRef(run),
    openRef = useRef(open),
    historyRef = useRef(loadHistory),
    navigationRef = useRef(() => {});
  runRef.current = run;
  openRef.current = open;
  historyRef.current = loadHistory;
  const loadLocation = useCallback(() => {
    const saved = savedEditionFromPath();
    if (saved)
      void runRef.current((current) =>
        openRef.current(
          saved.sessionId,
          current,
          false,
          false,
          true,
          saved,
          Boolean(followUpFromPath()),
        ),
      );
    else if (currentMode.current === 'history')
      void runRef.current((current) => historyRef.current(current));
  }, []);
  navigationRef.current = () => {
    const path = window.location.pathname;
    // The parent closes this workspace for the account page; a restored address needs no change.
    if (path === '/account' || (mode !== 'request' && path === shownPath.current)) return;
    if (!canLeave()) {
      // Parent route state may already reflect Back; restore the reading still being edited.
      window.history.pushState(null, '', shownPath.current);
      return;
    }
    // Invalidate even an accepted-reading load that has outlived the progress response.
    epoch.current++;
    inFlight.current = false;
    setBusy(false);
    setMessage(null);
    const previousEdition = selectedTarget.current;
    clearReading();
    shownPath.current = path;
    const restored = requestFromPath();
    const destination = restored
      ? 'request'
      : followUpFromPath()
        ? 'followup'
        : savedEditionFromPath()
          ? 'reading'
          : path === '/new'
            ? 'new'
            : 'history';
    setRequest(restored);
    resumeTarget.current = restored?.target ?? null;
    setRequestPending(Boolean(restored));
    setNavigationVersion((value) => value + 1);
    setMode(destination);
    currentMode.current = destination;
    if (destination === 'new' || destination === 'followup') {
      if (destination === 'followup' || mode === 'followup') {
        setQuestion('');
        setEnglish(false);
        clearPhoto();
      }
      intents.current.delete('start');
      resetContext();
      setQuestionSubmitted(false);
    }
    if (
      destination === 'history' &&
      previousEdition &&
      history?.items.some((item) => item.id === previousEdition.sessionId)
    ) {
      // Keep the loaded pages and return keyboard focus to the row the reader opened.
      focusHistoryOnCommit.current = `saved-reading-${previousEdition.sessionId}`;
    } else loadLocation();
  };
  useEffect(() => {
    alive.current = true;
    loadLocation();
    const focus = () => {
      if (currentMode.current === 'request' || activeDeletion.current) return;
      void runRef.current((current) =>
        currentMode.current === 'reading' && selected.current
          ? openRef.current(selected.current.id, current, true)
          : historyRef.current(current),
      );
    };
    const navigation = () => navigationRef.current();
    window.addEventListener('focus', focus);
    window.addEventListener('popstate', navigation);
    return () => {
      alive.current = false;
      photoSelection.current++;
      epoch.current++;
      intents.current.clear();
      window.removeEventListener('focus', focus);
      window.removeEventListener('popstate', navigation);
    };
  }, [loadLocation]);
  const save = () => {
    if (record)
      void run(async (current) => {
        const next = await api(
          `/sessions/${record.id}/save`,
          apiSchemas.SessionRecord,
          { saved: true },
          currentUser.current.csrfToken,
          {
            method: 'PUT',
            revision: record.revision,
            key: actionKey('save', [record.id, record.revision]).key,
          },
        );
        if (current()) {
          setRecord(next);
          intents.current.delete('save');
          setMessage({
            tone: 'success',
            text: 'Reading saved. Your reflection draft has not been submitted.',
          });
        }
      });
  };
  const saveReflection = () => {
    if (record && reading && !conflict)
      void run(async (current) => {
        const body = { text: draft, stance, editionId: reading.editionId };
        try {
          const result = await api(
            reflection ? `/reflections/${reflection.id}` : `/sessions/${record.id}/reflections`,
            apiSchemas.Reflection,
            body,
            currentUser.current.csrfToken,
            {
              method: reflection ? 'PUT' : 'POST',
              ...(reflection ? { revision: reflection.revision } : {}),
              key: actionKey('reflection', [record.id, reflection?.revision, body]).key,
            },
          );
          if (!current()) return;
          const saved = await api(`/sessions/${record.id}`, apiSchemas.SessionRecord);
          if (current()) {
            setRecord(saved);
            setReflection(result);
            setLatestReflection(null);
            setDraft(result.text);
            setStance(result.stance);
            setConflict(false);
            setReflectionEditing(false);
            requestAnimationFrame(() => editReflectionTrigger.current?.focus());
            intents.current.delete('reflection');
            setMessage({ tone: 'success', text: 'Reflection saved.' });
          }
        } catch (error) {
          if (current() && error instanceof ApiFailure && error.status === 409) {
            await open(record.id, current, true, true);
          } else throw error;
        }
      });
  };
  const viewRevision = () => {
    if (reflection)
      void run(async (current) => {
        setRevisionNote(null);
        setEraseRevisionChecked(false);
        try {
          const value = await api(
            `/reflections/${reflection.id}?revision=${revisionChoice}`,
            apiSchemas.Reflection,
          );
          if (current()) setRevisionNote(value);
        } catch (error) {
          if (current() && error instanceof ApiFailure && error.status === 410)
            setMessage({ tone: 'notice', text: 'The selected revision has been erased.' });
          else throw error;
        }
      });
  };
  const eraseRevision = () => {
    if (!record || !reflection || !revisionNote) return;
    const currentRevision = revisionNote.revision === reflection.revision;
    if (currentRevision && !canLeave()) return;
    void run(async (current) => {
      const payload = JSON.stringify([reflection.id, revisionNote.revision, reflection.revision]);
      if (revisionIntent.current?.payload !== payload)
        revisionIntent.current = { payload, intent: deletionIntent() };
      const intent = revisionIntent.current.intent,
        proof = { receiptId: intent.receiptId, receiptToken: intent.receiptToken };
      try {
        const receipt = await api(
          `/reflections/${reflection.id}/revisions/${revisionNote.revision}`,
          apiSchemas.DeletionReceipt,
          proof,
          currentUser.current.csrfToken,
          { method: 'DELETE', revision: reflection.revision, key: intent.key },
        );
        if (!current()) return;
        setRevisionReceipt({
          proof,
          initial: { state: receipt.state, backupExpiresBy: receipt.backupExpiresBy },
        });
        if (receipt.state === 'complete') {
          await open(record.id, current, !currentRevision);
          if (current()) {
            setRevisionNote(null);
            setEraseRevisionChecked(false);
            revisionIntent.current = null;
            setMessage({ tone: 'success', text: 'Reflection revision erased.' });
          }
        }
      } catch (error) {
        if (current() && error instanceof ApiFailure && error.code === 'CONFLICT') {
          revisionIntent.current = null;
          setRevisionNote(null);
          setEraseRevisionChecked(false);
          await open(record.id, current, true);
          if (current())
            setMessage({
              tone: 'notice',
              text: 'The reflection changed. View the revision and confirm erasure again.',
            });
        } else {
          if (current()) setRevisionReceipt({ proof, initial: null });
          throw error;
        }
      }
    });
  };
  const confirmReadingDeletion = (scope: ReadingDeletionTarget['scope']) => {
    if (!record || (scope === 'imported-edition' && !imported?.record.parentIdentity)) return;
    const single = scope === 'imported-edition';
    setMessage(null);
    setReadingDeletionReceipt(null);
    setDeletionTarget({
      scope,
      path: single ? `/readings/${imported!.editionId}` : `/sessions/${record.id}`,
      revision: single ? imported!.editionNumber : record.revision,
      question:
        (single ? imported?.record.question : record.question) ??
        reading?.question ??
        'Saved reading',
      createdAt: (single ? imported?.record.occurredAt : null) ?? record.createdAt,
    });
  };
  const deletionEntry = (
    <div className="reading-detail-actions">
      <TextLink
        href="#personal-reflection"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          document.getElementById('personal-reflection')?.focus();
        }}
      >
        View your reflection
      </TextLink>
      <Button
        ref={deleteTrigger}
        variant="text-button"
        className="delete-reading-trigger"
        disabled={busy}
        onClick={() => confirmReadingDeletion('family')}
      >
        Delete reading
      </Button>
    </div>
  );
  const syntheticContinuity = user.continuityReady && (mode === 'followup' || context.count > 0);
  const photoNotice = photoProcessingNotice(syntheticContinuity ? false : live, runtimeMode);
  const submitNotice = submissionNotice(syntheticContinuity ? false : live, runtimeMode);
  const binding = {
    clientIntentId: draftIntent,
    question,
    parentEditionId: mode === 'followup' && reading ? reading.editionId : null,
    permissionRevision: user.permission.revision,
  };
  const confirmed =
    context.confirmation?.binding === contextBinding(binding) ? context.confirmation : null;
  const contextReady = context.count === 0 || (Boolean(user.continuityReady) && Boolean(confirmed));
  const reviewing =
    mode === 'followup' && reviewedBinding === contextBinding(binding) && contextReady;
  const loadingFirstPage = mode === 'history' && !history && !historyRetry;
  const startHint = !question.trim()
    ? 'Enter your question to start.'
    : !english
      ? 'Confirm that you want to use English to start.'
      : null;
  const notesLink = (
    <TextLink
      href="#revisit-notes"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        document.getElementById('revisit-notes')?.focus();
      }}
    >
      Revisit notes
    </TextLink>
  );
  const localRuntime = ['synthetic-only', 'synthetic-local', 'live-local'].includes(
    runtimeMode ?? '',
  );
  const editionDetails = useEditionDetails(
    mode === 'reading' ? reading : null,
    record?.editionIds ?? [],
    onExpired,
  );
  const followUpEntry =
    reading &&
    record?.status === 'saved' &&
    !record.imported &&
    user.continuityReady &&
    user.permission.modelAllowed &&
    record.editionIds.length < 51 ? (
      <TextLink
        className="follow-up-link"
        href={`${editionPath(record.id, reading.editionId)}/follow-up`}
        onClick={editionNavigation}
      >
        Follow up on this edition
      </TextLink>
    ) : null;
  return (
    <section className="reading-workspace" aria-label="Your readings" aria-busy={busy}>
      {!deletionTarget && live === null && mode !== 'new' && (
        <div className="notice service-notice">
          <p>
            <Icon name="info" /> Reading service status is unavailable. Saved readings remain
            available.
          </p>
          {connectionRetry}
        </div>
      )}
      {!deletionTarget && !user.permission.modelAllowed && (
        <p className="notice">
          <Icon name="info" />
          <span>
            AI readings are off. Saved readings and reflections remain available. To start a new
            reading,{' '}
            <TextLink href="/account" onClick={onAccount}>
              turn on AI readings in your account
            </TextLink>
            .
          </span>
        </p>
      )}
      <nav className="reading-navigation" aria-label="Reading actions" hidden={!!deletionTarget}>
        <Button
          type="button"
          variant="secondary"
          aria-current={mode === 'history' ? 'page' : undefined}
          disabled={busy}
          onClick={() => {
            if (!canLeave()) return;
            void run(async (current) => {
              await loadHistory(current);
              if (current()) {
                setMode('history');
                replacePath('/');
                clearReading();
              }
            });
          }}
        >
          Saved readings
        </Button>
        <Button
          type="button"
          aria-current={mode === 'new' ? 'page' : undefined}
          disabled={busy || !user.permission.modelAllowed || requestPending || live === null}
          onClick={() => {
            if (!canLeave()) return;
            // A deliberate new reading is a new intent, even if the question is unchanged.
            intents.current.delete('start');
            resetContext();
            clearReading();
            setMode('new');
            setRequest(null);
            resumeTarget.current = null;
            setQuestionSubmitted(false);
            if (mode === 'followup') {
              setQuestion('');
              setEnglish(false);
            }
            replacePath('/new');
            setMessage(null);
          }}
        >
          New reading
        </Button>
      </nav>
      <Notice message={deletionTarget ? null : message} />
      {busy && !loadingFirstPage && !deletionTarget && (
        <p role="status" className="busy-line">
          <span className="spinner" aria-hidden="true" />
          Completing your reading action…
        </p>
      )}
      {deletionTarget && (
        <ReadingDeletion
          target={deletionTarget}
          csrfToken={user.csrfToken}
          onKeep={() => {
            keptDeletionScope.current = deletionTarget.scope;
            restoreDeleteFocus.current = true;
            setDeletionTarget(null);
          }}
          onConflict={() => {
            setDeletionTarget(null);
            if (record)
              void run(async (current) => {
                await open(record.id, current, true, false, true);
                if (current())
                  setMessage({
                    tone: 'notice',
                    text: 'This reading changed. Review the updated reading and confirm deletion again.',
                  });
              });
          }}
          onComplete={(proof, initial) => {
            const single = deletionTarget.scope === 'imported-edition';
            clearReading();
            setReadingDeletionReceipt({ proof, initial, single });
            setHistory(null);
            focusHistoryOnCommit.current = 'saved-readings-heading';
            setMode('history');
            replacePath('/');
            void run((current) => loadHistory(current));
          }}
        />
      )}
      {mode === 'history' && (
        <section className="history-section" aria-label="Saved reading history">
          <h2
            id="saved-readings-heading"
            ref={historyHeading}
            tabIndex={-1}
            className="title-section"
          >
            Saved readings
          </h2>
          <p className="muted">Opening one does not start a new reading.</p>
          {readingDeletionReceipt && (
            <DeletionReceiptPanel
              key={readingDeletionReceipt.proof.receiptId}
              proof={readingDeletionReceipt.proof}
              initial={readingDeletionReceipt.initial}
              title={readingDeletionReceipt.single ? 'Imported edition deleted' : 'Reading deleted'}
              summary={
                readingDeletionReceipt.single
                  ? 'The selected imported edition and its retained private copies were removed. Its imported parent and your other saved readings stay saved.'
                  : 'The reading, its reflections, dated revisit notes and all of its follow-ups were removed. Your other saved readings stay saved.'
              }
              onDismiss={() => setReadingDeletionReceipt(null)}
            />
          )}
          {loadingFirstPage && <p role="status">Loading saved readings…</p>}
          {historyRetry && (
            <>
              <Notice
                message={{ tone: 'error', text: 'Your saved readings could not be loaded.' }}
              />
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void run((current) => loadHistory(current, historyRetry.cursor))}
              >
                Retry loading saved readings
              </Button>
            </>
          )}
          {history?.items.length === 0 && !historyRetry && !busy && (
            <div className="empty-history">
              <Art name="study-possibility" className="empty-history-art" />
              <p>No saved readings yet.</p>
            </div>
          )}
          {history && history.items.length > 0 && (
            <ol className="reading-history">
              {history.items.map((item) => (
                <li key={item.id}>
                  <div className="history-copy">
                    <time dateTime={item.createdAt}>{date(item.createdAt)}</time>
                    <Button
                      type="button"
                      className="history-link"
                      id={`saved-reading-${item.id}`}
                      disabled={busy}
                      onClick={() =>
                        void run((current) => open(item.id, current, false, false, true, 'latest'))
                      }
                    >
                      <span>
                        {item.questionPreview ?? 'Saved reading'}
                        {item.imported && <small> · Imported reading</small>}
                      </span>
                      <Icon name="chevron" />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {history?.nextCursor && !historyRetry && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void run((current) => loadHistory(current, history.nextCursor))}
            >
              Load more readings
            </Button>
          )}
        </section>
      )}
      {mode === 'history' && request && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const target = resumeTarget.current ?? request.target;
            setRequest({ target, focus: false });
            replacePath(requestPath(target));
            setMode('request');
          }}
        >
          Resume reading request
        </Button>
      )}
      {mode === 'request' && request && (
        <RequestProgress
          key={`${request.target.id}:${navigationVersion}`}
          request={request}
          user={user}
          onSession={onSession}
          onExpired={onExpired}
          onTarget={(target) => {
            resumeTarget.current = target;
            replacePath(requestPath(target));
          }}
          onAllowNew={() => setRequestPending(false)}
          onReviewDraft={(reason) => {
            const start = request.start?.input;
            if (!start) return;
            const version = epoch.current;
            void refreshUser(() => alive.current && epoch.current === version).catch(
              (error: unknown) => {
                if (
                  alive.current &&
                  epoch.current === version &&
                  error instanceof ApiFailure &&
                  error.status === 401
                )
                  onExpired();
              },
            );
            setRequest(null);
            resumeTarget.current = null;
            setRequestPending(false);
            setQuestionSubmitted(false);
            intents.current.delete('start');
            resetContext();
            setMode(start.parentEditionId ? 'followup' : 'new');
            replacePath(
              start.parentEditionId && record
                ? `${editionPath(record.id, start.parentEditionId)}/follow-up`
                : '/new',
            );
            setMessage({
              tone: 'error',
              text: `${reason} Your question is still here. Choose and review any excerpts again.`,
            });
          }}
          onAccepted={(id, focus, target) =>
            void run(async (current) => {
              await open(id, current, false, false, focus, target);
              if (current()) {
                intents.current.delete('start');
                resetContext();
                setQuestion('');
                clearPhoto();
                setQuestionSubmitted(false);
                await refreshUser(current);
              }
            })
          }
        />
      )}
      {mode === 'followup' && !reading && !busy && (
        <Button variant="secondary" onClick={loadLocation}>
          Retry opening parent edition
        </Button>
      )}
      {(mode === 'new' || (mode === 'followup' && reading && record)) && (
        <form
          className="card new-reading"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              inFlight.current ||
              requestPending ||
              photoPreparing.current ||
              !contextReady ||
              !english ||
              (mode === 'followup' &&
                (!user.continuityReady ||
                  !reading ||
                  record?.status !== 'saved' ||
                  record.imported)) ||
              !question.trim() ||
              !user.permission.modelAllowed ||
              live === null
            )
              return;
            if (mode === 'followup' && !reviewing) {
              setReviewedBinding(contextBinding(binding));
              return;
            }
            const values = {
              question,
              languageConfirmed: 'en' as const,
              reversals: mode === 'followup' && reading ? reading.basis.reversals : reversals,
              permissionRevision: currentUser.current.permission.revision,
              parentEditionId: binding.parentEditionId,
              selection: confirmed?.selection ?? [],
              ...(confirmed ? { contextAcknowledgement: confirmed.acknowledgement } : {}),
              ...(mode === 'new' && spreadPhoto ? { spreadPhoto } : {}),
            };
            const intent = actionKey('start', values);
            const target = { kind: 'intent' as const, id: draftIntent };
            resumeTarget.current = target;
            replacePath(requestPath(target));
            setRequest({
              target,
              start: { input: { ...values, clientIntentId: draftIntent }, key: intent.key },
              focus: true,
            });
            setRequestPending(true);
            setQuestionSubmitted(true);
            setMode('request');
            setMessage(null);
          }}
        >
          <div className="new-reading-heading" hidden={reviewing}>
            <h2 ref={composerHeading} tabIndex={-1} className="title-section">
              {mode === 'followup' ? 'Ask a follow-up' : 'A new reading'}
            </h2>
            <Art name="spread-ribbon" mobileName="mobile-corner" className="new-reading-art" />
          </div>
          <div className="new-reading-layout" hidden={reviewing}>
            <div className="new-reading-content">
              {mode === 'followup' && reading && <FollowUp parent={reading} />}
              <ReflectionField
                id="reading-question"
                label={mode === 'followup' ? 'Your follow-up question' : 'Your question'}
                hint="Include what you are considering, what already works, and anything you want the reading to take into account."
                rows={3}
                maxLength={500}
                required
                value={question}
                onChange={(event) => {
                  setQuestion(event.target.value);
                  setQuestionSubmitted(false);
                }}
                disabled={busy}
              />
              <label className="check" htmlFor="check-english">
                <Input
                  id="check-english"
                  type="checkbox"
                  required
                  checked={english}
                  onChange={(event) => setEnglish(event.target.checked)}
                  disabled={busy}
                />
                Use English for this reading (required)
              </label>
              {mode === 'new' && (
                <>
                  <label className="check" htmlFor="check-reversals">
                    <Input
                      id="check-reversals"
                      type="checkbox"
                      checked={reversals}
                      onChange={(event) => setReversals(event.target.checked)}
                      disabled={busy}
                    />
                    Include reversed cards
                  </label>
                  <details className="spread-upload-field">
                    <summary>
                      <span>Use my own spread</span>
                      {spreadPhoto && <span className="caption">Photo attached</span>}
                    </summary>
                    <label htmlFor="reading-spread-photo">Photo of your spread (optional)</label>
                    <p id="reading-spread-photo-help" className="muted">
                      Situation, tension, possibility — from left to right. Use a photo of three
                      cards you have already drawn to recognize your cards and orientations instead
                      of drawing new ones.
                    </p>
                    <Input
                      ref={spreadInputRef}
                      id="reading-spread-photo"
                      aria-describedby="reading-spread-photo-help reading-photo-processing"
                      className="photo-file-input"
                      tabIndex={-1}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        const selection = ++photoSelection.current;
                        photoPreparing.current = true;
                        setPreparingPhoto(true);
                        setPhotoAnnouncement('Preparing photo…');
                        setSpreadPhoto(null);
                        setSpreadPhotoName(file.name);
                        setQuestionSubmitted(false);
                        const current = () => alive.current && photoSelection.current === selection;
                        void prepareSpreadPhoto(file)
                          .then((dataUrl) => {
                            if (!current()) return;
                            setSpreadPhoto(dataUrl);
                            setSpreadPhotoName(file.name);
                            setPhotoAnnouncement(`Photo attached: ${file.name}.`);
                            setQuestionSubmitted(false);
                            setMessage(null);
                          })
                          .catch((error) => {
                            if (!current()) return;
                            setSpreadPhoto(null);
                            setSpreadPhotoName(null);
                            setPhotoAnnouncement('');
                            if (spreadInputRef.current) spreadInputRef.current.value = '';
                            setMessage({
                              tone: 'error',
                              text:
                                error instanceof Error
                                  ? error.message
                                  : 'Could not load the spread photo.',
                            });
                          })
                          .finally(() => {
                            if (!current()) return;
                            photoPreparing.current = false;
                            setPreparingPhoto(false);
                          });
                      }}
                    />
                    <div
                      className={`spread-attachment ${spreadPhoto || preparingPhoto ? 'has-photo' : ''}`}
                      data-testid={
                        spreadPhoto || preparingPhoto ? 'spread-photo-preview' : undefined
                      }
                    >
                      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                        {photoAnnouncement}
                      </p>
                      {spreadPhoto || preparingPhoto ? (
                        <div className="spread-photo-preview">
                          {spreadPhoto && (
                            <img src={spreadPhoto} alt="Uploaded tarot spread preview" />
                          )}
                          {preparingPhoto && <p className="photo-preparing">Preparing photo…</p>}
                        </div>
                      ) : (
                        <div className="spread-photo-empty">
                          <Art name="three-card-spread" className="spread-intro-art" />
                          <p>Illustration only</p>
                        </div>
                      )}
                      <div className="spread-photo-meta">
                        <div className="spread-file-description">
                          {(spreadPhoto || preparingPhoto) && (
                            <p>{spreadPhotoName ?? 'Spread photo attached'}</p>
                          )}
                          <p className="muted">JPEG, PNG or WebP · up to 10 MB</p>
                        </div>
                        <div className="spread-photo-actions">
                          <Button
                            ref={choosePhotoRef}
                            type="button"
                            className="secondary choose-photo"
                            aria-describedby="reading-spread-photo-help reading-photo-processing"
                            disabled={busy}
                            onClick={() => spreadInputRef.current?.click()}
                          >
                            Choose photo
                          </Button>
                          {(spreadPhoto || preparingPhoto) && (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => {
                                clearPhoto();
                                setQuestionSubmitted(false);
                                choosePhotoRef.current?.focus();
                              }}
                            >
                              Remove photo
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </details>
                </>
              )}
              {user.continuityReady && (
                <ContextSelection
                  key={draftIntent}
                  mode="choose"
                  {...(mode === 'followup' && record && reading
                    ? { initialSource: { family: record, editionId: reading.editionId } }
                    : {})}
                  binding={binding}
                  csrfToken={user.csrfToken}
                  onExpired={onExpired}
                  onChange={updateContext}
                />
              )}
            </div>
            <aside className="reading-preflight" aria-labelledby="reading-preflight-title">
              <h3 id="reading-preflight-title">Before you start</h3>
              {mode === 'new' && (
                <p id="reading-photo-processing" aria-live="polite">
                  {photoNotice}
                </p>
              )}
              {connectionRetry}
              {submitNotice && <p>{submitNotice}</p>}
              <p>
                {mode === 'new'
                  ? READING_PRODUCT_COPY.startProcessing
                  : 'Starting a follow-up stores its question and result with this saved reading until deletion.'}
              </p>
              <div className="new-reading-footer">
                <Button
                  type="submit"
                  className="large"
                  aria-describedby={startHint ? 'reading-start-help' : undefined}
                  disabled={
                    busy ||
                    preparingPhoto ||
                    !english ||
                    !question.trim() ||
                    !contextReady ||
                    (mode === 'followup' && !user.continuityReady) ||
                    !user.permission.modelAllowed ||
                    live === null
                  }
                >
                  {mode === 'followup' ? 'Review follow-up' : 'Start reading'}
                  <Icon name="chevron" />
                </Button>
                {startHint && (
                  <p id="reading-start-help" className="muted">
                    {startHint}
                  </p>
                )}
                <p className="muted">
                  Readings left: {user.remainingDay} today · {user.remainingMonth} this month.
                </p>
              </div>
            </aside>
          </div>
          {reviewing && reading && (
            <FollowUpReview
              parent={reading}
              question={question}
              context={context}
              notice={submitNotice}
              heading={submissionHeading}
              disabled={
                busy ||
                !contextReady ||
                !user.permission.modelAllowed ||
                !user.continuityReady ||
                live === null
              }
              onBack={() => {
                setReviewedBinding(null);
                requestAnimationFrame(() => composerHeading.current?.focus());
              }}
            />
          )}
        </form>
      )}
      {mode === 'reading' && !record && !busy && message?.tone === 'error' && (
        <Button variant="secondary" onClick={loadLocation}>
          Retry opening reading
        </Button>
      )}
      {mode === 'reading' && record && selectedEditionId && (
        <section
          className={`reading-detail${reading ? ' reading-detail-native' : ''}`}
          aria-label="Reading detail"
          hidden={!!deletionTarget}
        >
          {reading && (
            <EditionHistory
              ids={record.editionIds}
              reading={reading}
              details={editionDetails.details}
            />
          )}
          {editionDetails.failed && (
            <p className="edition-details-retry">
              Some edition details could not be loaded.{' '}
              <Button variant="text-button" onClick={editionDetails.retry}>
                Retry edition details
              </Button>
            </p>
          )}
          {reading ? (
            <article
              data-testid="accepted-reading"
              className={`accepted-reading${reading.spreadPhoto ? ' has-spread-photo' : ''}`}
            >
              <div className="reading-header">
                <div className="reading-title">
                  <p className="test-notice">
                    <TopicChip tone="sage">
                      {reading.provenance.provider === 'openai'
                        ? 'AI reading'
                        : localRuntime
                          ? 'Local simulated reading'
                          : 'Simulated reading'}
                      {reading.mode === 'template' ? ' · Prepared reflection template' : ''}
                    </TopicChip>
                  </p>
                  <time
                    dateTime={reading.editionNumber === 1 ? record.createdAt : reading.acceptedAt}
                  >
                    {date(reading.editionNumber === 1 ? record.createdAt : reading.acceptedAt)}
                  </time>
                  {reading.parentEditionId && <p>Follow-up · Edition {reading.editionNumber}</p>}
                  <h2 ref={resultHeading} tabIndex={-1}>
                    {reading.question}
                  </h2>
                  <ReadingOrigin reading={reading} details={editionDetails.details} />
                  {notesLink}
                  {deletionEntry}
                  {followUpEntry}
                </div>
                {!reading.spreadPhoto && <Art name="study-inquiry" className="question-art" />}
              </div>
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
              {reading.units.map((unit, index) => {
                const card = reading.basis.cards.find((item) => item.position === unit.position);
                const name =
                  reading.kind === 'tarot.accepted.v2'
                    ? reading.draw.find((item) => item.position === unit.position)?.name
                    : card && cardName(reading.basis.deckEdition, card.cardId);
                return (
                  <section key={unit.position} className="card position-card">
                    <div className="position-title">
                      <span className="position-number" aria-hidden="true">
                        {index + 1}
                      </span>
                      <h3>{unit.position}</h3>
                    </div>
                    <div className="position-body">
                      {card && !reading.spreadPhoto && (
                        <CardFace cardId={card.cardId} orientation={card.orientation} name={name} />
                      )}
                      <div className="position-copy">
                        <div>
                          <h4>
                            {reading.spreadPhoto
                              ? 'Recognized card'
                              : reading.parentEditionId
                                ? 'Original card'
                                : 'Drawn card'}
                            {name ? `: ${name}` : ''}
                          </h4>
                          <p className="basis-text">{unit.basisText}</p>
                        </div>
                        <div>
                          <h4>Interpretation</h4>
                          <p>{unit.interpretation}</p>
                        </div>
                        {'reflectionQuestion' in unit && (
                          <div className="reflection-prompt">
                            <h4>Reflection prompt</h4>
                            <p>{unit.reflectionQuestion}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                );
              })}
              {reading.kind === 'tarot.accepted.v2' ? (
                <div className="card reading-closing">
                  <section>
                    <h3>Putting it together</h3>
                    <p>{reading.synthesis.text}</p>
                  </section>
                  <section>
                    <h3>An optional next step</h3>
                    <p>{reading.action.text}</p>
                  </section>
                  {reading.reflectionQuestion && (
                    <section className="reflection-prompt">
                      <h3>A question to consider</h3>
                      <p>{reading.reflectionQuestion.text}</p>
                    </section>
                  )}
                </div>
              ) : (
                <p className="reading-closing">{reading.closing}</p>
              )}
              <details className="reading-sources">
                <summary>Cards and sources</summary>
                <h3>Traditional source material</h3>
                <p className="muted">
                  These sources are saved with the reading. They are separate from the
                  interpretation and your own reflection. These meanings are unapproved development
                  material.
                </p>
                {reading.basis.cards.map((card, index) => {
                  const name =
                    reading.kind === 'tarot.accepted.v2'
                      ? reading.draw[index]!.name
                      : cardName(reading.basis.deckEdition, card.cardId);
                  const position = card.position[0]!.toUpperCase() + card.position.slice(1);
                  return (
                    <div key={card.id} className="source">
                      <CardThumbnail cardId={card.cardId} orientation={card.orientation} />
                      <div className="source-copy">
                        <h3>
                          {position}: {name ? `${name} (${card.cardId})` : card.cardId} ·{' '}
                          {card.orientation}
                        </h3>
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
                        <p className="source-attribution">
                          {reading.sources[index]!.rights.attribution}
                        </p>
                        <p className="muted source-id">
                          Source {reading.sources[index]!.id} · version{' '}
                          {reading.sources[index]!.version}
                        </p>
                      </div>
                    </div>
                  );
                })}
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
            </article>
          ) : pattern ? (
            <PatternReading reading={pattern} headingRef={resultHeading} />
          ) : imported ? (
            <ImportedReadingDetail reading={imported} headingRef={resultHeading} />
          ) : (
            <ReflectionCard>
              <h2 ref={resultHeading} tabIndex={-1}>
                Saved reading
              </h2>
              <p>This reading is unavailable. Your saved notes remain available.</p>
              {unavailable && (
                <p>
                  The import records this edition as{' '}
                  {
                    {
                      deleted: 'deleted',
                      source_erased: 'unavailable after source erasure',
                      content_withdrawn: 'withdrawn',
                    }[unavailable.reason]
                  }{' '}
                  on{' '}
                  <time dateTime={unavailable.unavailableAt}>
                    {date(unavailable.unavailableAt)}
                  </time>
                  .
                </p>
              )}
              {notesLink}
            </ReflectionCard>
          )}
          <aside className="reading-personal-writing" aria-label="Your writing">
            <div className={`save-reading ${record.status === 'saved' ? 'is-saved' : ''}`}>
              {record.status === 'saved' ? (
                <p className="saved-label">
                  <Icon name="check" />
                  Saved until you delete it.
                </p>
              ) : (
                <>
                  <div className="save-summary">
                    <Icon name="clock" />
                    <div className="save-copy">
                      <p>
                        <strong>Not saved</strong> · Temporary storage lasts 24 hours from creation.
                      </p>
                      <p className="muted">{READING_PRODUCT_COPY.saveReading}</p>
                    </div>
                  </div>
                  <Button id="save-reading" type="button" onClick={save} disabled={busy}>
                    <Icon name="bookmark" />
                    Save reading
                  </Button>
                </>
              )}
            </div>
            {!reading && deletionEntry}
            <ReflectionCard
              id="personal-reflection"
              tabIndex={-1}
              className="reflection-editor"
              aria-label="Personal reflection"
            >
              {reflection && !reflectionEditing && (
                <div className="saved-reflection">
                  <div className="saved-reflection-heading">
                    <h2>Your reflection</h2>
                    <Button
                      ref={editReflectionTrigger}
                      variant="text-button"
                      disabled={busy}
                      onClick={() => {
                        setReflectionEditing(true);
                        requestAnimationFrame(() =>
                          document.getElementById('reflection-text')?.focus(),
                        );
                      }}
                    >
                      Edit reflection
                    </Button>
                  </div>
                  <p className="muted">
                    Saved {date(reflection.updatedAt)} · {stanceLabels[reflection.stance]}
                  </p>
                  <p className="saved-reflection-text">{reflection.text}</p>
                </div>
              )}
              <div className="reflection-edit-controls" hidden={!!reflection && !reflectionEditing}>
                <h2>{reflection ? 'Edit reflection' : 'Add reflection'}</h2>
                <p>
                  This is your own writing. It does not change the reading or request AI generation.
                </p>
                {reading?.spreadPhoto && (
                  <figure className="reflection-spread-reference">
                    <img
                      src={reading.spreadPhoto}
                      alt="Your uploaded spread, for reference while writing"
                    />
                    <figcaption>Your uploaded spread</figcaption>
                  </figure>
                )}
                {conflict && (
                  <div className="notice reflection-conflict">
                    <p>
                      Current saved reflection
                      {latestReflection ? ` (revision ${latestReflection.revision})` : ''}:
                    </p>
                    <blockquote>{latestReflection?.text ?? 'No saved reflection.'}</blockquote>
                    <p>Saved response: {stanceLabels[latestReflection?.stance ?? 'unspecified']}</p>
                    <div className="actions">
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setReflection(latestReflection);
                          setLatestReflection(null);
                          setConflict(false);
                          setMessage({
                            tone: 'notice',
                            text: 'Your draft is ready for the next save.',
                          });
                        }}
                      >
                        Keep my draft for the next save
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          setReflection(latestReflection);
                          setDraft(latestReflection?.text ?? '');
                          setStance(latestReflection?.stance ?? 'unspecified');
                          setLatestReflection(null);
                          setConflict(false);
                          setMessage({
                            tone: 'notice',
                            text: 'The saved reflection is now in the editor.',
                          });
                        }}
                      >
                        Use the saved reflection
                      </Button>
                    </div>
                  </div>
                )}
                <ReflectionField
                  id="reflection-text"
                  label="Your reflection"
                  rows={4}
                  maxLength={10000}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={busy}
                />
                <label htmlFor="reflection-stance">How does this feel?</label>
                <div className="select-field">
                  <select
                    id="reflection-stance"
                    value={stance}
                    onChange={(event) => setStance(event.target.value as Thought['stance'])}
                    disabled={busy}
                  >
                    {Object.entries(stanceLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="muted">
                  Unsaved drafts stay only in memory and are lost when you leave this reading or
                  reload.
                </p>
                {record.status !== 'saved' && (
                  <p>Saving a reflection also saves this reading until deletion.</p>
                )}
                <Button
                  type="button"
                  onClick={saveReflection}
                  disabled={busy || conflict || !reading || !draft.trim()}
                >
                  Save reflection
                </Button>
                {reflection && (
                  <Button
                    variant="text-button"
                    disabled={busy}
                    onClick={() => {
                      const saved = conflict ? latestReflection : reflection;
                      setReflection(saved);
                      setDraft(saved?.text ?? '');
                      setStance(saved?.stance ?? 'unspecified');
                      setLatestReflection(null);
                      setConflict(false);
                      setReflectionEditing(!saved);
                      requestAnimationFrame(() =>
                        (saved
                          ? editReflectionTrigger.current
                          : document.getElementById('reflection-text')
                        )?.focus(),
                      );
                    }}
                  >
                    Cancel editing
                  </Button>
                )}
              </div>
            </ReflectionCard>
            <RevisitNotes
              key={`${user.subjectId}:${record.id}:${selectedEditionId}`}
              ref={revisitNotes}
              sessionId={record.id}
              editionId={selectedEditionId}
              saved={record.status === 'saved'}
              parentExpiresAt={record.retentionExpiresAt ?? null}
              csrfToken={user.csrfToken}
              onExpired={onExpired}
              onChanged={() => {
                const id = record.id;
                void run(async (current) => {
                  const fresh = await api(`/sessions/${id}`, apiSchemas.SessionRecord);
                  if (current() && selected.current?.id === id) setRecord(fresh);
                });
              }}
            />
            {reflection && (
              <details className="deletion-actions reflection-revisions">
                <summary>Reflection revisions</summary>
                <div className="revision-controls">
                  <div className="revision-select">
                    <label htmlFor="reflection-revision">Saved reflection revision</label>
                    <div className="select-field">
                      <select
                        id="reflection-revision"
                        value={revisionChoice}
                        onChange={(event) => {
                          setRevisionChoice(Number(event.target.value));
                          setRevisionNote(null);
                          setEraseRevisionChecked(false);
                        }}
                        disabled={busy}
                      >
                        {Array.from({ length: reflection.revision }, (_, i) => i + 1).map(
                          (value) => (
                            <option key={value} value={value}>
                              Revision {value}
                              {value === reflection.revision ? ' (current)' : ''}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </div>
                  <Button type="button" variant="secondary" onClick={viewRevision} disabled={busy}>
                    <Icon name="eye" />
                    View revision
                  </Button>
                </div>
                {revisionNote && (
                  <div className="notice revision-note">
                    <p>
                      Saved revision {revisionNote.revision} · {date(revisionNote.updatedAt)}
                    </p>
                    <blockquote>{revisionNote.text}</blockquote>
                    <p>
                      Erasing this revision keeps the reading and other authored revisions. Erasing
                      the current revision removes it from the editor; older revisions remain
                      available in export.
                    </p>
                    <label className="check" htmlFor="check-eraseRevisionChecked">
                      <Input
                        id="check-eraseRevisionChecked"
                        type="checkbox"
                        checked={eraseRevisionChecked}
                        onChange={(event) => setEraseRevisionChecked(event.target.checked)}
                        disabled={busy}
                      />
                      Permanently erase this reflection revision
                    </label>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={busy || !eraseRevisionChecked}
                      onClick={eraseRevision}
                    >
                      Erase revision {revisionNote.revision}
                    </Button>
                  </div>
                )}
              </details>
            )}
            {revisionReceipt && (
              <DeletionReceiptPanel
                key={revisionReceipt.proof.receiptId}
                {...revisionReceipt}
                onDismiss={() => setRevisionReceipt(null)}
              />
            )}
            {record.status === 'saved' && (
              <ContextSelection
                key={selectedEditionId}
                mode="manage"
                family={record}
                editionId={selectedEditionId}
                csrfToken={user.csrfToken}
                onExpired={onExpired}
              />
            )}
            {imported?.record.parentIdentity && (
              <div className="deletion-actions reading-deletion">
                <Button
                  ref={importedDeleteTrigger}
                  variant="text-button"
                  disabled={busy}
                  onClick={() => confirmReadingDeletion('imported-edition')}
                >
                  Delete this imported edition
                </Button>
              </div>
            )}
          </aside>
        </section>
      )}
    </section>
  );
}
