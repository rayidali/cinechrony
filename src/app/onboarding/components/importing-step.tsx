'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { CtaButton } from '@/components/v3/onboarding-kit';

const APP_ICON = 'https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png';
const CHUNK = 120; // films per import request — keeps each call well inside the budget
const POLL_MS = 4000;
const MAX_POLLS = 95; // ~6.3 min ceiling on the scrape before we give up

type ImportFilm = { name: string; year: string; status: string; rating: number | null; review: string | null };
type Library = {
  films: ImportFilm[];
  lists: Array<{ name: string; description?: string; movies: Array<{ name: string; year: string }> }>;
  favorites: Array<{ name: string; year: string }>;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Importing-films — Phase 0.7 Wave 7. Drives the ASYNC + CHUNKED import so it
 * never blows a serverless time budget regardless of library size:
 *   scrape/start → poll scrape/status (live "N found") → chunked scrape/import
 *   (films in 120s, then lists, favourites, finalize) with a real progress bar.
 * Graceful: no APIFY_TOKEN → proceeds with 0; any failure → retry / skip.
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
  const [phase, setPhase] = useState<'scraping' | 'importing' | 'failed'>('scraping');
  const [found, setFound] = useState(0);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const startedRef = useRef(false);
  const cancelledRef = useRef(false);

  const run = async () => {
    cancelledRef.current = false;
    setPhase('scraping');
    setFound(0);
    setTotal(0);
    setDone(0);
    try {
      const start = await apiCall<
        { available: false } | { available: true; runId: string; datasetId: string }
      >('POST', '/api/v1/imports/letterboxd/scrape/start', { username: lbUsername });
      if (!start.available) {
        onDone(0); // engine not provisioned — skip cleanly
        return;
      }

      // Poll the scrape until the library is ready.
      let library: Library | null = null;
      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_MS);
        if (cancelledRef.current) return;
        const s = await apiCall<{ status: 'running' | 'ready' | 'failed'; itemCount: number; library?: Library }>(
          'GET',
          `/api/v1/imports/letterboxd/scrape/status?runId=${encodeURIComponent(
            start.runId,
          )}&datasetId=${encodeURIComponent(start.datasetId)}`,
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

      // Chunked import with live progress.
      setPhase('importing');
      const films = library.films || [];
      setTotal(films.length);
      let imported = 0;
      for (let i = 0; i < films.length; i += CHUNK) {
        if (cancelledRef.current) return;
        const r = await apiCall<{ imported: number }>('POST', '/api/v1/imports/letterboxd/scrape/import', {
          phase: 'films',
          films: films.slice(i, i + CHUNK),
        });
        imported += r.imported || 0;
        setDone(Math.min(i + CHUNK, films.length));
      }
      // Tail: custom lists, favourites, then recount.
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
      await apiCall('POST', '/api/v1/imports/letterboxd/scrape/import', { phase: 'finalize' }).catch(() => {});

      if (cancelledRef.current) return;
      haptic('success');
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

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-8 text-center text-foreground">
      <div className="relative mb-8">
        {phase !== 'failed' && <div className="cc-pulse-ring absolute inset-0 rounded-[22px] bg-primary/20" />}
        <img src={APP_ICON} alt="" className="relative h-20 w-20 rounded-[22px]" />
      </div>

      {phase === 'failed' ? (
        <>
          <h1
            className="font-headline text-[26px] font-bold lowercase tracking-[-0.02em]"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            couldn&apos;t finish the import
          </h1>
          <p className="mt-2.5 max-w-[18rem] font-serif text-[15px] font-light italic text-muted-foreground">
            letterboxd can be slow behind its bot wall. give it another go, or skip
            and start fresh — nothing&apos;s lost.
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
        </>
      ) : phase === 'scraping' ? (
        <>
          <h1
            className="font-headline text-[28px] font-bold lowercase tracking-[-0.02em]"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            finding your films
          </h1>
          <p className="mt-2.5 font-serif text-[15px] font-light italic text-muted-foreground">
            reaching @{lbUsername}&apos;s diary on letterboxd…
          </p>
          <div className="mt-7 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {found > 0 ? `${found.toLocaleString('en-US')} found` : 'connecting…'}
          </div>
        </>
      ) : (
        <>
          <h1
            className="font-headline text-[28px] font-bold lowercase tracking-[-0.02em]"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            importing your films
          </h1>
          <p className="mt-2.5 font-serif text-[15px] font-light italic text-muted-foreground">
            matching {total.toLocaleString('en-US')} films to our library…
          </p>
          <div className="mt-7 w-full max-w-[18rem]">
            <div className="h-[6px] w-full overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.max(pct, 4)}%` }}
              />
            </div>
            <div className="mt-2.5 font-mono text-[12px] tabular-nums text-muted-foreground">
              {done.toLocaleString('en-US')} / {total.toLocaleString('en-US')}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
