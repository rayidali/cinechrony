/**
 * Module-level cache for TMDB movie/TV detail payloads.
 *
 * Why this exists: the movie-details modals fetch TMDB on open. The
 * `/comments` round-trip (modal → see-all-reviews → back) closes the modal
 * and remounts the list page, then re-opens the modal via the `?openMovie=`
 * query param. Even with a fresh `key`-based mount and a race-safe loader,
 * the second fetch was failing intermittently in the iOS PWA — most likely
 * the request lifecycle racing with the back-navigation transition.
 *
 * Module-level state survives component remounts AND page navigations
 * within the SPA (it lives at the JS module level, not in React state).
 * So the first open warms the cache; every reopen — same session — is an
 * instant hit. No network call, no race, nothing to break.
 *
 * The cache is intentionally unbounded for v1: a session caps out at a
 * couple dozen unique films per the typical user flow, payloads are ~5–20 KB,
 * and the module is discarded on hard refresh anyway.
 */

import type { TMDBMovieDetails, TMDBTVDetails } from '@/lib/types';
import { apiCall } from '@/lib/api-client';
import type { TrendingMovie } from '@/lib/tmdb-server';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';

export type ExtendedMovieDetails = TMDBMovieDetails & {
  imdbId?: string;
  imdbRating?: string;
  imdbVotes?: string;
};

export type ExtendedTVDetails = TMDBTVDetails & {
  imdbId?: string;
  imdbRating?: string;
  imdbVotes?: string;
};

export type MediaDetails = ExtendedMovieDetails | ExtendedTVDetails;

// Key shape: `<mediaType>:<tmdbId>` — e.g. `movie:603`, `tv:1399`.
const detailsCache = new Map<string, MediaDetails>();
// In-flight promises so a parallel re-mount doesn't double-fire the network
// call. The second caller awaits the same promise the first one started.
const inflight = new Map<string, Promise<MediaDetails | null>>();

function cacheKey(mediaType: 'movie' | 'tv', tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

/**
 * Synchronous cache lookup — returns details immediately if we have them,
 * `null` if we don't. Use this on modal mount BEFORE awaiting anything; it
 * lets the UI paint the full payload on the very first frame after a
 * subsequent open, with zero loading flash.
 */
export function getCachedDetails(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
): MediaDetails | null {
  return detailsCache.get(cacheKey(mediaType, tmdbId)) ?? null;
}

async function fetchAndCache(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
): Promise<MediaDetails | null> {
  const key = cacheKey(mediaType, tmdbId);

  // Coalesce concurrent calls for the same key.
  const existingInflight = inflight.get(key);
  if (existingInflight) return existingInflight;

  const accessToken = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  if (!accessToken) return null;

  const promise = (async (): Promise<MediaDetails | null> => {
    try {
      const path = mediaType === 'tv' ? 'tv' : 'movie';
      const response = await fetch(
        `${TMDB_API_BASE_URL}/${path}/${tmdbId}?append_to_response=credits,external_ids`,
        {
          headers: {
            accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      if (!response.ok) return null;
      const data = await response.json();
      const imdbId = data.external_ids?.imdb_id;

      let withImdb: MediaDetails = { ...data, imdbId };
      if (imdbId) {
        try {
          const omdbData = await apiCall<{
            imdbRating?: string; metascore?: string; imdbVotes?: string;
            rated?: string; runtime?: string;
          }>('GET', `/api/v1/movies/imdb-rating/${encodeURIComponent(imdbId)}`);
          if (omdbData.imdbRating) {
            withImdb = {
              ...withImdb,
              imdbRating: omdbData.imdbRating,
              imdbVotes: omdbData.imdbVotes,
            };
          }
        } catch {
          /* IMDB is best-effort — leave the rest of the payload intact. */
        }
      }

      detailsCache.set(key, withImdb);
      return withImdb;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/**
 * Get details for a film/TV show, hitting the network only if we don't have
 * them cached. Always returns the cached value on subsequent calls for the
 * same `(mediaType, tmdbId)` — bulletproof against the iOS PWA back-nav race
 * that was leaving the second open with no details. Use {@link getCachedDetails}
 * for the synchronous lookup; this is the async fetcher that warms the cache.
 */
export async function getMovieOrTVDetails(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
): Promise<MediaDetails | null> {
  const cached = detailsCache.get(cacheKey(mediaType, tmdbId));
  if (cached) return cached;
  return fetchAndCache(mediaType, tmdbId);
}

// "more like this" — the SimilarMoviesRow strip on the detail screen hits
// the same back-nav abort window. Same module-level cache treatment.
const similarCache = new Map<string, TrendingMovie[]>();
const similarInflight = new Map<string, Promise<TrendingMovie[]>>();

/** Synchronous cache lookup for the "more like this" row. */
export function getCachedSimilar(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
): TrendingMovie[] | null {
  return similarCache.get(cacheKey(mediaType, tmdbId)) ?? null;
}

/**
 * Get similar films/TV for a `(mediaType, tmdbId)`, caching the result at
 * module level so a re-mount during back-nav doesn't fire a request that
 * iOS will silently abort.
 */
export async function getSimilarWithCache(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
): Promise<TrendingMovie[]> {
  const key = cacheKey(mediaType, tmdbId);
  const cached = similarCache.get(key);
  if (cached) return cached;

  const existingInflight = similarInflight.get(key);
  if (existingInflight) return existingInflight;

  const promise = (async (): Promise<TrendingMovie[]> => {
    try {
      const res = await apiCall<{ movies: TrendingMovie[] }>(
        'GET',
        `/api/v1/movies/${tmdbId}/similar?mediaType=${mediaType}`,
      );
      const movies = res.movies ?? [];
      // Only cache non-empty results. An empty result on a transient failure
      // shouldn't poison the cache and prevent the next attempt from
      // succeeding — TMDB recommendations rarely return zero items for real
      // films, so "empty" is almost always a transport-level miss here.
      if (movies.length > 0) similarCache.set(key, movies);
      return movies;
    } catch {
      return [];
    } finally {
      similarInflight.delete(key);
    }
  })();

  similarInflight.set(key, promise);
  return promise;
}
