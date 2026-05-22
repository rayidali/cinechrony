'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { Movie } from '@/lib/types';
import { MovieCard } from './movie-card';
import { MovieCardGrid } from './movie-card-grid';
import { MovieCardList } from './movie-card-list';
import { MovieCardAnnotated } from './movie-card-annotated';
import { MovieDetailsModal } from './movie-details-modal';
import { GridViewHint } from './grid-view-hint';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Grid3X3, List, LayoutGrid, AlignLeft } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { ListControls } from './list-controls';
import { arrangeListMovies, type ListSort } from '@/lib/list-sort';

type ViewMode = 'grid' | 'list' | 'cards' | 'annotated';

type MovieListProps = {
  initialMovies: Movie[];
  isLoading: boolean;
  listId?: string;
  listOwnerId?: string;
  canEdit?: boolean;
};

const VIEW_MODE_KEY = 'cinechrony-view-mode';

export function MovieList({ initialMovies, isLoading, listId, listOwnerId, canEdit = true }: MovieListProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [filter, setFilter] = useState<'To Watch' | 'Watched'>('To Watch');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ListSort>('recent');
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Load view mode from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    if (saved && ['grid', 'list', 'cards', 'annotated'].includes(saved)) {
      setViewMode(saved as ViewMode);
    }
  }, []);

  // Handle openMovie query param - reopen modal when returning from comments page
  useEffect(() => {
    const openMovieId = searchParams.get('openMovie');
    if (openMovieId && initialMovies.length > 0 && !isLoading) {
      const movieToOpen = initialMovies.find(m => m.id === openMovieId);
      if (movieToOpen) {
        // Switch to the correct filter tab based on movie status
        setFilter(movieToOpen.status);
        setSelectedMovie(movieToOpen);
        setIsModalOpen(true);
        // Clear the query param to avoid reopening on refresh
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('openMovie');
        router.replace(newUrl.pathname + newUrl.search, { scroll: false });
      }
    }
  }, [searchParams, initialMovies, isLoading, router]);

  // Save view mode to localStorage when it changes
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const handleOpenDetails = useCallback((movie: Movie) => {
    setSelectedMovie(movie);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedMovie(null);
  }, []);

  // status tab + search + sort. A search query searches the whole list.
  const filteredMovies = useMemo(
    () => arrangeListMovies(initialMovies, { query: search, status: filter, sort }),
    [initialMovies, search, filter, sort]
  );

  // Render grid view skeleton
  const renderGridSkeleton = () => (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="aspect-[2/3]">
          <Skeleton className="w-full h-full rounded-md border border-border" />
        </div>
      ))}
    </div>
  );

  // Render list view skeleton
  const renderListSkeleton = () => (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[100px] rounded-lg border border-border" />
      ))}
    </div>
  );

  // Render cards view skeleton (original)
  const renderCardsSkeleton = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
      <Skeleton className="h-[500px] rounded-lg border border-border" />
      <Skeleton className="h-[500px] rounded-lg border border-border" />
    </div>
  );

  // Render empty state — search-aware copy.
  const renderEmptyState = () => {
    const searching = search.trim().length > 0;
    return (
      <div className="text-center py-16 border border-dashed border-border rounded-lg bg-secondary">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Empty" className="h-12 w-12 mx-auto opacity-50 mb-4" />
        <h3 className="font-headline text-2xl font-bold lowercase">
          {searching ? 'nothing matches' : 'all clear'}
        </h3>
        <p className="text-muted-foreground mt-2">
          {searching
            ? `no films in this list match "${search.trim()}".`
            : `There are no movies in the '${filter}' list.`}
        </p>
      </div>
    );
  };

  // Render grid view
  const renderGridView = () => (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4">
      {filteredMovies.map((movie) => (
        <MovieCardGrid
          key={`${movie.id}-${movie.addedBy}`}
          movie={movie}
          listId={listId}
          listOwnerId={listOwnerId}
          canEdit={canEdit}
          onOpenDetails={handleOpenDetails}
        />
      ))}
    </div>
  );

  // Render list view
  const renderListView = () => (
    <div className="space-y-3">
      {filteredMovies.map((movie) => (
        <MovieCardList
          key={`${movie.id}-${movie.addedBy}`}
          movie={movie}
          listId={listId}
          listOwnerId={listOwnerId}
          canEdit={canEdit}
          onOpenDetails={handleOpenDetails}
        />
      ))}
    </div>
  );

  // Render cards view (original full cards)
  const renderCardsView = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
      {filteredMovies.map((movie) => (
        <MovieCard
          key={`${movie.id}-${movie.addedBy}`}
          movie={movie}
          listId={listId}
          listOwnerId={listOwnerId}
          canEdit={canEdit}
        />
      ))}
    </div>
  );

  // Render annotated view (the reading mode — collaborator notes per movie)
  const renderAnnotatedView = () => (
    <div className="bg-card border border-border rounded-[20px] shadow-lift px-4">
      {filteredMovies.map((movie) => (
        <MovieCardAnnotated
          key={`${movie.id}-${movie.addedBy}`}
          movie={movie}
          onOpenDetails={handleOpenDetails}
        />
      ))}
    </div>
  );

  return (
    <div className="w-full">
      {/* Header with filter tabs and view toggle */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
        {/* Filter tabs */}
        <Tabs
          value={filter}
          onValueChange={(value) => setFilter(value as 'To Watch' | 'Watched')}
          className="w-full sm:w-auto"
        >
          <TabsList className="grid w-full sm:w-auto grid-cols-2 bg-background border border-border rounded-full p-1 h-auto">
            <TabsTrigger
              value="To Watch"
              className="rounded-full px-5 py-1.5 font-headline font-semibold text-sm lowercase tracking-tight data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-none"
            >
              to watch
            </TabsTrigger>
            <TabsTrigger
              value="Watched"
              className="rounded-full px-5 py-1.5 font-headline font-semibold text-sm lowercase tracking-tight data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-none"
            >
              watched
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* View mode toggle */}
        <div className="flex items-center gap-1 border border-border rounded-full p-1 bg-background">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => handleViewModeChange('grid')}
            className="h-8 w-8 p-0 rounded-full"
            title="Grid view"
          >
            <Grid3X3 className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => handleViewModeChange('list')}
            className="h-8 w-8 p-0 rounded-full"
            title="List view"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'cards' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => handleViewModeChange('cards')}
            className="h-8 w-8 p-0 rounded-full"
            title="Full cards view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'annotated' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => handleViewModeChange('annotated')}
            className="h-8 w-8 p-0 rounded-full"
            title="Annotated view"
          >
            <AlignLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search + sort */}
      <ListControls
        query={search}
        onQueryChange={setSearch}
        sort={sort}
        onSortChange={setSort}
      />

      {/* Movie count */}
      <p className="cc-meta text-xs text-muted-foreground mb-4">
        {filteredMovies.length} {filteredMovies.length === 1 ? 'film' : 'films'}
        {search.trim() ? ` matching “${search.trim()}”` : ''}
      </p>

      {/* Movie display */}
      {isLoading ? (
        viewMode === 'grid' ? renderGridSkeleton() :
        viewMode === 'cards' ? renderCardsSkeleton() :
        renderListSkeleton()
      ) : filteredMovies.length > 0 ? (
        viewMode === 'grid' ? renderGridView() :
        viewMode === 'list' ? renderListView() :
        viewMode === 'annotated' ? renderAnnotatedView() :
        renderCardsView()
      ) : (
        renderEmptyState()
      )}

      {/* Movie details modal for grid/list views.
       *
       * `key` is bound to the selected movie's ID so the modal is a FRESH
       * instance every time it opens. Without this, navigating
       * `/lists/[id]` → `/movie/[id]/comments` → back can revive the list
       * page from Next's router cache; the modal's internal state
       * (`mediaDetails`, `isLoadingDetails`, the fetch effect's `cancelled`
       * flag) survives the round-trip. The reopen via the `openMovie`
       * query param flips state in a way where the prior cancel can
       * discard the new fetch and we end up rendering the modal with no
       * details — the "info doesn't load" bug. Tying the lifecycle to the
       * movie id makes every open a clean mount: effects always run, the
       * TMDB fetch always lands. */}
      <MovieDetailsModal
        key={selectedMovie?.id ?? 'no-movie-open'}
        movie={selectedMovie}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        listId={listId}
        listOwnerId={listOwnerId}
        canEdit={canEdit}
      />

      {/* One-time hint for grid view on mobile */}
      {viewMode === 'grid' && <GridViewHint />}
    </div>
  );
}
