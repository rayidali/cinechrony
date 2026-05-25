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
 *  · Trending strip (films + loved lists) — global, identical for everyone,
 *    very stable day-to-day.
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

registerPersistedCache('trending-films');
registerPersistedCache('loved-lists');

registerPersistedPrefix('home-feed:');
registerPersistedPrefix('home-recs:');
registerPersistedPrefix('home-fw:');
registerPersistedPrefix('following:');
registerPersistedPrefix('collab-lists:');
