'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Pencil, MoreVertical, LogOut,
  Eye, EyeOff, ImageIcon, Settings, Share2,
} from 'lucide-react';
import { PullToRefresh } from '@/components/pull-to-refresh';
import Image from 'next/image';
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc, useAuth } from '@/firebase';
import { collection, orderBy, query, doc, where, limit, getDocs } from 'firebase/firestore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ListTile } from '@/components/v3/list-tile';
import { RecentRow } from '@/components/v3/recent-row';
import { useActivitiesVersion } from '@/lib/activity-events';
import { rememberListSeed } from '@/lib/list-detail-seed';
import { CoverPicker } from '@/components/cover-picker';
import { useToast } from '@/hooks/use-toast';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { profileShareUrl } from '@/lib/share';
import { haptic } from '@/lib/haptics';
import { TopFivePicker } from '@/components/v3/top-five-picker';
import { Hero } from '@/components/v3/hero';
import { GlassBtn } from '@/components/v3/glass-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { Segmented } from '@/components/v3/segmented';
import { EditProfileSheet } from '@/components/v3/edit-profile-sheet';
import { PeopleSheet } from '@/components/v3/people-sheet';
import { BottomNav } from '@/components/bottom-nav';
import { MovieModalProvider } from '@/contexts/movie-modal-context';
import type { UserProfile, MovieList, FavoriteMovie, Activity } from '@/lib/types';

// Design: ios-screens.jsx ProfileIOS — segmented is films · lists · activity.
// Shared lists + invites live on the Lists tab, not here.
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
// design mock's filled pills. Replaces the old heavy full-outline pill.
const GHOST_PILL =
  'inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-full bg-secondary text-foreground font-headline font-semibold text-[15px] lowercase tracking-tight transition-transform active:scale-[0.97]';

