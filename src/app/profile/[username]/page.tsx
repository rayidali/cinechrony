'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Film, ArrowLeft, Loader2, List, Lock, X, Users } from 'lucide-react';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FollowButton } from '@/components/follow-button';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useToast } from '@/hooks/use-toast';
import {
  getUserByUsername,
  getUserPublicLists,
  getCollaborativeLists,
  getFollowers,
  getFollowing,
} from '@/app/actions';
import type { UserProfile, MovieList } from '@/lib/types';

// Type for collaborative list with owner info
interface CollaborativeList extends MovieList {
  ownerId: string;
  ownerName?: string;
  ownerUsername?: string;
}


export default function UserProfilePage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const params = useParams();
  const username = params.username as string;
  const { toast } = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [lists, setLists] = useState<MovieList[]>([]);
  const [sharedLists, setSharedLists] = useState<CollaborativeList[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followers, setFollowers] = useState<UserProfile[]>([]);
  const [following, setFollowing] = useState<UserProfile[]>([]);
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      setIsLoading(true);
      setError(null);

      try {
        // Get user profile
        const profileResult = await getUserByUsername(username);
        if (profileResult.error || !profileResult.user) {
          setError('User not found');
          setIsLoading(false);
          return;
        }

        setProfile(profileResult.user);

        // Redirect to own profile page if viewing self
        if (user && profileResult.user.uid === user.uid) {
          router.replace('/profile');
          return;
        }

        // Get public lists owned by this user
        const listsResult = await getUserPublicLists(profileResult.user.uid);
        if (listsResult.lists) {
          setLists(listsResult.lists as MovieList[]);
        }

        // Get collaborative lists this user is part of (filter for public ones)
        try {
          const collabResult = await getCollaborativeLists(profileResult.user.uid);
          if (collabResult.lists) {
            // Filter to only show public collaborative lists
            const publicSharedLists = (collabResult.lists as CollaborativeList[]).filter(
              list => list.isPublic
            );
            setSharedLists(publicSharedLists);
          }
        } catch (collabErr) {
          console.error('Failed to load collaborative lists:', collabErr);
          // Don't fail the whole page if collaborative lists fail to load
        }
      } catch (err) {
        console.error('Failed to load profile:', err);
        setError('Failed to load profile');
      } finally {
        setIsLoading(false);
      }
    }

    if (username) {
      loadProfile();
    }
  }, [username, user, router]);

  const handleLoadFollowers = async () => {
    if (!profile) return;
    try {
      const result = await getFollowers(profile.uid);
      setFollowers(result.users || []);
      setShowFollowers(true);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } catch (error) {
      console.error('Failed to load followers:', error);
      setFollowers([]);
      setShowFollowers(true);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load followers' });
    }
  };

  const handleLoadFollowing = async () => {
    if (!profile) return;
    try {
      const result = await getFollowing(profile.uid);
      setFollowing(result.users || []);
      setShowFollowing(true);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } catch (error) {
      console.error('Failed to load following:', error);
      setFollowing([]);
      setShowFollowing(true);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load following' });
    }
  };

  const handleFollowChange = (isFollowing: boolean) => {
    if (profile) {
      setProfile({
        ...profile,
        followersCount: profile.followersCount + (isFollowing ? 1 : -1),
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <main className="min-h-screen bg-background font-body text-foreground">
        <div className="container mx-auto p-4 md:p-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4 border-[3px] border-black">
              <span className="text-2xl font-bold text-muted-foreground">?</span>
            </div>
            <h1 className="text-2xl font-headline font-bold mb-2">User Not Found</h1>
            <p className="text-muted-foreground mb-4">The user @{username} doesn&apos;t exist.</p>
            <Link href="/lists">
              <Button>Go Back</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background font-body text-foreground">
      <div className="container mx-auto p-4 md:p-8">
        <header className="mb-8">
          <div className="w-full flex justify-between items-center mb-6">
            <Button variant="ghost" className="gap-2" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>

          {/* Profile Header */}
          <div className="flex flex-col items-center">
            {/* Profile Picture */}
            <ProfileAvatar
              photoURL={profile.photoURL}
              displayName={profile.displayName}
              username={profile.username}
              size="xl"
              className="mb-4"
            />

            <h1 className="text-2xl md:text-3xl font-headline font-bold text-center">
              {profile.displayName || profile.username}
            </h1>

            <p className="text-muted-foreground mt-1">@{profile.username}</p>

            {/* Follower/Following Stats */}
            <div className="flex gap-6 mt-4">
              <button
                onClick={handleLoadFollowers}
                className="text-center hover:opacity-70 transition-opacity"
              >
                <span className="font-bold text-lg">{profile.followersCount || 0}</span>
                <span className="text-muted-foreground ml-1">followers</span>
              </button>
              <button
                onClick={handleLoadFollowing}
                className="text-center hover:opacity-70 transition-opacity"
              >
                <span className="font-bold text-lg">{profile.followingCount || 0}</span>
                <span className="text-muted-foreground ml-1">following</span>
              </button>
            </div>

            {/* Follow Button */}
            {!isUserLoading && user && (
              <div className="mt-4">
                <FollowButton
                  targetUserId={profile.uid}
                  targetUsername={profile.username || ''}
                  onFollowChange={handleFollowChange}
                />
              </div>
            )}

            {!user && !isUserLoading && (
              <Link href="/login" className="mt-4">
                <Button>Sign in to follow</Button>
              </Link>
            )}
          </div>
        </header>

        {/* Public Lists */}
        <section>
          <h2 className="text-xl font-headline font-bold mb-4">
            {profile.displayName || profile.username}&apos;s Lists
          </h2>
          {lists.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {lists.map((list) => (
                <Link
                  key={list.id}
                  href={`/profile/${username}/lists/${list.id}`}
                >
                  <Card className="border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] md:hover:shadow-[2px_2px_0px_0px_#000] md:hover:translate-x-0.5 md:hover:translate-y-0.5 transition-all duration-200 cursor-pointer">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <List className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">{list.name}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>Click to view movies</CardDescription>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card className="border-[3px] border-dashed border-black rounded-lg bg-secondary">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Lock className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="font-headline text-xl font-bold mb-2">No public lists</h3>
                <p className="text-muted-foreground">
                  This user hasn&apos;t shared any lists yet.
                </p>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Shared/Collaborative Lists */}
        {sharedLists.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xl font-headline font-bold mb-4 flex items-center gap-2">
              <Users className="h-5 w-5" />
              Shared Lists
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sharedLists.map((list) => (
                <Link
                  key={list.id}
                  href={`/profile/${list.ownerUsername}/lists/${list.id}`}
                >
                  <Card className="border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] md:hover:shadow-[2px_2px_0px_0px_#000] md:hover:translate-x-0.5 md:hover:translate-y-0.5 transition-all duration-200 cursor-pointer">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">{list.name}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>
                        Shared by {list.ownerName || list.ownerUsername}
                      </CardDescription>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Followers Modal */}
        {showFollowers && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Followers</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowFollowers(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="max-h-96 overflow-y-auto">
                {followers.length > 0 ? (
                  <ul className="divide-y divide-border">
                    {followers.map((follower) => (
                      <li key={follower.uid}>
                        <Link
                          href={`/profile/${follower.username}`}
                          onClick={() => setShowFollowers(false)}
                          className="flex items-center gap-3 py-3 hover:opacity-70 transition-opacity"
                        >
                          <ProfileAvatar
                            photoURL={follower.photoURL}
                            displayName={follower.displayName}
                            username={follower.username}
                            size="md"
                          />
                          <div>
                            <p className="font-medium">{follower.displayName || follower.username}</p>
                            <p className="text-sm text-muted-foreground">@{follower.username}</p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-center text-muted-foreground py-4">No followers yet</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Following Modal */}
        {showFollowing && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Following</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowFollowing(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="max-h-96 overflow-y-auto">
                {following.length > 0 ? (
                  <ul className="divide-y divide-border">
                    {following.map((followedUser) => (
                      <li key={followedUser.uid}>
                        <Link
                          href={`/profile/${followedUser.username}`}
                          onClick={() => setShowFollowing(false)}
                          className="flex items-center gap-3 py-3 hover:opacity-70 transition-opacity"
                        >
                          <ProfileAvatar
                            photoURL={followedUser.photoURL}
                            displayName={followedUser.displayName}
                            username={followedUser.username}
                            size="md"
                          />
                          <div>
                            <p className="font-medium">{followedUser.displayName || followedUser.username}</p>
                            <p className="text-sm text-muted-foreground">@{followedUser.username}</p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-center text-muted-foreground py-4">Not following anyone yet</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
