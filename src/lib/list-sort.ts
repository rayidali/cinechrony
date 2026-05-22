/**
 * Search + sort for a list's movies.
 *
 * Entirely client-side: a list's movies are already fully loaded in memory
 * (real-time subscription for your own lists, getPublicListMovies for public
 * ones), so filtering/sorting even a few hundred films is instant — adding a
 * server round-trip would be slower and pointless.
 */

import type { Movie } from '@/lib/types';

export type ListSort = 'recent' | 'oldest' | 'az' | 'rating';

export const LIST_SORTS: { id: ListSort; label: string }[] = [
  { id: 'recent', label: 'recently added' },
  { id: 'oldest', label: 'oldest first' },
  { id: 'az', label: 'a → z' },
  { id: 'rating', label: 'highest rated' },
];

/** Read a movie's createdAt as epoch ms — handles Date, ISO string, Firestore Timestamp, number. */
function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? 0 : t;
  }
  if (value instanceof Date) return value.getTime();
  const ts = value as { toMillis?: () => number; seconds?: number };
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

function matchesQuery(movie: Movie, q: string): boolean {
  return (
    (movie.title || '').toLowerCase().includes(q) ||
    String(movie.year || '').toLowerCase().includes(q)
  );
}

function sortMovies(movies: Movie[], sort: ListSort): Movie[] {
  const arr = [...movies];
  switch (sort) {
    case 'oldest':
      return arr.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
    case 'az':
      return arr.sort((a, b) =>
        (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }),
      );
    case 'rating':
      return arr.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    case 'recent':
    default:
      return arr.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }
}

/**
 * The single source of truth for what a list view shows.
 *
 * A search query searches the WHOLE list — it deliberately bypasses the
 * To Watch / Watched tab, because you shouldn't need to know a film's watch
 * status to find it in a 150-film list. With no query, the status tab applies.
 */
export function arrangeListMovies(
  movies: Movie[],
  opts: { query: string; status: 'To Watch' | 'Watched'; sort: ListSort },
): Movie[] {
  const q = opts.query.trim().toLowerCase();
  const filtered = q
    ? movies.filter((m) => matchesQuery(m, q))
    : movies.filter((m) => m.status === opts.status);
  return sortMovies(filtered, opts.sort);
}
