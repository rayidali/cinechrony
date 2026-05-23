/**
 * Client-side TMDB search.
 *
 * TMDB serves pre-optimized images and is safe to query from the browser with
 * the public read token (`NEXT_PUBLIC_TMDB_ACCESS_TOKEN`). This module is the
 * one place client components reach TMDB for *search* — the header search
 * overlay and the post composer's movie tagger both use it. Server-side TMDB
 * work (trending, recommendations, details) lives in `src/app/actions.ts`.
 */

import type { SearchResult, TMDBSearchResult, TMDBTVSearchResult } from '@/lib/types';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const PLACEHOLDER_POSTER = 'https://picsum.photos/seed/placeholder/500/750';

async function tmdbFetch(path: string, params: Record<string, string> = {}) {
  const accessToken = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('[tmdb-client] NEXT_PUBLIC_TMDB_ACCESS_TOKEN is not configured.');
    return null;
  }

  const url = new URL(`${TMDB_API_BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      console.error(`[tmdb-client] TMDB ${response.status} ${response.statusText}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error('[tmdb-client] fetch failed:', error);
    return null;
  }
}

function formatMovie(result: TMDBSearchResult): SearchResult {
  return {
    id: result.id.toString(),
    title: result.title,
    year: result.release_date ? result.release_date.split('-')[0] : 'N/A',
    posterUrl: result.poster_path
      ? `${TMDB_IMAGE_BASE}${result.poster_path}`
      : PLACEHOLDER_POSTER,
    posterHint: 'movie poster',
    mediaType: 'movie',
    tmdbId: result.id,
    overview: result.overview,
    rating: result.vote_average,
  };
}

function formatTV(result: TMDBTVSearchResult): SearchResult {
  return {
    id: result.id.toString(),
    title: result.name,
    year: result.first_air_date ? result.first_air_date.split('-')[0] : 'N/A',
    posterUrl: result.poster_path
      ? `${TMDB_IMAGE_BASE}${result.poster_path}`
      : PLACEHOLDER_POSTER,
    posterHint: 'tv show poster',
    mediaType: 'tv',
    tmdbId: result.id,
    overview: result.overview,
    rating: result.vote_average,
  };
}

/**
 * Search films + TV in parallel, interleaved newest-relevance first.
 * Returns at most `limit` results (default 16).
 */
export async function searchTmdbMulti(query: string, limit = 16): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const [movieData, tvData] = await Promise.all([
    tmdbFetch('search/movie', { query: q, include_adult: 'false', language: 'en-US', page: '1' }),
    tmdbFetch('search/tv', { query: q, include_adult: 'false', language: 'en-US', page: '1' }),
  ]);

  const movies: SearchResult[] = (movieData?.results ?? [])
    .filter((r: TMDBSearchResult) => r.poster_path)
    .slice(0, 12)
    .map(formatMovie);
  const tvShows: SearchResult[] = (tvData?.results ?? [])
    .filter((r: TMDBTVSearchResult) => r.poster_path)
    .slice(0, 12)
    .map(formatTV);

  // Interleave so both media types surface together.
  const combined: SearchResult[] = [];
  const maxLength = Math.max(movies.length, tvShows.length);
  for (let i = 0; i < maxLength; i++) {
    if (i < movies.length) combined.push(movies[i]);
    if (i < tvShows.length) combined.push(tvShows[i]);
  }
  return combined.slice(0, limit);
}
