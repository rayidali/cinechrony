'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Film, ArrowLeft, Users, AlertTriangle } from 'lucide-react';
import { useUser, useFirestore, useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { UserAvatar } from '@/components/user-avatar';
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
  const listId = params.listId as string;
  const firestore = useFirestore();

  // State for collaborative list lookup
  const [collaborativeListOwner, setCollaborativeListOwner] = useState<string | null>(null);
  const [isCheckingCollab, setIsCheckingCollab] = useState(false);

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
  useEffect(() => {
    async function checkCollaborativeLists() {
      if (!user || isLoadingOwnList || ownListData || isCheckingCollab) return;

      setIsCheckingCollab(true);
      try {
        const result = await getCollaborativeLists(user.uid);
        const collabList = result.lists?.find(l => l.id === listId);
        if (collabList) {
          setCollaborativeListOwner(collabList.ownerId);
        }
      } catch (error) {
        console.error('Failed to check collaborative lists:', error);
      } finally {
        setIsCheckingCollab(false);
      }
    }

    checkCollaborativeLists();
  }, [user, listId, isLoadingOwnList, ownListData, isCheckingCollab]);

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
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  // Show loading while checking for collaborative lists
  if (isCheckingCollab || (isLoadingOwnList && !ownListData)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  // Permission error - user doesn't have access
  if (hasPermissionError) {
    return (
      <main className="min-h-screen bg-background font-body text-foreground">
        <div className="container mx-auto p-4 md:p-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4 border-[3px] border-black">
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

  // List not found
  if (!listData && !isLoadingList) {
    return (
      <main className="min-h-screen bg-background font-body text-foreground">
        <div className="container mx-auto p-4 md:p-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <Film className="h-16 w-16 text-muted-foreground mb-4" />
            <h1 className="text-2xl font-headline font-bold mb-2">List Not Found</h1>
            <p className="text-muted-foreground mb-4">This list doesn&apos;t exist or you don&apos;t have access.</p>
            <Link href="/lists">
              <Button>Go to My Lists</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background font-body text-foreground">
      <div className="container mx-auto p-4 md:p-8">
        <header className="mb-12">
          <div className="w-full flex justify-between items-center mb-4">
            <Link href="/lists">
              <Button variant="ghost" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                All Lists
              </Button>
            </Link>
            <UserAvatar />
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
    </main>
  );
}
