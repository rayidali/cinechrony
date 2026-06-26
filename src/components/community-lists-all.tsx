'use client';

import { useRouter } from '@/lib/native-nav';
import { Globe, Loader2 } from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { seededGradient } from '@/lib/seeded-gradient';
import { haptic } from '@/lib/haptics';
import { DetailScreen } from '@/components/v3/detail-screen';
import type { LovedListCard } from '@/lib/lists-server';

/**
 * F17 — "community lists › all". The full loved-lists browse behind the home
 * rail's "view all": 2-up cover cards (fanned posters / cover / gradient) with
 * `N films · M saved`. Reads the **globally cached** `GET /api/v1/lists/loved`
 * (limit 60) — one shared scan serves everyone (free-tier discipline). Loved
 * lists are public by definition, so the visibility glyph is always the globe.
 */
export function CommunityListsAll({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const { data, isLoading, refetch } = useCachedAction<LovedListCard[]>('community-all', async () => {
    const r = await apiCall<{ lists: LovedListCard[]; gated: boolean }>(
      'GET',
      '/api/v1/lists/loved?limit=30',
    );
    return r.lists ?? [];
  });
  const lists = data ?? [];

  const open = (l: LovedListCard) => {
    if (!l.ownerUsername) return;
    haptic('light');
    onClose();
    router.push(`/profile/${l.ownerUsername}/lists/${l.id}`);
  };

  return (
    <DetailScreen isOpen={isOpen} onClose={onClose} title="from the community">
      <div className="px-[18px] pt-3 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-3.5">
          lists for you
        </div>

        {isLoading && !data ? (
          <div className="flex justify-center pt-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : lists.length === 0 ? (
          <div className="pt-20 text-center">
            <p className="font-serif italic text-[15px] text-muted-foreground">
              no community lists to show yet.
            </p>
            <button
              onClick={() => {
                haptic('light');
                refetch();
              }}
              className="mt-4 font-ui font-semibold text-[13px] text-primary transition-opacity active:opacity-60"
            >
              try again
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3.5">
            {lists.map((l) => (
              <ListCard key={l.id} list={l} onOpen={() => open(l)} />
            ))}
          </div>
        )}
      </div>
    </DetailScreen>
  );
}

function ListCard({ list, onOpen }: { list: LovedListCard; onOpen: () => void }) {
  const cover = list.coverImageUrl && list.coverMode !== 'auto' ? list.coverImageUrl : null;
  const posters = (list.previewPosters ?? []).filter(Boolean).slice(0, 3);

  return (
    <button onClick={onOpen} className="text-left group">
      <div
        className="relative aspect-square rounded-[18px] overflow-hidden shadow-photo bg-sunken transition-transform duration-200 group-active:scale-[0.98]"
        style={!cover ? { background: seededGradient(list.name) } : undefined}
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : posters.length > 0 ? (
          <CoverFan posters={posters} />
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="flex-1 min-w-0 font-headline font-bold text-[15px] lowercase tracking-[-0.02em] truncate">
          {list.name}
        </span>
        <Globe className="h-3 w-3 flex-shrink-0 text-muted-foreground" strokeWidth={2} />
      </div>
      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
        {list.movieCount} films
        {list.likes > 0 ? ` · ${formatSaved(list.likes)} saved` : ''}
      </p>
    </button>
  );
}

/** Up to three list posters fanned into the square cover — center upright. */
function CoverFan({ posters }: { posters: string[] }) {
  const [front, left, right] = posters;
  const items = [
    left ? { src: left, rot: -12, x: '-26%', z: 1 } : null,
    right ? { src: right, rot: 12, x: '26%', z: 1 } : null,
    front ? { src: front, rot: 0, x: '0%', z: 2 } : null,
  ].filter(Boolean) as { src: string; rot: number; x: string; z: number }[];

  return (
    <>
      {items.map((it, k) => (
        <span
          key={k}
          className="absolute left-1/2 top-1/2 w-[52%] aspect-[2/3] rounded-[9px] overflow-hidden border-[0.5px] border-black/25 shadow-[0_10px_22px_rgba(0,0,0,0.4)]"
          style={{
            transform: `translate(-50%,-50%) translateX(${it.x}) rotate(${it.rot}deg)`,
            zIndex: it.z,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={it.src} alt="" className="w-full h-full object-cover" />
        </span>
      ))}
    </>
  );
}

function formatSaved(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}
