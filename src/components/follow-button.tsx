'use client';

import { useState, useEffect } from 'react';
import { Loader2, UserPlus, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { followUser, unfollowUser, isFollowing } from '@/app/actions';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

const retroButtonClass = "border border-border rounded-lg shadow-lift transition-all duration-200";

type FollowButtonProps = {
  targetUserId: string;
  targetUsername: string;
  initialIsFollowing?: boolean;
  onFollowChange?: (isFollowing: boolean) => void;
  size?: 'default' | 'sm' | 'lg';
};

export function FollowButton({
  targetUserId,
  targetUsername,
  initialIsFollowing,
  onFollowChange,
  size = 'default',
}: FollowButtonProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [following, setFollowing] = useState(initialIsFollowing ?? false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(initialIsFollowing === undefined);

  // Check follow status if not provided
  useEffect(() => {
    async function checkStatus() {
      if (!user || initialIsFollowing !== undefined) return;

      setIsCheckingStatus(true);
      try {
        const result = await isFollowing(user.uid, targetUserId);
        if (!result.error) {
          setFollowing(result.isFollowing ?? false);
        }
      } catch (error) {
        console.error('Failed to check follow status:', error);
      } finally {
        setIsCheckingStatus(false);
      }
    }

    checkStatus();
  }, [user, targetUserId, initialIsFollowing]);

  const handleToggleFollow = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      if (following) {
        const result = await unfollowUser(await user.getIdToken(), targetUserId);
        if ('error' in result) {
          toast({ variant: 'destructive', title: 'Error', description: result.error });
        } else {
          setFollowing(false);
          onFollowChange?.(false);
          toast({ title: 'Unfollowed', description: `You unfollowed @${targetUsername}` });
        }
      } else {
        const result = await followUser(await user.getIdToken(), targetUserId);
        if ('error' in result) {
          toast({ variant: 'destructive', title: 'Error', description: result.error });
        } else {
          setFollowing(true);
          onFollowChange?.(true);
          toast({ title: 'Following', description: `You are now following @${targetUsername}` });
        }
      }
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
          Following
        </>
      ) : (
        <>
          <UserPlus className="h-4 w-4 mr-2" />
          Follow
        </>
      )}
    </Button>
  );
}
