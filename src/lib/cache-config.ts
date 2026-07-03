'use client';

import {
  registerPersistedCache,
  registerPersistedPrefix,
} from '@/lib/use-cached-action';

/**
 * Persist the caches that pay off on cold app open — closed-and-reopened
 * PWA, refresh, or app launch after a system kill. Without this, every
 * cold start hits the network with skeletons regardless of how recently
 * the user used the app.
 *
 * What we persist:
 *  · The home discovery rails — global, identical for everyone, stable
 *    day-to-day: `home-loved-lists`, `home-dig-in`, `home-leaderboard`,
 *    `home-hot-takes`. (These are the keys the LIVE rails actually use; the
 *    old `trending-films`/`loved-lists` registrations were dead — their
 *    consumer, trending-strip, was retired from home in 0.7 — so every cold
 *    open re-fetched every rail and pop-in danced. 2026-07 fix.)
 *  · User-scoped feeds — `home-feed:${uid}:*`, `home-recs:${uid}`,
 *    `home-fw:${uid}`, `following:${uid}`, `collab-lists:${uid}`.
 *
 * What we DON'T persist:
 *  · Anything containing tokens, raw Firestore Timestamps, or other data
 *    that won't survive JSON round-trip cleanly.
 *
 * Imported with side-effect from `client-provider.tsx` so the registration
 * runs once, at module load time, before any consuming component mounts.
 */

registerPersistedCache('home-loved-lists');
registerPersistedCache('home-dig-in');
registerPersistedCache('home-leaderboard');
registerPersistedCache('home-hot-takes');

registerPersistedPrefix('home-feed:');
registerPersistedPrefix('home-recs:');
registerPersistedPrefix('home-fw:');
registerPersistedPrefix('following:');
registerPersistedPrefix('collab-lists:');
