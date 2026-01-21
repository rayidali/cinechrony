'use client';

import Image from 'next/image';
import { useTransition, memo, useMemo } from 'react';
import { Eye, EyeOff, Loader2, Star, Trash2, Film, Tv } from 'lucide-react';

import type { Movie } from '@/lib/types';
import {
  updateDocumentNonBlocking,
  deleteDocumentNonBlocking,
  useFirestore,
  useUser,
} from '@/firebase';
import { Button } from '@/components/ui/button';
import { doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { getRatingStyle } from '@/lib/utils';

type MovieCardListProps = {
  movie: Movie;
  listId?: string;
  listOwnerId?: string;
  canEdit?: boolean;
  onOpenDetails?: (movie: Movie) => void;
};

export const MovieCardList = memo(function MovieCardList({
  movie,
  listId,
  listOwnerId,
  canEdit = true,
  onOpenDetails,
}: MovieCardListProps) {
  const [isPending, startTransition] = useTransition();
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  // Get rating style for movie rating badge
  const ratingStyle = useMemo(() => getRatingStyle(movie.rating ?? null), [movie.rating]);

  // Get notes to display (memoized to prevent array recreation)
  const notesEntries = useMemo(
    () => (movie.notes ? Object.entries(movie.notes) : []),
    [movie.notes]
  );

  // Use denormalized user data from movie doc - no fetch needed!
  const isAddedByCurrentUser = movie.addedBy === user?.uid;
  const addedByName = useMemo(() => {
    if (isAddedByCurrentUser) {
      return user?.displayName || user?.email?.split('@')[0] || 'You';
    }
    // Use denormalized data from movie doc
    return movie.addedByDisplayName || movie.addedByUsername || 'Someone';
  }, [isAddedByCurrentUser, user?.displayName, user?.email, movie.addedByDisplayName, movie.addedByUsername]);

  // Build note author names using denormalized noteAuthors data
  const noteAuthorNames = useMemo(() => {
    const authors: Record<string, string> = {};
    notesEntries.forEach(([uid]) => {
      if (uid === user?.uid) {
        authors[uid] = user?.displayName || user?.email?.split('@')[0] || 'you';
      } else if (movie.noteAuthors?.[uid]) {
        // Use denormalized note author data
        const author = movie.noteAuthors[uid];
        authors[uid] = author.username || author.displayName || 'user';
      } else if (uid === movie.addedBy && movie.addedByUsername) {
        // Fallback to movie adder's denormalized data
        authors[uid] = movie.addedByUsername;
      } else {
        // Final fallback
        authors[uid] = 'user';
      }
    });
    return authors;
  }, [notesEntries, user?.uid, user?.displayName, user?.email, movie.noteAuthors, movie.addedBy, movie.addedByUsername]);

  if (!user) return null;

  const effectiveOwnerId = listOwnerId || user.uid;
  const movieDocRef = listId
    ? doc(firestore, 'users', effectiveOwnerId, 'lists', listId, 'movies', movie.id)
    : doc(firestore, 'users', user.uid, 'movies', movie.id);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    startTransition(() => {
      const newStatus = movie.status === 'To Watch' ? 'Watched' : 'To Watch';
      updateDocumentNonBlocking(movieDocRef, { status: newStatus });
    });
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    startTransition(() => {
      deleteDocumentNonBlocking(movieDocRef);
      const itemType = movie.mediaType === 'tv' ? 'TV Show' : 'Movie';
      toast({
        title: `${itemType} Removed`,
        description: `${movie.title} has been removed from your list.`,
      });
    });
  };

  const handleClick = () => {
    if (onOpenDetails) {
      onOpenDetails(movie);
    }
  };

  return (
    <div
      className="group rounded-lg border-[2px] border-black shadow-[3px_3px_0px_0px_#000] bg-card cursor-pointer transition-all duration-200 md:hover:shadow-[1px_1px_0px_0px_#000] md:hover:translate-x-0.5 md:hover:translate-y-0.5 overflow-hidden"
      onClick={handleClick}
    >
      <div className="flex gap-3 p-3">
        {/* Poster thumbnail */}
        <div className="relative w-16 h-24 flex-shrink-0 rounded overflow-hidden border border-black">
          <Image
            src={movie.posterUrl}
            alt={movie.title}
            fill
            className="object-cover"
            sizes="64px"
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              {movie.mediaType === 'tv' ? (
                <Tv className="h-3.5 w-3.5 text-primary flex-shrink-0" />
              ) : (
                <Film className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              )}
              <h3 className="font-bold text-sm truncate" title={movie.title}>
                {movie.title}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">{movie.year}</p>

            {/* Rating */}
            {movie.rating && (
              <div className="flex items-center gap-1 mt-1">
                <Star className="h-3 w-3" style={{ ...ratingStyle.accent, fill: ratingStyle.accent.color }} />
                <span className="text-xs font-medium" style={ratingStyle.accent}>{movie.rating.toFixed(1)}</span>
              </div>
            )}
          </div>

          {/* Added by */}
          <p className="text-xs text-muted-foreground mt-1">
            Added by {addedByName}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end justify-between">
          {/* Status badge */}
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              movie.status === 'Watched'
                ? 'bg-green-100 text-green-800'
                : 'bg-yellow-100 text-yellow-800'
            }`}
          >
            {movie.status}
          </span>

          {/* Action buttons */}
          {canEdit && (
            <div className="flex gap-1 mt-2">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={handleToggle}
                disabled={isPending}
                title={movie.status === 'To Watch' ? 'Mark Watched' : 'Mark To Watch'}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : movie.status === 'To Watch' ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={handleRemove}
                disabled={isPending}
                title="Remove movie"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Notes section - displayed below the main card content */}
      {notesEntries.length > 0 && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-1.5">
          {notesEntries.map(([uid, note]) => (
            <div key={uid} className="text-sm leading-relaxed">
              <span className="font-semibold text-primary">@{noteAuthorNames[uid] || '...'}</span>
              <span className="text-muted-foreground/50 mx-1.5">·</span>
              <span className="text-muted-foreground line-clamp-2 break-words">{note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
