'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import { CtaButton } from '@/components/v3/onboarding-kit';
import { importStore, useImportStore, formatEta } from '@/lib/import-store';

const WALL_SLOTS = 25;

/** Eases a displayed number toward a target — counters never just snap. */
function useCountUp(target: number, ms = 750): number {
  const [display, setDisplay] = useState(0);
  const ref = useRef({ start: 0, from: 0, raf: 0 });
  useEffect(() => {
    ref.current.from = display;
    ref.current.start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - ref.current.start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(ref.current.from + (target - ref.current.from) * eased));
      if (t < 1) ref.current.raf = requestAnimationFrame(step);
    };
    cancelAnimationFrame(ref.current.raf);
    ref.current.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(ref.current.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return display;
}

const STATUS_LINES = [
  'reaching letterboxd…',
  'reading your diary…',
  'dusting off your five-star nights…',
  'cross-referencing the canon…',
  'almost in…',
];

/**
 * Importing-films — Phase 0.7 Wave 7. A VIEW of the background import store (the
 * import itself lives in `import-store.ts` so it survives navigation). The wait,
 * made lovable: real posters spring into a building wall, counters tick up, an
 * accurate ETA, then a stat reveal. After a few seconds the user can tap
 * "continue in the app" — the import keeps going in the background (global pill).
 * Reviews sync in the background after onboarding (the browser actor is slow).
 */
export function ImportingStep({
  lbUsername,
  onProceed,
  onSkip,
}: {
  lbUsername: string;
  onProceed: (importedCount: number) => void;
  onSkip: () => void;
}) {
  const s = useImportStore();
  const [canBackground, setCanBackground] = useState(false);
  const proceededRef = useRef(false);

  // Start the import + mark this screen foreground while mounted.
  useEffect(() => {
    importStore.setForeground(true);
    importStore.start(lbUsername);
    return () => importStore.setForeground(false);
  }, [lbUsername]);

  // Offer "continue in the app" once there's enough on screen not to feel empty.
  useEffect(() => {
    const t = setTimeout(() => setCanBackground(true), 9000);
    return () => clearTimeout(t);
  }, []);

  // When the import finishes while the user is watching: hold the reveal, then go.
  useEffect(() => {
    if (s.phase !== 'done' || proceededRef.current) return;
    haptic('success');
    const t = setTimeout(() => {
      proceededRef.current = true;
      onProceed(s.stats.films);
    }, 2600);
    return () => clearTimeout(t);
  }, [s.phase, s.stats.films, onProceed]);

  const proceed = (count: number) => {
    if (proceededRef.current) return;
    proceededRef.current = true;
    importStore.setForeground(false); // hand off to the global pill
    onProceed(count);
  };

  const counter = useCountUp(s.phase === 'scraping' ? s.found : s.phase === 'importing' ? s.done : s.total);
  const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
  const eta = formatEta(s.etaMs);
  const [statusLine, setStatusLine] = useState(0);
  useEffect(() => {
    if (s.phase !== 'scraping') return;
    const t = setInterval(() => setStatusLine((i) => (i + 1) % STATUS_LINES.length), 2600);
    return () => clearInterval(t);
  }, [s.phase]);

  const slotCount = WALL_SLOTS;

  if (s.phase === 'failed') {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-8 text-center text-foreground">
        <img
          src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png"
          alt=""
          className="mb-7 h-20 w-20 rounded-[22px]"
        />
        <h1
          className="font-headline text-[26px] font-bold lowercase tracking-[-0.02em]"
          style={{ fontVariationSettings: '"wdth" 95' }}
        >
          couldn&apos;t finish the import
        </h1>
        <p className="mt-2.5 max-w-[18rem] font-serif text-[15px] font-light italic text-muted-foreground">
          letterboxd can be slow behind its bot wall. give it another go, or skip and
          start fresh — nothing&apos;s lost.
        </p>
        <div className="mt-8 w-full max-w-[20rem] space-y-1.5">
          <CtaButton label="try again" onClick={() => importStore.retry()} />
          <button
            onClick={() => {
              haptic('light');
              importStore.dismiss();
              onSkip();
            }}
            className="w-full py-3 text-center font-ui text-[15px] font-semibold text-muted-foreground transition-opacity active:opacity-60"
          >
            skip for now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-background px-6 text-center text-foreground">
      {/* the building poster wall */}
      <div className="grid w-full max-w-[290px] gap-[7px]" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {Array.from({ length: slotCount }).map((_, i) => {
          const url = s.posters[i];
          return (
            <div key={i} className="relative aspect-[2/3] overflow-hidden rounded-[7px] bg-muted">
              {url ? (
                <img
                  src={url}
                  alt=""
                  className="cc-poster-pop h-full w-full object-cover"
                  loading="eager"
                  onError={(e) => (e.currentTarget.style.opacity = '0')}
                />
              ) : (
                <div className="cc-shimmer h-full w-full" />
              )}
            </div>
          );
        })}
      </div>

      {s.phase === 'done' ? (
        <div className="mt-9">
          <h1
            className="font-headline text-[27px] font-bold lowercase tracking-[-0.02em]"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            your cinema, imported
          </h1>
          <div className="mt-5 flex items-stretch justify-center gap-3">
            <RevealStat value={s.stats.films} label="films" />
            <RevealStat value={s.stats.ratings} label="ratings" />
            <RevealStat value={s.stats.lists} label="lists" />
          </div>
          {lbUsername && (
            <p className="mt-5 font-ui text-[13px] text-muted-foreground">
              + your reviews are syncing in the background
            </p>
          )}
        </div>
      ) : (
        <div className="mt-9">
          <h1
            className="font-headline text-[27px] font-bold lowercase tracking-[-0.02em]"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            {s.phase === 'scraping' ? 'finding your films' : 'building your library'}
          </h1>

          <div
            className="mt-3 font-headline text-[52px] font-bold leading-none tabular-nums tracking-[-0.03em] text-primary"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            {counter.toLocaleString('en-US')}
            {s.phase === 'importing' && (
              <span className="text-foreground/30">/{s.total.toLocaleString('en-US')}</span>
            )}
          </div>
          <div className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {s.phase === 'scraping' ? 'films found' : 'films imported'}
          </div>

          {s.phase === 'importing' && (
            <>
              <div className="mx-auto mt-5 h-[6px] w-[220px] overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.max(pct, 3)}%` }}
                />
              </div>
              <p className="mt-3 h-4 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {eta ?? 'matching to our library…'}
              </p>
            </>
          )}
          {s.phase === 'scraping' && (
            <p className="mt-5 h-4 font-serif text-[14px] font-light italic text-muted-foreground">
              {STATUS_LINES[statusLine]}
            </p>
          )}

          {/* continue in the app — import keeps running in the background */}
          {canBackground && (
            <button
              onClick={() => {
                haptic('light');
                proceed(s.done);
              }}
              className="mx-auto mt-8 flex items-center gap-1.5 font-ui text-[14px] font-semibold text-primary transition-opacity active:opacity-60"
            >
              continue in the app
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RevealStat({ value, label }: { value: number; label: string }) {
  const n = useCountUp(value, 900);
  return (
    <div className="min-w-[74px] rounded-[16px] border border-hair bg-card px-4 py-3.5 shadow-press">
      <div
        className="font-headline text-[26px] font-bold leading-none tabular-nums text-foreground"
        style={{ fontVariationSettings: '"wdth" 95' }}
      >
        {n.toLocaleString('en-US')}
      </div>
      <div className="mt-1.5 flex items-center justify-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Check className="h-[11px] w-[11px] text-success" strokeWidth={3} />
        {label}
      </div>
    </div>
  );
}
