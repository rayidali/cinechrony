'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Film, ArrowLeft, Users, AlertTriangle } from 'lucide-react';
import { useUser, useFirestore, useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { UserAvatar } from '@/components/user-avatar';
import { ThemeToggle } from '@/components/theme-toggle';
import { BottomNav } from '@/components/bottom-nav';
import { collection, doc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { MovieList } from '@/components/movie-list';
import { AddMovieFormForList } from '@/components/add-movie-form-list';
import { ListCollaborators } from '@/components/list-collaborators';
import { getCollaborativeLists } from '@/app/actions';
import type { Movie, MovieList as MovieListType } from '@/lib/types';

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

  // Get movies in this list
  const moviesQuery = useMemoFirebase(() => {
    if (!effectiveOwnerId || !listId) return null;
    return collection(firestore, 'users', effectiveOwnerId, 'lists', listId, 'movies');
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
          const result = await getCollaborativeLists(user.uid);
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
  const isOwner = effectiveOwnerId === user?.uid && !collaborativeListOwner;
  const isCollaborator = !!collaborativeListOwner;
  const canEdit = isOwner || isCollaborator;

  // Check if this is a collaborative list (has collaborators)
  const hasCollaborators = (listData?.collaboratorIds?.length ?? 0) > 0;
  const showCollaborators = isOwner || isCollaborator || hasCollaborators;

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  // Show loading while:
  // 1. Loading own list
  // 2. Checking for collaborative lists
  // 3. Loading collaborative list (after we've identified there's one)
  // 4. Haven't completed lookup yet AND don't have any list data
  const isLoading = isLoadingOwnList ||
    isCheckingCollab ||
    (collaborativeListOwner && isLoadingCollabList) ||
    (!ownListData && !collabListData && !lookupComplete && !hasPermissionError);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  // Permission error - user doesn't have access
  if (hasPermissionError) {
    return (
      <main className="min-h-screen font-body text-foreground">
        <div className="container mx-auto p-4 md:p-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4 border-[3px] border-border">
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

  // List not found or loading timed out
  if (!listData && !isLoadingList) {
    return (
      <main className="min-h-screen font-body text-foreground">
        <div className="container mx-auto p-4 md:p-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <Film className="h-16 w-16 text-muted-foreground mb-4" />
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

  return (
    <main className="min-h-screen font-body text-foreground pb-24 md:pb-8 md:pt-20">
      <div className="container mx-auto p-4 md:p-8">
        <header className="mb-12">
          <div className="w-full flex justify-between items-center mb-4">
            <Link href="/lists">
              <Button variant="ghost" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                All Lists
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <UserAvatar />
            </div>
          </div>
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-4 mb-2">
              <Film className="h-10 w-10 md:h-12 md:w-12 text-primary" />
              <h1 className="text-4xl md:text-6xl font-headline font-bold text-center tracking-tighter">
                {isLoadingList ? '...' : listData?.name || 'List'}
              </h1>
            </div>

            {/* Collaborative badge */}
            {isCollaborator && (
              <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                <span>Collaborative list</span>
              </div>
            )}

            <p className="max-w-2xl text-center text-muted-foreground mb-8">
              Add movies, track what to watch, and what you&apos;ve watched.
            </p>

            {canEdit && (
              <div className="w-full max-w-2xl">
                <AddMovieFormForList listId={listId} listOwnerId={effectiveOwnerId} />
              </div>
            )}
          </div>
        </header>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Collaborators sidebar - shows first on mobile, right side on desktop */}
          {showCollaborators && effectiveOwnerId && listData && (
            <div className="order-first lg:order-last lg:w-80 lg:flex-shrink-0">
              <div className="lg:sticky lg:top-8">
                <ListCollaborators
                  listId={listId}
                  listOwnerId={effectiveOwnerId}
                  listName={listData.name}
                />
              </div>
            </div>
          )}

          {/* Movie list */}
          <div className="flex-1 min-w-0">
            <MovieList
              initialMovies={movies || []}
              isLoading={isLoadingMovies}
              listId={listId}
              listOwnerId={effectiveOwnerId}
              canEdit={canEdit}
            />
          </div>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
