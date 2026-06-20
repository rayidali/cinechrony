'use client';

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { CtaButton } from '@/components/v3/onboarding-kit';

const CHUNK = 120;
const POLL_MS = 4000;
const MAX_POLLS = 95;
const WALL_SLOTS = 25; // 5×5 poster wall
const POSTER_CAP = 25;

type ImportFilm = { name: string; year: string; status: string; rating: number | null; review: string | null };
type Library = {
  films: ImportFilm[];
  lists: Array<{ name: string; description?: string; movies: Array<{ name: string; year: string }> }>;
  favorites: Array<{ name: string; year: string }>;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Eases a displayed number toward a target — the counters never just snap. */
function useCountUp(target: number, ms = 750): number {
  const [display, setDisplay] = useState(0);
  const ref = useRef({ start: 0, raf: 0 });
  useEffect(() => {
    const from = display;
    ref.current.start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - ref.current.start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (target - from) * eased));
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
 * Importing-films — Phase 0.7 Wave 7. The wait, made lovable: the user literally
 * watches their library assemble — real posters spring into a building wall, a
 * counter ticks up, milestones check off, then a stat reveal lands. Underneath
 * it's the async + chunked pipeline (never blows a function budget). Reviews are
 * synced in the BACKGROUND after onboarding (the browser actor is minutes-slow),
 * so they're never part of the wait.
 */
export function ImportingStep({
  lbUsername,
  onDone,
  onSkip,
}: {
  lbUsername: string;
  onDone: (importedCount: number) => void;
  onSkip: () => void;
}) {
  const [phase, setPhase] = useState<'scraping' | 'importing' | 'reveal' | 'failed'>('scraping');
  const [found, setFound] = useState(0);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [posters, setPosters] = useState<string[]>([]);
  const [statusLine, setStatusLine] = useState(0);
  const [stats, setStats] = useState({ films: 0, ratings: 0, lists: 0, reviews: 0 });
  const startedRef = useRef(false);
  const cancelledRef = useRef(false);

  const addPosters = (urls: string[]) =>
    setPosters((prev) => (prev.length >= POSTER_CAP ? prev : [...prev, ...urls].slice(0, POSTER_CAP)));

  const run = async () => {
    cancelledRef.current = false;
    setPhase('scraping');
    setFound(0);
    setTotal(0);
    setDone(0);
    setPosters([]);
    try {
      const start = await apiCall<
        { available: false } | { available: true; runId: string; datasetId: string }
      >('POST', '/api/v1/imports/letterboxd/scrape/start', { username: lbUsername });
      if (!start.available) {
        onDone(0);
        return;
      }

      let library: Library | null = null;
      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_MS);
        if (cancelledRef.current) return;
        const s = await apiCall<{ status: 'running' | 'ready' | 'failed'; itemCount: number; library?: Library }>(
          'GET',
          `/api/v1/imports/letterboxd/scrape/status?runId=${encodeURIComponent(start.runId)}&datasetId=${encodeURIComponent(start.datasetId)}`,
        );
        setFound(s.itemCount || 0);
        if (s.status === 'failed') throw new Error('scrape failed');
        if (s.status === 'ready') {
          library = s.library ?? { films: [], lists: [], favorites: [] };
          break;
        }
      }
      if (!library) throw new Error('scrape timed out');
      if (cancelledRef.current) return;

      const films = library.films || [];
      const ratingsCount = films.filter((f) => f.rating != null).length;
      const reviewsCount = films.filter((f) => f.review).length;
      setPhase('importing');
      setTotal(films.length);

      let imported = 0;
      for (let i = 0; i < films.length; i += CHUNK) {
        if (cancelledRef.current) return;
        const r = await apiCall<{ imported: number; posters: string[] }>(
          'POST',
          '/api/v1/imports/letterboxd/scrape/import',
          { phase: 'films', films: films.slice(i, i + CHUNK) },
        );
        imported += r.imported || 0;
        if (r.posters?.length) addPosters(r.posters);
        setDone(Math.min(i + CHUNK, films.length));
      }
      for (const list of library.lists || []) {
        if (cancelledRef.current) return;
        await apiCall('POST', '/api/v1/imports/letterboxd/scrape/import', { phase: 'list', list }).catch(() => {});
      }
      if (library.favorites?.length) {
        await apiCall('POST', '/api/v1/imports/letterboxd/scrape/import', {
          phase: 'favorites',
          favorites: library.favorites,
        }).catch(() => {});
      }
      // finalize (recount) + kick the background reviews scrape (server-side).
      await apiCall('POST', '/api/v1/imports/letterboxd/scrape/import', {
        phase: 'finalize',
        username: lbUsername,
      }).catch(() => {});
      // Flag the device to finish the background reviews import after onboarding.
      try {
        localStorage.setItem('cc-pending-reviews', '1');
      } catch {
        /* ignore */
      }

      if (cancelledRef.current) return;
      setStats({ films: imported, ratings: ratingsCount, lists: library.lists.length, reviews: reviewsCount });
      setPhase('reveal');
      haptic('success');
      await sleep(2400);
      if (cancelledRef.current) return;
      onDone(imported);
    } catch {
      if (!cancelledRef.current) setPhase('failed');
    }
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void run();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rotate the witty status line while scraping
  useEffect(() => {
    if (phase !== 'scraping') return;
    const t = setInterval(() => setStatusLine((i) => (i + 1) % STATUS_LINES.length), 2600);
    return () => clearInterval(t);
  }, [phase]);

  const counter = useCountUp(phase === 'scraping' ? found : phase === 'importing' ? done : total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const realCount = posters.length;
  const slotCount = phase === 'reveal' ? Math.max(realCount, 0) : WALL_SLOTS;

  if (phase === 'failed') {
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
          <CtaButton label="try again" onClick={() => void run()} />
          <button
            onClick={() => {
              haptic('light');
              cancelledRef.current = true;
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
      <div
        className="grid w-full max-w-[290px] gap-[7px]"
        style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}
      >
        {Array.from({ length: slotCount }).map((_, i) => {
          const url = posters[i];
          return (
            <div key={i} className="relative aspect-[2/3] overflow-hidden rounded-[7px] bg-muted">
              {url ? (
                <img
                  src={url}
                  alt=""
                  className="cc-poster-pop h-full w-full object-cover"
                  loading="eager"
                  onError={(e) => ((e.currentTarget.style.opacity = '0'))}
                />
              ) : (
                <div className="cc-shimmer h-full w-full" />
              )}
            </div>
          );
        })}
      </div>

      {/* headline + counter */}
      {phase === 'reveal' ? (
        <div className="mt-9">
          <h1
            className="font-headline text-[27px] font-bold lowercase tracking-[-0.02em]"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            your cinema, imported
          </h1>
          <div className="mt-5 flex items-stretch justify-center gap-3">
            <RevealStat value={stats.films} label="films" />
            <RevealStat value={stats.ratings} label="ratings" />
            <RevealStat value={stats.lists} label="lists" />
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
            {phase === 'scraping' ? 'finding your films' : 'building your library'}
          </h1>

          <div
            className="mt-3 font-headline text-[52px] font-bold leading-none tabular-nums tracking-[-0.03em] text-primary"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            {counter.toLocaleString('en-US')}
            {phase === 'importing' && <span className="text-foreground/30">/{total.toLocaleString('en-US')}</span>}
          </div>
          <div className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {phase === 'scraping' ? 'films found' : 'films imported'}
          </div>

          {phase === 'importing' && (
            <div className="mx-auto mt-5 h-[6px] w-[220px] overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.max(pct, 3)}%` }}
              />
            </div>
          )}

          <p className="mt-5 h-4 font-serif text-[14px] font-light italic text-muted-foreground">
            {phase === 'scraping' ? STATUS_LINES[statusLine] : `matching @${lbUsername}'s films to our library…`}
          </p>
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
