'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Film, Users, X } from 'lucide-react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { UserAvatar } from '@/components/user-avatar';
import { ThemeToggle } from '@/components/theme-toggle';
import { NotificationBell } from '@/components/notification-bell';
import { BottomNav } from '@/components/bottom-nav';
import { PullToRefresh } from '@/components/pull-to-refresh';
import { NewListDrawer } from '@/components/new-list-drawer';
import { NavBar } from '@/components/v3/nav-bar';
import { Segmented } from '@/components/v3/segmented';
import { ListTile } from '@/components/v3/list-tile';
import { Fab } from '@/components/fab';
import { Button } from '@/components/ui/button';
import { collection, orderBy, query } from 'firebase/firestore';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import type { CollaborativeListSummary } from '@/lib/lists-server';
import type { MovieList, ListInvite } from '@/lib/types';
import {
  useCachedAction, readCachedAction, setCachedAction,
  isCachedActionFresh, invalidateCachedAction,
} from '@/lib/use-cached-action';
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
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [listPreviews, setListPreviews] = useState<Record<string, ListPreview>>({});
  const [collabListPreviews, setCollabListPreviews] = useState<Record<string, ListPreview>>({});
  const [pendingInvites, setPendingInvites] = useState<ListInvite[]>([]);
  const collabPreviewSigRef = useRef('');
  const [seg, setSeg] = useState<'mine' | 'shared'>('mine');
  const [scrolled, setScrolled] = useState(false);
  const [dateLabel, setDateLabel] = useState('');

  // Collapsing nav: fade in the frost once the page scrolls past the threshold.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Tabular date for the eyebrow (DD.MM.YY). Set after mount so the static
  // prerender and the client render agree (no hydration mismatch).
  useEffect(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    setDateLabel(`${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)}`);
  }, []);

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

  // Fetch list previews (posters and counts) when lists change. TTL-gated +
  // cached so navigating away and back doesn't re-fire it; the count/posters
  // self-heal within the window (server preview cache is busted on movie add).
  useEffect(() => {
    async function fetchPreviews() {
      if (!user || !lists || lists.length === 0) return;
      const key = `lists-own-previews:${user.uid}`;
      const cached = readCachedAction<Record<string, ListPreview>>(key);
      if (cached) setListPreviews(cached);
      if (cached && isCachedActionFresh(key, 60_000)) return;
      try {
        const listIds = lists.map((list) => list.id);
        const result = await apiCall<{ previews: Record<string, { previewPosters: string[]; movieCount: number }> }>(
          'POST', `/api/v1/users/${user.uid}/lists/previews`,
          { listIds },
        );
        if (result.previews) {
          setListPreviews(result.previews);
          setCachedAction(key, result.previews);
        }
      } catch (error) {
        console.error('Failed to fetch list previews:', error);
      }
    }

    fetchPreviews();
  }, [user, lists]);

  // Fetch collaborative list previews when collaborative lists change (gated).
  useEffect(() => {
    async function fetchCollabPreviews() {
      if (!user || collaborativeLists.length === 0) return;
      const key = `collab-previews:${user.uid}`;
      const cached = readCachedAction<Record<string, ListPreview>>(key);
      if (cached) setCollabListPreviews(cached);
      // Dedup the double-fire: collaborativeLists changes ref twice (cached →
      // revalidated), and the per-list GETs out-race the cache write. Skip if
      // we've already kicked off a fetch for this exact set this mount.
      const sig = collaborativeLists.map((l) => l.id).sort().join(',');
      if (collabPreviewSigRef.current === sig) return;
      if (cached && isCachedActionFresh(key, 60_000)) { collabPreviewSigRef.current = sig; return; }
      collabPreviewSigRef.current = sig;
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
        setCachedAction(key, previews);
      } catch (error) {
        console.error('Failed to fetch collaborative list previews:', error);
      }
    }

    fetchCollabPreviews();
  }, [user, collaborativeLists]);

  // Pending list invites — shown atop the "shared" segment (gated; invalidated
  // by accept/decline below so a handled invite disappears immediately).
  useEffect(() => {
    async function loadInvites() {
      if (!user) return;
      const key = `invites:${user.uid}`;
      const cached = readCachedAction<ListInvite[]>(key);
      if (cached) setPendingInvites(cached);
      if (cached && isCachedActionFresh(key, 60_000)) return;
      try {
        const result = await apiCall<{ invites: ListInvite[] }>('GET', '/api/v1/me/invites');
        setPendingInvites(result.invites || []);
        setCachedAction(key, result.invites || []);
      } catch (error) {
        console.error('Failed to load invites:', error);
      }
    }
    loadInvites();
  }, [user]);

  const handleAcceptInvite = useCallback(async (invite: ListInvite) => {
    try {
      await apiCall('POST', '/api/v1/invites/accept', { inviteId: invite.id });
      toast({ title: 'invite accepted', description: `you're now on "${invite.listName}"` });
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
      if (user) {
        invalidateCachedAction(`invites:${user.uid}`);
        invalidateCachedAction(`collab-previews:${user.uid}`);
      }
      collabResult.refetch();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof ApiClientError ? err.message : 'Failed to accept invite',
      });
    }
  }, [toast, collabResult, user]);

  const handleDeclineInvite = useCallback(async (invite: ListInvite) => {
    try {
      await apiCall('POST', `/api/v1/invites/${invite.id}/decline`);
      toast({ title: 'invite declined' });
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
      if (user) invalidateCachedAction(`invites:${user.uid}`);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof ApiClientError ? err.message : 'Failed to decline invite',
      });
    }
  }, [toast, user]);

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

      // Pull-to-refresh is a true bypass — drop the gated caches so the fresh
      // values below (and the collab-previews effect) replace them.
      invalidateCachedAction(`collab-previews:${user.uid}`);

      // Refresh pending invites
      try {
        const inv = await apiCall<{ invites: ListInvite[] }>('GET', '/api/v1/me/invites');
        setPendingInvites(inv.invites || []);
        setCachedAction(`invites:${user.uid}`, inv.invites || []);
      } catch { /* non-fatal */ }

      // Refresh own list previews
      if (lists && lists.length > 0) {
        const listIds = lists.map((list) => list.id);
        const previewResult = await apiCall<{ previews: Record<string, { previewPosters: string[]; movieCount: number }> }>(
          'POST', `/api/v1/users/${user.uid}/lists/previews`,
          { listIds },
        );
        if (previewResult.previews) {
          setListPreviews(previewResult.previews);
          setCachedAction(`lists-own-previews:${user.uid}`, previewResult.previews);
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

  const showLoading = seg === 'mine' ? isLoadingLists : isLoadingCollaborative;
  const skeletonCount = seg === 'mine' ? 4 : 2;

  return (
    <>
      <PullToRefresh onRefresh={handleRefresh} disabled={isCreateOpen}>
        <main className="min-h-screen font-body text-foreground pb-28 md:pb-8 md:pt-20">
          {/* v3 collapsing frosted nav */}
          <NavBar
            eyebrow={`the collection${dateLabel ? ` · ${dateLabel}` : ''}`}
            title="your watchlists"
            scrolled={scrolled}
            topRight={
              <>
                <NotificationBell />
                <ThemeToggle />
                <UserAvatar />
              </>
            }
          />

          <div className="mx-auto max-w-2xl px-4">
            <div className="pt-1 pb-5">
              <Segmented
                value={seg}
                onChange={(v) => setSeg(v as 'mine' | 'shared')}
                options={[
                  { id: 'mine', label: 'mine' },
                  { id: 'shared', label: 'shared' },
                ]}
              />
            </div>

            {showLoading ? (
              <div className="grid grid-cols-2 gap-x-5 gap-y-7">
                {Array.from({ length: skeletonCount }).map((_, i) => (
                  <div key={i}>
                    <div className="aspect-[4/5] rounded-[20px] bg-secondary border border-hair animate-pulse" />
                    <div className="mt-2.5 h-3.5 w-2/3 rounded bg-secondary animate-pulse" />
                  </div>
                ))}
              </div>
            ) : seg === 'mine' ? (
              lists && lists.length > 0 ? (
                <div className="grid grid-cols-2 gap-x-5 gap-y-7">
                  {lists.map((list) => {
                    const preview = listPreviews[list.id];
                    const augmented = { ...list, movieCount: preview?.movieCount ?? 0 };
                    return (
                      <ListTile
                        key={list.id}
                        name={list.name}
                        isPublic={list.isPublic}
                        movieCount={preview?.movieCount ?? 0}
                        previewPosters={preview?.previewPosters ?? []}
                        coverImageUrl={list.coverImageUrl}
                        coverMode={list.coverMode}
                        onClick={(e) => handleCardClick(list.id, e, undefined, augmented, preview?.previewPosters)}
                      />
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="no lists yet"
                  body="your first watchlist is one tap away."
                  onCreate={() => setIsCreateOpen(true)}
                />
              )
            ) : (
              <div className="space-y-7">
                {/* Pending invites — moved here from the profile in the v3 redesign. */}
                {pendingInvites.length > 0 && (
                  <div>
                    <div className="cc-eyebrow">pending invites · {pendingInvites.length}</div>
                    <div className="mt-2.5 overflow-hidden rounded-[20px] border border-hair bg-card">
                      {pendingInvites.map((invite, i) => (
                        <div
                          key={invite.id}
                          className={`flex items-center justify-between gap-3 px-4 py-3.5 ${i < pendingInvites.length - 1 ? 'border-b border-rule' : ''}`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                              <Users className="h-[22px] w-[22px]" strokeWidth={1.8} />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-headline text-[16px] font-semibold lowercase tracking-tight">
                                {invite.listName}
                              </p>
                              <p className="cc-meta text-[11px] text-muted-foreground">
                                invited by @{invite.inviterUsername}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-shrink-0 gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleDeclineInvite(invite)}>
                              <X className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="accent" onClick={() => handleAcceptInvite(invite)}>
                              accept
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {collaborativeLists.length > 0 ? (
                  <div className="grid grid-cols-2 gap-x-5 gap-y-7">
                    {collaborativeLists.map((list) => {
                      const preview = collabListPreviews[list.id];
                      const augmented = { ...list, movieCount: preview?.movieCount ?? 0 };
                      return (
                        <ListTile
                          key={`collab-${list.id}`}
                          name={list.name}
                          isPublic={list.isPublic}
                          movieCount={preview?.movieCount ?? 0}
                          ownerName={list.ownerDisplayName || list.ownerUsername || 'unknown'}
                          previewPosters={preview?.previewPosters ?? []}
                          coverImageUrl={list.coverImageUrl}
                          coverMode={list.coverMode}
                          onClick={(e) => handleCardClick(list.id, e, list.ownerId, augmented, preview?.previewPosters)}
                        />
                      );
                    })}
                  </div>
                ) : (
                  pendingInvites.length === 0 && (
                    <EmptyState
                      title="no shared lists"
                      body="lists friends share with you land here."
                    />
                  )
                )}
              </div>
            )}
          </div>
        </main>
      </PullToRefresh>

      {/* BottomNav outside PullToRefresh to keep fixed positioning */}
      <BottomNav />

      {/* Persistent add — film-red FAB, consistent with list detail. */}
      <Fab
        icon={Plus}
        label="new list"
        ariaLabel="Create a new list"
        onClick={() => setIsCreateOpen(true)}
      />

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

/** Empty state for a segment — dashed card, optional create CTA. */
function EmptyState({
  title,
  body,
  onCreate,
}: {
  title: string;
  body: string;
  onCreate?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[20px] border border-dashed border-rule bg-card py-14 px-6 text-center">
      <Film className="mb-4 h-10 w-10 text-muted-foreground" strokeWidth={1.4} />
      <h3 className="mb-1.5 font-headline text-xl font-bold lowercase tracking-tight text-foreground">
        {title}
      </h3>
      <p className="cc-lead text-muted-foreground">{body}</p>
      {onCreate && (
        <button
          onClick={onCreate}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 h-10 font-headline text-sm font-bold lowercase tracking-tight text-primary-foreground shadow-fab active:scale-[0.97]"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          new list
        </button>
      )}
    </div>
  );
}
