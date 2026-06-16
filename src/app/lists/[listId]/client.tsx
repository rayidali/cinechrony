'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, Plus } from 'lucide-react';
import { useUser, useFirestore, useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { BottomNav } from '@/components/bottom-nav';
import { PullToRefresh } from '@/components/pull-to-refresh';
import { collection, doc, query, orderBy, limit } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { MovieList } from '@/components/movie-list';
import { ListHeader } from '@/components/list-header';
import { AddMovieModal } from '@/components/add-movie-modal';
import { Hero } from '@/components/v3/hero';
import { GlassBtn } from '@/components/v3/glass-button';
import { Fab } from '@/components/fab';
import { apiCall } from '@/lib/api-client';
import type { CollaborativeListSummary } from '@/lib/lists-server';
import type { Movie, MovieList as MovieListType } from '@/lib/types';
import { recallListSeed } from '@/lib/list-detail-seed';

export default function ListDetailPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const listId = params.listId as string;
  const firestore = useFirestore();

  // Check if owner was passed in query params (from invite acceptance)
  const ownerFromQuery = searchParams.get('owner');

  // State for collaborative list lookup - initialize from query param if available
  const [collaborativeListOwner, setCollaborativeListOwner] = useState<string | null>(ownerFromQuery);
  const [isCheckingCollab, setIsCheckingCollab] = useState(false);
  // Track if we've completed all lookup attempts (for terminal state)
  const [lookupComplete, setLookupComplete] = useState(false);
  // Safety timeout to prevent infinite loading
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  // Add movie modal state
  const [isAddMovieOpen, setIsAddMovieOpen] = useState(false);

  // Determine the effective owner ID (user's own or collaborative)
  const effectiveOwnerId = collaborativeListOwner || user?.uid;

  // Get list details from user's own collection first
  const ownListDocRef = useMemoFirebase(() => {
    if (!user || !listId) return null;
    return doc(firestore, 'users', user.uid, 'lists', listId);
  }, [firestore, user, listId]);

  const { data: ownListData, isLoading: isLoadingOwnList, error: ownListError } = useDoc<MovieListType>(ownListDocRef);

  // Get list details from collaborative list owner's collection
  const collabListDocRef = useMemoFirebase(() => {
    if (!collaborativeListOwner || !listId) return null;
    return doc(firestore, 'users', collaborativeListOwner, 'lists', listId);
  }, [firestore, collaborativeListOwner, listId]);

  const { data: collabListData, isLoading: isLoadingCollabList, error: collabListError } = useDoc<MovieListType>(collabListDocRef);

  // Use whichever list data we have
  const listData = ownListData || collabListData;
  const isLoadingList = isLoadingOwnList || (collaborativeListOwner && isLoadingCollabList);

  // Optimistic seed from the list-card tap on `/lists` — gives us the
  // list's name + cover + count + collaborator IDs before the network
  // round-trip lands. Renders the page chrome instantly. See
  // [[list-detail-seed]]. Cleared from sessionStorage on read so a hard
  // refresh of the URL doesn't reuse a stale seed indefinitely.
  const seed = useMemo(() => recallListSeed(listId), [listId]);
  const effectiveListData: MovieListType | null = listData ?? (seed?.list as MovieListType | undefined) ?? null;

  // Get movies in this list
  const moviesQuery = useMemoFirebase(() => {
    if (!effectiveOwnerId || !listId) return null;
    // Cap the real-time listener so a runaway/huge list can't read thousands of
    // docs on mount. 300 covers any real list; MovieList still sorts/filters.
    return query(
      collection(firestore, 'users', effectiveOwnerId, 'lists', listId, 'movies'),
      orderBy('createdAt', 'desc'),
      limit(300),
    );
  }, [firestore, effectiveOwnerId, listId]);

  const { data: movies, isLoading: isLoadingMovies, error: moviesError } = useCollection<Movie>(moviesQuery);

  // Safety timeout - if loading takes more than 10 seconds, show error
  // Cancel timer if we successfully load data
  useEffect(() => {
    // If we already have data, no need for timeout
    if (ownListData || collabListData) {
      return;
    }

    const timer = setTimeout(() => {
      setLoadingTimedOut(true);
      setLookupComplete(true);
    }, 10000);

    return () => clearTimeout(timer);
  }, [listId, ownListData, collabListData]);

  // Check for permission errors - handle both Error and FirestoreError types
  const isPermissionError = (error: Error | null | undefined): boolean => {
    if (!error) return false;
    // FirestoreError has a 'code' property
    if ('code' in error && error.code === 'permission-denied') return true;
    // Also check error message for permission-related content
    if (error.message?.includes('permission') || error.message?.includes('Missing or insufficient permissions')) return true;
    return false;
  };

  const hasPermissionError = isPermissionError(ownListError) ||
    isPermissionError(collabListError) ||
    isPermissionError(moviesError);

  // Check for collaborative lists if own list not found
  // Also fallback to lookup if query param owner didn't work
  useEffect(() => {
    async function checkCollaborativeLists() {
      // If owner from query is the current user, clear it (it's their own list)
      if (ownerFromQuery && user && ownerFromQuery === user.uid) {
        setCollaborativeListOwner(null);
        return;
      }

      // Skip if we found own list or still loading own list
      if (!user || isLoadingOwnList || ownListData) return;

      // Skip if already checking
      if (isCheckingCollab) return;

      // If we have a query param owner AND collab data loaded successfully, we're done
      if (collaborativeListOwner && !isLoadingCollabList && collabListData) {
        setLookupComplete(true);
        return;
      }

      // If query param owner failed (no data after loading), fallback to lookup
      const queryParamFailed = ownerFromQuery && collaborativeListOwner === ownerFromQuery &&
        !isLoadingCollabList && !collabListData && !collabListError;

      // Skip lookup if we have a working collaborative owner (data loaded successfully)
      if (collaborativeListOwner && collabListData) {
        return;
      }

      // If query param worked (still loading), wait for it
      if (collaborativeListOwner && isLoadingCollabList) {
        return;
      }

      // If lookup already completed, don't retry
      if (lookupComplete) return;

      // Perform lookup if:
      // - No owner set, OR
      // - Query param owner failed to load the list
      if (!collaborativeListOwner || queryParamFailed) {
        setIsCheckingCollab(true);
        try {
          const result = await apiCall<{ lists: CollaborativeListSummary[] }>("GET", "/api/v1/me/collaborative-lists");
          const collabList = result.lists?.find(l => l.id === listId);
          if (collabList) {
            setCollaborativeListOwner(collabList.ownerId);
          } else {
            // No collaborative list found - mark lookup as complete
            setLookupComplete(true);
          }
        } catch (error) {
          console.error('Failed to check collaborative lists:', error);
          setLookupComplete(true);
        } finally {
          setIsCheckingCollab(false);
        }
      }
    }

    checkCollaborativeLists();
  }, [user, listId, isLoadingOwnList, ownListData, isCheckingCollab, ownerFromQuery, collaborativeListOwner, isLoadingCollabList, collabListData, collabListError, lookupComplete]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  // Determine if user can edit this list
  // User is owner if they have their own list data (not accessed via collaborator lookup)
  const isOwner = !!ownListData;
  // SECURITY FIX: Must verify user's UID is actually in collaboratorIds array
  // Previously, this was checking if collabListData was truthy, but public lists
  // allow reads by anyone (isPublic == true), so collabListData being truthy
  // does NOT mean the user is a collaborator - only that they can read the list.
  // This was a critical security bug that allowed any user to edit public lists.
  const isCollaborator = !isOwner &&
    !!user &&
    !!listData?.collaboratorIds &&
    Array.isArray(listData.collaboratorIds) &&
    listData.collaboratorIds.includes(user.uid);
  const canEdit = isOwner || isCollaborator;

  // Check if this is a collaborative list (has collaborators)
  const hasCollaborators = (listData?.collaboratorIds?.length ?? 0) > 0;

  // Pull-to-refresh handler - movies are already real-time via useCollection,
  // but this gives a satisfying gesture and can re-check collaborative status
  const handleRefresh = useCallback(async () => {
    if (!user) return;

    // Re-check collaborative lists in case permissions changed
    if (!ownListData && !collaborativeListOwner) {
      try {
        const result = await apiCall<{ lists: CollaborativeListSummary[] }>("GET", "/api/v1/me/collaborative-lists");
        const collabList = result.lists?.find(l => l.id === listId);
        if (collabList) {
          setCollaborativeListOwner(collabList.ownerId);
        }
      } catch (error) {
        console.error('Failed to refresh collaborative lists:', error);
      }
    }

    // Small delay for visual feedback since movies are already real-time
    await new Promise(resolve => setTimeout(resolve, 300));
  }, [user, ownListData, collaborativeListOwner, listId]);

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  // `isLoading` summarises whether real data is still in flight; we no
  // longer gate the WHOLE page on it. The chrome + seed render immediately;
  // `isLoading` is consumed below by MovieList for its skeleton state.
  const isLoading = isLoadingOwnList ||
    isCheckingCollab ||
    (collaborativeListOwner && isLoadingCollabList) ||
    (!ownListData && !collabListData && !lookupComplete && !hasPermissionError);

  // Permission error — terminal state, beats any optimistic seed.
  if (hasPermissionError) {
    return (
      <main className="min-h-screen font-body text-foreground">
        <div className="container mx-auto p-4 md:p-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4 border border-border">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="text-2xl font-headline font-bold mb-2">Access Denied</h1>
            <p className="text-muted-foreground mb-4 text-center max-w-md">
              You don&apos;t have permission to view this list. Ask the list owner to invite you as a collaborator.
            </p>
            <Link href="/lists">
              <Button>Go to My Lists</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // List genuinely not found — only after we've finished trying. The seed
  // got us to instant-render, but real data is authoritative; if real
  // lookup completes empty, we fall through to NotFound regardless of
  // whether a seed was available (it would've been wrong/stale).
  if (!listData && lookupComplete && !isLoading) {
    return (
      <main className="min-h-screen font-body text-foreground">
        <div className="container mx-auto p-4 md:p-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Not Found" className="h-16 w-16 opacity-50 mb-4" />
            <h1 className="text-2xl font-headline font-bold mb-2">
              {loadingTimedOut ? 'Could Not Load List' : 'List Not Found'}
            </h1>
            <p className="text-muted-foreground mb-4 text-center max-w-md">
              {loadingTimedOut
                ? 'We couldn\'t resolve this list. If you just accepted an invite, please try refreshing or ask the owner to resend the invite link.'
                : 'This list doesn\'t exist or you don\'t have access.'}
            </p>
            <Link href="/lists">
              <Button>Go to My Lists</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // We are now in one of these states:
  //   · Real data loaded — render normally.
  //   · Seed available, real data still loading — render with seed-backed
  //     `effectiveListData`. Movies grid shows skeleton until Firestore lands.
  //   · No seed, real data still loading, no terminal error — render the
  //     chrome with a skeleton header (this is the "direct URL navigation"
  //     case; rarer, but should still feel snappy because IndexedDB
  //     persistence makes the second snapshot near-instant).

  const isPublic = !!effectiveListData?.isPublic;
  const hasCover =
    !!effectiveListData?.coverImageUrl && effectiveListData?.coverMode !== 'auto';

  return (
    <>
      <PullToRefresh onRefresh={handleRefresh} disabled={isAddMovieOpen}>
        <main className="min-h-screen font-body text-foreground pb-28 md:pb-8">
          {/* Cinematic hero — cover (or seeded gradient) + glass chrome */}
          <Hero
            coverImageUrl={hasCover ? effectiveListData?.coverImageUrl : undefined}
            seed={effectiveListData?.name}
            topLeft={
              <GlassBtn icon={ArrowLeft} ariaLabel="Back to lists" onClick={() => router.push('/lists')} />
            }
          >
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/85">
              {isPublic ? 'public list' : 'private list'}
            </div>
            {effectiveListData ? (
              <h1 className="mt-2 font-headline text-[34px] font-bold leading-[0.92] tracking-tight lowercase text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.35)] md:text-5xl">
                {effectiveListData.name || 'list'}
              </h1>
            ) : (
              <div className="mt-2 h-9 w-2/3 animate-pulse rounded bg-white/20" />
            )}
          </Hero>

          {/* Pull-up content sheet */}
          <div className="relative z-[1] -mt-5 min-h-[60vh] rounded-t-[22px] bg-background">
            <div className="mx-auto max-w-3xl px-4 pt-5">
              {effectiveOwnerId && effectiveListData ? (
                <ListHeader
                  listId={listId}
                  listOwnerId={effectiveOwnerId}
                  listData={effectiveListData}
                  isOwner={isOwner}
                  isCollaborator={isCollaborator}
                  movieCount={movies?.length}
                />
              ) : (
                <div className="space-y-3" aria-label="Loading list header">
                  <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
                  <div className="h-8 w-1/3 rounded-full bg-muted animate-pulse" />
                </div>
              )}

              {/* Movie list — `MovieList` shows its own skeleton when isLoading. */}
              <div className="mt-6">
                <MovieList
                  initialMovies={movies || []}
                  isLoading={isLoadingMovies}
                  listId={listId}
                  listOwnerId={effectiveOwnerId}
                  listName={effectiveListData?.name}
                  canEdit={canEdit}
                />
              </div>
            </div>
          </div>
        </main>
      </PullToRefresh>

      <BottomNav />

      {/* Persistent add — film-red FAB (the hero + scrolls away on long lists) */}
      {canEdit && effectiveOwnerId && (
        <Fab
          icon={Plus}
          label="add"
          ariaLabel="Add movie"
          className="z-40"
          onClick={() => setIsAddMovieOpen(true)}
        />
      )}

      {/* Add Movie Modal */}
      {effectiveOwnerId && (
        <AddMovieModal
          isOpen={isAddMovieOpen}
          onClose={() => setIsAddMovieOpen(false)}
          listId={listId}
          listOwnerId={effectiveOwnerId}
          listName={effectiveListData?.name}
        />
      )}
    </>
  );
}
