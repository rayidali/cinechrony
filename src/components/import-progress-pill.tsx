'use client';

import { useEffect, useRef } from 'react';
import { Loader2, Check, Film } from 'lucide-react';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { importStore, useImportStore, formatEta } from '@/lib/import-store';

/**
 * Global Letterboxd-import progress pill — Phase 0.7 Wave 7. The background face
 * of the import store: once the user taps "continue in the app", the import keeps
 * running and this slim pill rides above the tab bar with LIVE, specific feedback
 * — "N found" while scraping, "N / total · ~Xs left" while importing, then a
 * confirmed done state — instead of an opaque bar. It also RESUMES an import
 * interrupted by an app kill (re-fetches the finished Apify dataset; idempotent
 * writes), and re-resumes when the app returns to the foreground (iOS suspends
 * JS timers while backgrounded). Renders nothing while the dedicated importing
 * screen is foreground, or when idle. Mounted once in the root layout.
 */
export function ImportProgressPill() {
  const { user } = useUser();
  const s = useImportStore();
  const { toast } = useToast();
  const toastedRef = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Resume an interrupted import: on first authenticated boot AND whenever the
  // app returns to the foreground (Capacitor suspends timers in the background).
  useEffect(() => {
    if (!user) return;
    importStore.resumeIfPending();
    const onResume = () => importStore.resumeIfPending();
    const onVis = () => {
      if (document.visibilityState === 'visible') onResume();
    };
    document.addEventListener('visibilitychange', onVis);
    let removeNative: (() => void) | undefined;
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('resume', onResume);
        removeNative = () => void handle.remove();
      } catch {
        /* plugin unavailable on web — visibilitychange covers it */
      }
    })();
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      removeNative?.();
    };
  }, [user]);

  // On background completion: toast once, then auto-dismiss the pill.
  useEffect(() => {
    if (s.phase === 'done' && s.active && s.completedBackground && !s.foreground && !toastedRef.current) {
      toastedRef.current = true;
      if (s.stats.films > 0) {
        toast({
          title: 'your library is in',
          description: `imported ${s.stats.films.toLocaleString('en-US')} films${
            s.reviewsPending ? ' · reviews are syncing' : ''
          }.`,
        });
      }
      hideTimer.current = setTimeout(() => importStore.dismiss(), 4500);
    }
    return () => clearTimeout(hideTimer.current);
  }, [s.phase, s.active, s.foreground, s.completedBackground, s.stats.films, s.reviewsPending, toast]);

  if (!s.active || s.foreground || s.phase === 'idle' || s.phase === 'failed') return null;
  if (s.phase === 'done' && !s.completedBackground) return null;

  const done = s.phase === 'done';
  const scraping = s.phase === 'scraping';
  const eta = formatEta(s.etaMs);
  const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;

  const title = done
    ? `imported ${s.stats.films.toLocaleString('en-US')} films`
    : scraping
      ? 'finding your films'
      : 'importing your library';
  const sub = done
    ? s.reviewsPending
      ? 'reviews syncing in the background'
      : 'all set'
    : scraping
      ? s.found > 0
        ? `${s.found.toLocaleString('en-US')} found so far`
        : 'reaching letterboxd…'
      : `${s.done.toLocaleString('en-US')} of ${s.total.toLocaleString('en-US')}${eta ? ` · ${eta}` : ''}`;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 84px)' }}
    >
      <div className="cc-pill-in pointer-events-auto flex w-full max-w-[340px] items-center gap-3 rounded-[18px] border border-hair bg-card/95 px-3.5 py-3 shadow-lift backdrop-blur-xl">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
          {done ? (
            <Check className="h-[18px] w-[18px] text-success" strokeWidth={3} />
          ) : scraping ? (
            <Film className="h-[17px] w-[17px]" />
          ) : (
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="truncate font-ui text-[14px] font-semibold leading-tight text-foreground">{title}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] leading-tight text-muted-foreground">{sub}</div>
          {!done && (
            <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-foreground/10">
              <div
                className={
                  scraping
                    ? 'cc-shimmer h-full w-1/3 rounded-full bg-primary/40'
                    : 'h-full rounded-full bg-primary transition-all duration-500'
                }
                style={scraping ? undefined : { width: `${Math.max(pct, 4)}%` }}
              />
            </div>
          )}
        </div>

        {!done && !scraping && (
          <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-primary">{pct}%</span>
        )}
      </div>
    </div>
  );
}
