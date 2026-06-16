/**
 * TMDB + OMDB server proxies — Phase A PR #14.
 *
 * The OMDB key (`OMDB_API_KEY`) is server-only — it must never reach the
 * browser. TMDB's read token is technically `NEXT_PUBLIC_*` and callable
 * from the browser (see `src/lib/tmdb-client.ts`), but the *enriched*
 * endpoints (trending + IMDB ratings; "for you" recs gated on the
 * viewer's ratings) belong server-side anyway.
 *
 *   - `getImdbRating`         OMDB only
 *   - `getTrendingMovies`     TMDB trending → OMDB ratings per-result
 *   - `getSimilarMovies`      TMDB recommendations → fallback to similar
 *   - `getRecommendationsForUser`  user's ratings → similar films per basis
 */

import { getUserRatings as getUserRatingsLib } from '@/lib/ratings-server';
import { createTtlCache, cached } from '@/lib/server-cache';

// ─── Shared types ─────────────────────────────────────────────────────────

export type TrendingMovie = {
  id: number;
  title: string;
  posterPath: string | null;
  releaseDate: string;
  voteAverage: number;
  mediaType: 'movie' | 'tv';
  imdbId?: string;
  imdbRating?: string;
};

export type RecommendationSet = {
  basisTmdbId: number;
  basisTitle: string;
  basisMediaType: 'movie' | 'tv';
  reason: string;
  recommendations: TrendingMovie[];
};

// ─── Key helpers ──────────────────────────────────────────────────────────

function getOmdbApiKey(): string {
  const key = process.env.OMDB_API_KEY;
  if (!key) {
    console.warn('[OMDB] API key not configured');
    return '';
  }
  return key;
}

function getTmdbToken(): string | null {
  const token = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  return token || null;
}

async function fetchImdbRating(
  tmdbId: number,
  tmdbAccessToken: string,
): Promise<{ imdbId?: string; imdbRating?: string }> {
  const OMDB_API_KEY = getOmdbApiKey();
  if (!OMDB_API_KEY) return {};
  try {
    const externalIdsResponse = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids`,
      {
        headers: {
          Authorization: `Bearer ${tmdbAccessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );
    if (!externalIdsResponse.ok) return {};
    const externalIds = await externalIdsResponse.json();
    const imdbId = externalIds.imdb_id;
    if (!imdbId) return {};

    const omdbResponse = await fetch(
      `https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`,
    );
    if (!omdbResponse.ok) return { imdbId };
    const omdbData = await omdbResponse.json();
    return {
      imdbId,
      imdbRating: omdbData.imdbRating !== 'N/A' ? omdbData.imdbRating : undefined,
    };
  } catch {
    return {};
  }
}

// ─── getImdbRating — OMDB lookup by IMDB id ───────────────────────────────

export type ImdbRating = {
  imdbRating?: string;
  metascore?: string; // Metacritic critic score, 0–100
  rottenTomatoes?: string; // e.g. "96%" — from OMDB's Ratings array
  awards?: string; // e.g. "Won 1 Oscar. 3 nominations total"
  imdbVotes?: string;
  rated?: string;
  runtime?: string;
};

/** Pull the Rotten Tomatoes "NN%" value out of OMDB's Ratings array. */
function extractRottenTomatoes(data: { Ratings?: Array<{ Source?: string; Value?: string }> }): string | undefined {
  const rt = data.Ratings?.find((r) => r.Source === 'Rotten Tomatoes');
  return rt?.Value && rt.Value !== 'N/A' ? rt.Value : undefined;
}

export class ImdbConfigError extends Error {
  constructor(message = 'OMDB API key not configured') {
    super(message);
    this.name = 'ImdbConfigError';
  }
}

export class ImdbNotFoundError extends Error {
  constructor(message = 'Movie not found') {
    super(message);
    this.name = 'ImdbNotFoundError';
  }
}

export async function getImdbRating(imdbId: string): Promise<ImdbRating> {
  const OMDB_API_KEY = getOmdbApiKey();
  if (!OMDB_API_KEY) throw new ImdbConfigError();

  const response = await fetch(
    `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${OMDB_API_KEY}`,
  );
  if (!response.ok) throw new ImdbNotFoundError('Failed to fetch OMDB data');

  const data = await response.json();
  if (data.Response === 'False') throw new ImdbNotFoundError(data.Error || 'Movie not found');

  return {
    imdbRating: data.imdbRating !== 'N/A' ? data.imdbRating : undefined,
    metascore: data.Metascore !== 'N/A' ? data.Metascore : undefined,
    rottenTomatoes: extractRottenTomatoes(data),
    awards: data.Awards && data.Awards !== 'N/A' ? data.Awards : undefined,
    imdbVotes: data.imdbVotes !== 'N/A' ? data.imdbVotes : undefined,
    rated: data.Rated !== 'N/A' ? data.Rated : undefined,
    runtime: data.Runtime !== 'N/A' ? data.Runtime : undefined,
  };
}

// ─── getTrendingMovies — TMDB trending enriched with IMDB ratings ─────────

