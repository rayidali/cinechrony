'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { Movie } from '@/lib/types';
import { MovieCellGrid, MovieCellRow } from './movie-cell';
import { MovieCardAnnotated } from './movie-card-annotated';
import { MovieDetailsModal } from './movie-details-modal';
import { PublicMovieDetailsModal } from './public-movie-details-modal';
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

type ViewMode = 'grid' | 'list' | 'annotated';

type MovieListProps = {
  initialMovies: Movie[];
  isLoading: boolean;
  listId?: string;
  listOwnerId?: string;
  listName?: string;
  canEdit?: boolean;
  /**
   * Read-only public list context (`/profile/[username]/lists/[listId]`). Opens
   * the standalone drawer instead of the in-list one, persists its own view
   * mode, and hides editing-only view options. Notes (annotated) mode stays
   * owner/collaborator-only — and they're redirected to the editable page — so
   * a public viewer never sees it.
   */
  publicReadOnly?: boolean;
  /** Return path for the standalone drawer's comments round-trip (public). */
  returnPath?: string;
  /** Lifts the detail-drawer open state so the page can disable pull-to-refresh. */
  onDrawerOpenChange?: (open: boolean) => void;
};

export function MovieList({
  initialMovies,
  isLoading,
  listId,
  listOwnerId,
  listName,
  canEdit = true,
  publicReadOnly = false,
  returnPath,
  onDrawerOpenChange,
}: MovieListProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [filter, setFilter] = useState<'To Watch' | 'Watched'>('To Watch');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ListSort>('recent');
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // The "notes"/annotated reading mode surfaces collaborator notes — owner /
  // collaborator only. The public read-only page never has edit rights.
  const canViewNotes = canEdit && !publicReadOnly;
  // Distinct persistence key per surface so the public grid/list choice can't
  // collide with the editable view (which can be 'annotated').
  const viewModeKey = publicReadOnly ? 'cinechrony-public-view-mode' : 'cinechrony-view-mode';

  // Load view mode from localStorage on mount
  useEffect(() => {
    const allowed: ViewMode[] = canViewNotes ? ['grid', 'list', 'annotated'] : ['grid', 'list'];
    const saved = localStorage.getItem(viewModeKey);
    if (saved && (allowed as string[]).includes(saved)) {
      setViewMode(saved as ViewMode);
    }
  }, [viewModeKey, canViewNotes]);

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
        onDrawerOpenChange?.(true);
        // Clear the query param to avoid reopening on refresh
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('openMovie');
        router.replace(newUrl.pathname + newUrl.search, { scroll: false });
      }
    }
  }, [searchParams, initialMovies, isLoading, router, onDrawerOpenChange]);

  // Save view mode to localStorage when it changes
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(viewModeKey, mode);
  };

  const handleOpenDetails = useCallback((movie: Movie) => {
    setSelectedMovie(movie);
    setIsModalOpen(true);
    onDrawerOpenChange?.(true);
  }, [onDrawerOpenChange]);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedMovie(null);
    onDrawerOpenChange?.(false);
  }, [onDrawerOpenChange]);

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
          <Skeleton className="w-full h-full rounded-[14px] border border-hair" />
        </div>
      ))}
    </div>
  );

  // Render list view skeleton
  const renderListSkeleton = () => (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[98px] rounded-[16px] border border-hair" />
      ))}
    </div>
  );

  // Render empty state — search-aware copy.
  const renderEmptyState = () => {
    const searching = search.trim().length > 0;
    return (
      <div className="text-center py-16 border border-dashed border-hair rounded-[20px] bg-secondary">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Empty" className="h-12 w-12 mx-auto opacity-50 mb-4" />
        <h3 className="font-headline text-2xl font-bold lowercase">
          {searching ? 'nothing matches' : 'all clear'}
        </h3>
        <p className="text-muted-foreground mt-2">
          {searching
            ? `no films in this list match "${search.trim()}".`
            : `no films in the '${filter.toLowerCase()}' list.`}
        </p>
      </div>
    );
  };

  // Render grid view
  const renderGridView = () => (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4">
      {filteredMovies.map((movie) => (
        // grid tile is view-only — no listId/canEdit (mutations live in the drawer)
        <MovieCellGrid
          key={`${movie.id}-${movie.addedBy}`}
          movie={movie}
          listOwnerId={listOwnerId}
          onOpenDetails={handleOpenDetails}
        />
      ))}
    </div>
  );

  // Render list view
  const renderListView = () => (
    <div className="space-y-3">
      {filteredMovies.map((movie) => (
        <MovieCellRow
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

  // Render annotated view (the reading mode — collaborator notes per movie)
  const renderAnnotatedView = () => (
    <div className="bg-card border border-hair rounded-[20px] shadow-lift px-4">
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
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-rule transition-colors',
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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-rule text-muted-foreground transition-colors hover:text-foreground"
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
              {canViewNotes && <DropdownMenuRadioItem value="annotated">notes</DropdownMenuRadioItem>}
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

      {/* Inline search — revealed by the search toggle (v3 search standard) */}
      {showSearch && (
        <div className="mb-4 flex h-12 items-center gap-2 rounded-[14px] border border-hair bg-sunken px-3.5">
          <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.8} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search this list…"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            className="flex-1 border-0 bg-transparent font-body text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
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
            <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
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
        viewMode === 'grid' ? renderGridSkeleton() : renderListSkeleton()
      ) : filteredMovies.length > 0 ? (
        viewMode === 'grid' ? renderGridView() :
        viewMode === 'annotated' ? renderAnnotatedView() :
        renderListView()
      ) : (
        renderEmptyState()
      )}

      {/* Movie details drawer.
       *
       * `key` is bound to the selected movie's ID so the drawer is a FRESH
       * instance every time it opens — without this, the `/lists/[id]` →
       * `/movie/[id]/comments` → back round-trip can revive stale internal
       * state and the details never load. Tying the lifecycle to the movie id
       * makes every open a clean mount.
       *
       * Public read-only lists use the STANDALONE drawer (no disabled in-list
       * controls / empty notes section for a stranger); editable lists use the
       * in-list drawer with watch-status + list notes. */}
      {publicReadOnly ? (
        <PublicMovieDetailsModal
          key={selectedMovie?.id ?? 'no-movie-open'}
          movie={selectedMovie}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          listId={listId}
          listOwnerId={listOwnerId}
          returnPath={returnPath}
        />
      ) : (
        <MovieDetailsModal
          key={selectedMovie?.id ?? 'no-movie-open'}
          movie={selectedMovie}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          listId={listId}
          listOwnerId={listOwnerId}
          listName={listName}
          canEdit={canEdit}
        />
      )}

      {/* One-time hint for grid view on mobile */}
      {viewMode === 'grid' && <GridViewHint />}
    </div>
  );
}
