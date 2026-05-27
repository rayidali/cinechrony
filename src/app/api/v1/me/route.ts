/**
 * `/api/v1/me` — the calling user's profile (Phase A PR #2).
 *
 *  PATCH   `{ bio?, photoURL?, favoriteMovies? }` → updates whichever fields
 *          are present. Collapses three legacy Server Actions
 *          (`updateBio` + `updateProfilePhoto` + `updateFavoriteMovies`) into
 *          one JSON-merge endpoint.
 *
 *  DELETE  `{ confirmUsername }` → hard-delete the account + cascade. Wraps
 *          `deleteAccount` (extracted to `@/lib/account-server`).
 *          Closes AUDIT.md 1.2 — the verified uid IS the deletion target;
 *          the typed username is a confirmation, not an identity claim.
 *
 * Audit suite: `scripts/audit-tests/27-me-endpoints.test.ts`.
 */

import { revalidatePath } from 'next/cache';
import { getDb } from '@/firebase/admin';
import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  deleteAccount,
  ConfirmationMismatchError,
  UserNotFoundError,
} from '@/lib/account-server';

export const dynamic = 'force-dynamic';

// ─── PATCH /api/v1/me ─────────────────────────────────────────────────────

type FavoriteMovie = {
  id: string;
  title: string;
  posterUrl: string;
  tmdbId: number;
};

type PatchMeBody = {
  bio?: string;
  photoURL?: string;
  favoriteMovies?: FavoriteMovie[];
};

function isFavoriteMovie(v: unknown): v is FavoriteMovie {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.posterUrl === 'string' &&
    typeof o.tmdbId === 'number'
  );
}

export const PATCH = apiRoute(async (req, { auth }) => {
  let body: PatchMeBody;
  try {
    body = (await req.json()) as PatchMeBody;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  // Build the Firestore update payload from whichever fields are present.
  // Each field is independently validated; an invalid field → 400 without
  // applying ANY of the updates (atomic from the client's POV).
  const updates: Record<string, unknown> = {};
  const responseFields: PatchMeBody = {};

  if (body.bio !== undefined) {
    if (typeof body.bio !== 'string') throw new BadRequestError('bio must be a string.');
    const trimmed = body.bio.trim().slice(0, 160);
    updates.bio = trimmed || null;
    responseFields.bio = trimmed;
  }

  if (body.photoURL !== undefined) {
    if (typeof body.photoURL !== 'string') {
      throw new BadRequestError('photoURL must be a string.');
    }
    if (!body.photoURL.startsWith('http://') && !body.photoURL.startsWith('https://')) {
      throw new BadRequestError('Invalid photo URL.');
    }
    updates.photoURL = body.photoURL;
    responseFields.photoURL = body.photoURL;
  }

  if (body.favoriteMovies !== undefined) {
    if (!Array.isArray(body.favoriteMovies)) {
      throw new BadRequestError('favoriteMovies must be an array.');
    }
    const limited = body.favoriteMovies.slice(0, 5);
    if (!limited.every(isFavoriteMovie)) {
      throw new BadRequestError(
        'favoriteMovies items must be { id, title, posterUrl, tmdbId }.',
      );
    }
    updates.favoriteMovies = limited;
    responseFields.favoriteMovies = limited;
  }

  if (Object.keys(updates).length === 0) {
    throw new BadRequestError('No updatable fields provided.');
  }

  const db = getDb();
  const userRef = db.collection('users').doc(auth.uid);
  // Existence guard — update() against a missing doc throws NOT_FOUND from
  // Firestore; surface it as our typed 404 so the client can distinguish.
  const exists = await userRef.get();
  if (!exists.exists) throw new NotFoundError('User profile not found.');

  await userRef.update(updates);

  // Same revalidation surface as the legacy actions.
  revalidatePath('/profile');
  revalidatePath('/profile/[username]');

  return responseFields;
});

// ─── DELETE /api/v1/me ────────────────────────────────────────────────────

type DeleteMeBody = { confirmUsername: string };

export const DELETE = apiRoute(async (req, { auth }) => {
  let body: DeleteMeBody;
  try {
    body = (await req.json()) as DeleteMeBody;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (typeof body.confirmUsername !== 'string') {
    throw new BadRequestError('confirmUsername is required.');
  }

  try {
    await deleteAccount(auth.uid, body.confirmUsername);
    // Best-effort revalidate; the user's own pages are about to 404 for them.
    revalidatePath('/profile');
    revalidatePath('/home');
    return { success: true };
  } catch (err) {
    if (err instanceof ConfirmationMismatchError) {
      throw new BadRequestError(err.message);
    }
    if (err instanceof UserNotFoundError) {
      throw new NotFoundError(err.message);
    }
    throw err; // surface as 500 via the wrapper
  }
});

export const OPTIONS = optionsHandler;
