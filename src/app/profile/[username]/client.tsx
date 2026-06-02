'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, X, Share2 } from 'lucide-react';
import Image from 'next/image';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FollowButton } from '@/components/follow-button';
import { ProfileAvatar } from '@/components/profile-avatar';
import { ProfileListCard } from '@/components/profile-list-card';
import { ListLikeButton } from '@/components/list-like-button';
import { ProfileOverflowMenu } from '@/components/profile-overflow-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { BottomNav } from '@/components/bottom-nav';
import { useUserBlocksCache } from '@/contexts/user-blocks-cache';
import { useToast } from '@/hooks/use-toast';
import {
  getUserByUsername,
  getUserPublicLists,
  getCollaborativeLists,
  getListPreview,
} from '@/app/actions';
import { apiCall } from '@/lib/api-client';
import type { UserProfile, MovieList } from '@/lib/types';

interface CollaborativeList extends MovieList {
  ownerId: string;
  ownerName?: string;
  ownerUsername?: string;
}

type ProfileTab = 'lists' | 'shared' | 'top5';

/** Format a Firestore date-ish value as a tabular MM.YY. */
function shortMonthYear(value: unknown): string | null {
  if (!value) return null;
  try {
    const v = value as { toDate?: () => Date };
    const d = typeof v?.toDate === 'function' ? v.toDate() : value instanceof Date ? value : new Date(value as string);
    if (isNaN(d.getTime())) return null;
    return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
  } catch {
    return null;
  }
}

const GHOST_PILL =
  'inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-foreground font-headline font-semibold text-[13px] lowercase tracking-tight transition-transform active:scale-[0.98]';

