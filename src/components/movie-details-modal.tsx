'use client';

import type { Movie } from '@/lib/types';
import { MovieDrawer } from './movie-drawer';

type MovieDetailsModalProps = {
  movie: Movie | null;
  isOpen: boolean;
  onClose: () => void;
  listId?: string;
  listOwnerId?: string;
  listName?: string;
  canEdit?: boolean;
};

/**
 * Editable in-list drawer — now a thin adapter over the unified
 * {@link MovieDrawer}. With a `listId` it renders the `in-list` visual
 * (IN · <list> eyebrow · list-name · comments · watch-status + list notes);
 * without one it falls back to `standalone`.
 */
export function MovieDetailsModal({
  movie, isOpen, onClose, listId, listOwnerId, listName, canEdit = true,
}: MovieDetailsModalProps) {
  return (
    <MovieDrawer
      movie={movie}
      isOpen={isOpen}
      onClose={onClose}
      context={
        listId && listOwnerId
          ? { kind: 'in-list', listId, listOwnerId, listName, canEdit }
          : { kind: 'standalone' }
      }
    />
  );
}
