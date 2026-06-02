/**
 * Letterboxd-import helpers — Phase A PR #18.
 *
 * Four phases, each callable independently:
 *   1. `parseLetterboxdExport`  — accepts a base64-encoded ZIP/CSV from a
 *      Letterboxd account export; returns the structured rows.
 *   2. `parseAndMatchMovies`    — paste-import: free text → parsed entries
 *      → TMDB-matched candidates with `selected` flags.
 *   3. `importMatchedMovies`    — write the user-confirmed match set into
 *      the caller's default list.
 *   4. `importLetterboxdMovies` — full one-shot: takes the structured
 *      Letterboxd data + import options, runs TMDB matching + writes
 *      everything (movies, ratings, reviews, lists, favorites).
 *
 * All four are auth-required at the route layer; caller UID is passed in
 * explicitly. Tight TMDB rate-limiting (50ms between requests) preserved
 * from the legacy actions.
 *
 * AUDIT 2.2 (preserved): bulk imports re-count the movies subcollection
 * and SET `movieCount` (instead of `increment(N)`) so re-imports stay
 * idempotent and partial failures self-heal.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';

// ─── Typed errors ─────────────────────────────────────────────────────────

export class LetterboxdValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LetterboxdValidationError';
  }
}

export class TmdbNotConfiguredError extends Error {
  constructor(message = 'TMDB not configured') {
    super(message);
    this.name = 'TmdbNotConfiguredError';
  }
}

// ─── Shared types ─────────────────────────────────────────────────────────

type LetterboxdRow = {
  Date?: string;
  Name: string;
  Year: string;
  'Letterboxd URI'?: string;
  Rating?: string;
};

type LetterboxdReviewRow = LetterboxdRow & { Review?: string };

export type LetterboxdData = {
  watched: LetterboxdRow[];
  ratings: LetterboxdRow[];
  watchlist: LetterboxdRow[];
  reviews: LetterboxdReviewRow[];
  favorites: LetterboxdRow[];
  lists: Array<{
    name: string;
    description?: string;
    movies: LetterboxdRow[];
  }>;
};

export type ParsedMovie = {
  originalLine: string;
  title: string;
  year: number | null;
};

export type MatchedMovie = {
  parsed: ParsedMovie;
  match: Record<string, unknown> | null;
  status: string;
  selected: boolean;
};

// ─── parseLetterboxdExport ────────────────────────────────────────────────

export async function parseLetterboxdExport(
  base64Data: string,
  fileName: string,
): Promise<{ data: LetterboxdData }> {
  const JSZip = (await import('jszip')).default;
  const Papa = (await import('papaparse')).default;

  const buffer = Buffer.from(base64Data, 'base64');
  const data: LetterboxdData = {
    watched: [], ratings: [], watchlist: [], reviews: [], favorites: [], lists: [],
  };

  const parseCSV = <T>(text: string): T[] => {
    const result = Papa.parse<T>(text, { header: true });
    return result.data.filter((row: any) => row.Name && row.Name.trim());
  };

  if (fileName.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(buffer);

    const watchedFile = zip.file('watched.csv');
    const ratingsFile = zip.file('ratings.csv');
    const watchlistFile = zip.file('watchlist.csv');
    const reviewsFile = zip.file('reviews.csv');
    const profileFile = zip.file('profile.csv');

    if (watchedFile) data.watched = parseCSV<LetterboxdRow>(await watchedFile.async('text'));
    if (ratingsFile) data.ratings = parseCSV<LetterboxdRow>(await ratingsFile.async('text'));
    if (watchlistFile) data.watchlist = parseCSV<LetterboxdRow>(await watchlistFile.async('text'));
    if (reviewsFile) data.reviews = parseCSV<LetterboxdReviewRow>(await reviewsFile.async('text'));

    if (profileFile) {
      const text = await profileFile.async('text');
      type ProfileRow = {
        'Date Joined'?: string;
        Username?: string;
        Bio?: string;
        'Favorite Films'?: string;
      };
      const profileData = parseCSV<ProfileRow>(text);
      if (profileData.length > 0 && profileData[0]['Favorite Films']) {
        const favoriteUris = profileData[0]['Favorite Films']!
          .split(',')
          .map((uri) => uri.trim())
          .filter((uri) => uri.length > 0);

        const uriToMovie = new Map<string, LetterboxdRow>();
        for (const movie of data.watched) {
          if (movie['Letterboxd URI']) uriToMovie.set(movie['Letterboxd URI'], movie);
        }
        for (const movie of data.ratings) {
          if (movie['Letterboxd URI'] && !uriToMovie.has(movie['Letterboxd URI'])) {
            uriToMovie.set(movie['Letterboxd URI'], movie);
          }
        }
        for (const uri of favoriteUris) {
          const movie = uriToMovie.get(uri);
          if (movie && data.favorites.length < 5) data.favorites.push(movie);
        }
      }
    }

    // Look for /lists/*.csv (user's custom lists)
    const listFiles = Object.keys(zip.files).filter(
      (name) => name.startsWith('lists/') && name.endsWith('.csv'),
    );
    for (const listPath of listFiles) {
      const listFile = zip.file(listPath);
      if (!listFile) continue;
      const text = await listFile.async('text');
      const lines = text.split('\n');

      let listName = listPath.replace('lists/', '').replace('.csv', '');
      let description = '';
      let movieStartIndex = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('Date,Name,Tags,') || line === 'Date,Name,Tags,URL,Description') {
          if (i + 1 < lines.length) {
            const metadataLine = lines[i + 1];
            const metaResult = Papa.parse<{ Name?: string; Description?: string }>(
              line + '\n' + metadataLine,
              { header: true },
            );
            if (metaResult.data.length > 0) {
              const meta = metaResult.data[0];
              if (meta.Name) listName = meta.Name.trim();
              if (meta.Description) description = meta.Description.trim();
            }
          }
        }
        if (line.startsWith('Position,Name,Year,') || line.startsWith('Position,Name,Year')) {
          movieStartIndex = i;
          break;
        }
      }

      const moviesCsvText = lines.slice(movieStartIndex).join('\n');
      const parsed = parseCSV<LetterboxdRow>(moviesCsvText);
      if (parsed.length > 0) {
        data.lists.push({ name: listName, description: description || undefined, movies: parsed });
      }
    }
  } else if (fileName.endsWith('.csv')) {
    const text = buffer.toString('utf-8');
    if (fileName.includes('watched'))      data.watched = parseCSV<LetterboxdRow>(text);
    else if (fileName.includes('rating'))   data.ratings = parseCSV<LetterboxdRow>(text);
    else if (fileName.includes('watchlist')) data.watchlist = parseCSV<LetterboxdRow>(text);
    else if (fileName.includes('review'))    data.reviews = parseCSV<LetterboxdReviewRow>(text);
    else data.watched = parseCSV<LetterboxdRow>(text);
  } else {
    throw new LetterboxdValidationError('Invalid file type. Please upload a .zip or .csv file.');
  }

  return { data };
}

// ─── parseAndMatchMovies (paste-import flow) ──────────────────────────────

export async function parseAndMatchMovies(
  text: string,
): Promise<{ matches: MatchedMovie[] }> {
  const TMDB_ACCESS_TOKEN = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  if (!TMDB_ACCESS_TOKEN) throw new TmdbNotConfiguredError();

  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const parsed: ParsedMovie[] = [];
  for (const line of lines) {
    let cleaned = line
      .replace(/^[\d]+[.\)]\s*/, '')
      .replace(/^[-•*]\s*/, '')
      .trim();
    const yearMatch = cleaned.match(/[\(\[]?(\d{4})[\)\]]?\s*$/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;
    const title = cleaned.replace(/[\(\[]?\d{4}[\)\]]?\s*$/, '').trim();
    if (title.length > 0) parsed.push({ originalLine: line, title, year });
  }
  if (parsed.length === 0) {
    throw new LetterboxdValidationError('No movies found in text');
  }

  const matches: MatchedMovie[] = [];
  for (const item of parsed) {
    try {
      const query = encodeURIComponent(item.title);
      const yearParam = item.year ? `&year=${item.year}` : '';
      const url = `https://api.themoviedb.org/3/search/movie?query=${query}${yearParam}&language=en-US&page=1`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        matches.push({ parsed: item, match: null, status: 'not_found', selected: false });
        continue;
      }
      const tmdbData = await response.json();
      const results = tmdbData.results || [];
      if (results.length === 0) {
        matches.push({ parsed: item, match: null, status: 'not_found', selected: false });
        continue;
      }
      let bestMatch = results[0];
      let status: 'exact_match' | 'best_guess' = 'best_guess';
      if (item.year) {
        const exactMatch = results.find((r: any) =>
          r.release_date?.startsWith(item.year!.toString()),
        );
        if (exactMatch) {
          bestMatch = exactMatch;
          status = 'exact_match';
        }
      } else if (results[0].release_date) {
        status = 'exact_match';
      }
      matches.push({ parsed: item, match: bestMatch, status, selected: true });
    } catch {
      matches.push({ parsed: item, match: null, status: 'not_found', selected: false });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { matches };
}

