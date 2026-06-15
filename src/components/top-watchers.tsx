'use client';

import Link from 'next/link';
import { apiCall } from '@/lib/api-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { Section } from '@/components/v3/section';
import { seededGradient } from '@/lib/seeded-gradient';
import type { LeaderboardEntry } from '@/lib/leaderboard-server';

/**
 * "top watchers" — weekly leaderboard rail (Phase 0.7 / v3,
 * `ios-home.jsx::Leaderboard`). Real aggregate from `GET /api/v1/leaderboard`
 * (films logged this week across your follow graph). Hidden when there's no
 * activity yet — no fabricated rows.
 */
const RANK_ACCENT = [
  'oklch(0.66 0.15 350)', // 1 pink
  'oklch(0.58 0.13 245)', // 2 blue
  'oklch(0.52 0.11 150)', // 3 sage
  'oklch(0.78 0.13 78)', // 4 amber
  'oklch(0.55 0.14 300)', // 5 violet
];

export function TopWatchers() {
  const { data } = useCachedAction<LeaderboardEntry[]>('home-leaderboard', async () => {
    const r = await apiCall<{ entries: LeaderboardEntry[] }>('GET', '/api/v1/leaderboard?window=week');
    return r.entries ?? [];
  });

  const entries = data ?? [];
  if (data && entries.length === 0) return null;

  return (
    <section>
      <Section
        eyebrow="weekly leaderboard"
        title="top watchers"
        trailing={<span className="font-ui font-semibold text-[13px] text-primary">view all</span>}
        className="mb-3.5"
      />
      <div className="flex gap-4 overflow-x-auto scrollbar-hide -mx-[18px] px-[18px] pb-1">
        {entries.map((e) => (
          <Link
            key={e.uid}
            href={e.username ? `/profile/${e.username}` : '#'}
            className="flex-shrink-0 w-[76px] text-center"
          >
            <div className="relative w-[76px] h-[76px] mx-auto">
              <div className="w-[76px] h-[76px] rounded-[26px] overflow-hidden bg-muted">
                {e.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span
                    className="flex w-full h-full items-center justify-center font-headline font-bold text-2xl text-white"
                    style={{ background: seededGradient(e.username || e.uid, 140) }}
                  >
                    {(e.username || e.displayName || '?').charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <span
                className="absolute -left-[3px] -bottom-[3px] w-[26px] h-[26px] rounded-full flex items-center justify-center font-headline font-bold text-[12px] tabular-nums text-white border-[2.5px] border-background"
                style={{ background: RANK_ACCENT[(e.rank - 1) % RANK_ACCENT.length] }}
              >
                {e.rank}
              </span>
            </div>
            <div className="mt-[9px] font-ui font-semibold text-[12px] text-foreground tracking-[-0.01em] truncate">
              @{e.username || 'user'}
            </div>
            <div className="font-mono text-[9.5px] text-muted-foreground tabular-nums">{e.films} films</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
