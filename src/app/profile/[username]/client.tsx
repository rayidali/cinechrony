'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Share2 } from 'lucide-react';
import Image from 'next/image';
import { useUser, useFirestore } from '@/firebase';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { FollowButton } from '@/components/follow-button';
import { ListLikeButton } from '@/components/list-like-button';
import { ProfileOverflowMenu } from '@/components/profile-overflow-menu';
import { BottomNav } from '@/components/bottom-nav';
import { Hero } from '@/components/v3/hero';
import { GlassBtn } from '@/components/v3/glass-button';
import { Segmented } from '@/components/v3/segmented';
import { ListTile } from '@/components/v3/list-tile';
import { RecentRow } from '@/components/v3/recent-row';
import { PeopleSheet } from '@/components/v3/people-sheet';
import { MovieModalProvider } from '@/contexts/movie-modal-context';
import { useUserBlocksCache } from '@/contexts/user-blocks-cache';
import { useToast } from '@/hooks/use-toast';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { profileShareUrl } from '@/lib/share';
import { haptic } from '@/lib/haptics';
import type { ListSummary } from '@/lib/lists-server';
import type { UserProfile, MovieList, Activity } from '@/lib/types';

// Design: ios-screens.jsx ProfileIOS — films · lists · activity. No "shared"
// tab here (the old one never populated for other users — only the owner can
// list their collaborative lists). Shared lives on the viewer's own Lists tab.
type ProfileTab = 'films' | 'lists' | 'activity';

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

// Filled tonal action pill — iOS-native (secondarySystemFill), matches the
// design mock's filled pills.
const GHOST_PILL =
  'inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-full bg-secondary text-foreground font-headline font-semibold text-[15px] lowercase tracking-tight transition-transform active:scale-[0.97]';

