/**
 * "what should we watch?" — the candidate pool behind the tonight hero
 * (Phase D4, `../design-refs-2026-08/screens/03-home-tonight-hero.png`).
 *
 * WHY A POOL AND NOT A PICK. The hero's second button is `another`, so the
 * shuffle has to be free. Returning ONE film would make every reshuffle a
 * network round trip and, on a free-tier Firestore project, a fresh scan of
 * every list. Instead the server returns a pool once, cached per user, and the
 * client shuffles inside it — the first tap and the fiftieth cost the same.
 *
 * WHAT THE HERO IS ALLOWED TO SAY. The mockup's justification line reads "on
 * three of your lists. sam, mara and theo are all free." The first half is
 * real: `listCount` is counted here. The second half is NOT — there is no
 * availability model in this app, and rendering it would put a confident
 * fabrication on the front page. It is deliberately absent rather than faked.
 *
 * Runtime is likewise absent: it is not on the movie doc. The client fetches it
 * for the ONE film currently on screen via the module-cached, client-direct
 * TMDB helper, which costs no Firestore read at all.
 */

import { getDb } from '@/firebase/admin';
import { createTtlCache, cached } from '@/lib/server-cache';
import { isUnfiledList } from '@/lib/unfiled-constants';

export type TonightFilm = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  /** How many of the caller's lists hold this film — the one honest reason the
   *  hero can give for surfacing it. */
  listCount: number;
};

/** Lists scanned per build of the pool. A pool is a suggestion, not an index —
 *  scanning everything would make the cheapest screen the most expensive. */
const MAX_LISTS = 12;
const MAX_PER_LIST = 40;
const POOL_SIZE = 30;

// Ten minutes: long enough that opening home repeatedly costs one scan, short
// enough that a film saved this morning can headline tonight.
const poolCache = createTtlCache<TonightFilm[]>({ ttlMs: 10 * 60_000, maxEntries: 500 });

/**
 * Unwatched films across the caller's own lists, most-listed first.
 *
 * The unfiled pen is INCLUDED. A film grabbed an hour ago and not yet filed is
 * the strongest possible signal of intent to watch — excluding it would mean
 * the app's newest, most-wanted films were the only ones it never suggested.
 */
export async function getTonightPool(uid: string): Promise<{ films: TonightFilm[] }> {
  const films = await cached(poolCache, uid, async () => {
    const db = getDb();
    const listsSnap = await db
      .collection('users').doc(uid).collection('lists')
      .orderBy('updatedAt', 'desc')
      .limit(MAX_LISTS)
      .get();
    if (listsSnap.empty) return [];

    // key → film + how many lists hold it
    const byFilm = new Map<string, TonightFilm>();

    for (const listDoc of listsSnap.docs) {
      let moviesSnap;
      try {
        moviesSnap = await listDoc.ref.collection('movies').limit(MAX_PER_LIST).get();
      } catch {
        continue; // one unreadable list degrades the pool, never the request
      }
      for (const m of moviesSnap.docs) {
        const d = m.data();
        // Only things still to watch — suggesting a film someone already saw
        // is the fastest way to make the hero feel like it isn't listening.
        if (d.status === 'Watched') continue;
        const tmdbId = Number(d.tmdbId);
        if (!tmdbId) continue;
        const mediaType: 'movie' | 'tv' = d.mediaType === 'tv' ? 'tv' : 'movie';
        const key = `${mediaType}_${tmdbId}`;

        const existing = byFilm.get(key);
        if (existing) {
          // The pen is a staging area, not a considered choice, so it does not
          // add to the "on N of your lists" claim.
          if (!isUnfiledList(listDoc.data())) existing.listCount += 1;
          continue;
        }
        byFilm.set(key, {
          tmdbId,
          mediaType,
          title: String(d.title ?? ''),
          year: String(d.year ?? ''),
          posterUrl: d.posterUrl || null,
          backdropUrl: d.backdropUrl || null,
          listCount: isUnfiledList(listDoc.data()) ? 0 : 1,
        });
      }
    }

    return [...byFilm.values()]
      .filter((f) => f.title)
      .sort((a, b) => b.listCount - a.listCount)
      .slice(0, POOL_SIZE);
  });

  return { films };
}

/** Called after a write that changes what is watchable, so the hero cannot keep
 *  offering a film the user just marked watched. */
export function invalidateTonightPool(uid: string): void {
  poolCache.delete(uid);
}
