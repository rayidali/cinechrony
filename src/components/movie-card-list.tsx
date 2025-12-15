'use client';

import Image from 'next/image';
import { useState, useTransition, useEffect } from 'react';
import { Eye, EyeOff, Loader2, Star, Trash2 } from 'lucide-react';

import type { Movie, UserProfile } from '@/lib/types';
import {
  updateDocumentNonBlocking,
  deleteDocumentNonBlocking,
  useFirestore,
  useUser,
} from '@/firebase';
import { getUserProfile } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

type MovieCardListProps = {
  movie: Movie;
  listId?: string;
  listOwnerId?: string;
  canEdit?: boolean;
  onOpenDetails?: (movie: Movie) => void;
};

export function MovieCardList({
  movie,
  listId,
  listOwnerId,
  canEdit = true,
  onOpenDetails,
}: MovieCardListProps) {
  const [isPending, startTransition] = useTransition();
  const [addedByUser, setAddedByUser] = useState<UserProfile | null>(null);
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  // Fetch the user who added this movie
  useEffect(() => {
    async function fetchAddedByUser() {
      if (!movie.addedBy) return;
      try {
        const result = await getUserProfile(movie.addedBy);
        if (result.user) {
          setAddedByUser(result.user);
        }
      } catch (error) {
        console.error('Failed to fetch addedBy user:', error);
      }
    }
    fetchAddedByUser();
  }, [movie.addedBy]);

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
      toast({
        title: 'Movie Removed',
        description: `${movie.title} has been removed from your list.`,
      });
    });
  };

  const handleClick = () => {
    if (onOpenDetails) {
      onOpenDetails(movie);
    }
  };

  // Get display name for added by
  const isAddedByCurrentUser = movie.addedBy === user?.uid;
  const addedByName = addedByUser?.displayName || addedByUser?.username ||
    (isAddedByCurrentUser ? (user?.displayName || user?.email?.split('@')[0] || 'You') : 'Someone');

  return (
    <div
      className="group flex gap-3 p-3 rounded-lg border-[2px] border-black shadow-[3px_3px_0px_0px_#000] bg-card cursor-pointer transition-all duration-200 md:hover:shadow-[1px_1px_0px_0px_#000] md:hover:translate-x-0.5 md:hover:translate-y-0.5"
      onClick={handleClick}
    >
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
          <h3 className="font-bold text-sm truncate" title={movie.title}>
            {movie.title}
          </h3>
          <p className="text-xs text-muted-foreground">{movie.year}</p>

          {/* Rating */}
          {movie.rating && (
            <div className="flex items-center gap-1 mt-1">
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
              <span className="text-xs font-medium">{movie.rating.toFixed(1)}</span>
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
  );
}
