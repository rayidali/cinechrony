'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { Movie } from '@/lib/types';
import { useUser } from '@/firebase';
import { MovieCellGrid, MovieCellRow } from './movie-cell';
import { MovieDetailsModal } from './movie-details-modal';
import { PublicMovieDetailsModal } from './public-movie-details-modal';
import { NotesBoard } from './v3/notes-board';
import { NoteSheet } from './v3/note-sheet';
import { Segmented } from '@/components/v3/segmented';
import { SheetMenu, SheetMenuItem, SheetMenuLabel } from '@/components/ui/sheet-menu';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { cn } from '@/lib/utils';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { arrangeListMovies, LIST_SORTS, type ListSort } from '@/lib/list-sort';

type ViewMode = 'grid' | 'list';
type Tab = 'To Watch' | 'Watched' | 'notes';

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
   * mode, and hides the notes tab (notes are owner/collaborator-only — and they
   * are redirected to the editable page — so a public viewer never sees it).
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
  const { user } = useUser();
  const { toast } = useToast();
  const [filter, setFilter] = useState<Tab>('To Watch');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ListSort>('recent');
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  // Notes-tab composer/editor state.
  const [noteSheet, setNoteSheet] = useState<{ open: boolean; movie: Movie | null; text: string }>(
    { open: false, movie: null, text: '' },
  );
  const [savingNote, setSavingNote] = useState(false);

  // The collaborator-notes board is a first-class tab — owner/collaborator only.
  const canViewNotes = canEdit && !publicReadOnly;
  // Distinct persistence key per surface so the public grid/list choice can't
  // collide with the editable view.
  const viewModeKey = publicReadOnly ? 'cinechrony-public-view-mode' : 'cinechrony-view-mode';

  const noteCount = useMemo(
    () => initialMovies.reduce(
      (n, m) => n + (m.notes ? Object.values(m.notes).filter(Boolean).length : 0),
      0,
    ),
    [initialMovies],
  );

  // Load view mode from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(viewModeKey);
    if (saved === 'grid' || saved === 'list') setViewMode(saved);
  }, [viewModeKey]);

  // If notes access is lost mid-session (e.g. removed as a collaborator), bounce
  // off the now-gone notes tab back to a visible film segment.
  useEffect(() => {
    if (filter === 'notes' && !canViewNotes) setFilter('To Watch');
  }, [filter, canViewNotes]);

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

  const saveNote = useCallback(async (movieId: string, text: string) => {
    if (!listId || !listOwnerId) return;
    setSavingNote(true);
    try {
      await apiCall('PATCH', `/api/v1/lists/${listOwnerId}/${listId}/movies/${movieId}`, { note: text });
      toast({ title: text.trim() ? 'note saved' : 'note removed' });
      setNoteSheet({ open: false, movie: null, text: '' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof ApiClientError ? err.message : 'Failed to save note.',
      });
    } finally {
      setSavingNote(false);
    }
  }, [listId, listOwnerId, toast]);

  // status tab + search + sort. A search query searches the whole list. (Notes
  // tab doesn't use this — the board flattens all movies itself.)
  const filteredMovies = useMemo(
    () => (filter === 'notes'
      ? []
      : arrangeListMovies(initialMovies, { query: search, status: filter, sort })),
    [initialMovies, search, filter, sort],
  );

  // Incremental windowing. A Letterboxd-imported list can hold thousands of
  // films; rendering them all at once floods the DOM (slow first paint + scroll
  // jank + memory). Instead we render a capped window that GROWS as a sentinel
  // near the bottom enters view — the same infinite-scroll pattern the home feed
  // uses (proven in the WKWebView), applied to an already-loaded array. Small
  // lists (<= WINDOW_INITIAL) render fully with no sentinel overhead.
  const WINDOW_INITIAL = 48;
  const WINDOW_STEP = 48;
  const [visibleCount, setVisibleCount] = useState(WINDOW_INITIAL);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset the window whenever the result set changes (tab/search/sort) so a new
  // view starts from the top instead of inheriting a huge previous window.
  useEffect(() => {
    setVisibleCount(WINDOW_INITIAL);
  }, [filter, search, sort]);

  const renderedMovies = useMemo(
    () => (filteredMovies.length > visibleCount ? filteredMovies.slice(0, visibleCount) : filteredMovies),
    [filteredMovies, visibleCount],
  );
  const hasMoreToRender = renderedMovies.length < filteredMovies.length;

  // Grow the window when the sentinel scrolls into view.
  useEffect(() => {
    if (!hasMoreToRender) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => c + WINDOW_STEP);
        }
      },
      { rootMargin: '600px' }, // pre-load a screen ahead so growth is invisible
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMoreToRender, renderedMovies.length]);

  // Sentinel + "showing N of M" footer, rendered under the grid/list.
  const renderWindowSentinel = () =>
    hasMoreToRender ? (
      <div ref={sentinelRef} className="py-6 text-center cc-meta text-xs text-muted-foreground">
        showing {renderedMovies.length} of {filteredMovies.length}
      </div>
    ) : null;

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
        <img src="/brand/cinechrony-icon.png" alt="" className="h-12 w-12 mx-auto opacity-50 mb-4" />
        <h3 className="font-headline text-2xl font-bold lowercase">
          {searching ? 'nothing matches' : 'all clear'}
        </h3>
        <p className="text-muted-foreground mt-2">
          {searching
            ? `no films in this list match "${search.trim()}".`
            : `no films in the '${(filter as string).toLowerCase()}' list.`}
        </p>
      </div>
    );
  };

  // Render grid view
  const renderGridView = () => (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4">
        {renderedMovies.map((movie) => (
          // grid tile is view-only — no listId/canEdit (mutations live in the drawer)
          <MovieCellGrid
            key={`${movie.id}-${movie.addedBy}`}
            movie={movie}
            listOwnerId={listOwnerId}
            onOpenDetails={handleOpenDetails}
          />
        ))}
      </div>
      {renderWindowSentinel()}
    </>
  );

  // Render list view
  const renderListView = () => (
    <>
      <div className="space-y-3">
        {renderedMovies.map((movie) => (
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
      {renderWindowSentinel()}
    </>
  );

  const isNotes = filter === 'notes' && canViewNotes;

  return (
    <div className="w-full">
      {/* Toolbar — segmented (+ notes tab) + search toggle + view/sort menu */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex-1">
          <Segmented
            value={filter}
            onChange={(value) => {
              // Don't bleed a film search into the notes board (or vice-versa).
              setFilter(value as Tab);
              setSearch('');
              setShowSearch(false);
            }}
            options={[
              { id: 'To Watch', label: 'to watch' },
              { id: 'Watched', label: 'watched' },
              ...(canViewNotes ? [{ id: 'notes', label: `notes · ${noteCount}` }] : []),
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

        {/* view/sort menu — films only (notes have no grid/list/sort) */}
        {!isNotes && (
          <SheetMenu
            title="view & sort"
            trigger={(open) => (
              <button
                type="button"
                onClick={open}
                aria-label="View and sort options"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-rule text-muted-foreground transition-colors hover:text-foreground"
              >
                <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </button>
            )}
          >
            {(close) => (
              <>
                <SheetMenuLabel>view</SheetMenuLabel>
                <SheetMenuItem active={viewMode === 'grid'} onSelect={() => { handleViewModeChange('grid'); close(); }}>grid</SheetMenuItem>
                <SheetMenuItem active={viewMode === 'list'} onSelect={() => { handleViewModeChange('list'); close(); }}>list</SheetMenuItem>
                <SheetMenuLabel>sort</SheetMenuLabel>
                {LIST_SORTS.map((o) => (
                  <SheetMenuItem key={o.id} active={sort === o.id} onSelect={() => { setSort(o.id as ListSort); close(); }}>
                    {o.label}
                  </SheetMenuItem>
                ))}
              </>
            )}
          </SheetMenu>
        )}
      </div>

      {/* Inline search — revealed by the search toggle (v3 search standard) */}
      {showSearch && (
        <div className="mb-4 flex h-12 items-center gap-2 rounded-[14px] border border-hair bg-sunken px-3.5">
          <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.8} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isNotes ? 'search notes…' : 'search this list…'}
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

      {/* Film count — films tabs only */}
      {!isNotes && (
        <p className="cc-meta text-xs text-muted-foreground mb-4">
          {filteredMovies.length} {filteredMovies.length === 1 ? 'film' : 'films'}
          {search.trim() ? ` matching “${search.trim()}”` : ''}
        </p>
      )}

      {/* Content */}
      {isNotes ? (
        <NotesBoard
          movies={initialMovies}
          query={search}
          onOpenFilm={handleOpenDetails}
          onAddNote={() => setNoteSheet({ open: true, movie: null, text: '' })}
          onEditNote={(movie, text) => setNoteSheet({ open: true, movie, text })}
        />
      ) : isLoading ? (
        viewMode === 'grid' ? renderGridSkeleton() : renderListSkeleton()
      ) : filteredMovies.length > 0 ? (
        viewMode === 'grid' ? renderGridView() : renderListView()
      ) : (
        renderEmptyState()
      )}

      {/* Movie details drawer (see the round-trip comment above). Public
       *  read-only lists use the STANDALONE drawer; editable lists the in-list one. */}
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

      {/* Notes composer/editor (owner/collaborator) */}
      {canViewNotes && (
        <NoteSheet
          isOpen={noteSheet.open}
          films={initialMovies}
          movie={noteSheet.movie}
          initialText={noteSheet.text}
          listName={listName}
          currentUserId={user?.uid}
          saving={savingNote}
          onSave={saveNote}
          onClose={() => setNoteSheet({ open: false, movie: null, text: '' })}
        />
      )}
    </div>
  );
}