export default function UserProfilePage() {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { isBlocked } = useUserBlocksCache();
  const router = useRouter();
  const params = useParams();
  const username = params.username as string;
  const { toast } = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [lists, setLists] = useState<MovieList[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [peopleTab, setPeopleTab] = useState<'followers' | 'following' | null>(null);
  const [listPreviews, setListPreviews] = useState<Record<string, { previewPosters: string[]; movieCount: number }>>({});
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [isLoadingActivities, setIsLoadingActivities] = useState(true);
  const [tab, setTab] = useState<ProfileTab>('films');

  const memberSince = useMemo(() => shortMonthYear(profile?.createdAt), [profile?.createdAt]);
  const favoriteMovies = profile?.favoriteMovies ?? [];
  const recentActivities = useMemo(() => (activities ?? []).slice(0, 4), [activities]);

  useEffect(() => {
    async function loadProfile() {
      setIsLoading(true);
      setError(null);
      try {
        const profileResult = await apiCall<{ user: UserProfile }>(
          'GET', `/api/v1/users/by-username/${encodeURIComponent(username)}`,
        ).catch((err) => {
          if (err instanceof ApiClientError && err.status === 404) return null;
          throw err;
        });
        if (!profileResult || !profileResult.user) {
          setError('User not found');
          setIsLoading(false);
          return;
        }
        setProfile(profileResult.user);

        if (user && profileResult.user.uid === user.uid) {
          router.replace('/profile');
          return;
        }

        const listsResult = await apiCall<{ lists: ListSummary[] }>(
          'GET', `/api/v1/users/${profileResult.user.uid}/public-lists`,
        );
        if (listsResult.lists) {
          setLists(listsResult.lists as unknown as MovieList[]);
        }
      } catch (err) {
        console.error('Failed to load profile:', err);
        setError('Failed to load profile');
      } finally {
        setIsLoading(false);
      }
    }

    // Gate on auth settling: running before `user` resolves can double-fire
    // and (worse) flash this page before the own-profile redirect fires.
    if (!isUserLoading && username) {
      loadProfile();
    }
  }, [username, user, isUserLoading, router]);

  // The viewed user's activity stream (world-readable). One-shot getDocs with
  // a local try/catch so a not-yet-built composite index degrades to an empty
  // section rather than firing the global error toast. See own-profile note.
  const loadActivities = useCallback(async () => {
    if (!profile?.uid) return;
    setIsLoadingActivities(true);
    try {
      const snap = await getDocs(
        query(
          collection(firestore, 'activities'),
          where('userId', '==', profile.uid),
          orderBy('createdAt', 'desc'),
          limit(30),
        ),
      );
      setActivities(snap.docs.map((d) => ({ ...(d.data() as Activity), id: d.id })));
    } catch (err) {
      setActivities([]);
      console.warn('Activity feed unavailable (Firestore index building?):', err);
    } finally {
      setIsLoadingActivities(false);
    }
  }, [firestore, profile?.uid]);

  useEffect(() => {
    loadActivities();
  }, [loadActivities]);

  useEffect(() => {
    async function fetchListPreviews() {
      if (!profile || lists.length === 0) return;
      try {
        // ONE batch call instead of N serial per-list preview reads.
        const { previews } = await apiCall<{
          previews: Record<string, { previewPosters: string[]; movieCount: number }>;
        }>('POST', `/api/v1/users/${profile.uid}/lists/previews`, {
          listIds: lists.map((l) => l.id),
        });
        setListPreviews(previews ?? {});
      } catch (error) {
        console.error('Failed to fetch list previews:', error);
      }
    }
    fetchListPreviews();
  }, [profile, lists]);

  const handleFollowChange = (isFollowing: boolean) => {
    if (profile) {
      setProfile({
        ...profile,
        followersCount: profile.followersCount + (isFollowing ? 1 : -1),
      });
    }
  };

  const handleShare = async () => {
    haptic('light');
    const url = profileShareUrl(username);
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: `@${username} on cinechrony`,
          text: `check out @${username} on cinechrony`,
          url,
        });
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
    { label: 'followers', value: profile.followersCount || 0, onClick: () => setPeopleTab('followers') },
    { label: 'following', value: profile.followingCount || 0, onClick: () => setPeopleTab('following') },
    { label: 'lists', value: lists.length, onClick: () => setTab('lists') },
  ];

  // Real "N films" chip — total films across the user's public lists.
  const filmsCount = lists.reduce((sum, l) => sum + (listPreviews[l.id]?.movieCount ?? 0), 0);

  const tabs: { id: ProfileTab; label: string }[] = [
    { id: 'films', label: 'films' },
    { id: 'lists', label: 'lists' },
    { id: 'activity', label: 'activity' },
  ];

  return (
    <MovieModalProvider returnPath={`/profile/${username}`}>
      <main className="min-h-screen text-foreground pb-24 md:pb-8">
        {/* Cinematic hero — the profile photo IS the hero; falls back to a
            seeded gradient (with name ghost) when they have no photo. */}
        <Hero
          coverImageUrl={profile.photoURL || undefined}
          seed={profile.displayName || profile.username || 'profile'}
          height={360}
          topLeft={<GlassBtn icon={ChevronLeft} ariaLabel="Back" onClick={() => router.back()} />}
          topRight={
            <ProfileOverflowMenu
              variant="glass"
              targetUserId={profile.uid}
              targetUsername={profile.username || 'user'}
            />
          }
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/75 [text-shadow:0_1px_6px_rgba(0,0,0,0.5)]">
            critic · @{profile.username}
            {memberSince ? ` · since ${memberSince}` : ''}
          </div>
          <h1 className="mt-1.5 truncate font-headline text-[34px] font-bold lowercase leading-[0.95] tracking-tight text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.4)]">
            {profile.displayName || profile.username}
          </h1>
          {profile.bio && (
            <p className="mt-1.5 line-clamp-2 font-serif text-[15px] italic leading-snug text-white/90 [text-shadow:0_1px_6px_rgba(0,0,0,0.5)]">
              {profile.bio}
            </p>
          )}
        </Hero>

        {/* Pull-up content sheet */}
        <div className="relative z-[1] -mt-5 min-h-[60vh] rounded-t-[22px] bg-background">
          <div className="mx-auto max-w-2xl px-4 pt-5">

            {/* Follow + share */}
            <div className="flex gap-2 mt-1">
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
                <Share2 className="h-4 w-4" strokeWidth={1.8} />
                share
              </button>
            </div>

            {/* Taste chip — real "N films" count across their public lists */}
            {filmsCount > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                <span className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3.5 font-mono text-[12px] tabular-nums text-foreground">
                  {filmsCount.toLocaleString()} films
                </span>
              </div>
            )}

            {/* Stats sandwich — between two hairlines */}
            <div className="h-px bg-border mt-4" />
            <div className="flex">
              {stats.map((s) => (
                <button key={s.label} onClick={s.onClick} className="flex-1 py-3 text-left">
                  <div className="font-headline font-bold text-[26px] tabular-nums leading-none">{s.value}</div>
                  <div className="cc-eyebrow mt-1">{s.label}</div>
                </button>
              ))}
            </div>
            <div className="h-px bg-border" />

            {/* Segmented tabs */}
            <div className="mt-4">
              <Segmented value={tab} onChange={(v) => setTab(v as ProfileTab)} options={tabs} />
            </div>

            {/* Tab content */}
            <div className="mt-5">
              {/* FILMS — the canon (top 5) + recent activity */}
              {tab === 'films' && (
                <div className="space-y-8">
                  <section>
                    <div className="cc-eyebrow">the canon</div>
                    <h2 className="mt-1 font-headline text-[22px] font-bold lowercase tracking-tight text-foreground">
                      top 5 films
                    </h2>
                    {favoriteMovies.length > 0 ? (
                      <div className="mt-3 grid grid-cols-5 gap-2">
                        {favoriteMovies.map((movie) => (
                          <div key={movie.tmdbId} className="relative">
                            <Image
                              src={movie.posterUrl}
                              alt={movie.title}
                              width={120}
                              height={180}
                              className="w-full h-auto rounded-[12px] border border-border shadow-lift"
                              title={movie.title}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 cc-lead text-[15px] text-muted-foreground">
                        no desert-island films picked yet.
                      </p>
                    )}
                  </section>

                  <section>
                    <div className="cc-eyebrow">lately</div>
                    <h2 className="mt-1 font-headline text-[22px] font-bold lowercase tracking-tight text-foreground">
                      recent
                    </h2>
                    {recentActivities.length > 0 ? (
                      <div className="mt-3 overflow-hidden rounded-[22px] border border-hair bg-card">
                        {recentActivities.map((a, i) => (
                          <RecentRow key={a.id} activity={a} last={i === recentActivities.length - 1} />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 cc-lead text-[15px] text-muted-foreground">
                        nothing here yet.
                      </p>
                    )}
                  </section>
                </div>
              )}

              {/* LISTS — public lists, likeable by non-members */}
              {tab === 'lists' && (
                lists.length > 0 ? (
                  <div className="grid grid-cols-2 gap-x-5 gap-y-7">
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
                        <ListTile
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

              {/* ACTIVITY — the viewed user's action feed */}
              {tab === 'activity' && (
                isLoadingActivities ? (
                  <div className="overflow-hidden rounded-[22px] border border-hair bg-card">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-[100px] animate-pulse border-b border-rule last:border-0 bg-secondary/40" />
                    ))}
                  </div>
                ) : activities && activities.length > 0 ? (
                  <div className="overflow-hidden rounded-[22px] border border-hair bg-card">
                    {activities.map((a, i) => (
                      <RecentRow key={a.id} activity={a} last={i === activities.length - 1} />
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center">
                    <p className="cc-lead text-[15px] text-muted-foreground">no activity yet.</p>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </main>

      {/* People sheet — this user's followers / following + follow-back */}
      <PeopleSheet
        isOpen={peopleTab !== null}
        onClose={() => setPeopleTab(null)}
        subjectUid={profile.uid}
        subjectUsername={profile.username}
        followersCount={profile.followersCount || 0}
        followingCount={profile.followingCount || 0}
        initialTab={peopleTab ?? 'followers'}
      />

      <BottomNav />
    </MovieModalProvider>
  );
}
