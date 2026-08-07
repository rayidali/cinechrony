/**
 * unfiled — the holding pen for films grabbed from a clip that have no list yet
 * (Phase D2, `../design-refs-2026-08/screens/01-unfiled-inbox.png`).
 *
 * WHY THIS EXISTS. Until now `saveExtraction` REQUIRED a `target` per film, so
 * the grab — share a reel, keep the film, the entire pitch — stopped and asked
 * a first-time user to name a list at the exact moment of first value. unfiled
 * is not an inbox feature; it is the removal of that stop. Everything else here
 * follows from that one sentence.
 *
 * WHY IT IS A REAL LIST rather than a new collection. A film in unfiled is a
 * film: it has a poster, a status, a `socialLink`, notes, a movie-cell to
 * render it in. Modelling it as `users/{uid}/lists/unfiled/movies` reuses the
 * whole existing surface — firestore.rules, `addMovieToList`,
 * `removeMovieFromList`, `movieCount` upkeep, the client's `useCollection`
 * read — and makes "file it" a document MOVE rather than a second subsystem
 * that would have to grow every one of those things again.
 *
 * WHY THE DOC ID IS FIXED. `UNFILED_LIST_ID` is a reserved, deterministic id,
 * not a Firestore auto-id. Two consequences, both deliberate:
 *   · provisioning is idempotent BY CONSTRUCTION. Two concurrent saves racing
 *     to create it both write the same doc, where a query-then-create would
 *     have produced two unfiled lists and split the user's films across them.
 *   · the client needs no lookup to read it. `users/{uid}/lists/unfiled/movies`
 *     is addressable from the first render, so the screen costs one
 *     `useCollection` and zero round-trips to find out where to look.
 * Real list ids are 20-character auto-ids, so `'unfiled'` cannot collide with a
 * list anyone already has.
 *
 * THE FLAG IS THE CONTRACT, NOT THE ID. Every read filters on `isUnfiled`, so
 * behaviour is data-driven and a future rename cannot silently un-hide it. See
 * `isUnfiledList` for the one subtlety that filter has.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { BadRequestError, NotFoundError } from '@/lib/api-handler';
import { addMovieToList, removeMovieFromList } from '@/lib/movies-server';
import { createList, UNFILED_LIST_ID, UNFILED_LIST_NAME } from '@/lib/lists-server';
import type { SearchResult } from '@/lib/types';

// The pen's IDENTITY (`UNFILED_LIST_ID`, `isUnfiledList`) lives in
// `lists-server.ts`, which owns the list-doc shape and which this module
// already imports from — defining it here would make that edge bidirectional.
// Re-exported so callers have one import for everything unfiled.
export { UNFILED_LIST_ID, UNFILED_LIST_NAME, isUnfiledList } from '@/lib/lists-server';

/** Bounded so one call can't fan out into an unbounded write storm. */
const MAX_FILE_ITEMS = 50;

/**
 * Returns the unfiled list id, creating the doc on first use.
 *
 * Called on the save path, so it must be cheap and safe to call repeatedly.
 * `merge: true` on a fixed id makes it both: concurrent callers converge on one
 * doc, and an existing pen is never clobbered (in particular `movieCount` is
 * only seeded when the doc is new, never reset to 0 on a later call).
 */
