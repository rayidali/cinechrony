'use client';

import { Link } from '@/lib/native-nav';
import { apiCall } from '@/lib/api-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { Section, ViewAll } from '@/components/v3/section';
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

export function TopWatchers({ onViewAll }: { onViewAll?: () => void }) {
  const { data } = useCachedAction<LeaderboardEntry[]>('home-leaderboard', async () => {
    const r = await apiCall<{ entries: LeaderboardEntry[] }>('GET', '/api/v1/leaderboard?window=week&fallback=1');
    return r.entries ?? [];
  }, { staleTime: 600_000 }); // weekly leaderboard — 10 min

  const entries = data ?? [];
  if (data && entries.length === 0) return null;

  return (
    <section>
      <Section
        eyebrow="weekly leaderboard"
        title="top watchers"
        trailing={<ViewAll onTap={onViewAll} />}
        className="mb-3.5"
      />
      <div className="flex gap-4 overflow-x-auto scrollbar-hide -mx-[18px] px-[18px] pb-1">
        {entries.map((e) => {
          const inner = (
            <>
            <div className="relative w-[76px] h-[76px] mx-auto">
              <div className="w-[76px] h-[76px] rounded-[26px] overflow-hidden bg-muted">
                {e.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img loading="lazy" decoding="async" src={e.photoURL} alt="" className="w-full h-full object-cover" />
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
            </>
          );
          // A username-less entry must not render a dead `#` anchor (focusable,
          // scrolls to top, dirties the URL) — fall back to a plain div, like
          // TopWatchersAll's null-guard. Keep the entry so ranks don't shift.
          return e.username ? (
            <Link key={e.uid} href={`/profile/${e.username}`} className="flex-shrink-0 w-[76px] text-center">
              {inner}
            </Link>
          ) : (
            <div key={e.uid} className="flex-shrink-0 w-[76px] text-center">
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}
