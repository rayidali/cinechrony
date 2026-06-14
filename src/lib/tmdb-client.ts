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
import { getVibe } from '@/lib/vibes';

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

function mapMovies(results: unknown, limit: number): SearchResult[] {
  if (!Array.isArray(results)) return [];
  return results
    .filter((r: TMDBSearchResult) => r.poster_path)
    .slice(0, limit)
    .map(formatMovie);
}

/**
 * "In theatres" — TMDB now-playing (US). Public, non-secret TMDB data, so it
 * runs client-direct like `searchTmdbMulti` (no server proxy needed → works on
 * web, preview, and the Capacitor native shell without an API round-trip).
 */
export async function getNowPlayingMovies(limit = 18): Promise<SearchResult[]> {
  const data = await tmdbFetch('movie/now_playing', {
    language: 'en-US',
    page: '1',
    region: 'US',
  });
  return mapMovies(data?.results, limit);
}

/** "Coming soon" — TMDB upcoming (US), future releases only. Client-direct. */
export async function getUpcomingMovies(limit = 18): Promise<SearchResult[]> {
  const data = await tmdbFetch('movie/upcoming', {
    language: 'en-US',
    page: '1',
    region: 'US',
  });
  const now = Date.now();
  const future = (Array.isArray(data?.results) ? data.results : []).filter(
    (r: TMDBSearchResult) => {
      const t = Date.parse(r.release_date || '');
      return Number.isFinite(t) && t > now;
    },
  );
  return mapMovies(future, limit);
}

/**
 * "Browse by vibe" — resolve a curated vibe term to a TMDB keyword id, then
 * `/discover` the best-voted films tagged with it. Retries without the vote
 * floor, then falls back to a title search, so a vibe never renders empty.
 * Client-direct (public TMDB data).
 */
export async function discoverByVibe(vibeId: string, limit = 24): Promise<SearchResult[]> {
  const vibe = getVibe(vibeId);
  if (!vibe) return [];

  // 1. term → keyword id
  const kw = await tmdbFetch('search/keyword', { query: vibe.keyword, page: '1' });
  const first = Array.isArray(kw?.results) ? kw.results[0] : null;
  const keywordId: number | null = first && typeof first.id === 'number' ? first.id : null;

  // 2. discover by keyword (well-voted first, then any)
  if (keywordId) {
    const discover = async (minVotes: number) => {
      const params: Record<string, string> = {
        with_keywords: String(keywordId),
        sort_by: 'vote_count.desc',
        include_adult: 'false',
        language: 'en-US',
        page: '1',
      };
      if (minVotes > 0) params['vote_count.gte'] = String(minVotes);
      const d = await tmdbFetch('discover/movie', params);
      return mapMovies(d?.results, limit);
    };
    let movies = await discover(150);
    if (movies.length === 0) movies = await discover(0);
    if (movies.length > 0) return movies;
  }

  // 3. fallback — plain title search on the term
  const s = await tmdbFetch('search/movie', {
    query: vibe.keyword,
    include_adult: 'false',
    language: 'en-US',
    page: '1',
  });
  return mapMovies(s?.results, limit);
}
