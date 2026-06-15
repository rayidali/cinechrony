'use client';

import { useCachedAction } from '@/lib/use-cached-action';
import { apiCall } from '@/lib/api-client';
import type { FriendsWatchingCard as FWCard } from '@/lib/friends-watching-server';

/**
 * Presence pill — "the reel" (Phase 0.7 / v3).
 *
 * "N of your circle are watching" — a real, non-fabricated count derived from
 * the existing friends-watching aggregate (followed users who recently touched
 * the same films). We union the distinct friends across every card. No live
 * presence / heartbeat (decided 2026-06-13) — this is genuine recent activity.
 *
 * Shares the `home-fw:{uid}` SWR key with the feed's friends-watching cards, so
 * it paints from cache and never double-fetches. Hidden when the circle is quiet.
 */
export function PresencePill({ userId }: { userId: string }) {
  const { data } = useCachedAction<FWCard[]>(
    userId ? `home-fw:${userId}` : null,
    async () => {
      const r = await apiCall<{ cards: FWCard[] }>('GET', '/api/v1/friends-watching');
      return r.cards ?? [];
    },
  );

  const cards = data ?? [];
  const byUid = new Map<string, FWCard['friends'][number]>();
  for (const c of cards) {
    for (const f of c.friends) {
      if (!byUid.has(f.uid)) byUid.set(f.uid, f);
    }
  }
  const friends = [...byUid.values()];
  if (friends.length === 0) return null;

  const shown = friends.slice(0, 3);

  return (
    <div className="mt-3 inline-flex items-center gap-2.5 pl-1.5 pr-3.5 py-1.5 rounded-full border border-hair bg-card shadow-lift">
      <div className="flex -space-x-2">
        {shown.map((f) => (
          <span
            key={f.uid}
            className="h-[22px] w-[22px] rounded-full ring-2 ring-card overflow-hidden bg-muted inline-flex items-center justify-center"
          >
            {f.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.photoURL} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-[9px] font-semibold text-muted-foreground">
                {(f.username || f.displayName || '?').charAt(0).toUpperCase()}
              </span>
            )}
          </span>
        ))}
      </div>
      <span className="cc-meta text-[12px] text-foreground/90">
        <span className="font-semibold text-foreground tabular-nums">{friends.length}</span>{' '}
        of your circle {friends.length === 1 ? 'is' : 'are'} watching
      </span>
    </div>
  );
}
