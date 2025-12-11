'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Film, ArrowLeft } from 'lucide-react';
import { useUser, useFirestore, useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { UserAvatar } from '@/components/user-avatar';
import { collection, doc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { MovieList } from '@/components/movie-list';
import { AddMovieFormForList } from '@/components/add-movie-form-list';
import type { Movie, MovieList as MovieListType } from '@/lib/types';

const retroButtonClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

export default function ListDetailPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const params = useParams();
  const listId = params.listId as string;
  const firestore = useFirestore();

  // Get list details
  const listDocRef = useMemoFirebase(() => {
    if (!user || !listId) return null;
    return doc(firestore, 'users', user.uid, 'lists', listId);
  }, [firestore, user, listId]);

  const { data: listData, isLoading: isLoadingList } = useDoc<MovieListType>(listDocRef);

  // Get movies in this list
  const moviesQuery = useMemoFirebase(() => {
    if (!user || !listId) return null;
    return collection(firestore, 'users', user.uid, 'lists', listId, 'movies');
  }, [firestore, user, listId]);

  const { data: movies, isLoading: isLoadingMovies } = useCollection<Movie>(moviesQuery);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
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
            <div className="flex items-center gap-4 mb-6">
              <Film className="h-10 w-10 md:h-12 md:w-12 text-primary" />
              <h1 className="text-4xl md:text-6xl font-headline font-bold text-center tracking-tighter">
                {isLoadingList ? '...' : listData?.name || 'List'}
              </h1>
            </div>
            <p className="max-w-2xl text-center text-muted-foreground mb-8">
              Add movies, track what to watch, and what you&apos;ve watched.
            </p>
            <div className="w-full max-w-2xl">
              <AddMovieFormForList listId={listId} />
            </div>
          </div>
        </header>

        <MovieList
          initialMovies={movies || []}
          isLoading={isLoadingMovies}
          listId={listId}
        />
      </div>
    </main>
  );
}
