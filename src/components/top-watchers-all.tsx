'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { useUser } from '@/firebase';
import { haptic } from '@/lib/haptics';
import { seededGradient } from '@/lib/seeded-gradient';
import { Segmented } from '@/components/v3/segmented';
import { DetailScreen } from '@/components/v3/detail-screen';
import type { LeaderboardEntry } from '@/lib/leaderboard-server';

/**
 * F16 — "top watchers › all". The full weekly leaderboard behind the home rail's
 * "view all": this-week / this-month / all-time tabs, a podium for the top 3,
 * ranked rows below (your own row highlighted). Reads the **cached**
 * `GET /api/v1/leaderboard?window=&limit=50` (per-window, cached client-side too)
 * — no new reads on tab return. Weekly movement (+/−) is deferred until a cheap
 * prior-window snapshot exists (no fabricated deltas).
 */
type Win = 'week' | 'month' | 'all';
const WINDOW_LABEL: Record<Win, string> = {
  week: 'this week',
  month: 'this month',
  all: 'all time',
};
// Rank accents — pink / blue / sage for the podium (matches the home rail).
const RANK_ACCENT = ['oklch(0.66 0.15 350)', 'oklch(0.58 0.13 245)', 'oklch(0.52 0.11 150)'];

export function TopWatchersAll({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const { user } = useUser();
  const [win, setWin] = useState<Win>('week');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const cache = useRef<Map<Win, LeaderboardEntry[]>>(new Map());

  const load = useCallback(async (w: Win) => {
    const hit = cache.current.get(w);
    if (hit) {
      setEntries(hit);
      return;
    }
    setLoading(true);
    try {
      const r = await apiCall<{ entries: LeaderboardEntry[] }>(
        'GET',
        `/api/v1/leaderboard?window=${w}&limit=50`,
      );
      cache.current.set(w, r.entries ?? []);
      setEntries(r.entries ?? []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) load(win);
  }, [isOpen, win, load]);

  const openProfile = (username: string | null) => {
    if (!username) return;
    haptic('light');
    onClose();
    router.push(`/profile/${username}`);
  };

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <DetailScreen isOpen={isOpen} onClose={onClose} title="top watchers">
      <div className="px-[18px] pt-3 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
        <Segmented
          value={win}
          onChange={(v) => setWin(v as Win)}
          options={[
            { id: 'week', label: 'this week' },
            { id: 'month', label: 'this month' },
            { id: 'all', label: 'all time' },
          ]}
        />

        {loading && entries.length === 0 ? (
          <div className="flex justify-center pt-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <p className="pt-24 text-center font-serif italic text-[15px] text-muted-foreground">
            no films logged in your circle {WINDOW_LABEL[win]} yet.
          </p>
        ) : (
          <>
            <Podium entries={podium} meUid={user?.uid} onOpen={openProfile} />
            {rest.length > 0 && (
              <div className="mt-7 space-y-2.5">
                {rest.map((e) => (
                  <RankRow
                    key={e.uid}
                    entry={e}
                    unit={WINDOW_LABEL[win]}
                    isMe={e.uid === user?.uid}
                    onOpen={() => openProfile(e.username)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </DetailScreen>
  );
}

function Avatar({ entry, size }: { entry: LeaderboardEntry; size: number }) {
  if (entry.photoURL) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={entry.photoURL} alt="" className="w-full h-full object-cover" />;
  }
  return (
    <span
      className="flex w-full h-full items-center justify-center font-headline font-bold text-white"
      style={{ background: seededGradient(entry.username || entry.uid, 140), fontSize: size * 0.4 }}
    >
      {(entry.username || entry.displayName || '?').charAt(0).toUpperCase()}
    </span>
  );
}

function Podium({
  entries,
  meUid,
  onOpen,
}: {
  entries: LeaderboardEntry[];
  meUid?: string;
  onOpen: (username: string | null) => void;
}) {
  // Display order left → center → right = #2 · #1 · #3.
  const order = [entries[1], entries[0], entries[2]].filter(Boolean) as LeaderboardEntry[];
  return (
    <div className="mt-7 flex items-end justify-center gap-4">
      {order.map((e) => {
        const top = e.rank === 1;
        const size = top ? 92 : 70;
        const accent = RANK_ACCENT[(e.rank - 1) % RANK_ACCENT.length];
        return (
          <button
            key={e.uid}
            onClick={() => onOpen(e.username)}
            className="flex flex-col items-center text-center transition-transform active:scale-95"
            style={{ width: top ? 104 : 84 }}
          >
            <div className="relative" style={{ width: size, height: size }}>
              <div
                className="w-full h-full rounded-[24px] overflow-hidden bg-muted"
                style={top ? { boxShadow: `0 0 0 3px ${accent}` } : undefined}
              >
                <Avatar entry={e} size={size} />
              </div>
              <span
                className="absolute -left-1 -bottom-1 flex items-center justify-center rounded-full font-headline font-bold tabular-nums text-white border-[2.5px] border-background"
                style={{ background: accent, width: 26, height: 26, fontSize: 12 }}
              >
                {e.rank}
              </span>
            </div>
            <div className="mt-2.5 font-ui font-semibold text-[13px] text-foreground tracking-[-0.01em] truncate max-w-full">
              @{e.username || 'user'}
              {e.uid === meUid && <span className="text-primary"> · you</span>}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground tabular-nums">{e.films} films</div>
          </button>
        );
      })}
    </div>
  );
}

function RankRow({
  entry,
  unit,
  isMe,
  onOpen,
}: {
  entry: LeaderboardEntry;
  unit: string;
  isMe: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className={`w-full flex items-center gap-3 rounded-[16px] px-3.5 py-3 text-left transition-transform active:scale-[0.99] ${
        isMe ? 'bg-primary/[0.07] border border-primary/30' : 'bg-card border border-hair'
      }`}
    >
      <span className="w-5 flex-shrink-0 text-center font-headline font-bold text-[15px] tabular-nums text-muted-foreground">
        {entry.rank}
      </span>
      <span className="h-10 w-10 flex-shrink-0 rounded-full overflow-hidden bg-muted">
        <Avatar entry={entry} size={40} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-ui font-semibold text-[14px] text-foreground tracking-[-0.01em] truncate">
          @{entry.username || 'user'}
          {isMe && <span className="text-primary"> · you</span>}
        </div>
        <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {entry.films} films {unit}
        </div>
      </div>
    </button>
  );
}
