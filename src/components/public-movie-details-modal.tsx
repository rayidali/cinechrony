'use client';

import type { Movie } from '@/lib/types';
import { MovieDrawer } from './movie-drawer';

type PublicMovieDetailsModalProps = {
  movie: Movie | null;
  isOpen: boolean;
  onClose: () => void;
  listId?: string;
  listOwnerId?: string;
  /** Full path to return to (comments round-trip). */
  returnPath?: string;
  /** z-index class for the drawer overlay + content (default z-50). */
  stackClassName?: string;
};

/**
 * Read-only twin — now a thin adapter over the unified {@link MovieDrawer}.
 * Always the `standalone` visual (now-showing eyebrow · want-to-watch ·
 * comments); `listId`/`listOwnerId`/`returnPath` ride through as route-only
 * context so the comments round-trip lands back in the right place.
 */
export function PublicMovieDetailsModal({
  movie, isOpen, onClose, listId, listOwnerId, returnPath, stackClassName,
}: PublicMovieDetailsModalProps) {
  return (
    <MovieDrawer
      movie={movie}
      isOpen={isOpen}
      onClose={onClose}
      context={{ kind: 'standalone' }}
      returnPath={returnPath}
      routeListId={listId}
      routeListOwnerId={listOwnerId}
      stackClassName={stackClassName}
    />
  );
}
