import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiSchemas } from '../contracts/index.ts';
import { api, ApiFailure } from './api.ts';
import { date } from './date.ts';
import {
  checkDeletionStatus,
  deletionIntent,
  downloadDeletionReceipt,
  type DeletionProof,
  type DeletionStatus,
} from './deletion.tsx';
import { Button } from './design/components.tsx';
import { Icon } from './icon.tsx';
import { Notice } from './notice.tsx';

export type ReadingDeletionTarget = {
  path: string;
  revision: number;
  question: string;
  createdAt: string;
  scope: 'family' | 'imported-edition';
};
type Phase = 'confirm' | 'deleting' | 'checking' | 'pending' | 'unconfirmed' | 'failed';

export function ReadingDeletion({
  target,
  csrfToken,
  onKeep,
  onConflict,
  onComplete,
}: {
  target: ReadingDeletionTarget;
  csrfToken: string;
  onKeep: () => void;
  onConflict: () => void;
  onComplete: (proof: DeletionProof, status: DeletionStatus) => void;
}) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const intent = useRef<ReturnType<typeof deletionIntent> | null>(null);
  const alive = useRef(true),
    inFlight = useRef(false),
    accepted = useRef(false),
    uncertain = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null),
    keepReading = useRef<HTMLButtonElement>(null);
  const busy = phase === 'deleting' || phase === 'checking';
  const canKeep = phase === 'confirm' || phase === 'failed';
  const single = target.scope === 'imported-edition';
  const scope = single
    ? 'This imported edition and its retained private copies will be permanently deleted.'
    : 'This permanently deletes the reading, its reflections, dated revisit notes and all of its follow-ups. Retained excerpts are erased.';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (phase === 'confirm') keepReading.current?.focus();
    else heading.current?.focus();
  }, [phase]);
  useEffect(() => {
    if (!canKeep) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inFlight.current) {
        event.preventDefault();
        onKeep();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [canKeep, onKeep]);

  const receive = (status: DeletionStatus) => {
    if (!alive.current) return;
    accepted.current = true;
    if (status.state === 'complete') onComplete(intent.current!, status);
    else setPhase('pending');
  };
  const submit = async () => {
    intent.current ??= deletionIntent();
    const proof = intent.current;
    setPhase('deleting');
    try {
      const receipt = await api(
        target.path,
        apiSchemas.DeletionReceipt,
        { receiptId: proof.receiptId, receiptToken: proof.receiptToken },
        csrfToken,
        {
          method: 'DELETE',
          revision: target.revision,
          key: proof.key,
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (receipt.receiptId !== proof.receiptId || receipt.receiptToken !== proof.receiptToken)
        throw new Error('The deletion receipt did not match this request.');
      receive(receipt);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiFailure && error.code === 'CONFLICT') {
        onConflict();
        return;
      }
      // Only an explicit admission rejection establishes that it is safe to keep reading.
      if (
        !accepted.current &&
        !uncertain.current &&
        error instanceof ApiFailure &&
        ['BAD_INPUT', 'FORBIDDEN', 'RATE_LIMITED'].includes(error.code ?? '')
      ) {
        setPhase('failed');
      } else {
        uncertain.current = true;
        setPhase('unconfirmed');
      }
    }
  };
  const act = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (!intent.current) {
        await submit();
        return;
      }
      setPhase('checking');
      try {
        receive(await checkDeletionStatus(intent.current, AbortSignal.timeout(15_000)));
      } catch (error) {
        if (!alive.current) return;
        if (error instanceof ApiFailure && error.status === 404 && !accepted.current)
          await submit();
        else setPhase('unconfirmed');
      }
    } finally {
      inFlight.current = false;
    }
  };
  const title = {
    confirm: single ? 'Delete this imported edition?' : 'Delete this reading?',
    deleting: 'Deleting reading…',
    checking: 'Checking deletion…',
    pending: 'Deleting reading…',
    unconfirmed: 'Deletion not confirmed',
    failed: 'Reading not deleted',
  }[phase];

  return (
    <section className="card reading-deletion-flow" aria-labelledby="reading-deletion-heading">
      {phase === 'confirm' && <Icon name="warning" className="deletion-warning" />}
      <h2 id="reading-deletion-heading" ref={heading} tabIndex={-1}>
        {title}
      </h2>
      <div className="deletion-reading-summary">
        <time dateTime={target.createdAt}>{date(target.createdAt, true)}</time>
        <p className="deletion-question">{target.question}</p>
        <p className="muted">
          {single ? 'Selected imported edition' : 'Reading and all related writing'}
        </p>
      </div>
      {busy && (
        <Notice
          message={{
            title: phase === 'checking' ? 'Checking the same deletion.' : 'Deletion in progress.',
            text: 'Waiting for confirmation. Please wait. No need to submit again.',
            tone: 'notice',
          }}
        />
      )}
      {phase === 'pending' && (
        <Notice
          message={{
            title: 'Deletion has been accepted.',
            text: 'Access is blocked while deletion finishes. Check its status for confirmation.',
            tone: 'notice',
          }}
        />
      )}
      {phase === 'unconfirmed' && (
        <Notice
          message={{
            title: 'We could not confirm deletion.',
            text: 'The connection may have failed after deletion was accepted. Retry checks this same deletion before sending it again.',
            tone: 'error',
          }}
        />
      )}
      {phase === 'failed' && (
        <Notice
          message={{
            title: 'Deletion was not accepted.',
            text: 'This reading is still available. You can keep reading or retry deletion.',
            tone: 'error',
          }}
        />
      )}
      {(phase === 'confirm' || phase === 'failed') && <p>{scope} There is no undo.</p>}
      {single ? (
        <p className="muted">Its imported parent and your other saved readings stay saved.</p>
      ) : (
        <p className="muted">Your other saved readings stay saved.</p>
      )}
      <p className="muted">
        Backup copies expire separately. Your receipt will show the confirmed expiry date.
        Downloaded copies are unaffected.
      </p>
      <div className="deletion-flow-actions">
        {canKeep && (
          <Button
            ref={keepReading}
            onClick={() => {
              if (!inFlight.current) onKeep();
            }}
          >
            Keep reading
          </Button>
        )}
        <Button
          variant={canKeep ? 'danger' : 'secondary'}
          disabled={busy}
          onClick={() => void act()}
        >
          {busy && <span className="spinner" aria-hidden="true" />}
          {phase === 'confirm'
            ? 'Delete permanently'
            : busy
              ? title
              : phase === 'pending' || accepted.current
                ? 'Check deletion status'
                : 'Retry deletion'}
        </Button>
        {intent.current && !busy && !canKeep && (
          <Button variant="text-button" onClick={() => downloadDeletionReceipt(intent.current!)}>
            <Icon name="download" />
            Download deletion receipt
          </Button>
        )}
      </div>
      {canKeep && <p className="muted">Escape also keeps this reading.</p>}
      {intent.current && !busy && !canKeep && (
        <p className="muted">
          Keep your receipt to check status later. It stays in this page’s memory.
        </p>
      )}
    </section>
  );
}
