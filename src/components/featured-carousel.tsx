'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Bookmark } from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { haptic } from '@/lib/haptics';
import { seededGradient } from '@/lib/seeded-gradient';
import type { LovedListCard } from '@/lib/lists-server';

const LOVED_KEY = 'home-loved-lists';

export function useLovedLists() {
  return useCachedAction<LovedListCard[]>(LOVED_KEY, async () => {
    const r = await apiCall<{ lists: LovedListCard[]; gated: boolean }>('GET', '/api/v1/lists/loved?limit=10');
    return r.lists ?? [];
  });
}

/**
 * Featured — the swipeable editorial list hero (Phase 0.7 / v3,
 * `ios-home.jsx::Featured`). Ghost title + scrim + eyebrow + lowercase title +
 * curator + glass advance + dots. Real loved lists (top few); hidden when none.
 */
export function FeaturedCarousel() {
  const router = useRouter();
  const { data } = useLovedLists();
  const [i, setI] = useState(0);

  // Top 3 in the hero; the rest fall to the "from the community" rail (slice 3),
  // so that rail appears once there are ≥4 lists (no overlap between the two).
  const lists = (data ?? []).slice(0, 3);
  if (data && lists.length === 0) return null;
  if (lists.length === 0) return null;

  const f = lists[i % lists.length];
  const next = () => {
    haptic('selection');
    setI((p) => (p + 1) % lists.length);
  };

  const cover = f.coverImageUrl && f.coverMode !== 'auto' ? f.coverImageUrl : null;
  const open = () => {
    if (f.ownerUsername) router.push(`/profile/${f.ownerUsername}/lists/${f.id}`);
  };

  return (
    <div
      className="relative h-[300px] rounded-[24px] overflow-hidden shadow-photo"
      style={!cover ? { background: seededGradient(f.name) } : undefined}
    >
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}

      {/* ghost title */}
      <div className="absolute inset-0 flex items-center justify-center px-4 text-center pointer-events-none">
        <span
          className="font-headline font-bold lowercase text-white/[0.08] leading-[0.84] tracking-[-0.05em]"
          style={{ fontSize: 88, fontVariationSettings: '"wdth" 86' }}
        >
          {f.name}
        </span>
      </div>

      {/* scrim */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.28) 0%, transparent 32%, transparent 44%, rgba(0,0,0,0.74) 100%)',
        }}
      />

      {/* tap target */}
      <button onClick={open} aria-label={f.name} className="absolute inset-0" />

      {/* content */}
      <div className="absolute left-[22px] right-[22px] bottom-[22px] z-[2] pointer-events-none">
        <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/[0.86] mb-2.5">
          <Bookmark className="h-[11px] w-[11px]" strokeWidth={2.2} />
          loved list
        </div>
        <div
          className="font-headline font-bold lowercase text-white leading-[0.96] tracking-[-0.04em] line-clamp-2"
          style={{ fontSize: 30, fontVariationSettings: '"wdth" 90', textShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
        >
          {f.name}
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          {f.ownerUsername && (
            <span className="h-6 w-6 rounded-full overflow-hidden ring-2 ring-black/35 flex items-center justify-center font-headline font-bold text-[11px] text-white"
              style={{ background: seededGradient(f.ownerUsername, 140) }}
            >
              {f.ownerUsername.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="font-mono text-[11px] text-white/[0.82] tracking-[-0.01em]">
            {f.movieCount} films{f.ownerUsername ? ` · by @${f.ownerUsername}` : ''}
          </span>
        </div>
      </div>

      {/* advance */}
      {lists.length > 1 && (
        <button
          onClick={next}
          aria-label="Next featured list"
          className="absolute right-4 top-4 z-[2] h-[38px] w-[38px] rounded-full inline-flex items-center justify-center text-white border-[0.5px] border-white/20 bg-black/30 backdrop-blur-md active:scale-95 transition-transform"
        >
          <ArrowRight className="h-[19px] w-[19px]" strokeWidth={2.1} />
        </button>
      )}

      {/* dots */}
      {lists.length > 1 && (
        <div className="absolute left-0 right-0 bottom-[9px] z-[2] flex justify-center gap-1.5">
          {lists.map((_, k) => (
            <span
              key={k}
              className="h-1.5 rounded-full transition-all duration-200"
              style={{
                width: k === i ? 18 : 6,
                background: k === i ? '#fff' : 'rgba(255,255,255,0.5)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
