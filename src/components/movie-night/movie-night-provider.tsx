'use client';

import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from '@/lib/native-nav';
import { CreateNightSheet } from './create-night-sheet';
import type { MovieNightFilm } from '@/lib/movie-night-types';

/**
 * Movie Night — app-wide provider (MOVIE-NIGHT-PLAN.md § S3 client: create
 * flow + entry points + provider foundation). Mounted once in the root
 * layout, next to `StoryShareProvider` (same "hoisted singleton sheet"
 * pattern — any screen calls `useMovieNight()` instead of importing the
 * sheet directly).
 *
 * `openCreate` mounts the MN03 create flow (this slice). `openNight` is a
 * STUB for S3b: it records which night id wants opening (so "see the night"
 * and the `/home?night=<id>` push deep link both have somewhere to land) but
 * renders nothing yet — S3b replaces the TODO below with the MN10 detail
 * sheet, keyed on `openNightId`.
 */

export type MovieNightListContext = {
  id: string;
  ownerId: string;
  name: string;
  /** Optional hint — the create sheet re-fetches the full member list itself
   *  (it needs live usernames/photos for the people picker), this just lets
   *  a caller that already has the ids pass them through untouched. */
  memberUids?: string[];
};

export type OpenCreateArgs = {
  film?: MovieNightFilm;
  list?: MovieNightListContext;
};

type MovieNightContextValue = {
  /** Open the MN03 create sheet. Omit `film` for the film-first path (MN02) —
   *  the sheet opens with the film slot empty and prompts the picker. */
  openCreate: (args?: OpenCreateArgs) => void;
  /** Open a night's detail. STUB in this slice (S3b implements the sheet). */
  openNight: (id: string) => void;
};

const MovieNightContext = createContext<MovieNightContextValue | null>(null);

export function useMovieNight(): MovieNightContextValue {
  const ctx = useContext(MovieNightContext);
  if (!ctx) throw new Error('useMovieNight must be used within a MovieNightProvider');
  return ctx;
}

/** Isolated so `useSearchParams()` can bail into a Suspense boundary during
 *  the static-export prerender without forcing one on every consumer of
 *  `MovieNightProvider` (matches the `/extract` page's Suspense pattern). */
function NightParamWatcher({ onNightParam }: { onNightParam: (id: string) => void }) {
  const searchParams = useSearchParams();
  const nightParam = searchParams?.get('night') ?? null;
  const lastHandled = useRef<string | null>(null);

  useEffect(() => {
    if (!nightParam || lastHandled.current === nightParam) return;
    lastHandled.current = nightParam;
    onNightParam(nightParam);
  }, [nightParam, onNightParam]);

  return null;
}

export function MovieNightProvider({ children }: { children: ReactNode }) {
  const [createArgs, setCreateArgs] = useState<OpenCreateArgs | null>(null);
  // TODO(S3b): render <NightDetailSheet nightId={openNightId} .../> here once
  // it exists; for now this just remembers which night wants opening (the
  // "see the night" tap + the /home?night=<id> push deep link both call in).
  const [openNightId, setOpenNightId] = useState<string | null>(null);

  const openCreate = useCallback((args: OpenCreateArgs = {}) => {
    setCreateArgs(args);
  }, []);

  const openNight = useCallback((id: string) => {
    setOpenNightId(id);
  }, []);

  const value = useMemo(() => ({ openCreate, openNight }), [openCreate, openNight]);

  return (
    <MovieNightContext.Provider value={value}>
      <Suspense fallback={null}>
        <NightParamWatcher onNightParam={openNight} />
      </Suspense>
      {children}
      <CreateNightSheet args={createArgs} onClose={() => setCreateArgs(null)} onOpenNight={openNight} />
      {/* TODO(S3b): night detail sheet, keyed on openNightId */}
    </MovieNightContext.Provider>
  );
}
