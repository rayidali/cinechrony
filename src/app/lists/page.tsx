'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2, Film, Users } from 'lucide-react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { UserAvatar } from '@/components/user-avatar';
import { ThemeToggle } from '@/components/theme-toggle';
import { NotificationBell } from '@/components/notification-bell';
import { BottomNav } from '@/components/bottom-nav';
import { ListCard } from '@/components/list-card';
import { PullToRefresh } from '@/components/pull-to-refresh';
import { Fab } from '@/components/fab';
import { NewListDrawer } from '@/components/new-list-drawer';
import { collection, orderBy, query } from 'firebase/firestore';
import { Card, CardContent } from '@/components/ui/card';
import { apiCall } from '@/lib/api-client';
import type { CollaborativeListSummary } from '@/lib/lists-server';
import type { MovieList } from '@/lib/types';
import { useCachedAction } from '@/lib/use-cached-action';
import { rememberListSeed } from '@/lib/list-detail-seed';

// Preview data for list cards
type ListPreview = {
  previewPosters: string[];
  movieCount: number;
};

// Extended type for collaborative lists with owner info
type CollaborativeList = MovieList & {
  ownerUsername?: string;
  ownerDisplayName?: string;
};

// Module-level guard so the one-time ensureUserProfile + migrateMoviesToList
// check runs at most once per user per session, regardless of how many times
// the user revisits /lists.
const initializedUsers = new Set<string>();


