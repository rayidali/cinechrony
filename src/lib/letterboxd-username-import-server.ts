/**
 * Letterboxd USERNAME import — the async, chunked pipeline (Phase 0.7 Wave 7).
 *
 * Why this exists: a public library can be thousands of films, and BOTH long
 * poles — the Apify scrape (minutes) and the TMDB match+write (~50ms/film) —
 * blow a single serverless request's time budget. So the import is decoupled
 * into SHORT requests the client orchestrates with live progress:
 *
 *   1. startLibraryScrape(username)      → { runId, datasetId }   (Apify run, no wait)
 *   2. pollLibraryScrape(runId, ds)      → { status, itemCount, library? }
 *      (when SUCCEEDED, returns the normalized + deduped import items)
 *   3. importFilmChunk(uid, items[])     → matches a CHUNK concurrently + writes
 *      (the client loops ~120 films/call, showing imported/total)
 *   4. importUserList / setFavorites / finalizeDefaultList — the tail.
 *
 * Reviews are intentionally NOT scraped here (the browser actor is minutes-slow);
 * the import items still carry any review text the cheerio pass happened to see.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import {
  startRun,
  getRunStatus,
  fetchDatasetItems,
  normalizeRows,
  normalizeUsername,
  buildCheerioInput,
  buildWebScraperReviewsInput,
  CHEERIO_ACTOR,
  BROWSER_ACTOR,
  APIFY_TERMINAL,
  LetterboxdUsernameError,
} from './letterboxd-scrape-server';
import { TmdbNotConfiguredError, type LetterboxdData } from './letterboxd-server';

const TMDB_ACCESS_TOKEN = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;

export type ImportFilm = {
  name: string;
  year: string;
  status: 'Watched' | 'To Watch';
  rating: number | null; // 1–10 (already ×2 from Letterboxd's 0.5–5 stars)
  review: string | null;
};

export type ImportLibrary = {
  films: ImportFilm[];
  lists: Array<{ name: string; description?: string; movies: Array<{ name: string; year: string }> }>;
  favorites: Array<{ name: string; year: string }>;
  summary: { films: number; lists: number; ratings: number };
};

// ── scrape lifecycle (decoupled) ─────────────────────────────────────────────

export async function startLibraryScrape(
  username: string,
  token: string,
): Promise<{ runId: string; datasetId: string }> {
  const u = normalizeUsername(username);
  const { runId, datasetId } = await startRun(CHEERIO_ACTOR, buildCheerioInput(u), token, { timeoutSecs: 600, memoryMbytes: 1024 });
  return { runId, datasetId };
}

export async function pollLibraryScrape(
  runId: string,
  datasetId: string,
  token: string,
): Promise<{ status: 'running' | 'ready' | 'failed'; itemCount: number; library?: ImportLibrary }> {
  const { status, itemCount } = await getRunStatus(runId, token);
  if (!APIFY_TERMINAL.has(status)) return { status: 'running', itemCount };
  if (status !== 'SUCCEEDED') return { status: 'failed', itemCount };

  const rows = await fetchDatasetItems(datasetId, token);
  const data = normalizeRows(rows);
  return { status: 'ready', itemCount, library: buildImportItems(data) };
}

/** Fold a normalized library into the flat, deduped import items the client chunks. */
export function buildImportItems(data: LetterboxdData): ImportLibrary {
  const ratingsMap = new Map<string, number>();
  for (const r of data.ratings) {
    if (r.Rating) ratingsMap.set(`${r.Name.toLowerCase()}_${r.Year}`, parseFloat(r.Rating) * 2);
  }
  const reviewsMap = new Map<string, string>();
  for (const r of data.reviews) {
    if (r.Review && r.Review.trim()) reviewsMap.set(`${r.Name.toLowerCase()}_${r.Year}`, r.Review.trim());
  }

  const films: ImportFilm[] = [];
  const seen = new Set<string>();
  const push = (name: string, year: string, status: 'Watched' | 'To Watch') => {
    const key = `${name.toLowerCase()}_${year}`;
    if (seen.has(key)) return;
    seen.add(key);
    const rating = ratingsMap.get(key) ?? null;
    const review = reviewsMap.get(key) ?? null;
    // A rating or a review implies the film was watched — never leave it in
    // "to watch" even if it somehow arrived via the watchlist.
    const effectiveStatus = rating != null || review ? 'Watched' : status;
    films.push({ name, year, status: effectiveStatus, rating, review });
  };
  for (const w of data.watched) push(w.Name, w.Year, 'Watched');
  for (const w of data.watchlist) push(w.Name, w.Year, 'To Watch');

  return {
    films,
    lists: data.lists.map((l) => ({
      name: l.name,
      description: l.description,
      movies: l.movies.map((m) => ({ name: m.Name, year: m.Year })),
    })),
    favorites: data.favorites.map((f) => ({ name: f.Name, year: f.Year })),
    summary: { films: films.length, lists: data.lists.length, ratings: ratingsMap.size },
  };
}

