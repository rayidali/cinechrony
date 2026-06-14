'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Pencil, Check, X, Loader2, MoreVertical, Users, Camera, LogOut,
  Eye, EyeOff, ImageIcon, Settings, Search, Share2,
} from 'lucide-react';
import { PullToRefresh } from '@/components/pull-to-refresh';
import Image from 'next/image';
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc, useAuth } from '@/firebase';
import { collection, orderBy, query, doc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserSearch } from '@/components/user-search';
import { ListTile } from '@/components/v3/list-tile';
import { rememberListSeed } from '@/lib/list-detail-seed';
import { CoverPicker } from '@/components/cover-picker';
import { useToast } from '@/hooks/use-toast';
import { apiCall, ApiClientError } from '@/lib/api-client';
import type { CollaborativeListSummary } from '@/lib/lists-server';
import { ProfileAvatar } from '@/components/profile-avatar';
import { AvatarPicker } from '@/components/avatar-picker';
import { FavoriteMoviesPicker } from '@/components/favorite-movies-picker';
import { Hero } from '@/components/v3/hero';
import { GlassBtn } from '@/components/v3/glass-button';
import { Segmented } from '@/components/v3/segmented';
import { BottomNav } from '@/components/bottom-nav';
import type { UserProfile, MovieList, ListInvite, FavoriteMovie } from '@/lib/types';

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

