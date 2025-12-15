'use client';

import { useState, useEffect } from 'react';
import type { Movie } from '@/lib/types';
import { MovieCard } from './movie-card';
import { MovieCardGrid } from './movie-card-grid';
import { MovieCardList } from './movie-card-list';
import { MovieDetailsModal } from './movie-details-modal';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Film, Grid3X3, List, LayoutGrid } from 'lucide-react';
import { Skeleton } from './ui/skeleton';

type ViewMode = 'grid' | 'list' | 'cards';

type MovieListProps = {
  initialMovies: Movie[];
  isLoading: boolean;
  listId?: string;
  listOwnerId?: string;
  canEdit?: boolean;
};

const VIEW_MODE_KEY = 'movienight-view-mode';

export function MovieList({ initialMovies, isLoading, listId, listOwnerId, canEdit = true }: MovieListProps) {
  const [filter, setFilter] = useState<'To Watch' | 'Watched'>('To Watch');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Load view mode from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    if (saved && ['grid', 'list', 'cards'].includes(saved)) {
      setViewMode(saved as ViewMode);
    }
  }, []);

  // Save view mode to localStorage when it changes
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

  const filteredMovies = initialMovies.filter((movie) => movie.status === filter);

  // Render grid view skeleton
  const renderGridSkeleton = () => (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="aspect-[2/3]">
          <Skeleton className="w-full h-full rounded-md border-[2px] border-black" />
        </div>
      ))}
    </div>
  );

  // Render list view skeleton
  const renderListSkeleton = () => (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[100px] rounded-lg border-[2px] border-black" />
      ))}
    </div>
  );

  // Render cards view skeleton (original)
  const renderCardsSkeleton = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
      <Skeleton className="h-[500px] rounded-lg border-[3px] border-black" />
      <Skeleton className="h-[500px] rounded-lg border-[3px] border-black" />
    </div>
  );

  // Render empty state
  const renderEmptyState = () => (
    <div className="text-center py-16 border-[3px] border-dashed border-black rounded-lg bg-secondary">
      <Film className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h3 className="font-headline text-2xl font-bold">All clear!</h3>
      <p className="text-muted-foreground mt-2">
        There are no movies in the &apos;{filter}&apos; list.
      </p>
    </div>
  );

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
          <Button
            variant={viewMode === 'cards' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => handleViewModeChange('cards')}
            className="h-8 w-8 p-0"
            title="Full cards view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Movie count */}
      <p className="text-sm text-muted-foreground mb-4">
        {filteredMovies.length} {filteredMovies.length === 1 ? 'movie' : 'movies'}
      </p>

      {/* Movie display */}
      {isLoading ? (
        viewMode === 'grid' ? renderGridSkeleton() :
        viewMode === 'list' ? renderListSkeleton() :
        renderCardsSkeleton()
      ) : filteredMovies.length > 0 ? (
        viewMode === 'grid' ? renderGridView() :
        viewMode === 'list' ? renderListView() :
        renderCardsView()
      ) : (
        renderEmptyState()
      )}

      {/* Movie details modal for grid/list views */}
      <MovieDetailsModal
        movie={selectedMovie}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        listId={listId}
        listOwnerId={listOwnerId}
        canEdit={canEdit}
      />
    </div>
  );
}
