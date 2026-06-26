'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from '@/lib/native-nav';
import { Link } from '@/lib/native-nav';
import { ArrowLeft, Lock } from 'lucide-react';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { FollowButton } from '@/components/follow-button';
import { BottomNav } from '@/components/bottom-nav';
import { MovieList } from '@/components/movie-list';
import { ListHeader } from '@/components/list-header';
import { Hero } from '@/components/v3/hero';
import { GlassBtn } from '@/components/v3/glass-button';
import { ProfileAvatar } from '@/components/profile-avatar';
import { apiCall, ApiClientError } from '@/lib/api-client';
import type { PublicListResult } from '@/lib/lists-server';
import type { UserProfile, Movie, MovieList as MovieListType } from '@/lib/types';

export default function PublicListPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const params = useParams();
  const username = params.username as string;
  const listId = params.listId as string;

  const [owner, setOwner] = useState<UserProfile | null>(null);
  const [list, setList] = useState<MovieListType | null>(null);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadList() {
      setIsLoading(true);
      setError(null);

      try {
        // Get owner profile
        const profileResult = await apiCall<{ user: UserProfile }>(
          'GET', `/api/v1/users/by-username/${encodeURIComponent(username)}`,
        ).catch((err) => {
          if (err instanceof ApiClientError && err.status === 404) return null;
          throw err;
        });
        if (!profileResult || !profileResult.user) {
          setError('User not found');
          setIsLoading(false);
          return;
        }

        setOwner(profileResult.user);

        // Redirect to own list page if viewing own list
        if (user && profileResult.user.uid === user.uid) {
          router.replace(`/lists/${listId}`);
          return;
        }

        // Get list and movies
        let listResult: PublicListResult;
        try {
          listResult = await apiCall<PublicListResult>(
            'GET', `/api/v1/lists/${profileResult.user.uid}/${listId}/movies-view`,
          );
        } catch (err) {
          if (err instanceof ApiClientError && err.status === 403) {
            setError('This list is private.');
          } else if (err instanceof ApiClientError && err.status === 404) {
            setError('List not found.');
          } else {
            setError('Failed to load list.');
          }
          setIsLoading(false);
          return;
        }

        const loadedList = listResult.list as unknown as MovieListType;
        // Collaborators get the editable view, same as the owner — members
        // shouldn't land on the read-only page for a list they can edit.
        if (
          user &&
          Array.isArray(loadedList?.collaboratorIds) &&
          loadedList.collaboratorIds.includes(user.uid)
        ) {
          router.replace(`/lists/${listId}`);
          return;
        }

        setList(loadedList);
        setMovies(listResult.movies as Movie[]);
      } catch (err) {
        console.error('Failed to load list:', err);
        setError('Failed to load list');
      } finally {
        setIsLoading(false);
      }
    }

    // Wait for auth to settle before fetching — otherwise the effect runs once
    // with user=null (during Firebase bootstrap) and again after it resolves,
    // double-firing the profile + movies-view reads AND briefly showing an
    // owner/collaborator the read-only page before the redirect fires.
    if (!isUserLoading && username && listId) {
      loadList();
    }
  }, [username, listId, user, isUserLoading, router]);

  if (error) {
    return (
      <main className="min-h-screen font-body text-foreground">
        <div className="container mx-auto p-4 md:p-8">
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            <Lock className="h-16 w-16 text-muted-foreground mb-4" />
            <div className="cc-eyebrow">{error === 'This list is private.' ? 'private' : 'not found'}</div>
            <h1 className="font-headline text-2xl font-bold lowercase tracking-tight mt-3 mb-2">
              {error === 'This list is private.' ? 'private list' : 'list not found'}
            </h1>
            <p className="cc-lead text-muted-foreground mb-4 max-w-md">{error}</p>
            <Button onClick={() => router.back()}>go back</Button>
          </div>
        </div>
      </main>
    );
  }

  const hasCover = !!list?.coverImageUrl && list?.coverMode !== 'auto';

  return (
    <>
      <main className="min-h-screen font-body text-foreground pb-24 md:pb-8">
        {/* Cinematic hero — cover (or seeded gradient) + glass back */}
        <Hero
          coverImageUrl={hasCover ? list?.coverImageUrl : undefined}
          seed={list?.name}
          topLeft={
            <GlassBtn icon={ArrowLeft} ariaLabel="Back to profile" onClick={() => router.replace(`/profile/${username}`)} />
          }
        >
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/85">
            public list
          </div>
          {list ? (
            <h1 className="mt-2 font-headline text-[34px] font-bold leading-[0.92] tracking-tight lowercase text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.35)] md:text-5xl">
              {list.name || 'list'}
            </h1>
          ) : (
            <div className="mt-2 h-9 w-2/3 animate-pulse rounded bg-white/20" />
          )}
        </Hero>

        {/* Pull-up content sheet */}
        <div className="relative z-[1] -mt-5 min-h-[60vh] rounded-t-[22px] bg-background">
          <div className="mx-auto max-w-3xl px-4 pt-5">
            {/* Owner attribution + follow */}
            {owner ? (
              <div className="flex items-center gap-3">
                <Link href={`/profile/${owner.username}`} className="transition-opacity hover:opacity-80">
                  <ProfileAvatar
                    photoURL={owner.photoURL}
                    displayName={owner.displayName}
                    username={owner.username}
                    size="md"
                  />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/profile/${owner.username}`}
                    className="block truncate font-headline text-[15px] font-bold lowercase tracking-tight hover:text-primary transition-colors"
                  >
                    {owner.displayName || owner.username}
                  </Link>
                  <p className="font-mono text-[11px] text-muted-foreground truncate">@{owner.username}</p>
                </div>
                {!isUserLoading && user && owner.username && (
                  <FollowButton targetUserId={owner.uid} targetUsername={owner.username} size="sm" />
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3" aria-label="Loading owner">
                <div className="h-10 w-10 rounded-full bg-secondary animate-pulse" />
                <div className="h-4 w-32 rounded bg-secondary animate-pulse" />
              </div>
            )}

            {/* List meta — description · collaborators · like (read-only) */}
            {owner && list ? (
              <div className="mt-5">
                <ListHeader
                  listId={listId}
                  listOwnerId={owner.uid}
                  listData={list}
                  isOwner={false}
                  isCollaborator={false}
                  movieCount={movies.length}
                  posters={movies.map((m) => m.posterUrl).filter(Boolean).slice(0, 3)}
                  hideOwnerInStack
                />
              </div>
            ) : (
              <div className="mt-5 space-y-3" aria-label="Loading list header">
                <div className="h-4 w-1/2 rounded bg-secondary animate-pulse" />
                <div className="h-8 w-1/3 rounded-full bg-secondary animate-pulse" />
              </div>
            )}

            {/* Movie list — read-only; shows its own skeleton while loading */}
            <div className="mt-6">
              <MovieList
                initialMovies={movies}
                isLoading={isLoading}
                listId={listId}
                listOwnerId={owner?.uid}
                listName={list?.name}
                canEdit={false}
                publicReadOnly
                returnPath={`/profile/${username}/lists/${listId}`}
              />
            </div>
          </div>
        </div>
      </main>

      <BottomNav />
    </>
  );
}
