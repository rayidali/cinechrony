'use client';

import { useState, useEffect } from 'react';
import { Loader2, UserPlus, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isFollowing } from '@/app/actions';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { invalidateCachedAction } from '@/lib/use-cached-action';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

const retroButtonClass = "border border-border rounded-lg shadow-lift transition-all duration-200";

type FollowButtonProps = {
  targetUserId: string;
  targetUsername: string;
  /** Pre-populated "does viewer follow target". If omitted, fetched lazily. */
  initialIsFollowing?: boolean;
  /** Pre-populated "does target follow viewer" — drives the "Follow back"
   *  label. If omitted, fetched lazily alongside `initialIsFollowing`. */
  initialIsFollowedByTarget?: boolean;
  onFollowChange?: (isFollowing: boolean) => void;
  size?: 'default' | 'sm' | 'lg';
};

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

  // Resolve both directions of the follow relationship in parallel.
  // Skipped entirely if both initial values were supplied (avoids the round
  // trips for callers that already know — e.g. server-rendered profile
  // pages that pre-load membership).
  useEffect(() => {
    async function checkStatus() {
      if (!user) return;
      if (initialIsFollowing !== undefined && initialIsFollowedByTarget !== undefined) {
        return;
      }

      setIsCheckingStatus(true);
      try {
        const [viewerFollowsTarget, targetFollowsViewer] = await Promise.all([
          initialIsFollowing === undefined
            ? isFollowing(user.uid, targetUserId)
            : Promise.resolve({ isFollowing: initialIsFollowing }),
          initialIsFollowedByTarget === undefined
            ? isFollowing(targetUserId, user.uid)
            : Promise.resolve({ isFollowing: initialIsFollowedByTarget }),
        ]);
        if (!('error' in viewerFollowsTarget)) {
          setFollowing(viewerFollowsTarget.isFollowing ?? false);
        }
        if (!('error' in targetFollowsViewer)) {
          setFollowsViewer(targetFollowsViewer.isFollowing ?? false);
        }
      } catch (error) {
        console.error('Failed to check follow status:', error);
      } finally {
        setIsCheckingStatus(false);
      }
    }

    checkStatus();
  }, [user, targetUserId, initialIsFollowing, initialIsFollowedByTarget]);

  const handleToggleFollow = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      if (following) {
        await apiCall('DELETE', `/api/v1/users/${targetUserId}/follow`);
        setFollowing(false);
        onFollowChange?.(false);
        // Invalidate the cached following set so the home `friends` filter
        // reflects the change immediately on the next mount.
        invalidateCachedAction(`following:${user.uid}`);
        toast({ title: 'Unfollowed', description: `You unfollowed @${targetUsername}` });
      } else {
        await apiCall('POST', `/api/v1/users/${targetUserId}/follow`);
        setFollowing(true);
        onFollowChange?.(true);
        invalidateCachedAction(`following:${user.uid}`);
        toast({ title: 'Following', description: `You are now following @${targetUsername}` });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof ApiClientError ? err.message : 'Failed to update follow.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Don't show button if viewing own profile
  if (user?.uid === targetUserId) {
    return null;
  }

  if (isCheckingStatus) {
    return (
      <Button disabled className={retroButtonClass} size={size}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </Button>
    );
  }

  // Label priority: viewer-follows-target wins ("Following"). If we don't
  // already follow them but they follow us → "Follow back". Otherwise plain
  // "Follow". `followsViewer` defaults to `false` so the safe label is
  // always shown while the lazy fetch is in flight.
  const label = following ? 'Following' : followsViewer ? 'Follow back' : 'Follow';

  return (
    <Button
      onClick={handleToggleFollow}
      disabled={isLoading || !user}
      className={`${retroButtonClass} ${following ? 'bg-secondary text-foreground hover:bg-destructive hover:text-destructive-foreground' : ''}`}
      size={size}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : following ? (
        <>
          <UserMinus className="h-4 w-4 mr-2" />
          {label}
        </>
      ) : (
        <>
          <UserPlus className="h-4 w-4 mr-2" />
          {label}
        </>
      )}
    </Button>
  );
}
