'use client';

import { useEffect, useRef } from 'react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';

const FLAG = 'cc-pending-reviews';
const POLL_MS = 20_000;
const MAX_WINDOW_MS = 22 * 60 * 1000; // reviews can take many minutes for big libraries

/**
 * Finishes the BACKGROUND Letterboxd reviews import after onboarding (Phase 0.7
 * Wave 7). The reviews browser-actor run is minutes-slow, so it's never part of
 * the onboarding wait — the import flags `cc-pending-reviews`, and this
 * mount-once component polls `/imports/letterboxd/reviews/sync` until the run
 * lands, then quietly toasts. Robust on iOS: Capacitor suspends JS timers in the
 * background, so we also re-kick polling whenever the app returns to the
 * foreground (Capacitor `resume` + `visibilitychange`). Zero network unless the
 * flag is set. Mounted in the root layout.
 *
 * Reviews are PER-USER (`lb_{uid}_{tmdbId}` docs), so re-importing the same
 * Letterboxd account into the same account is idempotent (no dupes), and a
 * different account imports its own copy — there is no cross-account dedup.
 */
export function PendingImportSync() {
  const { user } = useUser();
  const { toast } = useToast();
  const polling = useRef(false);
  const deadline = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!user) return;

    const hasFlag = () => {
      try {
        return localStorage.getItem(FLAG) === '1';
      } catch {
        return false;
      }
    };
    const clearFlag = () => {
      try {
        localStorage.removeItem(FLAG);
      } catch {
        /* ignore */
      }
    };

    const tick = async () => {
      if (polling.current || !hasFlag()) return;
      if (Date.now() > deadline.current) return; // out of window; a foreground event re-opens it
      polling.current = true;
      try {
        const r = await apiCall<{ status: string; reviewsImported?: number }>(
          'POST',
          '/api/v1/imports/letterboxd/reviews/sync',
        );
        if (r.status === 'running') {
          timer.current = setTimeout(tick, POLL_MS);
        } else {
          clearFlag();
          if (r.status === 'done' && (r.reviewsImported ?? 0) > 0) {
            toast({
              title: 'your letterboxd reviews are in',
              description: `imported ${r.reviewsImported!.toLocaleString('en-US')} reviews.`,
            });
          }
        }
      } catch {
        // transient — retry within the window
        timer.current = setTimeout(tick, POLL_MS);
      } finally {
        polling.current = false;
      }
    };

    const kick = () => {
      if (!hasFlag()) return;
      // (Re)open the polling window — a fresh foreground gives reviews more time.
      deadline.current = Date.now() + MAX_WINDOW_MS;
      clearTimeout(timer.current);
      timer.current = setTimeout(tick, 3000);
    };

    kick();

    const onVis = () => {
      if (document.visibilityState === 'visible') kick();
    };
    document.addEventListener('visibilitychange', onVis);
    let removeNative: (() => void) | undefined;
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('resume', kick);
        removeNative = () => void handle.remove();
      } catch {
        /* web — visibilitychange covers it */
      }
    })();

    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVis);
      removeNative?.();
    };
  }, [user, toast]);

  return null;
}
