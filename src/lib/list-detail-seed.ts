'use client';

import type { MovieList } from '@/lib/types';

/**
 * sessionStorage-backed seed for the list-detail page.
 *
 * Why this exists: tapping a list card on `/lists` navigates to
 * `/lists/[listId]`. The destination page used to block ALL rendering on
 * `useDoc(listRef)` + the collaborative-list lookup — full-screen spinner
 * for ~150-400ms even though we already knew the list's name, cover, and
 * item count from the card we just tapped.
 *
 * Pattern (mirrors what Twitter / Instagram do natively): write the known
 * data forward on tap; the destination page reads it on first render and
 * paints the header + chrome synchronously. The real data fetch happens
 * in parallel and replaces the seed when it lands — usually with zero
 * visual change because the seed already matches.
 *
 * sessionStorage lifetime is exactly right here — survives the
 * intra-session navigation, never leaks across users or device restarts.
 *
 * Distinct from `cc-movie-modal:` (the openMovie-return seed) — that one
 * is for the modal-comments round-trip; this one is for the list-card-tap
 * forward jump.
 */

const SS_PREFIX = 'cc-list-seed:';

/**
 * Seed shape — only `id`, `name`, and `ownerId` are required; everything
 * else is optional. Different callers know different subsets of MovieList
 * (the /lists page knows almost everything; /profile/[username] knows
 * less); we accept the lowest common denominator and the detail page
 * uses whatever's present.
 */
export type ListSeed = {
  list: Partial<MovieList> & {
    id: string;
    name: string;
    ownerId: string;
    ownerUsername?: string | null;
    ownerDisplayName?: string | null;
  };
  previewPosters?: string[];
};

export function rememberListSeed(seed: ListSeed): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      SS_PREFIX + seed.list.id,
      JSON.stringify(seed),
    );
  } catch {
    /* quota / Safari private mode — non-critical; the destination still
       works, just shows a brief loading state. */
  }
}

export function recallListSeed(listId: string): ListSeed | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SS_PREFIX + listId);
    return raw ? (JSON.parse(raw) as ListSeed) : null;
  } catch {
    return null;
  }
}