export default function MyProfilePage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  // AUDIT.md 2.3 (Option A): usernames are permanent — no edit state needed.
  const [peopleTab, setPeopleTab] = useState<'followers' | 'following' | null>(null);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isFavoritePickerOpen, setIsFavoritePickerOpen] = useState(false);
  const [favoriteMovies, setFavoriteMovies] = useState<FavoriteMovie[]>([]);
  const [listPreviews, setListPreviews] = useState<Record<string, { previewPosters: string[]; movieCount: number }>>({});
  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);
  const [selectedList, setSelectedList] = useState<MovieList | null>(null);
  const [tab, setTab] = useState<ProfileTab>('films');

  // Get user profile from Firestore
  const userDocRef = useMemoFirebase(() => {
    if (!user) return null;
    return doc(firestore, 'users', user.uid);
  }, [firestore, user]);

  const { data: userProfile } = useDoc<UserProfile>(userDocRef);

  // Get user's lists
  const listsQuery = useMemoFirebase(() => {
    if (!user) return null;
    return query(
      collection(firestore, 'users', user.uid, 'lists'),
      orderBy('updatedAt', 'desc')
    );
  }, [firestore, user]);

  const { data: lists, isLoading: isLoadingLists } = useCollection<MovieList>(listsQuery);

  // The owner's own activity stream — powers the films-tab "recent" section
  // and the "activity" tab. Deliberately a one-shot getDocs (NOT a real-time
  // useCollection): useCollection relabels every read error as a global
  // "permission-error" toast, so a not-yet-deployed composite index would pop
  // the scary "Action blocked" banner. Here we own the try/catch and degrade
  // to an empty section instead. Needs the (userId ASC, createdAt DESC) index
  // in firestore.indexes.json — `firebase deploy --only firestore:indexes`.
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [isLoadingActivities, setIsLoadingActivities] = useState(true);

  const loadActivities = useCallback(async () => {
    if (!user) return;
    try {
      const snap = await getDocs(
        query(
          collection(firestore, 'activities'),
          where('userId', '==', user.uid),
          orderBy('createdAt', 'desc'),
          limit(30),
        ),
      );
      setActivities(snap.docs.map((d) => ({ ...(d.data() as Activity), id: d.id })));
    } catch (error) {
      // Most likely the composite index isn't live yet — show empty, no toast.
      setActivities([]);
      console.warn('Activity feed unavailable (Firestore index building?):', error);
    } finally {
      setIsLoadingActivities(false);
    }
  }, [firestore, user]);

  // Re-fetch "recent" when the activity feed changes (e.g. a rating cleared or a
  // watch removed from a drawer opened over this page) so it never lingers stale.
  const activitiesVersion = useActivitiesVersion();
  useEffect(() => {
    loadActivities();
  }, [loadActivities, activitiesVersion]);

  const recentActivities = useMemo(() => (activities ?? []).slice(0, 4), [activities]);

  const memberSince = useMemo(() => shortMonthYear(userProfile?.createdAt), [userProfile?.createdAt]);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  useEffect(() => {
    if (userProfile?.favoriteMovies) {
      setFavoriteMovies(userProfile.favoriteMovies);
    }
  }, [userProfile?.favoriteMovies]);

  // Fetch list previews when lists change
  useEffect(() => {
    async function fetchPreviews() {
      if (!user || !lists || lists.length === 0) return;
      try {
        const listIds = lists.map((list) => list.id);
        const result = await apiCall<{ previews: Record<string, { previewPosters: string[]; movieCount: number }> }>(
          'POST', `/api/v1/users/${user.uid}/lists/previews`,
          { listIds },
        );
        if (result.previews) {
          setListPreviews(result.previews);
        }
      } catch (error) {
        console.error('Failed to fetch list previews:', error);
      }
    }
    fetchPreviews();
  }, [user, lists]);

  const handleToggleVisibility = async (listId: string, currentIsPublic: boolean) => {
    if (!user) return;
    const nextIsPublic = !currentIsPublic;
    try {
      await apiCall(
        'PATCH',
        `/api/v1/lists/${user.uid}/${listId}`,
        { isPublic: nextIsPublic },
      );
      toast({ title: nextIsPublic ? 'list is now public' : 'list is now private' });
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Failed to update visibility.';
      toast({ variant: 'destructive', title: 'Error', description: message });
    }
  };

  const handleShare = async () => {
    const username = userProfile?.username;
    if (!username) return;
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
      /* user dismissed the share sheet — ignore */
    }
  };

  // Pull-to-refresh handler — lists + activities are real-time subscriptions,
  // so this only needs to refresh the API-fetched list previews.
  const handleRefresh = useCallback(async () => {
    if (!user) return;
    loadActivities();
    if (lists && lists.length > 0) {
      const listIds = lists.map((list) => list.id);
      const previewsResult = await apiCall<{ previews: Record<string, { previewPosters: string[]; movieCount: number }> }>(
        'POST', `/api/v1/users/${user.uid}/lists/previews`,
        { listIds },
      );
      if (previewsResult.previews) {
        setListPreviews(previewsResult.previews);
      }
    }
  }, [user, lists, loadActivities]);

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  const followersCount = userProfile?.followersCount || 0;
  const followingCount = userProfile?.followingCount || 0;
  const listsCount = lists?.length || 0;
  // Real "N films" chip — total films across the user's lists.
  const filmsCount = (lists ?? []).reduce(
    (sum, l) => sum + (listPreviews[l.id]?.movieCount ?? l.movieCount ?? 0),
    0,
  );

  const stats: { label: string; value: number; onClick: () => void }[] = [
    { label: 'followers', value: followersCount, onClick: () => setPeopleTab('followers') },
    { label: 'following', value: followingCount, onClick: () => setPeopleTab('following') },
    { label: 'lists', value: listsCount, onClick: () => setTab('lists') },
  ];

  const tabs: { id: ProfileTab; label: string }[] = [
    { id: 'films', label: 'films' },
    { id: 'lists', label: 'lists' },
    { id: 'activity', label: 'activity' },
  ];

  return (
    <MovieModalProvider returnPath="/profile">
      <PullToRefresh
        onRefresh={handleRefresh}
        disabled={peopleTab !== null || isEditProfileOpen || isFavoritePickerOpen || isCoverPickerOpen}
      >
        <main className="min-h-screen text-foreground pb-24 md:pb-8">
          {/* Cinematic hero — the profile photo IS the hero (design v2). When
              none is set, a tappable "add a profile photo" placeholder shows
              over a seeded gradient. */}
          <Hero
            coverImageUrl={userProfile?.photoURL || undefined}
            seed={userProfile?.displayName || userProfile?.username || 'profile'}
            height={360}
            topRight={
              <>
                <ThemeToggle variant="glass" />
                <GlassBtn icon={Settings} ariaLabel="Settings" onClick={() => router.push('/settings')} />
                <GlassBtn icon={LogOut} ariaLabel="Sign out" onClick={() => auth.signOut()} />
              </>
            }
            placeholder={
              userProfile && !userProfile.photoURL ? (
                <button
                  onClick={() => setIsEditProfileOpen(true)}
                  className="flex flex-col items-center gap-2 text-white/70 transition-transform active:scale-95"
                >
                  <ImageIcon className="h-9 w-9" strokeWidth={1.3} />
                  <span className="font-mono text-[11px] lowercase tracking-wide">add a profile photo</span>
                </button>
              ) : undefined
            }
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/75 [text-shadow:0_1px_6px_rgba(0,0,0,0.5)]">
              critic · @{userProfile?.username || '…'}
              {memberSince ? ` · since ${memberSince}` : ''}
            </div>
            <h1 className="mt-1.5 truncate font-headline text-[34px] font-bold lowercase leading-[0.95] tracking-tight text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.4)]">
              {userProfile?.displayName || user.displayName || 'user'}
            </h1>
            {userProfile?.bio && (
              <p className="mt-1.5 line-clamp-2 max-w-full font-serif text-[15px] italic leading-snug text-white/90 [text-shadow:0_1px_6px_rgba(0,0,0,0.5)]">
                {userProfile.bio}
              </p>
            )}
          </Hero>

          {/* Pull-up content sheet */}
          <div className="relative z-[1] -mt-5 min-h-[60vh] rounded-t-[22px] bg-background">
            <div className="mx-auto max-w-2xl px-4 pt-5">

            {/* Primary actions — edit profile + share (design v2) */}
            <div className="flex gap-2.5 mt-3">
              <button onClick={() => setIsEditProfileOpen(true)} className={`${GHOST_PILL} flex-1`}>
                <Pencil className="h-4 w-4" strokeWidth={1.8} />
                edit profile
              </button>
              <button onClick={handleShare} className={`${GHOST_PILL} flex-1`}>
                <Share2 className="h-4 w-4" strokeWidth={1.8} />
                share
              </button>
            </div>

            {/* Taste chips — real "N films" count (vibe tags TBD: needs a taste-tags feature) */}
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
                  {/* Top 5 — the canon */}
                  <section>
                    <div className="cc-eyebrow">the canon</div>
                    <h2 className="mt-1 font-headline text-[22px] font-bold lowercase tracking-tight text-foreground">
                      top 5 films
                    </h2>
                    <div className="mt-3 grid grid-cols-5 gap-2">
                      {[0, 1, 2, 3, 4].map((index) => {
                        const movie = favoriteMovies[index];
                        if (movie) {
                          return (
                            <button
                              key={movie.tmdbId}
                              className="relative group"
                              onClick={() => setIsFavoritePickerOpen(true)}
                            >
                              <Image
                                src={movie.posterUrl}
                                alt={movie.title}
                                width={120}
                                height={180}
                                className="w-full h-auto rounded-[12px] border border-border shadow-lift transition-all duration-200 group-hover:shadow-photo group-hover:-translate-y-0.5"
                                title={movie.title}
                              />
                              <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity rounded-[12px] flex items-center justify-center">
                                <Pencil className="h-4 w-4 text-white" />
                              </div>
                            </button>
                          );
                        }
                        return (
                          <button
                            key={index}
                            onClick={() => setIsFavoritePickerOpen(true)}
                            className="aspect-[2/3] rounded-[12px] border border-dashed border-border bg-background flex items-center justify-center hover:border-foreground/40 transition-colors text-muted-foreground"
                          >
                            <span className="text-[28px] font-light leading-none">+</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="cc-meta text-[11px] text-muted-foreground mt-3">
                      {favoriteMovies.length === 0
                        ? 'pick your 5 desert-island films.'
                        : 'tap a poster to edit your canon.'}
                    </p>
                  </section>

                  {/* Recent — owner's latest watched / rated / added */}
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
                        nothing yet — rate or add a film and it shows up here.
                      </p>
                    )}
                  </section>
                </div>
              )}

              {/* LISTS */}
              {tab === 'lists' && (
                isLoadingLists ? (
                  <div className="grid grid-cols-2 gap-x-5 gap-y-7">
                    {[1, 2].map((i) => (
                      <div key={i} className="aspect-[4/5] bg-secondary rounded-[20px] border border-border animate-pulse" />
                    ))}
                  </div>
                ) : lists && lists.length > 0 ? (
                  <div className="grid grid-cols-2 gap-x-5 gap-y-7">
                    {lists.map((list) => {
                      const preview = listPreviews[list.id];
                      const augmented = { ...list, movieCount: preview?.movieCount ?? list.movieCount ?? 0 };
                      return (
                        <ListTile
                          key={list.id}
                          name={list.name}
                          isPublic={list.isPublic !== false}
                          movieCount={preview?.movieCount ?? list.movieCount ?? 0}
                          coverImageUrl={list.coverImageUrl}
                          coverMode={list.coverMode}
                          previewPosters={preview?.previewPosters ?? []}
                          onClick={() => {
                            // Seed the detail page for instant render.
                            rememberListSeed({ list: augmented, previewPosters: preview?.previewPosters });
                            router.push(`/lists/${list.id}`);
                          }}
                          overlay={
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm"
                                  aria-label="List options"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="rounded-xl border border-border">
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setSelectedList(list);
                                    setIsCoverPickerOpen(true);
                                  }}
                                >
                                  <ImageIcon className="mr-2 h-4 w-4" />
                                  Set Cover
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleToggleVisibility(list.id, !!list.isPublic)}>
                                  {list.isPublic ? (
                                    <>
                                      <EyeOff className="mr-2 h-4 w-4" />
                                      Make Private
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="mr-2 h-4 w-4" />
                                      Make Public
                                    </>
                                  )}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          }
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-12 text-center">
                    <p className="cc-lead text-[15px] text-muted-foreground">nothing on the shelves yet.</p>
                  </div>
                )
              )}

              {/* ACTIVITY — the owner's full action feed */}
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
                    <p className="cc-lead text-[15px] text-muted-foreground">
                      no activity yet. rate something, mark it watched.
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
          </div>
        </main>
      </PullToRefresh>

      {/* People sheet — followers / following with follow-back + search */}
      <PeopleSheet
        isOpen={peopleTab !== null}
        onClose={() => setPeopleTab(null)}
        subjectUid={user.uid}
        subjectUsername={userProfile?.username || null}
        followersCount={followersCount}
        followingCount={followingCount}
        initialTab={peopleTab ?? 'followers'}
      />

      {/* Edit Profile Sheet — photo (camera roll / take photo / house avatar)
          + name + bio in one save. Handle is read-only. */}
      <EditProfileSheet
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
        displayName={userProfile?.displayName || user.displayName || ''}
        username={userProfile?.username || ''}
        photoURL={userProfile?.photoURL || null}
        bio={userProfile?.bio || ''}
      />

      {/* Top 5 picker — ranked slots (drag to rank), search + suggested */}
      <TopFivePicker
        isOpen={isFavoritePickerOpen}
        onClose={() => setIsFavoritePickerOpen(false)}
        currentFavorites={favoriteMovies}
        onUpdate={setFavoriteMovies}
      />

      {/* Cover Picker */}
      {selectedList && (
        <CoverPicker
          isOpen={isCoverPickerOpen}
          onClose={() => {
            setIsCoverPickerOpen(false);
            setSelectedList(null);
          }}
          listId={selectedList.id}
          listName={selectedList.name}
          currentCoverUrl={selectedList.coverImageUrl || null}
          onCoverChange={async () => {
            if (user && lists) {
              const listIds = lists.map((list) => list.id);
              const result = await apiCall<{ previews: Record<string, { previewPosters: string[]; movieCount: number }> }>(
                'POST', `/api/v1/users/${user.uid}/lists/previews`,
                { listIds },
              );
              if (result.previews) {
                setListPreviews(result.previews);
              }
            }
          }}
        />
      )}

      <BottomNav />
    </MovieModalProvider>
  );
}