export async function ensureUnfiledList(uid: string): Promise<string> {
  const ref = getDb().collection('users').doc(uid).collection('lists').doc(UNFILED_LIST_ID);
  const snap = await ref.get();
  if (snap.exists) return UNFILED_LIST_ID;

  await ref.set(
    {
      id: UNFILED_LIST_ID,
      name: UNFILED_LIST_NAME,
      isUnfiled: true,
      // Never public and never the default. The pen is a private staging area;
      // `getUserPublicLists`/`getLovedLists` already filter on isPublic, so
      // these two flags alone keep it off every public surface even before the
      // isUnfiled filters below.
      isPublic: false,
      isDefault: false,
      ownerId: uid,
      coverMode: 'auto',
      movieCount: 0,
      likes: 0,
      likedBy: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return UNFILED_LIST_ID;
}

export type FileTarget =
  | { ownerId: string; listId: string }
  /** Create a list and file into it — the sheet's "file all to… → new list". */
  | { newListName: string };

export type FileResult = {
  filed: string[];
  failed: Array<{ movieId: string; error: string }>;
  listId: string;
};

/**
 * Move films out of the pen and into a real list.
 *
 * ORDER MATTERS AND IS THE WHOLE SAFETY ARGUMENT: add to the destination FIRST,
 * remove from unfiled only once that succeeded. A crash or a permission failure
 * between the two leaves the film in BOTH places, which the next file resolves
 * (add dedupes, remove is idempotent). The other order would lose the film —
 * and the pen is the only record that it was ever grabbed.
 */
export async function fileUnfiled(
  uid: string,
  movieIds: string[],
  target: FileTarget,
): Promise<FileResult> {
  const ids = [...new Set((movieIds ?? []).filter((m) => typeof m === 'string' && m))].slice(
    0,
    MAX_FILE_ITEMS,
  );
  if (!ids.length) throw new BadRequestError('No films to file.');

  const db = getDb();
  const unfiledRef = db.collection('users').doc(uid).collection('lists').doc(UNFILED_LIST_ID);

  let ownerId: string;
  let listId: string;
  if ('newListName' in target) {
    const name = String(target.newListName ?? '').trim();
    if (!name) throw new BadRequestError('A list needs a name.');
    ({ listId } = await createList(uid, name));
    ownerId = uid;
  } else {
    ownerId = String(target.ownerId ?? '');
    listId = String(target.listId ?? '');
    if (!ownerId || !listId) throw new BadRequestError('A destination list is required.');
    // Filing INTO the pen is not a move, it is a no-op that would delete the
    // film — the add and the remove would target the same doc.
    if (ownerId === uid && listId === UNFILED_LIST_ID) {
      throw new BadRequestError('That is where they already are.');
    }
  }

  const filed: string[] = [];
  const failed: Array<{ movieId: string; error: string }> = [];

  for (const movieId of ids) {
    try {
      const snap = await unfiledRef.collection('movies').doc(movieId).get();
      if (!snap.exists) {
        failed.push({ movieId, error: 'not_in_unfiled' });
        continue;
      }
      const d = snap.data() as Record<string, unknown>;

      // Rebuild the SearchResult `addMovieToList` expects. The doc id is
      // `${mediaType}_${tmdbId}`, and `movieData.id` is what regenerates it, so
      // the film keeps the same identity in its new home and re-filing the same
      // film dedupes instead of duplicating.
      const mediaType = (d.mediaType === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv';
      const tmdbId = Number(d.tmdbId) || Number(String(movieId).split('_')[1]) || 0;
      const movieData: SearchResult = {
        id: String(tmdbId),
        title: String(d.title ?? ''),
        year: String(d.year ?? ''),
        posterUrl: String(d.posterUrl ?? ''),
        posterHint: String(d.posterHint ?? 'poster'),
        mediaType,
        tmdbId,
        overview: typeof d.overview === 'string' ? d.overview : undefined,
        rating: typeof d.rating === 'number' ? d.rating : undefined,
        backdropUrl: typeof d.backdropUrl === 'string' ? d.backdropUrl : undefined,
      };

      await addMovieToList(uid, ownerId, listId, {
        movieData,
        // Provenance travels with the film. Losing the clip on filing would
        // undo D1 — "the clip that did it" is why the film is here at all.
        socialLink: typeof d.socialLink === 'string' ? d.socialLink : undefined,
        socialThumbnail: typeof d.socialThumbnail === 'string' ? d.socialThumbnail : undefined,
        status: d.status === 'Watched' ? 'Watched' : 'To Watch',
      });

      await removeMovieFromList(uid, uid, UNFILED_LIST_ID, movieId);
      filed.push(movieId);
    } catch (err) {
      // Per-item isolation, same posture as saveExtraction: one film targeting
      // a list the caller can't edit must not sink the other nine.
      failed.push({ movieId, error: err instanceof Error ? err.name : 'failed' });
    }
  }

  return { filed, failed, listId };
}

/**
 * Drop films from the pen without filing them ("clear"). Deliberately a real
 * delete and not a soft flag: the pen's whole promise is that it empties.
 */
export async function clearUnfiled(uid: string, movieIds?: string[]): Promise<{ removed: number }> {
  const db = getDb();
  const unfiledRef = db.collection('users').doc(uid).collection('lists').doc(UNFILED_LIST_ID);
  if (!(await unfiledRef.get()).exists) throw new NotFoundError('Nothing is unfiled.');

  let ids: string[];
  if (Array.isArray(movieIds) && movieIds.length) {
    ids = [...new Set(movieIds.filter((m) => typeof m === 'string' && m))].slice(0, MAX_FILE_ITEMS);
  } else {
    const all = await unfiledRef.collection('movies').limit(MAX_FILE_ITEMS).get();
    ids = all.docs.map((d) => d.id);
  }

  let removed = 0;
  for (const movieId of ids) {
    const res = await removeMovieFromList(uid, uid, UNFILED_LIST_ID, movieId);
    if (res.removed) removed += 1;
  }
  return { removed };
}
