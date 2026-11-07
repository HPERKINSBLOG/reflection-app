import type { BirthDraft } from '../contracts/astrology.ts';
import { Button, ConfirmationHint, Input, TextLink } from './design/components.tsx';
import { type MouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { apiSchemas, type AuthResult } from '../contracts/index.ts';
import { READING_PRODUCT_COPY, SPREAD_PHOTO_COPY } from '../contracts/product-copy.ts';
import { api, ApiFailure } from './api.ts';
import { enroll, signIn } from './passkeys.ts';
import {
  type ConfirmationAnswer,
  PasswordDialog,
  PasswordLoginForm,
  PasswordOnlyForm,
  PasswordSetupForm,
} from './password-forms.tsx';
import {
  ReadingWorkspace,
  savedEditionFromPath,
  type WorkspaceHandle,
  type WorkspaceResume,
} from './readings.tsx';
import { requestFromPath } from './request-progress.tsx';
import { deletionIntent, DeletionReceiptPanel, type DeletionProof } from './deletion.tsx';
import { date } from './date.ts';
import { Notice, type NoticeMessage } from './notice.tsx';
import { Art } from './art.tsx';
import { Icon } from './icon.tsx';
import { Brand } from './design/components.tsx';
import { ImportRecords } from './imports.tsx';
import { ThemeSelect } from './design/theme.tsx';
import { Invitation, signInPath } from './invitation.tsx';

type View = z.infer<typeof apiSchemas.SessionView>;
type Kit = z.infer<typeof apiSchemas.RecoveryCodes>;
type Grant = z.infer<typeof apiSchemas.RecoveryGrant>;
function kitText(kit: Kit) {
  return JSON.stringify(
    {
      format: 'reflection-recovery-kit.v1',
      origin: window.location.origin,
      instructions: `Visit ${window.location.origin}/recover. Enter the recovery handle and one unused code, then follow the steps to replace your sign-in method. Keep this complete kit somewhere private.`,
      recoveryHandle: kit.recoveryHandle,
      codes: kit.codes,
    },
    null,
    2,
  );
}
function downloadFile(name: string, chunks: BlobPart[], type: string) {
  const url = URL.createObjectURL(new Blob(chunks, { type })),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Modified clicks keep the browser's own link behavior, such as opening a new tab. */
function plainClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
function environmentNotice(mode: string | null, live: boolean | null) {
  const unavailable = 'Reading service status is unavailable. Saved readings remain available.';
  if (mode === 'hosted-synthetic') {
    const notice =
      'This hosted preview simulates readings and does not contact an AI provider. Use test accounts and synthetic text only.';
    return live === null ? `${notice} ${unavailable}` : notice;
  }
  if (live === null) return unavailable;
  if (!live)
    return 'This local simulation does not contact an AI provider. Use test accounts and synthetic text only.';
  if (mode === 'live-preview')
    return 'This hosted preview sends new readings to a live AI provider.';
  if (mode === 'production') return 'New readings can be sent to a live AI provider.';
  return 'This development app sends new readings to a live AI provider.';
}
/** "Draw three cards" opens sign-in with the new-account choices focused. */
const startsNew = () =>
  window.location.pathname === signInPath &&
  new URLSearchParams(window.location.search).get('start') === 'new';
export function IdentityApp() {
  const [live, setLive] = useState<boolean | null>(null);
  const [runtimeMode, setRuntimeMode] = useState<string | null>(null);
  const [patternReady, setPatternReady] = useState(false);
  const connectionRequest = useRef<AbortController | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const checkConnection = useCallback(() => {
    connectionRequest.current?.abort();
    const controller = new AbortController();
    connectionRequest.current = controller;
    setCheckingConnection(true);
    setPatternReady(false);
    void fetch('/health', { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((runtime) => {
        if (controller.signal.aborted) return;
        if (typeof runtime === 'object' && runtime !== null && 'mode' in runtime) {
          const mode = String(runtime.mode);
          const ready = 'generationReady' in runtime && runtime.generationReady === true;
          setRuntimeMode(mode);
          setPatternReady(
            mode === 'live-preview' && 'patternReady' in runtime && runtime.patternReady === true,
          );
          if (mode === 'live-local' || mode === 'live-preview') setLive(true);
          if (mode === 'synthetic-only') setLive(false);
          if (ready && ['synthetic-local', 'hosted-synthetic'].includes(mode)) setLive(false);
          if (
            ready &&
            mode === 'production' &&
            'provider' in runtime &&
            runtime.provider === 'openai'
          )
            setLive(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setCheckingConnection(false);
      });
  }, []);
  useEffect(() => {
    checkConnection();
    return () => connectionRequest.current?.abort();
  }, [checkConnection]);
  const connectionRetry = live === null && (
    <Button variant="secondary" disabled={checkingConnection} onClick={checkConnection}>
      {checkingConnection ? 'Checking connection…' : 'Check connection again'}
    </Button>
  );
  const [session, setSession] = useState<View | null>(null);
  const [kit, setKit] = useState<Kit | null>(null);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [passwordScreen, setPasswordScreen] = useState<'login' | 'register' | null>(null);
  const [confirmingPassword, setConfirmingPassword] = useState(false);
  const passwordAnswer = useRef<((answer: ConfirmationAnswer) => void) | null>(null);
  const [credentials, setCredentials] = useState<z.infer<typeof apiSchemas.Credentials> | null>(
    null,
  );
  const [route, setRoute] = useState(window.location.pathname);
  const [patternRestore, setPatternRestore] = useState<BirthDraft | null>(null);
  const [readingResume, setReadingResume] = useState<WorkspaceResume | null>(null);
  const readingsPath = readingResume?.path ?? '/';
  const [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(true);
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const [accountDeleteChecked, setAccountDeleteChecked] = useState(false);
  const [deletionReceipt, setDeletionReceipt] = useState<{
    proof: DeletionProof;
    initial: z.infer<typeof apiSchemas.DeletionStatus> | null;
  } | null>(null);
  const [handle, setHandle] = useState(''),
    [code, setCode] = useState('');
  const [downloaded, setDownloaded] = useState(false),
    [acknowledged, setAcknowledged] = useState(false);
  const inFlight = useRef(false);
  const authenticated = useRef(false);
  const workspace = useRef<WorkspaceHandle>(null);
  const permissionIntent = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    authenticated.current = Boolean(session || kit);
  }, [session, kit]);
  const version = useRef(0),
    channel = useRef<BroadcastChannel | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const hadReceipt = useRef(false);
  const previousPasswordScreen = useRef(passwordScreen);
  useLayoutEffect(() => {
    if (previousPasswordScreen.current === passwordScreen) return;
    previousPasswordScreen.current = passwordScreen;
    heading.current?.focus();
  }, [passwordScreen]);
  const signupFocus = useRef(startsNew());
  const previousRoute = useRef(route);
  useLayoutEffect(() => {
    if (previousRoute.current === route) return;
    // Leaving a page closes its password form and forgets typed recovery details.
    if (previousRoute.current === '/recover') {
      setHandle('');
      setCode('');
    }
    if (route !== signInPath) signupFocus.current = false;
    previousRoute.current = route;
    setPasswordScreen(null);
  }, [route]);
  useLayoutEffect(() => {
    // A signed-in reader has no sign-in page. This covers any path not replaced earlier.
    if (!session || route !== signInPath) return;
    history.replaceState(null, '', '/');
    setRoute('/');
  }, [session, route]);
  // A checked status updates the receipt without moving focus, so focus follows its ID.
  const receiptId = deletionReceipt?.proof.receiptId;
  useLayoutEffect(() => {
    // The receipt and the welcome screen replace each other's primary heading.
    if (receiptId) receiptHeading.current?.focus();
    else if (hadReceipt.current) heading.current?.focus();
    hadReceipt.current = Boolean(receiptId);
  }, [receiptId]);
  const clear = useCallback(() => {
    version.current++;
    inFlight.current = false;
    authenticated.current = false;
    permissionIntent.current = null;
    setBusy(false);
    setChecking(false);
    setSession(null);
    setKit(null);
    setGrant(null);
    setPasswordScreen(null);
    passwordAnswer.current?.(null);
    passwordAnswer.current = null;
    setConfirmingPassword(false);
    setCredentials(null);
    setReadingResume(null);
    setPatternRestore(null);
    setHandle('');
    setCode('');
    setDownloaded(false);
    setAcknowledged(false);
    setAccountDeleteChecked(false);
    setDeletionReceipt(null);
    try {
      sessionStorage.clear();
    } catch {
      /* Browser storage may be unavailable. */
    }
    if ('caches' in window)
      void caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => {});
    navigator.serviceWorker?.controller?.postMessage({ type: 'PURGE_PRIVATE' });
  }, []);
  useEffect(() => {
    if (!session || kit || busy || route !== '/account') return;
    let current = true;
    setCredentials(null);
    void api('/auth/credentials', apiSchemas.Credentials)
      .then((listed) => {
        if (current) setCredentials(listed);
      })
      .catch((error) => {
        if (!current) return;
        if (error instanceof ApiFailure && error.status === 401) clear();
        else
          setMessage({
            tone: 'error',
            text: 'Your passkeys could not be loaded. Refresh this page to try again.',
          });
      });
    return () => {
      current = false;
    };
  }, [session, kit, busy, route, clear]);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const requested = version.current;
    setChecking(true);
    try {
      const current = await api('/me', apiSchemas.SessionView);
      if (requested === version.current) {
        // Replace /sign-in before the readings mount, so they never see that path.
        if (window.location.pathname === signInPath) {
          history.replaceState(null, '', '/');
          setRoute('/');
        }
        setSession(current);
      }
    } catch (error) {
      if (requested === version.current) {
        if (error instanceof ApiFailure && error.status === 401) {
          if (authenticated.current) clear();
        } else {
          setMessage({
            tone: 'error',
            text: 'Your session could not be refreshed. Keep this page open and try again when the connection returns.',
          });
        }
      }
    } finally {
      if (requested === version.current) setChecking(false);
    }
  }, [clear]);
  const leaveReadings = useCallback(() => {
    const current = workspace.current;
    if (!current) return true;
    if (!current.confirmLeave()) return false;
    setReadingResume(current.getResumeState());
    return true;
  }, []);
  useEffect(() => {
    void refresh();
    const updates = new BroadcastChannel('reflection-account');
    channel.current = updates;
    updates.onmessage = () => {
      clear();
      setMessage({
        tone: 'notice',
        text: 'Your account session changed in another tab. Please sign in again.',
      });
    };
    const focus = () => {
        if (authenticated.current) void refresh();
      },
      navigation = () => {
        // The account page closes the readings, so unsaved writing there needs a choice first.
        if (window.location.pathname === '/account' && !leaveReadings()) return;
        if (authenticated.current && window.location.pathname === signInPath)
          history.replaceState(null, '', '/');
        // Back or Forward to ?start=new focuses the new-account choices, as a direct load does.
        signupFocus.current = startsNew();
        setRoute(window.location.pathname);
        setMessage(null);
      };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        clear();
        void refresh();
      }
    };
    window.addEventListener('focus', focus);
    window.addEventListener('popstate', navigation);
    window.addEventListener('pageshow', pageshow);
    return () => {
      updates.close();
      window.removeEventListener('focus', focus);
      window.removeEventListener('popstate', navigation);
      window.removeEventListener('pageshow', pageshow);
    };
  }, [refresh, clear, leaveReadings]);
  const navigate = (path: string) => {
    history.pushState(null, '', path);
    // The route is the path alone; a query such as ?start=new stays in the address.
    setRoute(window.location.pathname);
  };
  const run = async (operation: (isCurrent: () => boolean) => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const operationVersion = ++version.current;
    const isCurrent = () => operationVersion === version.current;
    setBusy(true);
    setMessage(null);
    try {
      await operation(isCurrent);
      requestAnimationFrame(() => {
        if (isCurrent()) heading.current?.focus();
      });
    } catch (error) {
      if (isCurrent())
        setMessage({
          tone: 'error',
          text:
            error instanceof ApiFailure
              ? error.status >= 500 && error.correlationId
                ? `${error.message} Reference: ${error.correlationId}`
                : error.message
              : error instanceof Error && error.message
                ? error.message
                : 'The account action could not be completed. Please try again.',
        });
    } finally {
      if (isCurrent()) {
        inFlight.current = false;
        setBusy(false);
        setChecking(false);
      }
    }
  };
  const receiveKit = (value: Kit) => {
    setKit(value);
    setDownloaded(false);
    setAcknowledged(false);
  };
  const readSession = async (isCurrent: () => boolean) =>
    api('/me', apiSchemas.SessionView).catch((error) => {
      if (isCurrent() && error instanceof ApiFailure && error.status === 401) clear();
      throw error;
    });
  const complete = async (result: z.infer<typeof AuthResult>, isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    setDeletionReceipt(null);
    // Preserve the one-time kit even if the follow-up session read is temporarily unavailable.
    if (result.recoveryHandle)
      receiveKit({ recoveryHandle: result.recoveryHandle, codes: result.recoveryCodes });
    const current = await readSession(isCurrent);
    if (!isCurrent()) return;
    setSession(current);
    setGrant(null);
    setPasswordScreen(null);
    // Saved readings are the default destination; a requested reading or the account page stays.
    if (!requestFromPath() && !savedEditionFromPath() && window.location.pathname !== '/account') {
      // Signing in replaces /sign-in, so Back never returns to it.
      if (window.location.pathname === signInPath) {
        history.replaceState(null, '', '/');
        setRoute('/');
      } else navigate('/');
    }
  };
  const verifyIdentity = async (isCurrent: () => boolean, requirePasskey = false) => {
    if (!session) throw new Error('Your session has ended. Sign in again.');
    let answer: ConfirmationAnswer = 'passkey';
    if (session.passwordEnabled && !requirePasskey) {
      answer = await new Promise<ConfirmationAnswer>((resolve) => {
        passwordAnswer.current = resolve;
        setConfirmingPassword(true);
      });
      if (answer === null || !isCurrent()) return null;
    }
    const verified =
      answer === 'passkey'
        ? await signIn('reauthenticate', session.csrfToken)
        : await api(
            '/auth/password/reauthenticate',
            apiSchemas.AuthResult,
            answer,
            session.csrfToken,
          );
    if (!isCurrent()) return null;
    // Keep the rotated session usable if a subsequent action is cancelled.
    setSession({
      ...session,
      csrfToken: verified.csrfToken,
      recentAuthUntil: verified.recentAuthUntil,
    });
    channel.current?.postMessage('changed');
    return verified.csrfToken;
  };
  const download = () => {
    if (!kit) return;
    downloadFile('reflection-recovery-kit.json', [kitText(kit)], 'application/json');
    setDownloaded(true);
  };
  const expire = () => {
    clear();
    setMessage({ tone: 'notice', text: 'Your session ended. Please sign in again.' });
  };
  // Record routes answer 401 only once the session has ended.
  const expireIfEnded = (error: unknown, isCurrent: () => boolean) => {
    if (isCurrent() && error instanceof ApiFailure && error.status === 401) expire();
  };
  const show = (path: string) => {
    navigate(path);
    setMessage(null);
    requestAnimationFrame(() => heading.current?.focus());
  };
  /** The welcome page's actions open sign-in in place, so Back returns to the welcome. */
  const openSignIn = (event: MouseEvent<HTMLAnchorElement>, startNew: boolean) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    if (inFlight.current) return;
    if (!startNew) return show(signInPath);
    // The new-account group takes focus when it mounts.
    signupFocus.current = true;
    navigate(`${signInPath}?start=new`);
    setMessage(null);
  };
  const backToSignIn = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    if (!inFlight.current) show(signInPath);
  };
  const openAccount = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    if (route === '/account' || inFlight.current) return;
    if (!leaveReadings()) return;
    show('/account');
  };
  const backToReadings = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    if (!inFlight.current) show(readingsPath);
  };
  const permission = () =>
    void run(async (isCurrent) => {
      if (!session) return;
      const { permission: previous, csrfToken } = session;
      const payload = { modelAllowed: !previous.modelAllowed, policyVersion: 'egress.v1' as const };
      const intent = JSON.stringify([payload, previous.revision]);
      // A retry of the same change reuses its idempotency key.
      if (permissionIntent.current?.payload !== intent)
        permissionIntent.current = { payload: intent, key: crypto.randomUUID() };
      await api('/permissions/model', apiSchemas.Permission, payload, csrfToken, {
        method: 'PUT',
        revision: previous.revision,
        key: permissionIntent.current.key,
      }).catch((error: unknown) => {
        expireIfEnded(error, isCurrent);
        throw error;
      });
      if (!isCurrent()) return;
      permissionIntent.current = null;
      const updated = await readSession(isCurrent);
      if (isCurrent()) setSession(updated);
    });
  const exportRecords = () =>
    void run(async (isCurrent) => {
      if (!session) return;
      let view = session;
      if (Date.parse(view.recentAuthUntil) <= Date.now()) {
        if (!(await verifyIdentity(isCurrent))) return;
        view = await readSession(isCurrent);
        if (!isCurrent()) return;
        setSession(view);
      }
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      try {
        const ticket = await api('/exports', apiSchemas.ExportTicket, {}, view.csrfToken, {
          key: crypto.randomUUID(),
        });
        let cursor: string | null = null,
          bytes = 0;
        do {
          if (!isCurrent()) return;
          const page: z.infer<typeof apiSchemas.ExportPage> = await api(
            `/exports/${ticket.id}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
            apiSchemas.ExportPage,
          );
          if (!isCurrent()) return;
          const chunk = new TextEncoder().encode(`${JSON.stringify(page)}\n`);
          bytes += chunk.length;
          if (bytes > 32 * 1024 * 1024)
            throw new Error(
              'This export is too large to download here. No partial file was downloaded.',
            );
          chunks.push(chunk);
          cursor = page.nextCursor;
        } while (cursor);
      } catch (error) {
        expireIfEnded(error, isCurrent);
        throw error;
      }
      if (!isCurrent()) return;
      downloadFile('reflection-export.ndjson', chunks, 'application/x-ndjson');
      setMessage({
        tone: 'success',
        text: 'Export downloaded. Keep it somewhere private; deleting records here cannot delete downloaded copies.',
      });
    });
  const accountPage = Boolean(session) && !kit && !grant && route === '/account';
  const title = kit
    ? 'Keep your recovery kit'
    : grant
      ? grant.passwordEnabled
        ? 'Reset your sign-in'
        : 'Create your replacement passkey'
      : session
        ? accountPage
          ? 'Your account'
          : 'Your readings'
        : route === '/recover'
          ? 'Recover your account'
          : passwordScreen === 'login'
            ? 'Sign in with a password'
            : passwordScreen === 'register'
              ? 'Create a password account'
              : 'Sign in or create an account';
  // Signed out, / is an invitation. Every other path, such as /sign-in, signs in in place.
  const invitation = !session && !kit && !grant && route === '/';
  // Once the session check settles, the welcome and recovery pages link to sign-in.
  const headerSignIn =
    !session && !kit && !grant && !checking && (route === '/' || route === '/recover');
  const authPage = !kit && (Boolean(grant) || !session);
  const signInPage = authPage && !grant && route !== '/recover';
  const choosePasswordScreen = (screen: typeof passwordScreen) => {
    setPasswordScreen(screen);
    setMessage(null);
  };
  const dialog = confirmingPassword && (
    <PasswordDialog
      allowPasskey={Boolean(credentials?.items.length)}
      onAnswer={(answer) => {
        passwordAnswer.current?.(answer);
        passwordAnswer.current = null;
        setConfirmingPassword(false);
      }}
    />
  );
  const header = (
    <header className="site-header">
      <div className="shell-width">
        <Brand />
        {session && !kit && !grant && !accountPage && (
          <div id="workspace-navigation" inert={checking || busy} />
        )}
        <div className="header-tools">
          <ThemeSelect />
          {session && !kit && !grant && (
            <TextLink
              className="header-link"
              href="/account"
              aria-current={accountPage ? 'page' : undefined}
              onClick={openAccount}
            >
              Account
            </TextLink>
          )}
          {headerSignIn && (
            <TextLink
              className="header-link"
              href={signInPath}
              onClick={(event) => openSignIn(event, false)}
            >
              Sign in
            </TextLink>
          )}
        </div>
      </div>
    </header>
  );
  // The welcome page and the sign-in and recovery pages each mount their own panel.
  // A checked status comes back here, so it survives the move between them.
  const receiptPanel = deletionReceipt && (
    <DeletionReceiptPanel
      key={deletionReceipt.proof.receiptId}
      {...deletionReceipt}
      pageHeading={receiptHeading}
      onStatus={(initial) =>
        setDeletionReceipt((current) =>
          current?.proof.receiptId === deletionReceipt.proof.receiptId
            ? { ...current, initial }
            : current,
        )
      }
      onDismiss={() => setDeletionReceipt(null)}
    />
  );
  if (invitation)
    return (
      <div className="app-shell invitation-shell">
        {dialog}
        {header}
        <Invitation
          heading={heading}
          receipt={receiptPanel}
          notice={<Notice message={message} />}
          checking={checking}
          environment={environmentNotice(runtimeMode, live)}
          onSignIn={openSignIn}
        />
      </div>
    );
  return (
    <div className={`app-shell${accountPage ? ' account-shell' : ''}`}>
      {dialog}
      {header}
      <main
        className={
          authPage
            ? 'auth-layout'
            : `page-column ${kit ? 'kit-page' : accountPage ? 'account-page account-settings' : 'account-page readings-page'}`
        }
      >
        {authPage && <Art name="study-inquiry" className="auth-art" />}
        <div className={authPage ? 'auth-column' : 'page-stack'}>
          {receiptPanel}
          <div
            className={
              authPage
                ? `card auth-card ${signInPage ? 'sign-in-card' : 'recovery-card'} ${grant ? 'replacement-card' : ''}`
                : 'page-panel'
            }
          >
            {accountPage && (
              <TextLink
                className="back-link"
                href={readingsPath}
                aria-disabled={busy || undefined}
                onClick={backToReadings}
              >
                <Icon name="chevron" />
                Back to readings
              </TextLink>
            )}
            <div
              className={
                session && !kit && !grant && !accountPage
                  ? 'page-title sr-only workspace-title'
                  : 'page-title'
              }
            >
              <div className="title-copy">
                {deletionReceipt ? (
                  <h2>Account access</h2>
                ) : (
                  <h1 ref={heading} tabIndex={-1}>
                    {title}
                  </h1>
                )}
                {signInPage && !passwordScreen && !deletionReceipt && (
                  <p className="brand-promise">
                    Draw three tarot cards or bring your own spread. Save your reading and return
                    with a note.
                  </p>
                )}
                {(!session || kit || grant) && (
                  <p className="test-notice">{environmentNotice(runtimeMode, live)}</p>
                )}
                {kit && (
                  <p className="lead">
                    Your kit contains a recovery handle and ten one-time codes. You need the handle
                    and one unused code if you lose access to your account.
                  </p>
                )}
              </div>
              {kit && <Art name="study-perspective" className="title-art" />}
              {!kit && !grant && session && accountPage && (
                <Art
                  name="account-sprig"
                  mobileName="mobile-corner"
                  className="title-art account-title-art"
                />
              )}
            </div>
            <Notice message={message} />
            <div className="identity-content" aria-busy={busy || checking}>
              {checking && !session && !kit && !grant ? (
                <p role="status" className="busy-line">
                  <span className="spinner" aria-hidden="true" />
                  Checking your session…
                </p>
              ) : kit ? (
                <section aria-label="Recovery kit" className="kit-content">
                  <div className="card kit-card">
                    <p className="callout">
                      <Icon name="warning" />
                      <span>
                        Keep the complete file somewhere private, outside this browser. Anyone with
                        the handle and an unused code can replace your sign-in method. This kit is
                        shown only once.
                      </span>
                    </p>
                    <details>
                      <summary>Show handle and recovery codes</summary>
                      <p className="recovery-handle">
                        <strong>Recovery handle</strong>
                        <code>{kit.recoveryHandle}</code>
                      </p>
                      <ol className="codes">
                        {kit.codes.map((item) => (
                          <li key={item}>
                            <code>{item}</code>
                          </li>
                        ))}
                      </ol>
                    </details>
                    <div className="actions">
                      <Button type="button" onClick={download} disabled={busy}>
                        <Icon name="download" />
                        Download recovery kit
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async (isCurrent) => {
                            await navigator.clipboard.writeText(kitText(kit));
                            if (!isCurrent()) return;
                            setDownloaded(true);
                            setMessage({
                              tone: 'success',
                              text: 'Complete recovery kit copied. Store it somewhere private.',
                            });
                          })
                        }
                      >
                        <Icon name="copy" />
                        Copy complete kit
                      </Button>
                    </div>
                  </div>
                  <label className="check" htmlFor="check-acknowledged">
                    <Input
                      id="check-acknowledged"
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                    />
                    I have saved the complete kit with the handle and codes.
                  </label>
                  <Button
                    type="button"
                    className="large"
                    disabled={!downloaded || !acknowledged || busy || !session}
                    onClick={() =>
                      void run(async (isCurrent) => {
                        await api('/auth/recovery/ack', apiSchemas.Empty, {}, session?.csrfToken);
                        if (!isCurrent()) return;
                        const current = await readSession(isCurrent);
                        if (!isCurrent()) return;
                        setKit(null);
                        setSession(current);
                        channel.current?.postMessage('changed');
                      })
                    }
                  >
                    Continue
                  </Button>
                  <p className="muted">
                    The kit stays in memory here until you leave and is never saved automatically in
                    this browser.
                  </p>
                </section>
              ) : grant ? (
                <section className="replacement-content">
                  <p className="lead">
                    {grant.passwordEnabled
                      ? 'Set a new password or create a passkey to open your account again.'
                      : 'Your recovery code was verified. Create a new passkey to finish recovering your account.'}{' '}
                    This step expires after five minutes.
                  </p>
                  <p className="callout">
                    <Icon name="info" />
                    <span>
                      {grant.passwordEnabled
                        ? 'Either choice replaces your old password, passkeys and recovery kit. A new password works with your existing username and email.'
                        : 'Completing recovery replaces your previous passkeys and recovery kit.'}{' '}
                      Your readings stay in this account.
                    </span>
                  </p>
                  {grant.passwordEnabled && (
                    <PasswordOnlyForm
                      creating
                      busy={busy}
                      onSubmit={(password) =>
                        void run(async (isCurrent) => {
                          await complete(
                            await api('/auth/password/recover', apiSchemas.AuthResult, {
                              challengeId: grant.challengeId,
                              password,
                            }),
                            isCurrent,
                          );
                        })
                      }
                    />
                  )}
                  <Button
                    type="button"
                    variant={grant.passwordEnabled ? 'secondary' : 'primary'}
                    disabled={busy}
                    onClick={() =>
                      void run(async (isCurrent) => {
                        await complete(await enroll(grant.options), isCurrent);
                      })
                    }
                  >
                    <Icon name="key" />
                    Create replacement passkey
                  </Button>
                  <Button
                    type="button"
                    variant="text-button"
                    disabled={busy}
                    onClick={() => {
                      setGrant(null);
                      setMessage({
                        tone: 'notice',
                        text: 'Recovery cancelled. That code has been used. Sign in as usual or try another unused code.',
                      });
                    }}
                  >
                    Cancel recovery
                  </Button>
                </section>
              ) : session && accountPage ? (
                <section className="account-content">
                  <section className="consent" aria-label="AI reading permission">
                    <div className="consent-summary">
                      <div>
                        <h2>AI readings are {session.permission.modelAllowed ? 'on' : 'off'}</h2>
                        <p>
                          History, reopening, reflections, export and deletion remain available.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={
                          busy || checking || (live === null && !session.permission.modelAllowed)
                        }
                        onClick={permission}
                      >
                        {session.permission.modelAllowed
                          ? 'Turn off AI readings'
                          : 'Enable AI readings'}
                      </Button>
                    </div>
                    <div className="consent-disclosures">
                      <p>{READING_PRODUCT_COPY.aiPermission}</p>
                      <p>
                        {live === null
                          ? 'The reading service is unavailable. Check the connection before enabling AI.'
                          : live
                            ? SPREAD_PHOTO_COPY.liveProviderRetention
                            : READING_PRODUCT_COPY.providerRetention}
                      </p>
                      {connectionRetry}
                    </div>
                  </section>
                  <section className="account-tool-group" aria-labelledby="account-password-title">
                    <h2 id="account-password-title">Password sign-in</h2>
                    {session.passwordEnabled ? (
                      <p>
                        You can sign in with your username or email. If you forget your password,
                        use your saved recovery kit.
                      </p>
                    ) : (
                      <details>
                        <summary>Add password sign-in</summary>
                        <p>
                          Choose a username, email and password for this account. You’ll confirm
                          with your passkey.
                        </p>
                        <PasswordSetupForm
                          busy={busy}
                          submitLabel="Save password sign-in"
                          onSubmit={(input) =>
                            void run(async (isCurrent) => {
                              const csrf = await verifyIdentity(isCurrent, true);
                              if (!csrf) return;
                              await complete(
                                await api(
                                  '/auth/password/enroll',
                                  apiSchemas.AuthResult,
                                  input,
                                  csrf,
                                ),
                                isCurrent,
                              );
                              if (!isCurrent()) return;
                              channel.current?.postMessage('changed');
                              setMessage({
                                tone: 'success',
                                text: 'Password sign-in added. You can use either your username or your email.',
                              });
                            })
                          }
                        />
                      </details>
                    )}
                  </section>
                  <section className="card passkeys-card" aria-label="Manage passkeys">
                    <h2>Your passkeys</h2>
                    <p>
                      {session.passwordEnabled && credentials?.items.length === 0
                        ? 'Add a passkey to sign in with your device. You’ll confirm your password first.'
                        : 'Add a passkey on another device before removing one. You’ll verify an existing passkey before each change.'}{' '}
                      Changing passkeys signs out your other sessions.
                    </p>
                    {credentials ? (
                      <ul aria-label="Passkeys">
                        {credentials.items.map((credential) => (
                          <li key={credential.id}>
                            <span className="passkey-icon">
                              <Icon name="key" />
                            </span>
                            <p>
                              <strong>Passkey {credential.id.slice(0, 8)}</strong>
                              <span className="passkey-detail">
                                Added {date(credential.createdAt, true)}
                              </span>
                              <span className="passkey-detail">
                                {credential.backedUp
                                  ? 'Backed up by your passkey provider'
                                  : 'Not reported as backed up'}
                              </span>
                            </p>
                            <Button
                              type="button"
                              className="text-button remove-passkey"
                              disabled={busy || checking || credentials.items.length <= 1}
                              aria-label={`Remove passkey ${credential.id.slice(0, 8)}`}
                              onClick={() =>
                                void run(async (isCurrent) => {
                                  const csrf = await verifyIdentity(isCurrent, true);
                                  if (!csrf || !isCurrent()) return;
                                  await api(
                                    `/auth/credentials/${credential.id}`,
                                    apiSchemas.Empty,
                                    {},
                                    csrf,
                                    { method: 'DELETE' },
                                  );
                                  if (!isCurrent()) return;
                                  const current = await readSession(isCurrent);
                                  if (!isCurrent()) return;
                                  setSession(current);
                                  channel.current?.postMessage('changed');
                                  setMessage({
                                    tone: 'success',
                                    text: 'Passkey removed. Your other sessions have been signed out.',
                                  });
                                })
                              }
                            >
                              Remove
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p role="status" className="busy-line">
                        <span className="spinner" aria-hidden="true" />
                        Loading your passkeys…
                      </p>
                    )}
                    {credentials?.items.length === 1 && (
                      <p>Keep at least one passkey on your account.</p>
                    )}
                    <Button
                      type="button"
                      className="add-passkey"
                      disabled={busy || checking || !credentials || credentials.items.length >= 10}
                      onClick={() =>
                        void run(async (isCurrent) => {
                          const csrf = await verifyIdentity(
                            isCurrent,
                            Boolean(credentials?.items.length),
                          );
                          if (!csrf || !isCurrent()) return;
                          const options = await api(
                            '/auth/options',
                            apiSchemas.AuthOptions,
                            { purpose: 'add' },
                            csrf,
                          );
                          if (!isCurrent()) return;
                          await complete(await enroll(options, csrf), isCurrent);
                          if (!isCurrent()) return;
                          channel.current?.postMessage('changed');
                          setMessage({
                            tone: 'success',
                            text: 'Passkey added. Your other sessions have been signed out.',
                          });
                        })
                      }
                    >
                      <Icon name="add" />
                      Add a passkey
                    </Button>
                    {credentials?.items.length === 10 && (
                      <p>You have ten passkeys. Remove one before adding another.</p>
                    )}
                  </section>
                  <section className="account-tool-group" aria-labelledby="account-tools-title">
                    <h2 id="account-tools-title">Account tools</h2>
                    <ImportRecords
                      key={session.subjectId}
                      owner={session.subjectId}
                      csrf={session.csrfToken}
                      onExpired={expire}
                      onRestoreProfile={(birth) => {
                        setPatternRestore(birth);
                        setReadingResume(null);
                        show('/astrology/pattern');
                      }}
                    />
                    <div className="account-tools">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={exportRecords}
                      >
                        <Icon name="download" />
                        Export my records
                        <Icon name="chevron" className="account-tool-chevron" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async (isCurrent) => {
                            const csrf = await verifyIdentity(isCurrent);
                            if (!csrf || !isCurrent()) return;
                            const rotated = await api(
                              '/auth/recovery-codes',
                              apiSchemas.RecoveryCodes,
                              {},
                              csrf,
                            );
                            if (!isCurrent()) return;
                            receiveKit(rotated);
                            const current = await readSession(isCurrent);
                            if (!isCurrent()) return;
                            setSession(current);
                            channel.current?.postMessage('changed');
                          })
                        }
                      >
                        <Icon name="lock" />
                        Replace recovery kit
                        <Icon name="chevron" className="account-tool-chevron" />
                      </Button>
                    </div>
                  </section>
                  <section
                    className="account-tool-group account-signout"
                    aria-labelledby="account-signout-title"
                  >
                    <h2 id="account-signout-title">Sign out</h2>
                    <div className="account-session-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async (isCurrent) => {
                            await api('/auth/logout', apiSchemas.Empty, {}, session.csrfToken);
                            if (!isCurrent()) return;
                            clear();
                            channel.current?.postMessage('signed-out');
                            show('/');
                          })
                        }
                      >
                        Sign out
                        <Icon name="chevron" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async (isCurrent) => {
                            await api('/auth/logout-all', apiSchemas.Empty, {}, session.csrfToken);
                            if (!isCurrent()) return;
                            clear();
                            channel.current?.postMessage('signed-out');
                            show('/');
                          })
                        }
                      >
                        Sign out of all devices
                        <Icon name="chevron" />
                      </Button>
                    </div>
                  </section>
                  <details className="deletion-actions">
                    <summary>
                      <span className="account-delete-label">
                        <Icon name="delete" />
                        Delete account
                      </span>
                    </summary>
                    <p>
                      This permanently deletes your account, readings, reflections and passkeys.
                      Your recovery kit will no longer restore this account. Downloaded copies are
                      unchanged.
                    </p>
                    <label className="check" htmlFor="check-accountDeleteChecked">
                      <Input
                        id="check-accountDeleteChecked"
                        type="checkbox"
                        checked={accountDeleteChecked}
                        onChange={(event) => setAccountDeleteChecked(event.target.checked)}
                        disabled={busy}
                      />
                      Permanently delete my account, readings and reflections
                    </label>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={busy || !accountDeleteChecked}
                      aria-describedby={accountDeleteChecked ? undefined : 'account-delete-hint'}
                      onClick={() =>
                        void run(async (isCurrent) => {
                          let csrf = session.csrfToken;
                          if (Date.parse(session.recentAuthUntil) <= Date.now()) {
                            const verifiedCsrf = await verifyIdentity(isCurrent);
                            if (!verifiedCsrf) return;
                            csrf = verifiedCsrf;
                          }
                          const intent = deletionIntent(),
                            proof = {
                              receiptId: intent.receiptId,
                              receiptToken: intent.receiptToken,
                            };
                          let initial: z.infer<typeof apiSchemas.DeletionStatus> | null = null;
                          try {
                            const receipt = await api(
                              '/account',
                              apiSchemas.DeletionReceipt,
                              proof,
                              csrf,
                              { method: 'DELETE', key: intent.key },
                            );
                            initial = {
                              state: receipt.state,
                              backupExpiresBy: receipt.backupExpiresBy,
                            };
                          } catch (error) {
                            // A network/5xx failure may follow the access fence; retain the scoped receipt.
                            if (error instanceof ApiFailure && error.status < 500) throw error;
                          }
                          if (!isCurrent()) return;
                          clear();
                          setDeletionReceipt({ proof, initial });
                          channel.current?.postMessage('signed-out');
                          navigate('/');
                        })
                      }
                    >
                      Delete account permanently
                    </Button>
                    <ConfirmationHint id="account-delete-hint" show={!accountDeleteChecked} />
                  </details>
                  <p className="account-storage">
                    <Icon name="lock" />
                    <span>{READING_PRODUCT_COPY.serviceStorage}</span>
                  </p>
                </section>
              ) : session && route !== signInPath ? (
                <div inert={checking || busy}>
                  <ReadingWorkspace
                    ref={workspace}
                    resume={readingResume}
                    restoredBirth={patternRestore}
                    onRestoreConsumed={() => setPatternRestore(null)}
                    live={live}
                    runtimeMode={runtimeMode}
                    patternReady={patternReady}
                    connectionRetry={connectionRetry}
                    key={session.subjectId}
                    user={session}
                    onSession={setSession}
                    onExpired={expire}
                    onAccount={openAccount}
                  />
                </div>
              ) : route === '/recover' ? (
                <form
                  className="recovery-form"
                  autoComplete="off"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async (isCurrent) => {
                      const recovered = await api('/auth/recover', apiSchemas.RecoveryGrant, {
                        recoveryHandle: handle.trim(),
                        code: code.trim(),
                      });
                      if (!isCurrent()) return;
                      setGrant(recovered);
                      setHandle('');
                      setCode('');
                    });
                  }}
                >
                  <p className="lead">
                    Open the recovery kit you saved. Enter its handle and one unused code. A code
                    alone cannot identify your account.
                  </p>
                  <label htmlFor="recovery-handle">Recovery handle</label>
                  <Input
                    id="recovery-handle"
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="none"
                    required
                    maxLength={100}
                    disabled={busy}
                  />
                  <label htmlFor="recovery-code">Unused recovery code</label>
                  <Input
                    id="recovery-code"
                    type="password"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoComplete="off"
                    required
                    maxLength={100}
                    disabled={busy}
                  />
                  <Button type="submit" disabled={busy || !handle.trim() || !code.trim()}>
                    Verify recovery kit
                  </Button>
                  <p className="muted recovery-note">
                    Once verified, you can replace your passkey or reset a password you previously
                    set up. If the connection is interrupted, try another unused code.
                  </p>
                  <TextLink href={signInPath} onClick={backToSignIn}>
                    Back to sign in
                  </TextLink>
                </form>
              ) : passwordScreen ? (
                <section className="password-entry">
                  {passwordScreen === 'login' ? (
                    <PasswordLoginForm
                      busy={busy}
                      onLogin={(input) =>
                        void run(async (isCurrent) => {
                          await complete(
                            await api('/auth/password/login', apiSchemas.AuthResult, input),
                            isCurrent,
                          );
                        })
                      }
                    />
                  ) : (
                    <>
                      <p>
                        Choose a username and enter your email. Either one will work when you sign
                        in.
                      </p>
                      <PasswordSetupForm
                        busy={busy}
                        submitLabel="Create account"
                        onSubmit={(input) =>
                          void run(async (isCurrent) => {
                            await complete(
                              await api('/auth/password/register', apiSchemas.AuthResult, input),
                              isCurrent,
                            );
                          })
                        }
                      />
                    </>
                  )}
                  <div className="password-links">
                    {passwordScreen === 'login' && (
                      <TextLink href="/recover">Forgot your password?</TextLink>
                    )}
                    <Button
                      variant="text-button"
                      disabled={busy}
                      onClick={() =>
                        choosePasswordScreen(passwordScreen === 'login' ? 'register' : 'login')
                      }
                    >
                      {passwordScreen === 'login'
                        ? 'Create a password account'
                        : 'I already have an account'}
                    </Button>
                    <Button
                      variant="text-button"
                      disabled={busy}
                      onClick={() => choosePasswordScreen(null)}
                    >
                      Back to sign-in options
                    </Button>
                  </div>
                </section>
              ) : (
                <section className="sign-in-content">
                  <div className="actions">
                    <Button disabled={busy} onClick={() => choosePasswordScreen('login')}>
                      Sign in with a password
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async (isCurrent) => {
                          await complete(await signIn('authenticate'), isCurrent);
                        })
                      }
                    >
                      <Icon name="key" />
                      Sign in with a passkey
                    </Button>
                  </div>
                  <fieldset
                    className="signup-options"
                    tabIndex={-1}
                    ref={(group) => {
                      if (!group || !signupFocus.current) return;
                      signupFocus.current = false;
                      group.focus();
                    }}
                  >
                    <legend>
                      <h2>New to Reflection?</h2>
                    </legend>
                    <Button
                      variant="text-button"
                      disabled={busy}
                      onClick={() => choosePasswordScreen('register')}
                    >
                      Create a password account
                    </Button>
                    <Button
                      variant="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async (isCurrent) => {
                          const options = await api('/auth/options', apiSchemas.AuthOptions, {
                            purpose: 'register',
                          });
                          await complete(await enroll(options), isCurrent);
                        })
                      }
                    >
                      {live === false ? 'Create a test account' : 'Create an account'} with a
                      passkey
                    </Button>
                    <p className="field-hint">
                      A passkey lets you join without an email address or password.
                    </p>
                  </fieldset>
                  <TextLink href="/recover">Recover with your saved kit</TextLink>
                </section>
              )}
              {busy && (
                <p role="status" className="busy-line">
                  <span className="spinner" aria-hidden="true" />
                  Completing your account action…
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
