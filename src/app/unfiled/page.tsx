'use client';

/**
 * unfiled — the holding pen (Phase D2,
 * `../design-refs-2026-08/screens/01-unfiled-inbox.png`).
 *
 * Films land here when a grab is saved without choosing a list, which is now
 * the default path: the save no longer stops to ask. This screen is where they
 * get a home.
 *
 * It reads the pen DIRECTLY with `useCollection`, not through an endpoint. The
 * pen's list id is reserved and deterministic (`UNFILED_LIST_ID`), so the path
 * is addressable from the first render — an endpoint would cost a round trip
 * and lose the real-time updates that make a file feel instant.
 *
 * NO PERMANENT EMPTY BUCKET. The deck is explicit that unfiled "only exists
 * when it has something in it", so an empty pen is not a screen with an empty
 * state — it says its piece and offers the way out. Nothing in the tab bar ever
 * nags; entry is the home strip's count badge, which is itself conditional.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { collection, orderBy, query, limit } from 'firebase/firestore';
import { ChevronLeft, Bookmark, Loader2 } from 'lucide-react';
import { useRouter } from '@/lib/native-nav';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { Frost } from '@/components/v3/frost';
import { ListPickerSheet, type ListDestination, type PickableList } from '@/components/list-picker-sheet';
import { FullscreenTextInput } from '@/components/fullscreen-text-input';
import { UnfiledRow } from '@/components/unfiled-row';
import { useToast } from '@/hooks/use-toast';
import { apiCall } from '@/lib/api-client';
import { useCachedAction, invalidateCachedAction } from '@/lib/use-cached-action';
import { haptic } from '@/lib/haptics';
import { UNFILED_LIST_ID } from '@/lib/unfiled-constants';
import type { Movie } from '@/lib/types';
import type { ListSummary } from '@/lib/lists-server';

const PILL =
  'inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 ' +
  'font-ui font-semibold text-[14px] lowercase active:opacity-60 transition-opacity disabled:opacity-40';

export default function UnfiledPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();

  /** The films this file action applies to — one row, or all of them. */
  const [pending, setPending] = useState<string[] | null>(null);
  const [namingList, setNamingList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!isUserLoading && !user) router.push('/login');
  }, [user, isUserLoading, router]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const moviesQuery = useMemoFirebase(() => {
    if (!user) return null;
    return query(
      collection(firestore, 'users', user.uid, 'lists', UNFILED_LIST_ID, 'movies'),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
  }, [firestore, user]);
  const { data: films, isLoading } = useCollection<Movie>(moviesQuery);

  // Destinations for the picker. The pen itself is already excluded
  // server-side by `getUserLists`, so nothing here has to remember to.
  const listsResult = useCachedAction<{ lists: ListSummary[] }>(
    user ? `own-lists:${user.uid}` : null,
    () => apiCall<{ lists: ListSummary[] }>('GET', '/api/v1/lists'),
    { staleTime: 60_000 },
  );
  const pickable: PickableList[] = useMemo(
    () => (listsResult.data?.lists ?? []).map((l) => ({
      id: l.id, name: l.name, ownerId: l.ownerId,
      isPublic: l.isPublic, movieCount: l.movieCount, coverImageUrl: l.coverImageUrl,
    })),
    [listsResult.data],
  );

  const runFile = useCallback(
    async (movieIds: string[], target: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await apiCall<{ filed: string[]; failed: { movieId: string }[] }>(
          'POST', '/api/v1/unfiled/file', { movieIds, target },
        );
        // The list the films landed in changed, and so did the pen. The pen is
        // a live listener so it heals itself; the lists cache is not.
        invalidateCachedAction(`own-lists:${user?.uid}`);
        haptic('medium');
        if (res.failed.length) {
          toast({
            title: res.filed.length ? 'filed most of them' : 'that did not work',
            description: `${res.failed.length} could not be filed. they are still here.`,
          });
        }
      } catch {
        toast({ title: 'that did not work', description: 'nothing was lost. try again in a moment.' });
      } finally {
        setBusy(false);
        setPending(null);
      }
    },
    [toast, user?.uid],
  );

  const onPick = useCallback(
    (dest: ListDestination) => {
      if (!pending?.length) return;
      if (dest.kind === 'new') {
        // The name is typed on this screen, never inside the Vaul sheet — an
        // input in a drawer fights the iOS keyboard focus trap.
        setNamingList(true);
        return;
      }
      void runFile(pending, { ownerId: dest.ownerId, listId: dest.listId });
    },
    [pending, runFile],
  );

  const clearAll = useCallback(async () => {
    setBusy(true);
    try {
      await apiCall('POST', '/api/v1/unfiled/clear', {});
      haptic('medium');
    } catch {
      toast({ title: 'that did not work', description: 'they are all still here.' });
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const count = films?.length ?? 0;

  return (
    <div className="min-h-dvh bg-background pb-24">
      <div className="sticky top-0 z-20">
        <Frost tint={scrolled ? undefined : 'transparent'} blur={scrolled ? 22 : 0}
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
          <div className="flex items-center gap-2 px-5 pb-3">
            <button onClick={() => { haptic('light'); router.back(); }}
              aria-label="back" className="-ml-1 p-1 active:opacity-60">
              <ChevronLeft className="h-6 w-6" strokeWidth={2} />
            </button>
            <span className="cc-eyebrow text-muted-foreground">
              unfiled{count ? ` · ${count} film${count === 1 ? '' : 's'}` : ''}
            </span>
          </div>
        </Frost>
      </div>

      <div className="px-5">
        <h1 className="font-headline font-bold text-[34px] leading-[0.98] tracking-tight lowercase">
          unfiled
        </h1>

        {isLoading ? (
          <div className="mt-6 space-y-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-[72px] rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : count === 0 ? (
          <>
            <p className="mt-3 font-serif italic text-[15px] leading-relaxed text-muted-foreground">
              nothing waiting. everything you have grabbed has a home.
            </p>
            <button onClick={() => router.push('/lists')} className={`${PILL} mt-6`}>
              your lists
            </button>
          </>
        ) : (
          <>
            <p className="mt-3 font-serif italic text-[15px] leading-relaxed text-muted-foreground">
              {count === 1 ? 'one you grabbed and haven’t given a home yet. it keeps'
                : `${count} you grabbed and haven’t given a home yet. they keep`} for as long as you like.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                disabled={busy}
                onClick={() => { haptic('light'); setPending(films!.map((f) => f.id)); }}
                className={PILL}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" strokeWidth={1.9} />}
                file all to…
              </button>
              <button disabled={busy} onClick={() => { haptic('light'); void clearAll(); }} className={PILL}>
                clear
              </button>
            </div>

            <div className="mt-6 divide-y divide-hair border-t border-hair">
              {films!.map((film) => (
                <UnfiledRow
                  key={film.id}
                  movie={film}
                  busy={busy}
                  onFile={() => setPending([film.id])}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <ListPickerSheet
        open={!!pending?.length && !namingList}
        onOpenChange={(o) => { if (!o) setPending(null); }}
        lists={pickable}
        current={{ kind: 'new' }}
        onPick={onPick}
        title="file to"
      />

      <FullscreenTextInput
        isOpen={namingList}
        onClose={() => { setNamingList(false); setPending(null); }}
        onSave={async (name) => {
          const trimmed = name.trim();
          setNamingList(false);
          if (!trimmed || !pending?.length) { setPending(null); return; }
          await runFile(pending, { newListName: trimmed });
        }}
        initialValue=""
        singleLine
        title="name the list"
        placeholder="date night"
      />
    </div>
  );
}
