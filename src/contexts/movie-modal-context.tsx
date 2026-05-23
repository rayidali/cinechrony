'use client';

/**
 * MovieModalProvider — a single PublicMovieDetailsModal hoisted to the
 * page level, opened by anything in the tree via `useMovieModal()`.
 *
 * Why this exists:
 *
 * `/movie/[tmdbId]/comments` builds its "back" navigation off two URL
 * params — `returnPath` and `returnMovieId` — and lands the user at
 * `<returnPath>?openMovie=<id>`. The destination page is expected to
 * reopen the modal in response to the `openMovie` query param.
 *
 * That works fine on routes where ONE component owns the modal centrally
 * (`/lists/[listId]` via MovieList, `/profile/[username]/lists/[listId]`
 * via the page). It breaks on `/home` because every tile — trending
 * strip, activity feed, post card, recommendation card, friends-watching
 * card — was rendering its OWN PublicMovieDetailsModal with its OWN
 * `selectedMovie` state. There was no single listener for `openMovie`,
 * and even if there had been, the cards generate Movie objects on the fly
 * (with synthetic ids like `activity_${id}`) so the bare id in the URL is
 * useless for reconstruction.
 *
 * This provider centralizes both halves of the fix:
 *
 *   1. Children call `openMovie(movie)` from a single context hook. The
 *      provider sets `selectedMovie` + `isOpen` and renders the one shared
 *      modal. It also writes the full Movie object to `sessionStorage`
 *      keyed by `movie.id` so the round-trip rehydration has everything
 *      it needs.
 *
 *   2. An effect watches `?openMovie=Y`. When present, it reads the Movie
 *      from sessionStorage, restores it as the selected movie, opens the
 *      modal, and strips the param off the URL.
 *
 * The modal is rendered with `returnPath` set to the page's path so the
 * "see all" → `/comments` round-trip routes correctly back here.
 *
 * sessionStorage scope: per tab, persists across SPA navigations, dropped
 * when the tab closes. That's exactly the right lifetime — long enough to
 * survive the `/comments` round-trip, short enough that it can't leak
 * across user sessions.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PublicMovieDetailsModal } from '@/components/public-movie-details-modal';
import type { Movie } from '@/lib/types';

type MovieModalContextValue = {
  /** Open the shared modal with this movie. Idempotent. */
  openMovie: (movie: Movie) => void;
  /** Close the shared modal. */
  closeMovie: () => void;
};

const MovieModalContext = createContext<MovieModalContextValue | null>(null);

/** Hook — call from any descendant of MovieModalProvider. */
export function useMovieModal(): MovieModalContextValue {
  const ctx = useContext(MovieModalContext);
  if (!ctx) {
    throw new Error('useMovieModal must be used within a MovieModalProvider');
  }
  return ctx;
}

const SS_PREFIX = 'cc-movie-modal:';

function rememberMovie(movie: Movie) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${SS_PREFIX}${movie.id}`, JSON.stringify(movie));
  } catch {
    /* quota / safari private mode — non-critical, the openMovie return
       flow will silently no-op, but tile click → modal still works. */
  }
}

function recallMovie(id: string): Movie | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`${SS_PREFIX}${id}`);
    return raw ? (JSON.parse(raw) as Movie) : null;
  } catch {
    return null;
  }
}

type ProviderProps = {
  /** The current page's path — `/home`, `/profile`, etc. Passed to the
   * modal as its `returnPath` so the `/comments` round-trip lands here. */
  returnPath: string;
  children: React.ReactNode;
};

export function MovieModalProvider({ returnPath, children }: ProviderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // De-dup the openMovie-effect run: searchParams is a new object on every
  // render, so we'd otherwise refire even after consuming the param. The
  // ref tracks the last id we already restored.
  const handledOpenMovieRef = useRef<string | null>(null);

  const openMovie = useCallback((movie: Movie) => {
    rememberMovie(movie);
    setSelectedMovie(movie);
    setIsOpen(true);
  }, []);

  const closeMovie = useCallback(() => {
    setIsOpen(false);
    setSelectedMovie(null);
  }, []);

  // Reopen on return from /comments.
  useEffect(() => {
    const id = searchParams.get('openMovie');
    if (!id) {
      // URL has been cleared — reset so future returns work.
      handledOpenMovieRef.current = null;
      return;
    }
    if (handledOpenMovieRef.current === id) return;
    handledOpenMovieRef.current = id;

    const movie = recallMovie(id);
    if (movie) {
      setSelectedMovie(movie);
      setIsOpen(true);
    }
    // Strip the param either way — leaving it would re-trigger on every
    // future render and prevent a clean second visit.
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.delete('openMovie');
    router.replace(newUrl.pathname + newUrl.search, { scroll: false });
  }, [searchParams, router]);

  const value = useMemo<MovieModalContextValue>(
    () => ({ openMovie, closeMovie }),
    [openMovie, closeMovie],
  );

  return (
    <MovieModalContext.Provider value={value}>
      {children}
      <PublicMovieDetailsModal
        key={selectedMovie?.id ?? 'no-movie-open'}
        movie={selectedMovie}
        isOpen={isOpen}
        onClose={closeMovie}
        returnPath={returnPath}
      />
    </MovieModalContext.Provider>
  );
}