export default function ListsPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [listPreviews, setListPreviews] = useState<Record<string, ListPreview>>({});
  const [collabListPreviews, setCollabListPreviews] = useState<Record<string, ListPreview>>({});

  // Collaborative lists via SWR cache — first mount hits the network; every
  // subsequent visit in the session paints the prior result synchronously
  // and refreshes in the background. See [[use-cached-action]].
  const collabKey = user ? `collab-lists:${user.uid}` : null;
  const collabResult = useCachedAction<CollaborativeList[]>(collabKey, async () => {
    if (!user) return [];
    const result = await apiCall<{ lists: CollaborativeListSummary[] }>(
      'GET', '/api/v1/me/collaborative-lists',
    );
    return (result.lists ?? []) as unknown as CollaborativeList[];
  });
  const collaborativeLists = collabResult.data ?? [];
  const isLoadingCollaborative = collabResult.isLoading;

  // Query for user's lists
  const listsQuery = useMemoFirebase(() => {
    if (!user) return null;
    return query(
      collection(firestore, 'users', user.uid, 'lists'),
      orderBy('createdAt', 'desc')
    );
  }, [firestore, user]);

  const { data: lists, isLoading: isLoadingLists } = useCollection<MovieList>(listsQuery);

  // Initialize user profile + migration check — runs ONCE per session per
  // user (tracked at module level), NOT blocking render. This used to gate
  // the whole page on a network round-trip, so every tab return to /lists
  // showed a full-screen loading spinner for ~300ms even when every other
  // piece of data was cached. The check is a one-time migration for legacy
  // users; running it on every visit was wasteful regardless.
  useEffect(() => {
    if (!user || isUserLoading) return;
    if (initializedUsers.has(user.uid)) return;
    initializedUsers.add(user.uid);

    (async () => {
      try {
        // Phase A PR #4: migrateMoviesToList (legacy users/{uid}/movies →
        // users/{uid}/lists/{defaultListId}/movies one-shot migration) was
        // deleted. By 2026 the legacy collection is empty for every active
        // user; ensureUserProfile still runs (it's the default-list creator
        // for fresh signups).
        await apiCall('POST', '/api/v1/me/ensure', {
          email: user.email || '',
          displayName: user.displayName,
        });
      } catch (error) {
        console.error('Failed to initialize user:', error);
        initializedUsers.delete(user.uid);
      }
    })();
  }, [user, isUserLoading]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  // Fetch list previews (posters and counts) when lists change
  useEffect(() => {
    async function fetchPreviews() {
      if (!user || !lists || lists.length === 0) return;

      try {
        const listIds = lists.map((list) => list.id);
        const result = await apiCall<{ previews: Record<string, { previewPosters: string[]; movieCount: number }> }>(
          'POST', `/api/v1/users/${user.uid}/lists/previews`,
          { listIds },
        );
        if (result.previews) {
          setListPreviews(result.previews);
        }
      } catch (error) {
        console.error('Failed to fetch list previews:', error);
      }
    }

    fetchPreviews();
  }, [user, lists]);

  // Fetch collaborative list previews when collaborative lists change
  useEffect(() => {
    async function fetchCollabPreviews() {
      if (collaborativeLists.length === 0) return;

      try {
        const previews: Record<string, ListPreview> = {};
        await Promise.all(
          collaborativeLists.map(async (list) => {
            const result = await apiCall<{ previewPosters: string[]; movieCount: number }>(
              'GET', `/api/v1/lists/${list.ownerId}/${list.id}/preview`,
            );
            previews[list.id] = {
              previewPosters: result.previewPosters || [],
              movieCount: result.movieCount || 0,
            };
          })
        );
        setCollabListPreviews(previews);
      } catch (error) {
        console.error('Failed to fetch collaborative list previews:', error);
      }
    }

    fetchCollabPreviews();
  }, [collaborativeLists]);

  const handleListCreated = useCallback(
    (listId: string) => {
      setIsCreateOpen(false);
      router.push(`/lists/${listId}`);
    },
    [router],
  );

  const handleCardClick = useCallback(
    (
      listId: string,
      e: React.MouseEvent,
      ownerId?: string,
      list?: MovieList | CollaborativeList,
      previewPosters?: string[],
    ) => {
      // Seed the detail page with what we already know — name, cover, count,
      // collaborator IDs, preview posters. The destination page paints its
      // header + chrome synchronously from the seed; the real fetch resolves
      // in parallel. See [[list-detail-seed]].
      if (list) {
        rememberListSeed({
          list,
          previewPosters: previewPosters ?? [],
        });
      }
      if (ownerId) {
        router.push(`/lists/${listId}?owner=${ownerId}`);
      } else {
        router.push(`/lists/${listId}`);
      }
    },
    [router],
  );

  // Pull-to-refresh handler — invalidate the SWR cache and refetch via the
  // hook so listeners see the fresh data.
  const handleRefresh = useCallback(async () => {
    if (!user) return;

    try {
      collabResult.refetch();

      // Refresh own list previews
      if (lists && lists.length > 0) {
        const listIds = lists.map((list) => list.id);
        const previewResult = await apiCall<{ previews: Record<string, { previewPosters: string[]; movieCount: number }> }>(
          'POST', `/api/v1/users/${user.uid}/lists/previews`,
          { listIds },
        );
        if (previewResult.previews) {
          setListPreviews(previewResult.previews);
        }
      }
    } catch (error) {
      console.error('Failed to refresh lists:', error);
    }
  }, [user, lists, collabResult.refetch]);

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <PullToRefresh onRefresh={handleRefresh} disabled={isCreateOpen}>
        <main className="min-h-screen font-body text-foreground pb-24 md:pb-8 md:pt-20">
          <div className="container mx-auto p-4 md:p-8">
        {/* Header */}
        <header className="mb-8">
          <div className="flex justify-between items-center mb-7">
            <div className="flex items-center gap-2.5">
              <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Cinechrony" className="h-8 w-8" />
              <span className="font-headline font-bold text-lg lowercase tracking-tight">cinechrony</span>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <ThemeToggle />
              <UserAvatar />
            </div>
          </div>
          {/* Editorial title block */}
          <div className="cc-eyebrow">the collection</div>
          <div className="h-px bg-border my-3" />
          <h1 className="font-headline font-bold text-4xl md:text-5xl lowercase tracking-tight leading-[0.95]">
            your watchlists
          </h1>
        </header>

        <div className="max-w-4xl mx-auto">
          {/* My Lists Section */}
          <div className="flex justify-between items-center mb-5">
            <h2 className="cc-eyebrow">mine</h2>
          </div>

          {isLoadingLists ? (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="aspect-[4/5] bg-secondary rounded-2xl border border-border animate-pulse" />
              ))}
            </div>
          ) : lists && lists.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {lists.map((list) => {
                const preview = listPreviews[list.id];
                const augmented = { ...list, movieCount: preview?.movieCount ?? 0 };
                return (
                  <ListCard
                    key={list.id}
                    list={augmented}
                    previewPosters={preview?.previewPosters ?? []}
                    onClick={(e) => handleCardClick(list.id, e, undefined, augmented, preview?.previewPosters)}
                  />
                );
              })}
            </div>
          ) : (
            <Card className="border border-dashed border-border rounded-2xl bg-card">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Film className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="font-headline text-xl font-bold mb-2 lowercase tracking-tight">no lists yet</h3>
                <p className="text-muted-foreground mb-4 cc-lead">your first watchlist is one tap away.</p>
                <button
                  onClick={() => setIsCreateOpen(true)}
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-primary text-white font-headline font-bold text-sm lowercase tracking-tight shadow-fab active:scale-[0.97]"
                >
                  <Plus className="h-4 w-4" strokeWidth={2} />
                  new list
                </button>
              </CardContent>
            </Card>
          )}

          {/* Collaborative Lists Section */}
          {(isLoadingCollaborative || collaborativeLists.length > 0) && (
            <div className="mt-12">
              <div className="flex items-center gap-2 mb-5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} />
                <h2 className="cc-eyebrow">with friends</h2>
              </div>
              {isLoadingCollaborative ? (
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2].map((i) => (
                    <div key={i} className="aspect-[4/5] bg-secondary rounded-2xl border border-border animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {collaborativeLists.map((list) => {
                    const preview = collabListPreviews[list.id];
                    const augmented = { ...list, movieCount: preview?.movieCount ?? 0 };
                    return (
                      <ListCard
                        key={`collab-${list.id}`}
                        list={augmented}
                        previewPosters={preview?.previewPosters ?? []}
                        onClick={(e) => handleCardClick(list.id, e, list.ownerId, augmented, preview?.previewPosters)}
                        isCollaborative={true}
                        ownerName={list.ownerDisplayName || list.ownerUsername || 'Unknown'}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

      </div>

        </main>
      </PullToRefresh>

      {/* Floating Action Button - outside PullToRefresh to keep fixed positioning */}
      <Fab icon={Plus} label="new list" onClick={() => setIsCreateOpen(true)} />

      {/* BottomNav outside PullToRefresh to keep fixed positioning */}
      <BottomNav />

      {/* Editorial new-list creator (v3) — MUST sit outside PullToRefresh so
          position:fixed anchors to the viewport. PullToRefresh wraps its
          children in a translateY container, which becomes the containing
          block for any fixed descendant — anchoring it to the scrolled page
          instead of the viewport and producing a half-rendered drawer. */}
      <NewListDrawer
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handleListCreated}
      />
    </>
  );
}
