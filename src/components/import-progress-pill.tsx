'use client';

import { useEffect, useRef } from 'react';
import { Loader2, Check } from 'lucide-react';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { importStore, useImportStore, formatEta } from '@/lib/import-store';

/**
 * Global Letterboxd-import progress pill — Phase 0.7 Wave 7. The background face
 * of the import store: once the user taps "continue in the app", the import keeps
 * running and this slim pill rides above the tab bar showing live progress, then
 * confirms completion and quietly fades. It also RESUMES an import interrupted by
 * an app kill (re-fetches the finished Apify dataset; idempotent writes). Renders
 * nothing while the dedicated importing screen is foreground, or when idle.
 * Mounted once in the root layout.
 */
export function ImportProgressPill() {
  const { user } = useUser();
  const s = useImportStore();
  const { toast } = useToast();
  const toastedRef = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Resume an interrupted import on first authenticated boot.
  useEffect(() => {
    if (user) importStore.resumeIfPending();
  }, [user]);

  // On completion (while backgrounded): toast once, then auto-dismiss the pill.
  useEffect(() => {
    if (s.phase === 'done' && s.active && s.completedBackground && !s.foreground && !toastedRef.current) {
      toastedRef.current = true;
      if (s.stats.films > 0) {
        toast({
          title: 'your library is in',
          description: `imported ${s.stats.films.toLocaleString('en-US')} films${
            s.reviewsPending ? ' · reviews syncing' : ''
          }.`,
        });
      }
      hideTimer.current = setTimeout(() => importStore.dismiss(), 4000);
    }
    return () => clearTimeout(hideTimer.current);
  }, [s.phase, s.active, s.foreground, s.completedBackground, s.stats.films, s.reviewsPending, toast]);

  // Only the BACKGROUND-completed case shows the pill's done state; a foreground
  // finish is celebrated by the importing screen's own reveal.
  if (!s.active || s.foreground || s.phase === 'idle' || s.phase === 'failed') return null;
  if (s.phase === 'done' && !s.completedBackground) return null;

  const done = s.phase === 'done';
  const eta = formatEta(s.etaMs);
  const label = done
    ? `imported ${s.stats.films.toLocaleString('en-US')} films`
    : s.phase === 'scraping'
      ? 'finding your films…'
      : `importing ${s.done.toLocaleString('en-US')} / ${s.total.toLocaleString('en-US')}`;
  const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[92px] z-[60] flex justify-center px-4 pb-safe">
      <div className="pointer-events-auto flex w-full max-w-[320px] items-center gap-3 rounded-full border border-hair bg-card/95 px-4 py-2.5 shadow-lift backdrop-blur-xl">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
          {done ? (
            <Check className="h-4 w-4 text-success" strokeWidth={3} />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-ui text-[13px] font-semibold text-foreground">{label}</div>
          {!done && (
            <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${s.phase === 'importing' ? Math.max(pct, 4) : 8}%` }}
              />
            </div>
          )}
        </div>
        {!done && eta && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {eta}
          </span>
        )}
      </div>
    </div>
  );
}