export async function getTrendingMovies(): Promise<{ movies: TrendingMovie[] }> {
  const tmdb = getTmdbToken();
  if (!tmdb) return { movies: [] };

  const response = await fetch(
    'https://api.themoviedb.org/3/trending/movie/day?language=en-US',
    {
      headers: {
        Authorization: `Bearer ${tmdb}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 3600 }, // 1h cache
    },
  );
  if (!response.ok) return { movies: [] };

  const data = await response.json();
  const trendingResults = (data.results ?? []).slice(0, 10);

  const imdbDataPromises = trendingResults.map((m: { id: number }) =>
    fetchImdbRating(m.id, tmdb),
  );
  const imdbDataResults = await Promise.all(imdbDataPromises);

  const movies: TrendingMovie[] = trendingResults.map((movie: Record<string, unknown>, i: number) => ({
    id: movie.id as number,
    title: (movie.title as string) || (movie.name as string),
    posterPath: (movie.poster_path as string) ?? null,
    releaseDate: (movie.release_date as string) || (movie.first_air_date as string) || '',
    voteAverage: (movie.vote_average as number) ?? 0,
    mediaType: 'movie' as const,
    imdbId: imdbDataResults[i]?.imdbId,
    imdbRating: imdbDataResults[i]?.imdbRating,
  }));
  return { movies };
}

// ─── getSimilarMovies — TMDB recommendations → similar fallback ───────────

export async function getSimilarMovies(
  tmdbId: number,
  mediaType: 'movie' | 'tv' = 'movie',
  limit = 12,
): Promise<{ movies: TrendingMovie[] }> {
  if (!tmdbId || Number.isNaN(Number(tmdbId))) return { movies: [] };
  const tmdb = getTmdbToken();
  if (!tmdb) return { movies: [] };

  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const headers = {
    Authorization: `Bearer ${tmdb}`,
    'Content-Type': 'application/json',
  };

  async function fetchEndpoint(endpoint: 'recommendations' | 'similar') {
    const res = await fetch(
      `https://api.themoviedb.org/3/${type}/${tmdbId}/${endpoint}?language=en-US&page=1`,
      { headers, next: { revalidate: 86400 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  }

  let results = await fetchEndpoint('recommendations');
  if (results.length === 0) results = await fetchEndpoint('similar');

  const movies: TrendingMovie[] = results
    .filter((m: { poster_path?: string | null }) => m.poster_path)
    .slice(0, limit)
    .map((m: Record<string, unknown>) => ({
      id: m.id as number,
      title: (m.title as string) || (m.name as string) || 'untitled',
      posterPath: (m.poster_path as string) ?? null,
      releaseDate: (m.release_date as string) || (m.first_air_date as string) || '',
      voteAverage: (m.vote_average as number) ?? 0,
      mediaType: (m.media_type === 'tv' || type === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv',
    }));
  return { movies };
}

// ─── getRecommendationsForUser — caller-scoped via Bearer token ──────────

/**
 * Build 1-3 "if you liked X" recommendation sets for the viewer based on
 * their rating history. Tiered: loved (>=8, up to 3 bases) → liked (>=6.5,
 * up to 2) → the single most-recent rating, so cautious raters still get
 * something.
 */
// Per-caller cache — recs read the viewer's ratings then fan out to TMDB
// `similar` per basis. 5 min staleness is fine (taste doesn't shift by the
// minute) and spares both Firestore reads and TMDB calls on repeated loads.
const recommendationsCache = createTtlCache<{ sets: RecommendationSet[] }>({ ttlMs: 300_000 });

export async function getRecommendationsForUser(
  callerUid: string,
): Promise<{ sets: RecommendationSet[] }> {
  return cached(recommendationsCache, callerUid, async () => {
  const { ratings } = await getUserRatingsLib(callerUid, { limit: 40 });
  const seen = new Set<number>();
  const rated = (ratings || []).filter((r) => {
    if (typeof r.rating !== 'number' || !r.tmdbId || seen.has(r.tmdbId)) return false;
    seen.add(r.tmdbId);
    return true;
  });

  // Tiered so cautious raters still get something: loved (>=8, up to 3 bases)
  // → liked (>=6.5, up to 2) → the single most-recent rating. The tier sets
  // the per-card reason voice ("you loved …" / "because you liked …").
  let tier: 'loved' | 'liked' | 'recent' = 'loved';
  let bases = rated.filter((r) => r.rating >= 8).slice(0, 3);
  if (bases.length === 0) {
    bases = rated.filter((r) => r.rating >= 6.5).slice(0, 2);
    tier = 'liked';
  }
  if (bases.length === 0) {
    bases = rated.slice(0, 1);
    tier = 'recent';
  }

  if (bases.length === 0) return { sets: [] };

  const reasonFor = (title: string) => {
    const t = (title || 'it').toLowerCase();
    if (tier === 'loved') return `you loved ${t}`;
    if (tier === 'liked') return `because you liked ${t}`;
    return `because you watched ${t}`;
  };

  const sets = await Promise.all(
    bases.map(async (b): Promise<RecommendationSet> => {
      const { movies } = await getSimilarMovies(b.tmdbId, b.mediaType || 'movie', 9);
      return {
        basisTmdbId: b.tmdbId,
        basisTitle: b.movieTitle || 'a film you loved',
        basisMediaType: (b.mediaType || 'movie') as 'movie' | 'tv',
        reason: reasonFor(b.movieTitle || ''),
        recommendations: movies,
      };
    }),
  );
  return { sets: sets.filter((s) => s.recommendations.length > 0) };
  });
}
