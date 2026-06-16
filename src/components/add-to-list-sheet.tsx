'use client';

import { useState, useEffect, useTransition } from 'react';
import { Drawer } from 'vaul';
import { Loader2, ListPlus } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import type { ListSummary } from '@/lib/lists-server';
import { useToast } from '@/hooks/use-toast';
import type { SearchResult } from '@/lib/types';

type ListRow = { id: string; name: string; movieCount: number };

type AddToListSheetProps = {
  movie: SearchResult | null;
  isOpen: boolean;
  onClose: () => void;
};

/**
 * "which list?" — the bottom sheet behind every explicit `+ to a list`
 * affordance (recommendation cards, friends-watching). Adds the film to one of
 * the viewer's lists via the existing addMovieToList FormData action.
 */
export function AddToListSheet({ movie, isOpen, onClose }: AddToListSheetProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [lists, setLists] = useState<ListRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!isOpen || !user) return;
    let cancelled = false;
    setIsLoading(true);
    apiCall<{ lists: ListSummary[] }>('GET', `/api/v1/users/${user.uid}/lists`)
      .then((res) => {
        if (cancelled) return;
        setLists(
          (res.lists ?? []).map((l) => ({
            id: l.id,
            name: l.name,
            movieCount: l.movieCount ?? 0,
          })),
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, user]);

  const handleAdd = (listId: string, listName: string) => {
    if (!user || !movie || addingId) return;
    setAddingId(listId);
    startTransition(async () => {
      try {
        await apiCall('POST', `/api/v1/lists/${user.uid}/${listId}/movies`, {
          movieData: movie,
          status: 'To Watch',
        });
        toast({ title: 'added.', description: `${movie.title} → ${listName}` });
        onClose();
      } catch {
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to add.' });
      } finally {
        setAddingId(null);
      }
    });
  };

  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[90]" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[90] flex flex-col rounded-t-2xl bg-card outline-none max-h-[70vh]">
          <Drawer.Title className="sr-only">Add {movie?.title ?? 'movie'} to a list</Drawer.Title>
          <div className="mx-auto mt-3 mb-1 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="px-5 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))] overflow-y-auto">
            <div className="cc-eyebrow">which list?</div>
            <div className="h-px bg-border mt-2.5 mb-1" />
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : lists.length === 0 ? (
              <p className="font-serif italic text-sm text-muted-foreground py-8 text-center">
                nothing on the shelves yet — make a list first.
              </p>
            ) : (
              <ul>
                {lists.map((list) => (
                  <li key={list.id}>
                    <button
                      onClick={() => handleAdd(list.id, list.name)}
                      disabled={!!addingId}
                      className="w-full flex items-center gap-3 py-3 text-left active:opacity-60 disabled:opacity-50 transition-opacity"
                    >
                      <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                        <ListPlus className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-headline font-semibold text-sm lowercase tracking-tight truncate">
                          {list.name}
                        </p>
                        <p className="cc-meta text-[11px] text-muted-foreground">
                          {list.movieCount} {list.movieCount === 1 ? 'film' : 'films'}
                        </p>
                      </div>
                      {addingId === list.id && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
