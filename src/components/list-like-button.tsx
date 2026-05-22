'use client';

import { useState, useTransition, useMemo } from 'react';
import { Heart } from 'lucide-react';
import { useAuth, useUser } from '@/firebase';
import { likeList, unlikeList } from '@/app/actions';
import { cn } from '@/lib/utils';

type ListLikeButtonProps = {
  listOwnerId: string;
  listId: string;
  initialLikes: number;
  initialLikedBy: string[];
  /** `detail` — outlined pill on the list view; `cover` — glass pill on a cover card. */
  variant?: 'detail' | 'cover';
  className?: string;
};

/**
 * Like / unlike a public list (LAUNCH 0.5.1).
 *
 * Optimistic toggle — the heart fills sage when liked (the v2 like treatment,
 * matching reviews + activity). Disabled for signed-out viewers and for the
 * list owner (no liking your own shelf).
 */
export function ListLikeButton({
  listOwnerId,
  listId,
  initialLikes,
  initialLikedBy,
  variant = 'detail',
  className,
}: ListLikeButtonProps) {
  const { user } = useUser();
  const auth = useAuth();
  const [isPending, startTransition] = useTransition();

  const [likes, setLikes] = useState(initialLikes);
  const [isLiked, setIsLiked] = useState(
    user ? initialLikedBy.includes(user.uid) : false,
  );

  const isOwner = user?.uid === listOwnerId;
  const disabled = !user || isOwner || isPending;

  const handleToggle = () => {
    if (disabled) return;
    const next = !isLiked;
    setIsLiked(next);
    setLikes((n) => Math.max(0, next ? n + 1 : n - 1));

    startTransition(async () => {
      try {
        const idToken = (await auth.currentUser?.getIdToken()) ?? '';
        const res = next
          ? await likeList(idToken, listOwnerId, listId)
          : await unlikeList(idToken, listOwnerId, listId);
        if ('error' in res && res.error) {
          // Roll back on failure.
          setIsLiked(!next);
          setLikes((n) => Math.max(0, next ? n - 1 : n + 1));
        } else if ('likes' in res && typeof res.likes === 'number') {
          setLikes(res.likes);
        }
      } catch {
        setIsLiked(!next);
        setLikes((n) => Math.max(0, next ? n - 1 : n + 1));
      }
    });
  };

  const label = useMemo(
    () => (isLiked ? 'Unlike list' : 'Like list'),
    [isLiked],
  );

  if (variant === 'cover') {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleToggle();
        }}
        disabled={disabled}
        aria-label={label}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-full',
          'bg-black/45 backdrop-blur-sm text-white cc-meta text-[10px]',
          'transition-transform active:scale-90',
          disabled && 'opacity-90',
          className,
        )}
      >
        <Heart
          className={cn('h-3 w-3', isLiked && 'fill-current text-success')}
          strokeWidth={2}
        />
        {likes > 0 && <span>{likes}</span>}
      </button>
    );
  }

  return (
    <button
      onClick={handleToggle}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-2 h-10 px-4 rounded-full border transition-colors',
        'font-headline font-semibold text-sm lowercase tracking-tight',
        isLiked
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-border text-foreground hover:border-foreground/40',
        disabled && !isLiked && 'opacity-60',
        className,
      )}
    >
      <Heart
        className={cn('h-4 w-4', isLiked && 'fill-current')}
        strokeWidth={1.8}
      />
      <span className="tabular-nums">{likes}</span>
      <span className="text-muted-foreground font-normal">
        {likes === 1 ? 'like' : 'likes'}
      </span>
    </button>
  );
}