function shortDate(value: unknown): string | null {
  if (!value) return null;
  try {
    const v = value as { toDate?: () => Date };
    const d = typeof v?.toDate === 'function' ? v.toDate() : value instanceof Date ? value : new Date(value as string);
    if (isNaN(d.getTime())) return null;
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

const GHOST_PILL =
  'inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-foreground font-headline font-semibold text-[13px] lowercase tracking-tight transition-transform active:scale-[0.98]';

export default function MyProfilePage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  // AUDIT.md 2.3 (Option A): usernames are permanent — no edit state needed.
  const [followers, setFollowers] = useState<UserProfile[]>([]);
  const [following, setFollowing] = useState<UserProfile[]>([]);
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<ListInvite[]>([]);
  const [collaborativeLists, setCollaborativeLists] = useState<Array<{ id: string; name: string; ownerId: string; ownerUsername: string | null }>>([]);
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [newBio, setNewBio] = useState('');
  const [isSavingBio, setIsSavingBio] = useState(false);
  const [isFavoritePickerOpen, setIsFavoritePickerOpen] = useState(false);
  const [favoriteMovies, setFavoriteMovies] = useState<FavoriteMovie[]>([]);
  const [listPreviews, setListPreviews] = useState<Record<string, { previewPosters: string[]; movieCount: number }>>({});
  const [collabListPreviews, setCollabListPreviews] = useState<Record<string, { previewPosters: string[]; movieCount: number }>>({});
  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);
  const [selectedList, setSelectedList] = useState<MovieList | null>(null);
  const [tab, setTab] = useState<ProfileTab>('lists');
  const [showSearch, setShowSearch] = useState(false);

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

  const memberSince = useMemo(() => shortMonthYear(userProfile?.createdAt), [userProfile?.createdAt]);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  useEffect(() => {
    if (userProfile?.bio !== undefined) {
      setNewBio(userProfile.bio || '');
    }
  }, [userProfile?.bio]);

  useEffect(() => {
    if (userProfile?.favoriteMovies) {
      setFavoriteMovies(userProfile.favoriteMovies);
    }
  }, [userProfile?.favoriteMovies]);

  // Load pending invites and collaborative lists
  useEffect(() => {
    async function loadInvitesAndCollabs() {
      if (!user) return;
      try {
        const [invitesResult, collabResult] = await Promise.all([
          apiCall<{ invites: ListInvite[] }>('GET', '/api/v1/me/invites'),
          apiCall<{ lists: CollaborativeListSummary[] }>('GET', '/api/v1/me/collaborative-lists'),
        ]);
        setPendingInvites(invitesResult.invites || []);
        setCollaborativeLists(collabResult.lists || []);
      } catch (error) {
        console.error('Failed to load invites/collabs:', error);
      }
    }
    loadInvitesAndCollabs();
  }, [user]);

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

  // Fetch collaborative list previews
  useEffect(() => {
    async function fetchCollabPreviews() {
      if (collaborativeLists.length === 0) return;
      try {
        const previews: Record<string, { previewPosters: string[]; movieCount: number }> = {};
        await Promise.all(
          collaborativeLists.map(async (list) => {
            const result = await apiCall<{ previewPosters: string[]; movieCount: number }>(
              'GET', `/api/v1/lists/${list.ownerId}/${list.id}/preview`,
            );
            previews[list.id] = {
              previewPosters: result.previewPosters || [],
              movieCount: result.movieCount || 0,
            };
          })
        );
        setCollabListPreviews(previews);
      } catch (error) {
        console.error('Failed to fetch collaborative list previews:', error);
      }
    }
    fetchCollabPreviews();
  }, [collaborativeLists, user]);

  const handleSaveBio = async () => {
    if (!user) return;
    setIsSavingBio(true);
    try {
      await apiCall('PATCH', '/api/v1/me', { bio: newBio });
      toast({ title: 'bio updated' });
      setIsEditingBio(false);
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Failed to update bio.';
      toast({ variant: 'destructive', title: 'Error', description: message });
    } finally {
      setIsSavingBio(false);
    }
  };

  const handleLoadFollowers = async () => {
    if (!user) return;
    try {
      const result = await apiCall<{ users: UserProfile[] }>(
        'GET',
        `/api/v1/users/${user.uid}/followers`,
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
    if (!user) return;
    try {
      const result = await apiCall<{ users: UserProfile[] }>(
        'GET',
        `/api/v1/users/${user.uid}/following`,
      );
      setFollowing(result.users || []);
      setShowFollowing(true);
    } catch {
      setFollowing([]);
      setShowFollowing(true);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load following' });
    }
  };

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

  const handleAcceptInvite = async (invite: ListInvite) => {
    if (!user) return;
    try {
      await apiCall('POST', '/api/v1/invites/accept', { inviteId: invite.id });
      toast({ title: 'invite accepted', description: `you're now on "${invite.listName}"` });
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
      const collabResult = await apiCall<{ lists: CollaborativeListSummary[] }>(
        'GET', '/api/v1/me/collaborative-lists',
      );
      setCollaborativeLists(collabResult.lists || []);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof ApiClientError ? err.message : 'Failed to accept invite',
      });
    }
  };

  const handleDeclineInvite = async (invite: ListInvite) => {
    if (!user) return;
    try {
      await apiCall('POST', `/api/v1/invites/${invite.id}/decline`);
      toast({ title: 'invite declined' });
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof ApiClientError ? err.message : 'Failed to decline invite',
      });
    }
  };

  const handleAvatarChange = async (newPhotoURL: string) => {
    if (!user) return;
    // Throws ApiClientError on failure — the caller (AvatarPicker) handles it.
    await apiCall('PATCH', '/api/v1/me', { photoURL: newPhotoURL });
  };

  const handleShare = async () => {
    const username = userProfile?.username;
    if (!username) return;
    const url = `${window.location.origin}/profile/${username}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: `@${username} on cinechrony`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: 'link copied' });
      }
    } catch {
      /* user dismissed the share sheet — ignore */
    }
  };

  // Pull-to-refresh handler
  const handleRefresh = useCallback(async () => {
    if (!user) return;
    const [invitesResult, collabResult] = await Promise.all([
      apiCall<{ invites: ListInvite[] }>('GET', '/api/v1/me/invites'),
      apiCall<{ lists: CollaborativeListSummary[] }>('GET', '/api/v1/me/collaborative-lists'),
    ]);
    setPendingInvites(invitesResult.invites || []);
    setCollaborativeLists(collabResult.lists || []);

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
  }, [user, lists]);

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

  const stats: { label: string; value: number; onClick: () => void }[] = [
    { label: 'followers', value: followersCount, onClick: handleLoadFollowers },
    { label: 'following', value: followingCount, onClick: handleLoadFollowing },
    { label: 'lists', value: listsCount, onClick: () => setTab('lists') },
  ];

  const tabs: { id: ProfileTab; label: string }[] = [
    { id: 'lists', label: 'lists' },
    { id: 'shared', label: 'shared' },
    { id: 'top5', label: 'top 5' },
  ];

  return (
    <>
      <PullToRefresh
        onRefresh={handleRefresh}
        disabled={showFollowers || showFollowing || isAvatarPickerOpen || isFavoritePickerOpen || isCoverPickerOpen}
      >
        <main className="min-h-screen text-foreground pb-24 md:pb-8">
          {/* Cinematic hero — seeded gradient + glass settings / sign-out */}
          <Hero
            seed={userProfile?.displayName || userProfile?.username || 'profile'}
            height={340}
            topRight={
              <>
                <GlassBtn icon={Settings} ariaLabel="Settings" onClick={() => router.push('/settings')} />
                <GlassBtn icon={LogOut} ariaLabel="Sign out" onClick={() => auth.signOut()} />
              </>
            }
          >
            <div className="flex items-end gap-4">
              <div className="group relative flex-shrink-0">
                <ProfileAvatar
                  photoURL={userProfile?.photoURL}
                  displayName={userProfile?.displayName}
                  username={userProfile?.username}
                  email={user.email}
                  size="xl"
                  onClick={() => setIsAvatarPickerOpen(true)}
                  className="cursor-pointer shadow-photo ring-[3px] ring-white/90"
                />
                <div
                  className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => setIsAvatarPickerOpen(true)}
                >
                  <Camera className="h-5 w-5 text-white" />
                </div>
              </div>
              <div className="min-w-0 pb-1">
                <h1 className="truncate font-headline text-[30px] font-bold lowercase leading-none tracking-tight text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.35)]">
                  {userProfile?.displayName || user.displayName || 'user'}
                </h1>
                <p className="mt-1.5 font-mono text-[11px] text-white/80">
                  @{userProfile?.username || '…'}
                  {memberSince ? ` · since ${memberSince}` : ''}
                </p>
              </div>
            </div>
            {!isEditingBio && (
              <button
                onClick={() => setIsEditingBio(true)}
                className="mt-3 block max-w-full text-left"
              >
                <p className="line-clamp-2 font-serif text-[15px] italic leading-snug text-white/90 [text-shadow:0_1px_6px_rgba(0,0,0,0.45)]">
                  {userProfile?.bio || 'add a one-liner…'}
                  <Pencil className="ml-1.5 inline h-3 w-3 align-baseline text-white/70" />
                </p>
              </button>
            )}
          </Hero>

          {/* Pull-up content sheet */}
          <div className="relative z-[1] -mt-5 min-h-[60vh] rounded-t-[22px] bg-background">
            <div className="mx-auto max-w-2xl px-4 pt-5">

            {/* Bio editor — opened by tapping the hero tagline */}
            {isEditingBio && (
              <div className="mt-1 mb-5 space-y-2">
                <textarea
                  value={newBio}
                  onChange={(e) => setNewBio(e.target.value)}
                  placeholder="add a one-liner. something they'll remember you by…"
                  maxLength={160}
                  rows={2}
                  autoFocus
                  className="w-full resize-none rounded-[14px] border border-input bg-background p-3 font-serif italic text-[15px] leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex items-center justify-between">
                  <span className="cc-meta text-[10px] text-muted-foreground">{newBio.length}/160</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setIsEditingBio(false);
                        setNewBio(userProfile?.bio || '');
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="accent" onClick={handleSaveBio} disabled={isSavingBio}>
                      {isSavingBio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Ghost pill actions */}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowSearch((v) => !v)} className={GHOST_PILL}>
                <Search className="h-3.5 w-3.5" strokeWidth={1.8} />
                find friends
              </button>
              <button onClick={handleShare} className={GHOST_PILL}>
                <Share2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                share
              </button>
            </div>

            {showSearch && (
              <div className="mt-4">
                <UserSearch />
              </div>
            )}

            {/* Stats sandwich — between two hairlines */}
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

            {/* Segmented tabs */}
            <div className="mt-5">
              <Segmented value={tab} onChange={(v) => setTab(v as ProfileTab)} options={tabs} />
            </div>

            {/* Tab content */}
            <div className="mt-6">
              {/* LISTS */}
              {tab === 'lists' && (
                isLoadingLists ? (
                  <div className="grid grid-cols-2 gap-4">
                    {[1, 2].map((i) => (
                      <div key={i} className="aspect-[4/5] bg-secondary rounded-[20px] border border-border animate-pulse" />
                    ))}
                  </div>
                ) : lists && lists.length > 0 ? (
                  <div className="grid grid-cols-2 gap-4">
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

              {/* SHARED — pending invites + collaborative lists */}
              {tab === 'shared' && (
                <div className="space-y-6">
                  {pendingInvites.length > 0 && (
                    <div>
                      <div className="cc-eyebrow">pending invites · {pendingInvites.length}</div>
                      <div className="h-px bg-border mt-2.5 mb-1" />
                      {pendingInvites.map((invite) => (
                        <div
                          key={invite.id}
                          className="flex items-center justify-between gap-3 py-3.5 border-b border-border"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center flex-shrink-0">
                              <Users className="h-4 w-4" strokeWidth={1.8} />
                            </div>
                            <div className="min-w-0">
                              <p className="font-headline font-semibold text-sm lowercase tracking-tight truncate">
                                {invite.listName}
                              </p>
                              <p className="cc-meta text-[11px] text-muted-foreground">
                                invited by @{invite.inviterUsername}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <Button size="sm" variant="outline" onClick={() => handleDeclineInvite(invite)}>
                              <X className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="accent" onClick={() => handleAcceptInvite(invite)}>
                              accept
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {collaborativeLists.length > 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                      {collaborativeLists.map((collab) => {
                        const preview = collabListPreviews[collab.id];
                        const augmented = { ...collab, movieCount: preview?.movieCount ?? 0 };
                        return (
                          <ListTile
                            key={collab.id}
                            name={collab.name}
                            ownerName={collab.ownerUsername || undefined}
                            movieCount={preview?.movieCount ?? 0}
                            previewPosters={preview?.previewPosters ?? []}
                            onClick={() => {
                              rememberListSeed({ list: augmented, previewPosters: preview?.previewPosters });
                              router.push(`/lists/${collab.id}?owner=${collab.ownerId}`);
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    pendingInvites.length === 0 && (
                      <div className="py-12 text-center">
                        <p className="cc-lead text-[15px] text-muted-foreground">
                          no shared lists yet. invite the group chat.
                        </p>
                      </div>
                    )
                  )}
                </div>
              )}

              {/* TOP 5 */}
              {tab === 'top5' && (
                <div>
                  <div className="grid grid-cols-5 gap-2.5">
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
                              className="w-full h-auto rounded-[10px] border border-border shadow-lift transition-all duration-200 group-hover:shadow-photo group-hover:-translate-y-0.5"
                              title={movie.title}
                            />
                            <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity rounded-[10px] flex items-center justify-center">
                              <Pencil className="h-4 w-4 text-white" />
                            </div>
                          </button>
                        );
                      }
                      return (
                        <button
                          key={index}
                          onClick={() => setIsFavoritePickerOpen(true)}
                          className="aspect-[2/3] rounded-[10px] border border-dashed border-border bg-background flex items-center justify-center hover:border-foreground/40 transition-colors text-muted-foreground"
                        >
                          <span className="text-xl">+</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="cc-meta text-[11px] text-muted-foreground mt-3 text-center">
                    {favoriteMovies.length === 0
                      ? 'pick your 5 desert-island films.'
                      : 'tap a poster to edit your canon.'}
                  </p>
                </div>
              )}
            </div>
          </div>
          </div>
        </main>
      </PullToRefresh>

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
                  {followers.map((profile) => (
                    <li key={profile.uid}>
                      <Link
                        href={`/profile/${profile.username}`}
                        onClick={() => setShowFollowers(false)}
                        className="flex items-center gap-3 py-3 hover:opacity-70 transition-opacity"
                      >
                        <ProfileAvatar
                          photoURL={profile.photoURL}
                          displayName={profile.displayName}
                          username={profile.username}
                          size="md"
                        />
                        <div>
                          <p className="font-headline font-semibold text-sm">{profile.displayName || profile.username}</p>
                          <p className="cc-meta text-[11px] text-muted-foreground">@{profile.username}</p>
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
                  {following.map((profile) => (
                    <li key={profile.uid}>
                      <Link
                        href={`/profile/${profile.username}`}
                        onClick={() => setShowFollowing(false)}
                        className="flex items-center gap-3 py-3 hover:opacity-70 transition-opacity"
                      >
                        <ProfileAvatar
                          photoURL={profile.photoURL}
                          displayName={profile.displayName}
                          username={profile.username}
                          size="md"
                        />
                        <div>
                          <p className="font-headline font-semibold text-sm">{profile.displayName || profile.username}</p>
                          <p className="cc-meta text-[11px] text-muted-foreground">@{profile.username}</p>
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

      {/* Avatar Picker Modal */}
      <AvatarPicker
        isOpen={isAvatarPickerOpen}
        onClose={() => setIsAvatarPickerOpen(false)}
        currentAvatarUrl={userProfile?.photoURL || null}
        onAvatarChange={handleAvatarChange}
      />

      {/* Favorite Movies Picker Modal */}
      <FavoriteMoviesPicker
        isOpen={isFavoritePickerOpen}
        onClose={() => setIsFavoritePickerOpen(false)}
        userId={user.uid}
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
    </>
  );
}
