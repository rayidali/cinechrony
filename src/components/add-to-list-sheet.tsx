'use client';

import { useState, useEffect, useMemo } from 'react';
import { Drawer } from 'vaul';
import { Loader2, Check, Film } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import type { ListForMovie } from '@/lib/lists-server';
import { useToast } from '@/hooks/use-toast';
import { seededGradient } from '@/lib/seeded-gradient';
import { haptic } from '@/lib/haptics';
import type { SearchResult } from '@/lib/types';

type AddToListSheetProps = {
  movie: SearchResult | null;
  isOpen: boolean;
  onClose: () => void;
};

/**
 * F05 — "add to list". A membership toggle (not a one-shot add): each of the
 * caller's lists shows whether it already holds this film, and tapping toggles
 * it on/off (add ↔ remove) immediately. The in-list movie doc id is
 * deterministic (`${mediaType}_${tmdbId}`), so membership + toggling are exact.
 */
export function AddToListSheet({ movie, isOpen, onClose }: AddToListSheetProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [lists, setLists] = useState<ListForMovie[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Canonical identifiers (strip any `movie_`/`tv_` prefix from the id so the
  // add's doc id matches the membership doc id).
  const { tmdbId, mediaType, movieDocId } = useMemo(() => {
    const mt = movie?.mediaType === 'tv' ? 'tv' : 'movie';
    const id = movie?.tmdbId
      ?? (movie ? parseInt(String(movie.id).replace(/^(?:movie|tv)_/, ''), 10) : 0);
    return { tmdbId: id || 0, mediaType: mt, movieDocId: `${mt}_${id || 0}` };
  }, [movie]);

  useEffect(() => {
    if (!isOpen || !user || !tmdbId) return;
    let cancelled = false;
    setIsLoading(true);
    setBusy({});
    apiCall<{ lists: ListForMovie[] }>(
      'GET', `/api/v1/movies/${tmdbId}/list-membership?mediaType=${mediaType}`,
    )
      .then((res) => {
        if (cancelled) return;
        const ls = res.lists ?? [];
        setLists(ls);
        setChecked(Object.fromEntries(ls.map((l) => [l.id, l.contains])));
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, user, tmdbId, mediaType]);

  const toggle = async (list: ListForMovie) => {
    if (!user || !movie || !tmdbId || busy[list.id]) return;
    const next = !checked[list.id];
    haptic(next ? 'light' : 'selection');
    setChecked((c) => ({ ...c, [list.id]: next }));
    setBusy((b) => ({ ...b, [list.id]: true }));
    try {
      if (next) {
        await apiCall('POST', `/api/v1/lists/${user.uid}/${list.id}/movies`, {
          movieData: { ...movie, id: String(tmdbId) },
          status: 'To Watch',
        });
      } else {
        await apiCall('DELETE', `/api/v1/lists/${user.uid}/${list.id}/movies/${movieDocId}`);
      }
    } catch {
      setChecked((c) => ({ ...c, [list.id]: !next })); // roll back
      toast({ variant: 'destructive', title: 'Error', description: `Couldn't update "${list.name}".` });
    } finally {
      setBusy((b) => ({ ...b, [list.id]: false }));
    }
  };

  const mediaLabel = mediaType === 'tv' ? 'tv' : 'film';

  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[90]" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[90] flex flex-col rounded-t-[22px] bg-card outline-none max-h-[82vh]">
          <Drawer.Title className="sr-only">Add {movie?.title ?? 'movie'} to a list</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />

          {/* header */}
          <div className="flex items-center justify-between px-5 py-2.5">
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui font-semibold text-[15px] text-muted-foreground active:opacity-60">
              cancel
            </button>
            <span className="font-headline font-bold text-[18px] lowercase tracking-[-0.02em]">add to list</span>
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui font-bold text-[15px] text-primary active:opacity-60">
              done
            </button>
          </div>

          {/* film cell */}
          {movie && (
            <div className="flex items-center gap-3 px-5 pb-3">
              <div className="relative h-12 w-9 flex-shrink-0 rounded-lg overflow-hidden bg-sunken">
                {movie.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={movie.posterUrl} alt="" className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0">
                <div className="font-headline font-bold text-[16px] lowercase tracking-[-0.02em] truncate">
                  adding · {movie.title.toLowerCase()}
                </div>
                <div className="font-mono text-[10px] text-muted-foreground lowercase truncate">
                  {[movie.year && movie.year !== 'N/A' ? movie.year : null, mediaLabel].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
          )}

          <div className="px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : lists.length === 0 ? (
              <p className="font-serif italic text-[15px] text-muted-foreground py-8 text-center">
                nothing on the shelves yet — make a list first.
              </p>
            ) : (
              <div className="rounded-2xl border border-hair bg-card divide-y divide-hair overflow-hidden">
                {lists.map((list) => {
                  const on = !!checked[list.id];
                  const cover = list.coverImageUrl && list.coverMode !== 'auto' ? list.coverImageUrl : null;
                  return (
                    <button
                      key={list.id}
                      onClick={() => toggle(list)}
                      disabled={!!busy[list.id]}
                      className="w-full flex items-center gap-3 p-3 text-left active:bg-foreground/5 transition-colors"
                    >
                      <span
                        className="relative h-11 w-11 flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center"
                        style={!cover ? { background: seededGradient(list.name) } : undefined}
                      >
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cover} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Film className="h-4 w-4 text-white/80" strokeWidth={1.8} />
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-headline font-bold text-[15px] lowercase tracking-[-0.02em] truncate">
                          {list.name}
                        </span>
                        <span className="block font-mono text-[10px] text-muted-foreground tabular-nums">
                          {list.movieCount} {list.movieCount === 1 ? 'film' : 'films'}
                        </span>
                      </span>
                      <span
                        className={`flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center transition-colors ${
                          on ? 'bg-primary text-white' : 'border-2 border-hair'
                        }`}
                      >
                        {busy[list.id] ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : on ? (
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
