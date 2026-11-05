import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure } from '../api.ts';
import type { NoticeMessage } from '../notice.tsx';

export function useAstrologyAction(onExpired: () => void) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<NoticeMessage | null>(null);
  const sequence = useRef(0),
    alive = useRef(true),
    running = useRef(false),
    expired = useRef(onExpired);
  expired.current = onExpired;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
      running.current = false;
    };
  }, []);
  const run = useCallback(async (work: (current: () => boolean) => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    const operation = ++sequence.current;
    const current = () => alive.current && operation === sequence.current;
    setBusy(true);
    setNotice(null);
    try {
      await work(current);
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiFailure && error.status === 401) {
        expired.current();
        return;
      }
      const text =
        error instanceof ApiFailure
          ? error.code === 'QUOTA_EXCEEDED'
            ? 'You have reached today’s chart calculation limit. Your draft is still here. Try again tomorrow.'
            : error.code === 'STORAGE_LIMIT_EXCEEDED'
              ? 'Your account is full. Your draft is still here. Free some space in your journal before saving.'
              : error.status === 410
                ? 'This chart content is unavailable. Your draft is still here, and saved writing remains in your journal.'
                : error.status === 403
                  ? 'This action needs your recovery kit acknowledgement or current account permission. Your draft is still here.'
                  : 'This action could not be completed. Your draft is still here. Please try again.'
          : 'The connection was interrupted. Your draft is still here. Please try again.';
      setNotice({ tone: 'error', text });
    } finally {
      if (current()) {
        running.current = false;
        setBusy(false);
      }
    }
  }, []);
  return { busy, notice, setNotice, run };
}