// ── TMDB matching (concurrent) ───────────────────────────────────────────────

type TmdbHit = {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
};

async function tmdbMatch(name: string, year: string): Promise<TmdbHit | null> {
  try {
    const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(
      name,
    )}&year=${encodeURIComponent(year)}&language=en-US&page=1`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TMDB_ACCESS_TOKEN}` } });
    if (!res.ok) return null;
    const j = (await res.json()) as { results?: TmdbHit[] };
    const results = j.results || [];
    if (!results.length) return null;
    return results.find((r) => r.release_date?.startsWith(year)) || results[0];
  } catch {
    return null;
  }
}

/** Bounded-concurrency map — keeps TMDB ~40 req/s (safe under its limit) while
 *  collapsing the sequential 50ms-per-film wall-clock. */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  return out;
}

// ── default-list helper ──────────────────────────────────────────────────────

async function getDefaultListId(db: FirebaseFirestore.Firestore, uid: string): Promise<string> {
  const userRef = db.collection('users').doc(uid);
  const def = await userRef.collection('lists').where('isDefault', '==', true).limit(1).get();
  if (!def.empty) return def.docs[0].id;
  const any = await userRef.collection('lists').limit(1).get();
  if (!any.empty) return any.docs[0].id;
  const ref = userRef.collection('lists').doc();
  await ref.set({
    id: ref.id,
    name: 'My Watchlist',
    isDefault: true,
    isPublic: false,
    ownerId: uid,
    collaboratorIds: [],
    movieCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

function posterUrl(p?: string | null): string | null {
  return p ? `https://image.tmdb.org/t/p/w500${p}` : null;
}

/**
 * A scraped Letterboxd list often yields the site's generic share boilerplate
 * ("<user> is using Letterboxd to share film reviews and lists with friends.
 * Join here.") instead of a real description. Drop that — an imported list with a
 * junk description reads as broken.
 */
function cleanListDescription(desc?: string | null): string | null {
  const d = (desc || '').trim();
  if (!d) return null;
  if (/using letterboxd to share film reviews/i.test(d)) return null;
  if (/^join here\.?$/i.test(d)) return null;
  return d.slice(0, 500);
}

// ── chunk import (films + ratings + reviews) ─────────────────────────────────

export async function importFilmChunk(
  uid: string,
  items: ImportFilm[],
): Promise<{ imported: number; posters: string[] }> {
  if (!TMDB_ACCESS_TOKEN) throw new TmdbNotConfiguredError();
  if (!items.length) return { imported: 0, posters: [] };

  const db = getDb();
  const listId = await getDefaultListId(db, uid);
  const userData = (await db.collection('users').doc(uid).get()).data();

  const matched = await mapPool(items, 8, async (it) => ({ it, m: await tmdbMatch(it.name, it.year) }));

  // A few real posters per chunk → the import screen builds a live poster wall.
  const posters: string[] = [];

  let batch = db.batch();
  let ops = 0;
  let imported = 0;
  const flush = async () => {
    if (ops > 0) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  for (const { it, m } of matched) {
    if (!m) continue;
    if (m.poster_path && posters.length < 12) posters.push(`https://image.tmdb.org/t/p/w342${m.poster_path}`);
    const docId = `movie_${m.id}`;
    const movieRef = db.collection('users').doc(uid).collection('lists').doc(listId).collection('movies').doc(docId);
    batch.set(
      movieRef,
      {
        id: docId,
        title: m.title,
        year: m.release_date?.slice(0, 4) || it.year,
        posterUrl: posterUrl(m.poster_path),
        posterHint: m.title,
        addedBy: uid,
        status: it.status,
        createdAt: FieldValue.serverTimestamp(),
        mediaType: 'movie',
        tmdbId: m.id,
        overview: m.overview || null,
        rating: m.vote_average || null,
        backdropUrl: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : null,
        addedByDisplayName: userData?.displayName || null,
        addedByUsername: userData?.username || null,
        addedByPhotoURL: userData?.photoURL || null,
      },
      { merge: true },
    );
    ops++;
    imported++;

    if (it.rating != null) {
      const ratingRef = db.collection('ratings').doc(`${uid}_${m.id}`);
      batch.set(
        ratingRef,
        {
          userId: uid,
          tmdbId: m.id,
          mediaType: 'movie',
          movieTitle: m.title,
          moviePosterUrl: posterUrl(m.poster_path),
          rating: it.rating,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      ops++;
    }

    // NOTE: reviews are NOT written here. They come exclusively from the
    // background reviews sync (writeReviews), which writes the canonical,
    // idempotent shape (parentId:null, deterministic lb_{uid}_{tmdbId} id). The
    // cheerio scrape that feeds this chunk carries no reviews anyway.

    if (ops >= 450) await flush();
  }
  await flush();

  // Keep the default list's denormalized count live as chunks land (so "my
  // watchlist" grows during import instead of jumping at the end). finalize does
  // the authoritative recount-and-SET, correcting any increment drift.
  if (imported > 0) {
    await db
      .collection('users')
      .doc(uid)
      .collection('lists')
      .doc(listId)
      .update({ movieCount: FieldValue.increment(imported), updatedAt: FieldValue.serverTimestamp() })
      .catch(() => {});
  }
  return { imported, posters };
}

// ── one custom list ──────────────────────────────────────────────────────────

export async function importUserList(
  uid: string,
  list: { name: string; description?: string; movies: Array<{ name: string; year: string }> },
): Promise<{ imported: number }> {
  if (!TMDB_ACCESS_TOKEN) throw new TmdbNotConfiguredError();
  if (!list.movies?.length) return { imported: 0 };

  const db = getDb();
  // Get an id WITHOUT creating the list doc yet — we write the films first, then
  // create the list doc once with the FINAL movieCount, so the lists grid never
  // shows a "0 films" flicker before the count catches up (the reported bug).
  const listRef = db.collection('users').doc(uid).collection('lists').doc();
  const userData = (await db.collection('users').doc(uid).get()).data();

  const matched = await mapPool(list.movies, 8, async (mv) => await tmdbMatch(mv.name, mv.year));

  let batch = db.batch();
  let ops = 0;
  let imported = 0;
  for (const m of matched) {
    if (!m) continue;
    const docId = `movie_${m.id}`;
    batch.set(
      listRef.collection('movies').doc(docId),
      {
        id: docId,
        title: m.title,
        year: m.release_date?.slice(0, 4) || '',
        posterUrl: posterUrl(m.poster_path),
        posterHint: m.title,
        addedBy: uid,
        status: 'To Watch',
        createdAt: FieldValue.serverTimestamp(),
        mediaType: 'movie',
        tmdbId: m.id,
        overview: m.overview || null,
        rating: m.vote_average || null,
        backdropUrl: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : null,
        addedByDisplayName: userData?.displayName || null,
        addedByUsername: userData?.username || null,
        addedByPhotoURL: userData?.photoURL || null,
      },
      { merge: true },
    );
    ops++;
    imported++;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  // Nothing matched → don't leave an empty ghost list cluttering the grid.
  if (imported === 0) return { imported: 0 };

  // Create the list doc LAST, already carrying the right count + a cleaned
  // description (no Letterboxd share boilerplate).
  await listRef.set({
    id: listRef.id,
    name: list.name || 'Imported list',
    description: cleanListDescription(list.description),
    isDefault: false,
    isPublic: false,
    ownerId: uid,
    collaboratorIds: [],
    movieCount: imported,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { imported };
}

// ── favourites (top 5 → profile) ─────────────────────────────────────────────

export async function setUserFavorites(
  uid: string,
  favorites: Array<{ name: string; year: string }>,
): Promise<{ set: number }> {
  if (!TMDB_ACCESS_TOKEN || !favorites?.length) return { set: 0 };
  const db = getDb();
  const matched = await mapPool(favorites.slice(0, 5), 5, async (f) => await tmdbMatch(f.name, f.year));
  const favoriteMovies = matched
    .filter((m): m is TmdbHit => !!m)
    .map((m) => ({
      id: `movie_${m.id}`,
      title: m.title,
      posterUrl: posterUrl(m.poster_path) || '',
      tmdbId: m.id,
    }));
  if (!favoriteMovies.length) return { set: 0 };
  await db.collection('users').doc(uid).update({ favoriteMovies });
  return { set: favoriteMovies.length };
}

// ── finalize (recount the default list) ──────────────────────────────────────

export async function finalizeDefaultList(
  uid: string,
  opts: { username?: string; token?: string } = {},
): Promise<{ movieCount: number }> {
  const db = getDb();
  const listId = await getDefaultListId(db, uid);
  const listRef = db.collection('users').doc(uid).collection('lists').doc(listId);
  const countSnap = await listRef.collection('movies').count().get();
  const movieCount = countSnap.data().count;
  await listRef.update({ movieCount, updatedAt: FieldValue.serverTimestamp() });

  // Record which Letterboxd handle was imported (owner-only) — the hook for a
  // future "re-sync" affordance + light idempotency. We deliberately do NOT
  // hard-lock a Letterboxd account to one Cinechrony user: the diary is already
  // public, two real people might share, and someone may re-import after the
  // original abandons — locking is all downside. Imports are idempotent instead.
  if (opts.username) {
    try {
      await db.collection('users_private').doc(uid).set(
        { importedLetterboxd: { username: opts.username, at: FieldValue.serverTimestamp() } },
        { merge: true },
      );
    } catch {
      /* non-critical */
    }
  }

  // Kick the slow reviews scrape NOW (only for users who actually committed an
  // import) and stash the run on users_private; `syncPendingReviews` finishes it
  // in the background after onboarding — reviews are never part of the wait.
  if (opts.username && opts.token) {
    try {
      const { runId, datasetId } = await startReviewsRun(opts.username, opts.token);
      await db.collection('users_private').doc(uid).set(
        // username + attempt let syncPendingReviews retry a flaky/timed-out run.
        { pendingReviews: { runId, datasetId, username: opts.username, attempt: 1, createdAt: FieldValue.serverTimestamp() } },
        { merge: true },
      );
    } catch {
      /* best-effort — a failed reviews kick must not fail the import */
    }
  }
  return { movieCount };
}

// ── reviews: background sync ──────────────────────────────────────────────────

/** Start the (slow) reviews browser-actor run; returns its ids for later polling. */
export async function startReviewsRun(
  username: string,
  token: string,
): Promise<{ runId: string; datasetId: string }> {
  const u = normalizeUsername(username);
  // 900s (15 min) balances completeness for big libraries against cost — still
  // ~4× cheaper than the actor's 1-hour default. Even a timeout now salvages its
  // partial dataset (see syncPendingReviews), so this is an upper bound, not a
  // cliff.
  const { runId, datasetId } = await startRun(BROWSER_ACTOR, buildWebScraperReviewsInput(u), token, { timeoutSecs: 900, memoryMbytes: 2048 });
  return { runId, datasetId };
}

const REVIEW_SYNC_CAP = 400; // bound a single sync to fit the function budget
const REVIEW_PENDING_TTL_MS = 40 * 60 * 1000;
const MAX_REVIEW_ATTEMPTS = 2; // retry a flaky/failed scrape once before giving up

async function writeReviews(
  uid: string,
  reviews: Array<{ Name: string; Year: string; Review?: string }>,
): Promise<number> {
  if (!TMDB_ACCESS_TOKEN || !reviews.length) return 0;
  const db = getDb();
  const userData = (await db.collection('users').doc(uid).get()).data();
  const listId = await getDefaultListId(db, uid);
  const slice = reviews.filter((r) => r.Review && r.Review.trim()).slice(0, REVIEW_SYNC_CAP);

  const matched = (await mapPool(slice, 8, async (r) => ({ r, m: await tmdbMatch(r.Name, r.Year) }))).filter(
    (x): x is { r: { Name: string; Year: string; Review?: string }; m: TmdbHit } => !!x.m,
  );

  // Pull the user's ratings for these films in one batched read → the imported
  // review carries its score (shows as a scored review, not a bare note).
  const ratingRefs = matched.map(({ m }) => db.collection('ratings').doc(`${uid}_${m.id}`));
  const ratingDocs = ratingRefs.length ? await db.getAll(...ratingRefs) : [];
  const ratingByTmdb = new Map<number, number>();
  ratingDocs.forEach((d, i) => {
    const v = d.data()?.rating;
    if (typeof v === 'number') ratingByTmdb.set(matched[i].m.id, v);
  });

  let batch = db.batch();
  let ops = 0;
  let written = 0;
  const flush = async () => {
    if (ops > 0) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  for (const { r, m } of matched) {
    // Deterministic id → re-running the sync is idempotent (no duplicate reviews).
    const reviewRef = db.collection('reviews').doc(`lb_${uid}_${m.id}`);
    batch.set(
      reviewRef,
      {
        id: `lb_${uid}_${m.id}`,
        tmdbId: m.id,
        mediaType: 'movie',
        movieTitle: m.title,
        moviePosterUrl: posterUrl(m.poster_path),
        userId: uid,
        username: userData?.username || null,
        userDisplayName: userData?.displayName || null,
        userPhotoUrl: userData?.photoURL || null,
        text: r.Review!.trim(),
        ratingAtTime: ratingByTmdb.get(m.id) ?? null,
        likes: 0,
        likedBy: [],
        // Canonical review shape — the reviews wall filters where(parentId==null),
        // so a missing parentId makes an imported review INVISIBLE (the bug).
        parentId: null,
        replyCount: 0,
        hasSpoiler: false,
        reactions: {},
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    ops++;
    written++;

    // A reviewed film has been watched — make sure it's in the default list as
    // Watched (it usually already is from the films grid; this covers the case
    // where the grid missed it). merge → never clobbers an existing entry's data.
    const movieRef = db.collection('users').doc(uid).collection('lists').doc(listId).collection('movies').doc(`movie_${m.id}`);
    batch.set(
      movieRef,
      {
        id: `movie_${m.id}`,
        title: m.title,
        year: m.release_date?.slice(0, 4) || '',
        posterUrl: posterUrl(m.poster_path),
        posterHint: m.title,
        addedBy: uid,
        status: 'Watched',
        mediaType: 'movie',
        tmdbId: m.id,
        overview: m.overview || null,
        rating: m.vote_average || null,
        backdropUrl: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : null,
        addedByDisplayName: userData?.displayName || null,
        addedByUsername: userData?.username || null,
        addedByPhotoURL: userData?.photoURL || null,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    ops++;

    if (ops >= 440) await flush();
  }
  await flush();
  if (written > 0) {
    const listRef = db.collection('users').doc(uid).collection('lists').doc(listId);
    const countSnap = await listRef.collection('movies').count().get();
    await listRef.update({ movieCount: countSnap.data().count, updatedAt: FieldValue.serverTimestamp() });
  }
  return written;
}

/**
 * Finish the background reviews import. Reads the pending run off the user doc,
 * polls it, and on completion fetches + imports the reviews, then clears the
 * flag. Returns quickly while the run is still going (the client retries). Clears
 * a stale/failed run so it can't get stuck pending forever.
 */
export async function syncPendingReviews(
  uid: string,
  token: string,
): Promise<{ status: 'none' | 'running' | 'done' | 'failed'; reviewsImported?: number }> {
  const db = getDb();
  const privRef = db.collection('users_private').doc(uid);
  const snap = await privRef.get();
  const pending = snap.data()?.pendingReviews as
    | { runId?: string; datasetId?: string; username?: string; attempt?: number; createdAt?: { toMillis?: () => number } }
    | undefined;
  if (!pending?.runId || !pending?.datasetId) return { status: 'none' };

  const createdMs = pending.createdAt?.toMillis?.() ?? 0;
  const stale = createdMs > 0 && Date.now() - createdMs > REVIEW_PENDING_TTL_MS;

  const { status } = await getRunStatus(pending.runId, token);

  // Still running: keep waiting unless this attempt has outlived its TTL (a hung
  // run) — then fall through to salvage/retry below.
  if (!APIFY_TERMINAL.has(status) && !stale) return { status: 'running' };

  // SALVAGE whatever was scraped — a TIMED-OUT run still has a partial dataset,
  // so a big library that didn't fully finish gets MOST of its reviews instead
  // of none. (Idempotent ids mean a later full run just tops it up.)
  let rows: Awaited<ReturnType<typeof fetchDatasetItems>> = [];
  try {
    rows = await fetchDatasetItems(pending.datasetId, token);
  } catch {
    /* dataset unreadable — fall through to retry/give-up */
  }
  const data = normalizeRows(rows);
  if (data.reviews.length > 0) {
    const reviewsImported = await writeReviews(uid, data.reviews);
    await privRef.update({ pendingReviews: FieldValue.delete() });
    return { status: 'done', reviewsImported };
  }

  // Nothing salvaged + the run didn't cleanly succeed → RETRY a fresh scrape
  // once (handles transient Cloudflare 403s / aborts). SUCCEEDED-but-empty just
  // means the user has no reviews — don't retry that.
  const attempt = pending.attempt ?? 1;
  if (status !== 'SUCCEEDED' && attempt < MAX_REVIEW_ATTEMPTS && pending.username) {
    try {
      const next = await startReviewsRun(pending.username, token);
      await privRef.update({
        pendingReviews: {
          runId: next.runId,
          datasetId: next.datasetId,
          username: pending.username,
          attempt: attempt + 1,
          createdAt: FieldValue.serverTimestamp(),
        },
      });
      return { status: 'running' };
    } catch {
      /* couldn't start a retry — give up below */
    }
  }

  await privRef.update({ pendingReviews: FieldValue.delete() });
  return { status: status === 'SUCCEEDED' ? 'done' : 'failed', reviewsImported: 0 };
}

export { LetterboxdUsernameError };