// ─── importMatchedMovies (paste-import phase 3) ───────────────────────────

async function getOrCreateDefaultList(
  db: FirebaseFirestore.Firestore,
  userId: string,
): Promise<string> {
  const listsSnapshot = await db
    .collection('users').doc(userId).collection('lists')
    .where('isDefault', '==', true)
    .limit(1).get();
  if (!listsSnapshot.empty) return listsSnapshot.docs[0].id;

  const listRef = db.collection('users').doc(userId).collection('lists').doc();
  await listRef.set({
    id: listRef.id,
    name: 'My Watchlist',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    isDefault: true,
    isPublic: false,
    ownerId: userId,
    collaboratorIds: [],
    movieCount: 0,
  });
  return listRef.id;
}

export async function importMatchedMovies(
  callerUid: string,
  matchedMovies: MatchedMovie[],
): Promise<{ importedCount: number }> {
  const db = getDb();
  const listId = await getOrCreateDefaultList(db, callerUid);

  const userDoc = await db.collection('users').doc(callerUid).get();
  const userData = userDoc.data();

  const moviesToImport = matchedMovies.filter((m) => m.selected && m.match);
  let importedCount = 0;
  const batches: FirebaseFirestore.WriteBatch[] = [];
  let currentBatch = db.batch();
  let operationCount = 0;

  for (const { match } of moviesToImport) {
    if (!match) continue;
    const matchTyped = match as Record<string, any>;
    const docId = `movie_${matchTyped.id}`;
    const movieRef = db
      .collection('users').doc(callerUid)
      .collection('lists').doc(listId)
      .collection('movies').doc(docId);

    currentBatch.set(movieRef, {
      id: docId,
      title: matchTyped.title,
      year: matchTyped.release_date?.slice(0, 4) || '',
      posterUrl: matchTyped.poster_path
        ? `https://image.tmdb.org/t/p/w500${matchTyped.poster_path}`
        : null,
      posterHint: matchTyped.title,
      addedBy: callerUid,
      status: 'To Watch',
      createdAt: FieldValue.serverTimestamp(),
      mediaType: 'movie',
      tmdbId: matchTyped.id,
      overview: matchTyped.overview || null,
      rating: matchTyped.vote_average || null,
      backdropUrl: matchTyped.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${matchTyped.backdrop_path}`
        : null,
      addedByDisplayName: userData?.displayName || null,
      addedByUsername: userData?.username || null,
      addedByPhotoURL: userData?.photoURL || null,
    }, { merge: true });

    operationCount++;
    importedCount++;
    if (operationCount >= 500) {
      batches.push(currentBatch);
      currentBatch = db.batch();
      operationCount = 0;
    }
  }
  if (operationCount > 0) batches.push(currentBatch);

  for (const batch of batches) await batch.commit();

  // AUDIT 2.2 — recount + SET (idempotent + self-healing under partial failure).
  const listRef = db.collection('users').doc(callerUid).collection('lists').doc(listId);
  const countSnap = await listRef.collection('movies').count().get();
  await listRef.update({
    movieCount: countSnap.data().count,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { importedCount };
}

// ─── importLetterboxdMovies (full one-shot pipeline) ─────────────────────

export type LetterboxdImportOptions = {
  importWatched: boolean;
  importRatings: boolean;
  importWatchlist: boolean;
  importReviews?: boolean;
  importLists?: boolean;
};

export async function importLetterboxdMovies(
  callerUid: string,
  letterboxdData: {
    watched: Array<{ Name: string; Year: string; Rating?: string }>;
    ratings: Array<{ Name: string; Year: string; Rating?: string }>;
    watchlist: Array<{ Name: string; Year: string }>;
    reviews?: Array<{ Name: string; Year: string; Rating?: string; Review?: string }>;
    favorites?: Array<{ Name: string; Year: string }>;
    lists?: Array<{ name: string; description?: string; movies: Array<{ Name: string; Year: string }> }>;
  },
  options: LetterboxdImportOptions,
): Promise<{ importedCount: number; reviewsImported: number; favoritesImported: number; listsCreated: number }> {
  const TMDB_ACCESS_TOKEN = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  if (!TMDB_ACCESS_TOKEN) throw new TmdbNotConfiguredError();

  const db = getDb();
  const listId = await getOrCreateDefaultList(db, callerUid);

  const userDoc = await db.collection('users').doc(callerUid).get();
  const userData = userDoc.data();

  const ratingsMap = new Map<string, number>();
  if (options.importRatings) {
    for (const row of letterboxdData.ratings) {
      if (row.Rating) {
        const key = `${row.Name.toLowerCase()}_${row.Year}`;
        ratingsMap.set(key, parseFloat(row.Rating) * 2);
      }
    }
  }
  const reviewsMap = new Map<string, string>();
  if (options.importReviews && letterboxdData.reviews) {
    for (const row of letterboxdData.reviews) {
      if (row.Review && row.Review.trim()) {
        const key = `${row.Name.toLowerCase()}_${row.Year}`;
        reviewsMap.set(key, row.Review.trim());
      }
    }
  }

  const topRatedMovies: Array<{
    id: string; title: string; posterUrl: string; tmdbId: number; rating: number;
  }> = [];

  const moviesToProcess: Array<{ name: string; year: string; status: 'Watched' | 'To Watch' }> = [];
  if (options.importWatched) {
    for (const row of letterboxdData.watched) {
      moviesToProcess.push({ name: row.Name, year: row.Year, status: 'Watched' });
    }
  }
  if (options.importWatchlist) {
    for (const row of letterboxdData.watchlist) {
      const alreadyWatched = letterboxdData.watched.some(
        (w) => w.Name === row.Name && w.Year === row.Year,
      );
      if (!alreadyWatched) {
        moviesToProcess.push({ name: row.Name, year: row.Year, status: 'To Watch' });
      }
    }
  }

  let importedCount = 0;
  const batches: FirebaseFirestore.WriteBatch[] = [];
  let currentBatch = db.batch();
  let operationCount = 0;

  for (const movie of moviesToProcess) {
    try {
      const query = encodeURIComponent(movie.name);
      const url = `https://api.themoviedb.org/3/search/movie?query=${query}&year=${movie.year}&language=en-US&page=1`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) continue;
      const tmdbData = await response.json();
      const results = tmdbData.results || [];
      if (results.length === 0) continue;

      const match = results.find((r: any) => r.release_date?.startsWith(movie.year)) || results[0];
      const docId = `movie_${match.id}`;
      const movieRef = db
        .collection('users').doc(callerUid)
        .collection('lists').doc(listId)
        .collection('movies').doc(docId);

      currentBatch.set(movieRef, {
        id: docId,
        title: match.title,
        year: match.release_date?.slice(0, 4) || movie.year,
        posterUrl: match.poster_path
          ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
          : null,
        posterHint: match.title,
        addedBy: callerUid,
        status: movie.status,
        createdAt: FieldValue.serverTimestamp(),
        mediaType: 'movie',
        tmdbId: match.id,
        overview: match.overview || null,
        rating: match.vote_average || null,
        backdropUrl: match.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}`
          : null,
        addedByDisplayName: userData?.displayName || null,
        addedByUsername: userData?.username || null,
        addedByPhotoURL: userData?.photoURL || null,
      }, { merge: true });

      operationCount++;
      importedCount++;

      const ratingKey = `${movie.name.toLowerCase()}_${movie.year}`;
      const userRating = ratingsMap.get(ratingKey);
      if (userRating && options.importRatings) {
        const ratingRef = db.collection('ratings').doc(`${callerUid}_${match.id}`);
        currentBatch.set(ratingRef, {
          userId: callerUid,
          tmdbId: match.id,
          mediaType: 'movie',
          movieTitle: match.title,
          moviePosterUrl: match.poster_path
            ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
            : null,
          rating: userRating,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        operationCount++;
        if (userRating === 10) {
          topRatedMovies.push({
            id: docId,
            title: match.title,
            posterUrl: match.poster_path
              ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
              : '',
            tmdbId: match.id,
            rating: userRating,
          });
        }
      }

      const userReview = reviewsMap.get(ratingKey);
      if (userReview && options.importReviews) {
        const reviewRef = db.collection('reviews').doc();
        currentBatch.set(reviewRef, {
          id: reviewRef.id,
          tmdbId: match.id,
          mediaType: 'movie',
          movieTitle: match.title,
          moviePosterUrl: match.poster_path
            ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
            : null,
          userId: callerUid,
          username: userData?.username || null,
          userDisplayName: userData?.displayName || null,
          userPhotoUrl: userData?.photoURL || null,
          text: userReview,
          ratingAtTime: userRating || null,
          likes: 0,
          likedBy: [],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        operationCount++;
      }

      if (operationCount >= 450) {
        batches.push(currentBatch);
        currentBatch = db.batch();
        operationCount = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch {
      continue;
    }
  }
  if (operationCount > 0) batches.push(currentBatch);
  for (const batch of batches) await batch.commit();

  const listRef = db.collection('users').doc(callerUid).collection('lists').doc(listId);
  const countSnap = await listRef.collection('movies').count().get();
  await listRef.update({
    movieCount: countSnap.data().count,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Imported user-defined lists (each gets its own new list).
  let listsCreated = 0;
  if (options.importLists && letterboxdData.lists && letterboxdData.lists.length > 0) {
    for (const lbList of letterboxdData.lists) {
      try {
        const newListRef = db.collection('users').doc(callerUid).collection('lists').doc();
        await newListRef.set({
          id: newListRef.id,
          name: lbList.name,
          description: lbList.description || null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          isDefault: false,
          isPublic: false,
          ownerId: callerUid,
          collaboratorIds: [],
          movieCount: 0,
        });

        let listMovieCount = 0;
        let listBatch = db.batch();
        let listBatchCount = 0;
        for (const movie of lbList.movies) {
          try {
            const query = encodeURIComponent(movie.Name);
            const url = `https://api.themoviedb.org/3/search/movie?query=${query}&year=${movie.Year}&language=en-US&page=1`;
            const response = await fetch(url, {
              headers: {
                Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
              },
            });
            if (!response.ok) continue;
            const tmdbData = await response.json();
            const results = tmdbData.results || [];
            if (results.length === 0) continue;
            const match = results.find((r: any) => r.release_date?.startsWith(movie.Year)) || results[0];

            const movieDocId = `movie_${match.id}`;
            const movieRef = db
              .collection('users').doc(callerUid)
              .collection('lists').doc(newListRef.id)
              .collection('movies').doc(movieDocId);
            listBatch.set(movieRef, {
              id: movieDocId,
              title: match.title,
              year: match.release_date?.slice(0, 4) || movie.Year,
              posterUrl: match.poster_path
                ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
                : null,
              posterHint: match.title,
              addedBy: callerUid,
              status: 'To Watch',
              createdAt: FieldValue.serverTimestamp(),
              mediaType: 'movie',
              tmdbId: match.id,
              overview: match.overview || null,
              rating: match.vote_average || null,
              backdropUrl: match.backdrop_path
                ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}`
                : null,
              addedByDisplayName: userData?.displayName || null,
              addedByUsername: userData?.username || null,
              addedByPhotoURL: userData?.photoURL || null,
            }, { merge: true });

            listBatchCount++;
            listMovieCount++;
            if (listBatchCount >= 450) {
              await listBatch.commit();
              listBatch = db.batch();
              listBatchCount = 0;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          } catch {
            continue;
          }
        }
        if (listBatchCount > 0) await listBatch.commit();
        if (listMovieCount > 0) {
          await newListRef.update({ movieCount: listMovieCount });
          listsCreated++;
        }
      } catch {
        continue;
      }
    }
  }

  // Favorites: prefer Letterboxd profile favorites, fall back to top-rated.
  let favoriteMoviesToSet: Array<{
    id: string; title: string; posterUrl: string; tmdbId: number;
  }> = [];
  if (letterboxdData.favorites && letterboxdData.favorites.length > 0) {
    for (const fav of letterboxdData.favorites.slice(0, 5)) {
      try {
        const query = encodeURIComponent(fav.Name);
        const url = `https://api.themoviedb.org/3/search/movie?query=${query}&year=${fav.Year}&language=en-US&page=1`;
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        });
        if (response.ok) {
          const tmdbData = await response.json();
          const results = tmdbData.results || [];
          if (results.length > 0) {
            const match = results.find((r: any) => r.release_date?.startsWith(fav.Year)) || results[0];
            favoriteMoviesToSet.push({
              id: `movie_${match.id}`,
              title: match.title,
              posterUrl: match.poster_path
                ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
                : '',
              tmdbId: match.id,
            });
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        // continue
      }
    }
  }
  if (favoriteMoviesToSet.length === 0 && topRatedMovies.length > 0) {
    favoriteMoviesToSet = topRatedMovies.slice(0, 5).map(({ id, title, posterUrl, tmdbId }) => ({
      id, title, posterUrl, tmdbId,
    }));
  }
  if (favoriteMoviesToSet.length > 0) {
    await db.collection('users').doc(callerUid).update({ favoriteMovies: favoriteMoviesToSet });
  }

  await db.collection('users').doc(callerUid).update({ onboardingComplete: true });

  return {
    importedCount,
    reviewsImported: reviewsMap.size,
    favoritesImported: favoriteMoviesToSet.length,
    listsCreated,
  };
}
