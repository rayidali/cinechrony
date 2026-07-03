'use client';

import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { invalidateCachedAction } from '@/lib/use-cached-action';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';

type FollowButtonProps = {
  targetUserId: string;
  targetUsername: string;
  /** Pre-populated "does viewer follow target". If omitted, fetched lazily. */
  initialIsFollowing?: boolean;
  /** Pre-populated "does target follow viewer" — drives the "follow back"
   *  label. If omitted, fetched lazily alongside `initialIsFollowing`. */
  initialIsFollowedByTarget?: boolean;
  onFollowChange?: (isFollowing: boolean) => void;
  size?: 'default' | 'sm';
};

/**
 * FollowButton — v3 pill. Film-red filled for follow / follow-back, tonal with
 * a check for following (tap to unfollow). Lowercase, haptic on toggle.
 * Pass both `initial*` props to skip the status round-trip (lists pre-resolve
 * the relationship for every row → zero per-row fetches).
 */
export function FollowButton({
  targetUserId,
  targetUsername,
  initialIsFollowing,
  initialIsFollowedByTarget,
  onFollowChange,
  size = 'default',
}: FollowButtonProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [following, setFollowing] = useState(initialIsFollowing ?? false);
  const [followsViewer, setFollowsViewer] = useState(initialIsFollowedByTarget ?? false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(
    initialIsFollowing === undefined || initialIsFollowedByTarget === undefined,
  );

  // Resolve both directions of the follow relationship in one round trip —
  // skipped entirely when both initial values were supplied.
  useEffect(() => {
    async function checkStatus() {
      if (!user) return;
      if (initialIsFollowing !== undefined && initialIsFollowedByTarget !== undefined) {
        return;
      }
      setIsCheckingStatus(true);
      try {
        const rel = await apiCall<{ isFollowing: boolean; isFollowedBy: boolean }>(
          'GET', `/api/v1/users/${targetUserId}/follow-status`,
        ).catch(() => ({ isFollowing: false, isFollowedBy: false }));
        setFollowing(initialIsFollowing ?? rel.isFollowing);
        setFollowsViewer(initialIsFollowedByTarget ?? rel.isFollowedBy);
      } catch (error) {
        console.error('Failed to check follow status:', error);
      } finally {
        setIsCheckingStatus(false);
      }
    }
    checkStatus();
  }, [user, targetUserId, initialIsFollowing, initialIsFollowedByTarget]);

  const handleToggleFollow = async () => {
    if (!user || isLoading) return;
    const next = !following;
    // Optimistic: flip instantly (the label change IS the feedback), then
    // confirm with the server and roll back on failure — the bookmark-button
    // pattern. The highest-signal social action must never wait on a round trip.
    haptic('selection');
    setFollowing(next);
    onFollowChange?.(next);
    invalidateCachedAction(`following:${user.uid}`);
    setIsLoading(true);
    try {
      await apiCall(next ? 'POST' : 'DELETE', `/api/v1/users/${targetUserId}/follow`);
    } catch (err) {
      setFollowing(!next); // roll back
      onFollowChange?.(!next);
      invalidateCachedAction(`following:${user.uid}`);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof ApiClientError ? err.message : 'Failed to update follow.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Hidden on your own row.
  if (user?.uid === targetUserId) return null;

  const dims = size === 'sm' ? 'h-9 px-3.5 text-[13px]' : 'h-11 px-5 text-[14px]';
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-full font-headline font-semibold lowercase tracking-tight transition-transform active:scale-95 disabled:opacity-60';

  // viewer-follows-target wins ("following"); else if they follow us →
  // "follow back"; else "follow". While the relationship is still resolving we
  // show the neutral "follow" label (no spinner) — far better than a spinner
  // pill popping in on the reel / public profile; it self-corrects the instant
  // status lands, and an early tap is handled optimistically.
  const label = following ? 'following' : followsViewer ? 'follow back' : 'follow';

  return (
    <button
      onClick={handleToggleFollow}
      disabled={isLoading || isCheckingStatus || !user}
      className={cn(
        base,
        dims,
        following ? 'bg-secondary text-foreground' : 'bg-primary text-primary-foreground shadow-fab',
      )}
    >
      {following && <Check className="h-4 w-4" strokeWidth={2.4} />}
      {label}
    </button>
  );
}
