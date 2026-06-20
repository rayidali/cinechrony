'use client';

import { useEffect, useRef } from 'react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';

const FLAG = 'cc-pending-reviews';
const RETRY_MS = 30_000;
const MAX_TRIES = 12; // ~6 min of polling per app session; flag persists across sessions

/**
 * Finishes the BACKGROUND Letterboxd reviews import after onboarding (Phase 0.7
 * Wave 7). The reviews browser-actor run is minutes-slow, so it's never part of
 * the onboarding wait — the importing screen sets a device flag, and this
 * mount-once component polls `/imports/letterboxd/reviews/sync` until the run
 * lands, then quietly toasts. No-op (and zero network) unless the flag is set, so
 * it costs nothing for everyone else. Mounted in the root layout.
 */
export function PendingImportSync() {
  const { user } = useUser();
  const { toast } = useToast();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!user || startedRef.current) return;
    let flag: string | null = null;
    try {
      flag = localStorage.getItem(FLAG);
    } catch {
      /* storage blocked */
    }
    if (flag !== '1') return;
    startedRef.current = true;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    const clearFlag = () => {
      try {
        localStorage.removeItem(FLAG);
      } catch {
        /* ignore */
      }
    };

    const poll = async () => {
      if (cancelled) return;
      tries++;
      try {
        const r = await apiCall<{ status: string; reviewsImported?: number }>(
          'POST',
          '/api/v1/imports/letterboxd/reviews/sync',
        );
        if (r.status === 'running') {
          if (tries < MAX_TRIES) timer = setTimeout(poll, RETRY_MS); // else leave flag for next session
          return;
        }
        clearFlag();
        if (r.status === 'done' && (r.reviewsImported ?? 0) > 0) {
          toast({
            title: 'your letterboxd reviews are in',
            description: `imported ${r.reviewsImported!.toLocaleString('en-US')} reviews.`,
          });
        }
      } catch {
        if (tries < 3) timer = setTimeout(poll, RETRY_MS); // transient — a couple of retries
      }
    };

    timer = setTimeout(poll, 4000); // let first paint settle
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, toast]);

  return null;
}
