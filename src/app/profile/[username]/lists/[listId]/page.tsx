'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Film,
  User,
  ArrowLeft,
  Lock,
  Grid3X3,
  List,
} from 'lucide-react';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FollowButton } from '@/components/follow-button';
import { Skeleton } from '@/components/ui/skeleton';
import { PublicMovieGrid } from '@/components/public-movie-grid';
import { PublicMovieListItem } from '@/components/public-movie-list-item';
import { PublicMovieDetailsModal } from '@/components/public-movie-details-modal';
import {
  getUserByUsername,
  getPublicListMovies,
} from '@/app/actions';
import type { UserProfile, Movie, MovieList } from '@/lib/types';

type ViewMode = 'grid' | 'list';
const VIEW_MODE_KEY = 'movienight-view-mode';

export default function PublicListPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const params = useParams();
  const username = params.username as string;
  const listId = params.listId as string;

  const [owner, setOwner] = useState<UserProfile | null>(null);
  const [list, setList] = useState<MovieList | null>(null);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'To Watch' | 'Watched'>('To Watch');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Load view mode from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    if (saved && ['grid', 'list'].includes(saved)) {
      setViewMode(saved as ViewMode);
    }
  }, []);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const handleOpenDetails = (movie: Movie) => {
    setSelectedMovie(movie);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedMovie(null);
  };

  useEffect(() => {
    async function loadList() {
      setIsLoading(true);
      setError(null);

      try {
        // Get owner profile
        const profileResult = await getUserByUsername(username);
        if (profileResult.error || !profileResult.user) {
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
        const viewerId = user?.uid || '';
        const listResult = await getPublicListMovies(profileResult.user.uid, listId, viewerId);

        if (listResult.error) {
          setError(listResult.error);
          setIsLoading(false);
          return;
        }

        setList(listResult.list as MovieList);
        setMovies(listResult.movies as Movie[]);
      } catch (err) {
        console.error('Failed to load list:', err);
        setError('Failed to load list');
      } finally {
        setIsLoading(false);
      }
    }

    if (username && listId) {
      loadList();
    }
  }, [username, listId, user, router]);

  const filteredMovies = movies.filter((movie) => movie.status === filter);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-background font-body text-foreground">
        <div className="container mx-auto p-4 md:p-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <Lock className="h-16 w-16 text-muted-foreground mb-4" />
            <h1 className="text-2xl font-headline font-bold mb-2">
              {error === 'This list is private.' ? 'Private List' : 'List Not Found'}
            </h1>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={() => router.back()}>Go Back</Button>
          </div>
        </div>
      </main>
    );
  }

  // Render grid skeleton
  const renderGridSkeleton = () => (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="aspect-[2/3]">
          <Skeleton className="w-full h-full rounded-md border-[2px] border-black" />
        </div>
      ))}
    </div>
  );

  // Render list skeleton
  const renderListSkeleton = () => (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[100px] rounded-lg border-[2px] border-black" />
      ))}
    </div>
  );

  return (
    <main className="min-h-screen bg-background font-body text-foreground">
      <div className="container mx-auto p-4 md:p-8">
        <header className="mb-8">
          <div className="w-full flex justify-between items-center mb-6">
            <Button variant="ghost" className="gap-2" onClick={() => router.replace(`/profile/${username}`)}>
              <ArrowLeft className="h-4 w-4" />
              Back to Profile
            </Button>
          </div>

          {/* List Header */}
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-4 mb-4">
              <Film className="h-10 w-10 md:h-12 md:w-12 text-primary" />
              <h1 className="text-3xl md:text-5xl font-headline font-bold text-center tracking-tighter">
                {list?.name || 'List'}
              </h1>
            </div>

            {/* Owner Info */}
            {owner && (
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 border-[2px] border-black flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <Link href={`/profile/${owner.username}`} className="font-medium hover:text-primary transition-colors">
                    {owner.displayName || owner.username}
                  </Link>
                  <p className="text-sm text-muted-foreground">@{owner.username}</p>
                </div>
                {!isUserLoading && user && (
                  <FollowButton
                    targetUserId={owner.uid}
                    targetUsername={owner.username || ''}
                    size="sm"
                  />
                )}
              </div>
            )}

            <p className="text-muted-foreground text-center">
              Viewing {owner?.displayName || owner?.username}&apos;s list (read-only)
            </p>
          </div>
        </header>

        {/* Filter and View Toggle */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
          {/* Filter tabs */}
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as 'To Watch' | 'Watched')}
            className="w-full sm:w-auto"
          >
            <TabsList className="grid w-full sm:w-auto grid-cols-2 bg-background border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] p-0 h-auto">
              <TabsTrigger
                value="To Watch"
                className="rounded-l-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none border-r-[3px] border-black px-4"
              >
                To Watch
              </TabsTrigger>
              <TabsTrigger
                value="Watched"
                className="rounded-r-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none px-4"
              >
                Watched
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* View mode toggle */}
          <div className="flex items-center gap-1 border-[2px] border-black rounded-lg p-1 bg-background">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleViewModeChange('grid')}
              className="h-8 w-8 p-0"
              title="Grid view"
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleViewModeChange('list')}
              className="h-8 w-8 p-0"
              title="List view"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Movie count */}
        <p className="text-sm text-muted-foreground mb-4">
          {filteredMovies.length} {filteredMovies.length === 1 ? 'movie' : 'movies'}
        </p>

        {/* Movies Display */}
        {filteredMovies.length > 0 ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4">
              {filteredMovies.map((movie) => (
                <PublicMovieGrid
                  key={movie.id}
                  movie={movie}
                  onOpenDetails={handleOpenDetails}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredMovies.map((movie) => (
                <PublicMovieListItem
                  key={movie.id}
                  movie={movie}
                  onOpenDetails={handleOpenDetails}
                />
              ))}
            </div>
          )
        ) : (
          <div className="text-center py-16 border-[3px] border-dashed border-black rounded-lg bg-secondary">
            <Film className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-headline text-2xl font-bold">No movies here</h3>
            <p className="text-muted-foreground mt-2">
              There are no movies in the &apos;{filter}&apos; list.
            </p>
          </div>
        )}

        {/* Movie Details Modal */}
        <PublicMovieDetailsModal
          movie={selectedMovie}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
        />
      </div>
    </main>
  );
}
