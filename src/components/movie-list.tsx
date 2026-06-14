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
import { Segmented } from '@/components/v3/segmented';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { cn } from '@/lib/utils';
import { arrangeListMovies, LIST_SORTS, type ListSort } from '@/lib/list-sort';

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
  const [showSearch, setShowSearch] = useState(false);

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
      {/* Toolbar — segmented + search toggle + view/sort menu (all features,
          collapsed into two tidy affordances). */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex-1">
          <Segmented
            value={filter}
            onChange={(value) => setFilter(value as 'To Watch' | 'Watched')}
            options={[
              { id: 'To Watch', label: 'to watch' },
              { id: 'Watched', label: 'watched' },
            ]}
          />
        </div>

        <button
          type="button"
          onClick={() => setShowSearch((s) => !s)}
          aria-label="Search this list"
          aria-pressed={showSearch}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rule transition-colors',
            showSearch ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Search className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="View and sort options"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rule text-muted-foreground transition-colors hover:text-foreground"
            >
              <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="cc-eyebrow">view</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={viewMode}
              onValueChange={(v) => handleViewModeChange(v as ViewMode)}
            >
              <DropdownMenuRadioItem value="grid">grid</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="list">list</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="cards">cards</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="annotated">notes</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="cc-eyebrow">sort</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as ListSort)}>
              {LIST_SORTS.map((o) => (
                <DropdownMenuRadioItem key={o.id} value={o.id}>
                  {o.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Inline search — revealed by the search toggle */}
      {showSearch && (
        <div className="mb-4 flex h-10 items-center gap-2 rounded-full border border-rule bg-card px-3.5 shadow-press">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search this list…"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            className="flex-1 border-0 bg-transparent font-serif text-sm italic text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setShowSearch(false);
            }}
            aria-label="Close search"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      )}

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
