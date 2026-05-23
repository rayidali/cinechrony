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
import { useToast } from '@/hooks/use-toast';
import { ensureUserProfile, migrateMoviesToList, getCollaborativeLists, getListsPreviews, getListPreview } from '@/app/actions';
import type { MovieList } from '@/lib/types';

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


export default function ListsPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [collaborativeLists, setCollaborativeLists] = useState<CollaborativeList[]>([]);
  const [isLoadingCollaborative, setIsLoadingCollaborative] = useState(false);
  const [listPreviews, setListPreviews] = useState<Record<string, ListPreview>>({});
  const [collabListPreviews, setCollabListPreviews] = useState<Record<string, ListPreview>>({});

  // Query for user's lists
  const listsQuery = useMemoFirebase(() => {
    if (!user) return null;
    return query(
      collection(firestore, 'users', user.uid, 'lists'),
      orderBy('createdAt', 'desc')
    );
  }, [firestore, user]);

  const { data: lists, isLoading: isLoadingLists } = useCollection<MovieList>(listsQuery);

  // Initialize user profile and handle migration for existing users
  useEffect(() => {
    async function initUser() {
      if (!user || isUserLoading) return;

      try {
        const result = await ensureUserProfile(
          await user.getIdToken(),
          user.email || '',
          user.displayName
        );

        if (!('error' in result) && result.defaultListId) {
          // Check for old movies to migrate
          const migrateResult = await migrateMoviesToList(await user.getIdToken(), result.defaultListId);
          if (!('error' in migrateResult) && migrateResult.migratedCount && migrateResult.migratedCount > 0) {
            toast({
              title: 'Movies Migrated',
              description: `${migrateResult.migratedCount} movies moved to your default list.`,
            });
          }
        }
      } catch (error) {
        console.error('Failed to initialize user:', error);
      } finally {
        setIsInitializing(false);
      }
    }

    initUser();
  }, [user, isUserLoading, toast]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  // Fetch collaborative lists
  useEffect(() => {
    async function fetchCollaborativeLists() {
      if (!user || isUserLoading) return;

      setIsLoadingCollaborative(true);
      try {
        const result = await getCollaborativeLists(user.uid);
        if (result.lists) {
          setCollaborativeLists(result.lists as CollaborativeList[]);
        }
      } catch (error) {
        console.error('Failed to fetch collaborative lists:', error);
      } finally {
        setIsLoadingCollaborative(false);
      }
    }

    fetchCollaborativeLists();
  }, [user, isUserLoading]);

  // Fetch list previews (posters and counts) when lists change
  useEffect(() => {
    async function fetchPreviews() {
      if (!user || !lists || lists.length === 0) return;

      try {
        const listIds = lists.map((list) => list.id);
        const result = await getListsPreviews(user.uid, listIds, await user.getIdToken());
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
        // Fetch previews in parallel - each list has its own owner
        await Promise.all(
          collaborativeLists.map(async (list) => {
            const result = await getListPreview(list.ownerId, list.id, user ? await user.getIdToken() : undefined);
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

  const handleCardClick = useCallback((listId: string, e: React.MouseEvent, ownerId?: string) => {
    if (ownerId) {
      router.push(`/lists/${listId}?owner=${ownerId}`);
    } else {
      router.push(`/lists/${listId}`);
    }
  }, [router]);

  // Pull-to-refresh handler
  const handleRefresh = useCallback(async () => {
    if (!user) return;

    try {
      // Refresh collaborative lists
      const collabResult = await getCollaborativeLists(user.uid);
      if (collabResult.lists) {
        setCollaborativeLists(collabResult.lists as CollaborativeList[]);
      }

      // Refresh own list previews
      if (lists && lists.length > 0) {
        const listIds = lists.map((list) => list.id);
        const previewResult = await getListsPreviews(user.uid, listIds, await user.getIdToken());
        if (previewResult.previews) {
          setListPreviews(previewResult.previews);
        }
      }
    } catch (error) {
      console.error('Failed to refresh lists:', error);
    }
  }, [user, lists]);

  if (isUserLoading || !user || isInitializing) {
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
                return (
                  <ListCard
                    key={list.id}
                    list={{ ...list, movieCount: preview?.movieCount ?? 0 }}
                    previewPosters={preview?.previewPosters ?? []}
                    onClick={(e) => handleCardClick(list.id, e)}
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
                    return (
                      <ListCard
                        key={`collab-${list.id}`}
                        list={{ ...list, movieCount: preview?.movieCount ?? 0 }}
                        previewPosters={preview?.previewPosters ?? []}
                        onClick={(e) => handleCardClick(list.id, e, list.ownerId)}
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