export default function UserProfilePage() {
  const { user, isUserLoading } = useUser();
  const { isBlocked } = useUserBlocksCache();
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
  const [listPreviews, setListPreviews] = useState<Record<string, { previewPosters: string[]; movieCount: number }>>({});
  const [sharedListPreviews, setSharedListPreviews] = useState<Record<string, { previewPosters: string[]; movieCount: number }>>({});
  const [tab, setTab] = useState<ProfileTab>('lists');

  const memberSince = useMemo(() => shortMonthYear(profile?.createdAt), [profile?.createdAt]);
  const favoriteMovies = profile?.favoriteMovies ?? [];

  useEffect(() => {
    async function loadProfile() {
      setIsLoading(true);
      setError(null);
      try {
        const profileResult = await getUserByUsername(username);
        if (profileResult.error || !profileResult.user) {
          setError('User not found');
          setIsLoading(false);
          return;
        }
        setProfile(profileResult.user);

        if (user && profileResult.user.uid === user.uid) {
          router.replace('/profile');
          return;
        }

        const listsResult = await getUserPublicLists(profileResult.user.uid);
        if (listsResult.lists) {
          setLists(listsResult.lists as MovieList[]);
        }

        try {
          const collabResult = await getCollaborativeLists(profileResult.user.uid);
          if (collabResult.lists) {
            const publicSharedLists = (collabResult.lists as CollaborativeList[]).filter(
              (list) => list.isPublic
            );
            setSharedLists(publicSharedLists);
          }
        } catch (collabErr) {
          console.error('Failed to load collaborative lists:', collabErr);
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

  useEffect(() => {
    async function fetchListPreviews() {
      if (!profile || lists.length === 0) return;
      try {
        const previews: Record<string, { previewPosters: string[]; movieCount: number }> = {};
        await Promise.all(
          lists.map(async (list) => {
            const result = await getListPreview(profile.uid, list.id);
            previews[list.id] = {
              previewPosters: result.previewPosters || [],
              movieCount: result.movieCount || 0,
            };
          })
        );
        setListPreviews(previews);
      } catch (error) {
        console.error('Failed to fetch list previews:', error);
      }
    }
    fetchListPreviews();
  }, [profile, lists]);

  useEffect(() => {
    async function fetchSharedPreviews() {
      if (sharedLists.length === 0) return;
      try {
        const previews: Record<string, { previewPosters: string[]; movieCount: number }> = {};
        await Promise.all(
          sharedLists.map(async (list) => {
            const result = await getListPreview(list.ownerId, list.id);
            previews[list.id] = {
              previewPosters: result.previewPosters || [],
              movieCount: result.movieCount || 0,
            };
          })
        );
        setSharedListPreviews(previews);
      } catch (error) {
        console.error('Failed to fetch shared list previews:', error);
      }
    }
    fetchSharedPreviews();
  }, [sharedLists]);

  const handleLoadFollowers = async () => {
    if (!profile) return;
    try {
      const result = await apiCall<{ users: UserProfile[] }>(
        'GET',
        `/api/v1/users/${profile.uid}/followers`,
      );
      setFollowers(result.users || []);
      setShowFollowers(true);
    } catch {
      setFollowers([]);
      setShowFollowers(true);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load followers' });
    }
  };

  const handleLoadFollowing = async () => {
    if (!profile) return;
    try {
      const result = await apiCall<{ users: UserProfile[] }>(
        'GET',
        `/api/v1/users/${profile.uid}/following`,
      );
      setFollowing(result.users || []);
      setShowFollowing(true);
    } catch {
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

  const handleShare = async () => {
    const url = `${window.location.origin}/profile/${username}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: `@${username} on cinechrony`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: 'link copied' });
      }
    } catch {
      /* dismissed */
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <main className="min-h-screen text-foreground">
        <div className="container mx-auto px-4 md:px-8 max-w-2xl">
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            <div className="cc-eyebrow">not found</div>
            <h1 className="font-headline font-bold text-3xl lowercase tracking-tight mt-3">
              that scene&apos;s missing
            </h1>
            <p className="cc-lead text-[15px] text-muted-foreground mt-2">
              @{username} doesn&apos;t exist. let&apos;s go back.
            </p>
            <Link href="/lists" className="mt-5">
              <Button>back to lists</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // LAUNCH 0.5.5: a blocked relationship (either direction) makes the profile
  // unavailable — no content, no interaction.
  if (profile && isBlocked(profile.uid)) {
    return (
      <main className="min-h-screen text-foreground">
        <div className="container mx-auto px-4 md:px-8 max-w-2xl">
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            <div className="cc-eyebrow">unavailable</div>
            <h1 className="font-headline font-bold text-3xl lowercase tracking-tight mt-3">
              this account is unavailable
            </h1>
            <p className="cc-lead text-[15px] text-muted-foreground mt-2">
              you can&apos;t view this profile.
            </p>
            <Link href="/home" className="mt-5">
              <Button>back home</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const stats: { label: string; value: number; onClick: () => void }[] = [
    { label: 'followers', value: profile.followersCount || 0, onClick: handleLoadFollowers },
    { label: 'following', value: profile.followingCount || 0, onClick: handleLoadFollowing },
    { label: 'lists', value: lists.length, onClick: () => setTab('lists') },
  ];

  const tabs: { id: ProfileTab; label: string }[] = [
    { id: 'lists', label: 'lists' },
    { id: 'shared', label: 'shared' },
    { id: 'top5', label: 'top 5' },
  ];

  return (
    <main className="min-h-screen text-foreground pb-24 md:pb-8 md:pt-20">
      <div className="container mx-auto px-4 md:px-8 max-w-2xl">

        {/* Topbar */}
        <div className="flex justify-between items-center pt-1 pb-5">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1 cc-meta text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
            back
          </button>
          <div className="flex items-center gap-1">
            <ProfileOverflowMenu
              targetUserId={profile.uid}
              targetUsername={profile.username || 'user'}
            />
            <ThemeToggle />
          </div>
        </div>

        {/* Editorial header */}
        <div className="cc-eyebrow">
          critic{memberSince ? ` · member since ${memberSince}` : ''}
        </div>
        <div className="h-px bg-border my-3" />

        <div className="flex items-end gap-4">
          <ProfileAvatar
            photoURL={profile.photoURL}
            displayName={profile.displayName}
            username={profile.username}
            size="xl"
            className="flex-shrink-0 shadow-photo"
          />
          <div className="min-w-0 pb-1">
            <h1 className="font-headline font-bold text-3xl lowercase tracking-tight leading-none truncate">
              {profile.displayName || profile.username}
            </h1>
            <p className="cc-meta text-xs text-muted-foreground mt-1.5">@{profile.username}</p>
          </div>
        </div>

        {/* Bio */}
        {profile.bio && (
          <p className="cc-lead text-[15px] text-foreground mt-4">{profile.bio}</p>
        )}

        {/* Follow + share */}
        <div className="flex gap-2 mt-4">
          {!isUserLoading && user ? (
            <FollowButton
              targetUserId={profile.uid}
              targetUsername={profile.username || ''}
              onFollowChange={handleFollowChange}
            />
          ) : !isUserLoading ? (
            <Link href="/login" className={GHOST_PILL}>
              sign in to follow
            </Link>
          ) : null}
          <button onClick={handleShare} className={GHOST_PILL}>
            <Share2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            share
          </button>
        </div>

        {/* Stats sandwich */}
        <div className="h-px bg-border mt-6" />
        <div className="flex">
          {stats.map((s) => (
            <button key={s.label} onClick={s.onClick} className="flex-1 py-4 text-left">
              <div className="font-headline font-bold text-2xl tabular-nums leading-none">{s.value}</div>
              <div className="cc-eyebrow mt-1.5">{s.label}</div>
            </button>
          ))}
        </div>
        <div className="h-px bg-border" />

        {/* Tabs */}
        <div className="flex gap-6 mt-5 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`font-headline font-semibold text-sm lowercase tracking-tight pb-2.5 -mb-px border-b-2 transition-colors ${
                tab === t.id
                  ? 'text-foreground border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="mt-6">
          {tab === 'lists' && (
            lists.length > 0 ? (
              <div className="grid grid-cols-2 gap-4">
                {lists.map((list) => {
                  const preview = listPreviews[list.id];
                  // A like is an outside endorsement — hide the heart from the
                  // list's own members (owner + collaborators) and signed-out users.
                  const isMember =
                    !!user &&
                    (user.uid === profile.uid ||
                      (Array.isArray(list.collaboratorIds) &&
                        list.collaboratorIds.includes(user.uid)));
                  const canLike = !!user && !isMember;
                  return (
                    <ProfileListCard
                      key={list.id}
                      name={list.name}
                      isPublic
                      movieCount={preview?.movieCount ?? 0}
                      coverImageUrl={list.coverImageUrl}
                      coverMode={list.coverMode}
                      previewPosters={preview?.previewPosters ?? []}
                      onClick={() => router.push(`/profile/${username}/lists/${list.id}`)}
                      likeButton={
                        canLike ? (
                          <ListLikeButton
                            variant="cover"
                            listOwnerId={list.ownerId || profile.uid}
                            listId={list.id}
                            collaboratorIds={list.collaboratorIds}
                            initialLikes={list.likes ?? 0}
                            initialLikedBy={list.likedBy ?? []}
                          />
                        ) : undefined
                      }
                    />
                  );
                })}
              </div>
            ) : (
              <div className="py-12 text-center">
                <p className="cc-lead text-[15px] text-muted-foreground">
                  no public lists yet.
                </p>
              </div>
            )
          )}

          {tab === 'shared' && (
            sharedLists.length > 0 ? (
              <div className="grid grid-cols-2 gap-4">
                {sharedLists.map((list) => {
                  const preview = sharedListPreviews[list.id];
                  return (
                    <ProfileListCard
                      key={list.id}
                      name={list.name}
                      isCollaborative
                      ownerName={list.ownerUsername || list.ownerName || undefined}
                      movieCount={preview?.movieCount ?? 0}
                      previewPosters={preview?.previewPosters ?? []}
                      onClick={() => router.push(`/profile/${list.ownerUsername}/lists/${list.id}`)}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="py-12 text-center">
                <p className="cc-lead text-[15px] text-muted-foreground">no shared lists yet.</p>
              </div>
            )
          )}

          {tab === 'top5' && (
            favoriteMovies.length > 0 ? (
              <div className="grid grid-cols-5 gap-2.5">
                {favoriteMovies.map((movie) => (
                  <div key={movie.tmdbId} className="relative">
                    <Image
                      src={movie.posterUrl}
                      alt={movie.title}
                      width={120}
                      height={180}
                      className="w-full h-auto rounded-[10px] border border-border shadow-lift"
                      title={movie.title}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center">
                <p className="cc-lead text-[15px] text-muted-foreground">
                  no desert-island films picked yet.
                </p>
              </div>
            )
          )}
        </div>
      </div>

      {/* Followers Modal */}
      {showFollowers && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-photo">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>followers</CardTitle>
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
                          <p className="font-headline font-semibold text-sm">{follower.displayName || follower.username}</p>
                          <p className="cc-meta text-[11px] text-muted-foreground">@{follower.username}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-center font-serif italic text-muted-foreground py-4">no followers yet</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Following Modal */}
      {showFollowing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-photo">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>following</CardTitle>
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
                          <p className="font-headline font-semibold text-sm">{followedUser.displayName || followedUser.username}</p>
                          <p className="cc-meta text-[11px] text-muted-foreground">@{followedUser.username}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-center font-serif italic text-muted-foreground py-4">not following anyone yet</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
