'use client';

import Image from 'next/image';
import { useState, useTransition } from 'react';
import { Eye, EyeOff, Loader2, Star } from 'lucide-react';

import type { Movie } from '@/lib/types';
import {
  updateDocumentNonBlocking,
  deleteDocumentNonBlocking,
  useFirestore,
  useUser,
} from '@/firebase';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { doc } from 'firebase/firestore';

type MovieCardGridProps = {
  movie: Movie;
  listId?: string;
  listOwnerId?: string;
  canEdit?: boolean;
  onOpenDetails?: (movie: Movie) => void;
};

export function MovieCardGrid({
  movie,
  listId,
  listOwnerId,
  canEdit = true,
  onOpenDetails,
}: MovieCardGridProps) {
  const [isPending, startTransition] = useTransition();
  const [showQuickActions, setShowQuickActions] = useState(false);
  const { user } = useUser();
  const firestore = useFirestore();

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

  const handleClick = () => {
    if (onOpenDetails) {
      onOpenDetails(movie);
    }
  };

  return (
    <div
      className="group relative cursor-pointer"
      onClick={handleClick}
      onMouseEnter={() => setShowQuickActions(true)}
      onMouseLeave={() => setShowQuickActions(false)}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-md overflow-hidden border-[2px] border-black shadow-[3px_3px_0px_0px_#000] transition-all duration-200 md:group-hover:shadow-[1px_1px_0px_0px_#000] md:group-hover:translate-x-0.5 md:group-hover:translate-y-0.5">
        <Image
          src={movie.posterUrl}
          alt={movie.title}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 20vw"
        />

        {/* Rating badge (if available) */}
        {movie.rating && (
          <div className="absolute top-1 left-1 bg-black/80 text-white px-1.5 py-0.5 rounded text-xs font-bold flex items-center gap-0.5">
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
            {movie.rating.toFixed(1)}
          </div>
        )}

        {/* Status indicator */}
        <div className="absolute bottom-1 right-1">
          <div
            className={`w-5 h-5 rounded-full border-2 border-white flex items-center justify-center ${
              movie.status === 'Watched'
                ? 'bg-green-500'
                : 'bg-yellow-500'
            }`}
          >
            {movie.status === 'Watched' ? (
              <Eye className="h-3 w-3 text-white" />
            ) : (
              <EyeOff className="h-3 w-3 text-white" />
            )}
          </div>
        </div>

        {/* Hover overlay with quick actions - desktop only */}
        {canEdit && (
          <div className="absolute inset-0 bg-black/60 opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Button
              size="sm"
              variant={movie.status === 'Watched' ? 'secondary' : 'default'}
              onClick={handleToggle}
              disabled={isPending}
              className="text-xs px-2 py-1 h-auto"
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : movie.status === 'To Watch' ? (
                'Mark Watched'
              ) : (
                'Mark To Watch'
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Title below poster (mobile-visible, desktop on hover) */}
      <div className="mt-1 px-0.5">
        <p className="text-xs font-medium truncate" title={movie.title}>
          {movie.title}
        </p>
        <p className="text-xs text-muted-foreground">{movie.year}</p>
      </div>
    </div>
  );
}
