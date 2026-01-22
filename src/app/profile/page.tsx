'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil, Check, X, Loader2, List, Globe, Lock, MoreVertical, Mail, Users, Camera, Star, LogOut, Eye, EyeOff, ImageIcon } from 'lucide-react';
import Image from 'next/image';
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc, useAuth } from '@/firebase';
import { collection, orderBy, query, doc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserSearch } from '@/components/user-search';
import { ListCard } from '@/components/list-card';
import { CoverPicker } from '@/components/cover-picker';
import { useToast } from '@/hooks/use-toast';
import { updateUsername, getFollowers, getFollowing, toggleListVisibility, getMyPendingInvites, acceptInvite, declineInvite, getCollaborativeLists, updateProfilePhoto, updateBio, getListsPreviews, getListPreview } from '@/app/actions';
import { ProfileAvatar } from '@/components/profile-avatar';
import { AvatarPicker } from '@/components/avatar-picker';
import { FavoriteMoviesPicker } from '@/components/favorite-movies-picker';
import { ThemeToggle } from '@/components/theme-toggle';
import { BottomNav } from '@/components/bottom-nav';
import type { UserProfile, MovieList, ListInvite, FavoriteMovie } from '@/lib/types';

const retroButtonClass = "border-[3px] dark:border-2 border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none active:shadow-none active:translate-x-1 active:translate-y-1 dark:active:translate-x-0 dark:active:translate-y-0 transition-all duration-200";
const retroInputClass = "border-[3px] dark:border-2 border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] dark:focus:shadow-none focus:border-primary transition-shadow duration-200 bg-card";

export default function MyProfilePage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [followers, setFollowers] = useState<UserProfile[]>([]);
  const [following, setFollowing] = useState<UserProfile[]>([]);
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<ListInvite[]>([]);
  const [isLoadingInvites, setIsLoadingInvites] = useState(false);
  const [collaborativeLists, setCollaborativeLists] = useState<Array<{ id: string; name: string; ownerId: string; ownerUsername: string | null }>>([]);
  const [isLoadingCollab, setIsLoadingCollab] = useState(false);
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

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  useEffect(() => {
    if (userProfile?.username) {
      setNewUsername(userProfile.username);
    }
  }, [userProfile?.username]);

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

      setIsLoadingInvites(true);
      setIsLoadingCollab(true);

      try {
        const [invitesResult, collabResult] = await Promise.all([
          getMyPendingInvites(user.uid),
          getCollaborativeLists(user.uid),
        ]);

        setPendingInvites(invitesResult.invites || []);
        setCollaborativeLists(collabResult.lists || []);
      } catch (error) {
        console.error('Failed to load invites/collabs:', error);
      } finally {
        setIsLoadingInvites(false);
        setIsLoadingCollab(false);
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
        const result = await getListsPreviews(user.uid, listIds);
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
            const result = await getListPreview(list.ownerId, list.id);
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
  }, [collaborativeLists]);

  const handleSaveUsername = async () => {
    if (!user || !newUsername.trim()) return;

    setIsSavingUsername(true);
    try {
      const result = await updateUsername(user.uid, newUsername);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'Username Updated', description: `Your username is now @${result.username}` });
        setIsEditingUsername(false);
      }
    } finally {
      setIsSavingUsername(false);
    }
  };

  const handleSaveBio = async () => {
    if (!user) return;

    setIsSavingBio(true);
    try {
      const result = await updateBio(user.uid, newBio);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'Bio Updated', description: 'Your bio has been saved.' });
        setIsEditingBio(false);
      }
    } finally {
      setIsSavingBio(false);
    }
  };

  const handleLoadFollowers = async () => {
    if (!user) return;
    try {
      const result = await getFollowers(user.uid);
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
    if (!user) return;
    try {
      const result = await getFollowing(user.uid);
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

  const handleToggleVisibility = async (listId: string, currentlyPublic: boolean) => {
    if (!user) return;
    // For user's own lists, userId and listOwnerId are the same
    const result = await toggleListVisibility(user.uid, user.uid, listId);
    if (result.error) {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    } else {
      toast({
        title: result.isPublic ? 'List is now public' : 'List is now private',
        description: result.isPublic
          ? 'Your followers can now see this list.'
          : 'Only you can see this list.',
      });
    }
  };

  const handleAcceptInvite = async (invite: ListInvite) => {
    if (!user) return;
    try {
      const result = await acceptInvite(user.uid, invite.id);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'Invite Accepted', description: `You are now a collaborator on "${invite.listName}"` });
        setPendingInvites(prev => prev.filter(i => i.id !== invite.id));
        // Reload collaborative lists
        const collabResult = await getCollaborativeLists(user.uid);
        setCollaborativeLists(collabResult.lists || []);
      }
    } catch (error) {
      console.error('Failed to accept invite:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to accept invite' });
    }
  };

  const handleDeclineInvite = async (invite: ListInvite) => {
    if (!user) return;
    try {
      const result = await declineInvite(user.uid, invite.id);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'Invite Declined', description: 'The invite has been declined.' });
        setPendingInvites(prev => prev.filter(i => i.id !== invite.id));
      }
    } catch (error) {
      console.error('Failed to decline invite:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to decline invite' });
    }
  };

  const handleAvatarChange = async (newPhotoURL: string) => {
    if (!user) return;
    const result = await updateProfilePhoto(user.uid, newPhotoURL);
    if (result.error) {
      throw new Error(result.error);
    }
  };

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen font-body text-foreground pb-24 md:pb-8 md:pt-20">
      <div className="container mx-auto p-4 md:p-8">
        <header className="mb-8">
          <div className="w-full flex justify-between items-center mb-6">
            <Link href="/lists">
              <Button variant="ghost" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                My Lists
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Button
                variant="outline"
                size="sm"
                onClick={() => auth.signOut()}
                className={`${retroButtonClass} text-destructive border-destructive`}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Profile Header */}
          <div className="flex flex-col items-center">
            {/* Profile Picture - Clickable to change */}
            <div className="relative mb-4 group">
              <ProfileAvatar
                photoURL={userProfile?.photoURL}
                displayName={userProfile?.displayName}
                username={userProfile?.username}
                email={user.email}
                size="xl"
                onClick={() => setIsAvatarPickerOpen(true)}
                className="cursor-pointer"
              />
              {/* Edit overlay */}
              <div
                className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                onClick={() => setIsAvatarPickerOpen(true)}
              >
                <Camera className="h-6 w-6 text-white" />
              </div>
            </div>

            <h1 className="text-2xl md:text-3xl font-headline font-bold text-center">
              {userProfile?.displayName || user.displayName || 'User'}
            </h1>

            {/* Username */}
            <div className="flex items-center gap-2 mt-2">
              {isEditingUsername ? (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">@</span>
                  <Input
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                    className={`${retroInputClass} w-40`}
                    maxLength={20}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleSaveUsername}
                    disabled={isSavingUsername}
                  >
                    {isSavingUsername ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 text-green-600" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setIsEditingUsername(false);
                      setNewUsername(userProfile?.username || '');
                    }}
                  >
                    <X className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">@{userProfile?.username || 'loading...'}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setIsEditingUsername(true)}
                    className="h-8 w-8"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>

            {/* Bio */}
            <div className="mt-3 w-full max-w-md">
              {isEditingBio ? (
                <div className="space-y-2">
                  <textarea
                    value={newBio}
                    onChange={(e) => setNewBio(e.target.value)}
                    placeholder="Write a short bio..."
                    maxLength={160}
                    rows={3}
                    className={`${retroInputClass} w-full resize-none p-3`}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{newBio.length}/160</span>
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
                      <Button
                        size="sm"
                        onClick={handleSaveBio}
                        disabled={isSavingBio}
                        className={`${retroButtonClass} bg-primary text-primary-foreground`}
                      >
                        {isSavingBio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className="text-center text-muted-foreground cursor-pointer hover:text-foreground transition-colors group"
                  onClick={() => setIsEditingBio(true)}
                >
                  {userProfile?.bio ? (
                    <p className="inline italic">{userProfile.bio}</p>
                  ) : (
                    <p className="italic">Add a bio...</p>
                  )}
                  <Pencil className="h-3 w-3 inline ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              )}
            </div>

            {/* Stats Row - Styled Boxes */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleLoadFollowers}
                className="flex flex-col items-center px-5 py-3 rounded-xl border-[3px] dark:border-2 border-border bg-card shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none hover:shadow-[2px_2px_0px_0px_hsl(var(--border))] hover:translate-x-0.5 hover:translate-y-0.5 active:shadow-none active:translate-x-1 active:translate-y-1 transition-all min-w-[90px]"
              >
                <span className="font-bold text-2xl">{userProfile?.followersCount || 0}</span>
                <span className="text-xs text-muted-foreground">followers</span>
              </button>
              <button
                onClick={handleLoadFollowing}
                className="flex flex-col items-center px-5 py-3 rounded-xl border-[3px] dark:border-2 border-border bg-card shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none hover:shadow-[2px_2px_0px_0px_hsl(var(--border))] hover:translate-x-0.5 hover:translate-y-0.5 active:shadow-none active:translate-x-1 active:translate-y-1 transition-all min-w-[90px]"
              >
                <span className="font-bold text-2xl">{userProfile?.followingCount || 0}</span>
                <span className="text-xs text-muted-foreground">following</span>
              </button>
              <Link
                href="/lists"
                className="flex flex-col items-center px-5 py-3 rounded-xl border-[3px] dark:border-2 border-border bg-yellow-400 dark:bg-yellow-500 text-black shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none hover:shadow-[2px_2px_0px_0px_hsl(var(--border))] hover:translate-x-0.5 hover:translate-y-0.5 active:shadow-none active:translate-x-1 active:translate-y-1 transition-all min-w-[90px]"
              >
                <span className="font-bold text-2xl">{lists?.length || 0}</span>
                <span className="text-xs">lists</span>
              </Link>
            </div>

            {/* Favorite Movies */}
            <div className="mt-8 w-full max-w-lg">
              <div className="flex items-center justify-center gap-2 mb-4">
                <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                <h3 className="text-lg font-headline font-bold">Top 5 Films</h3>
              </div>
              <div className="flex justify-center gap-3">
                {[0, 1, 2, 3, 4].map((index) => {
                  const movie = favoriteMovies[index];
                  if (movie) {
                    return (
                      <div
                        key={movie.tmdbId}
                        className="relative group cursor-pointer"
                        onClick={() => setIsFavoritePickerOpen(true)}
                      >
                        <Image
                          src={movie.posterUrl}
                          alt={movie.title}
                          width={70}
                          height={105}
                          className="rounded-lg border-[3px] border-border shadow-[3px_3px_0px_0px_hsl(var(--border))] transition-all duration-200 group-hover:shadow-[1px_1px_0px_0px_hsl(var(--border))] group-hover:translate-x-0.5 group-hover:translate-y-0.5"
                          title={movie.title}
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                          <Pencil className="h-4 w-4 text-white" />
                        </div>
                      </div>
                    );
                  }
                  return (
                    <button
                      key={index}
                      onClick={() => setIsFavoritePickerOpen(true)}
                      className="w-[70px] h-[105px] rounded-lg border-[3px] border-dashed border-border/50 bg-secondary/30 flex items-center justify-center hover:border-primary hover:bg-primary/10 transition-all duration-200 group"
                    >
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-8 h-8 rounded-full bg-border/30 group-hover:bg-primary/20 flex items-center justify-center transition-colors">
                          <span className="text-xl text-muted-foreground group-hover:text-primary">+</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-center text-xs text-muted-foreground mt-3">
                Click to add your favorite films
              </p>
            </div>
          </div>
        </header>

        {/* Search Users */}
        <section className="mb-8">
          <h2 className="text-xl font-headline font-bold mb-4">Find Friends</h2>
          <UserSearch />
        </section>

        {/* Pending Invites */}
        {pendingInvites.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xl font-headline font-bold mb-4 flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Pending Invites
              <span className="bg-primary text-primary-foreground text-sm px-2 py-0.5 rounded-full">
                {pendingInvites.length}
              </span>
            </h2>
            <div className="space-y-3">
              {pendingInvites.map((invite) => (
                <Card
                  key={invite.id}
                  className="border-[3px] dark:border-2 border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none"
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center border-[3px] border-border">
                        <Users className="h-5 w-5 text-primary-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">{invite.listName}</p>
                        <p className="text-sm text-muted-foreground">
                          Invited by @{invite.inviterUsername}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-[2px] border-border rounded-full"
                        onClick={() => handleDeclineInvite(invite)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        className={`${retroButtonClass} bg-primary text-primary-foreground font-bold`}
                        onClick={() => handleAcceptInvite(invite)}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Accept
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Collaborative Lists */}
        {collaborativeLists.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xl font-headline font-bold mb-4 flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Shared With Me
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {collaborativeLists.map((collab) => {
                const preview = collabListPreviews[collab.id];
                return (
                  <ListCard
                    key={collab.id}
                    list={{
                      ...collab,
                      movieCount: preview?.movieCount ?? 0,
                      isPublic: true, // Shared lists shown here are public
                      createdAt: new Date(),
                      updatedAt: new Date(),
                      isDefault: false,
                    }}
                    previewPosters={preview?.previewPosters ?? []}
                    onClick={() => router.push(`/lists/${collab.id}?owner=${collab.ownerId}`)}
                    isCollaborative={true}
                    ownerName={collab.ownerUsername || 'Unknown'}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* My Lists */}
        <section>
          <h2 className="text-xl font-headline font-bold mb-4">My Lists</h2>
          {isLoadingLists ? (
            <div className="grid grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <div key={i} className="aspect-[4/5] bg-secondary rounded-2xl border-[3px] border-border animate-pulse" />
              ))}
            </div>
          ) : lists && lists.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {lists.map((list) => {
                const preview = listPreviews[list.id];
                return (
                  <ListCard
                    key={list.id}
                    list={{ ...list, movieCount: preview?.movieCount ?? 0 }}
                    previewPosters={preview?.previewPosters ?? []}
                    onClick={() => router.push(`/lists/${list.id}`)}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 flex-shrink-0 text-white hover:bg-white/20"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="border-[2px] border-border rounded-xl">
                        <DropdownMenuItem
                          onSelect={() => {
                            setSelectedList(list);
                            setIsCoverPickerOpen(true);
                          }}
                        >
                          <ImageIcon className="h-4 w-4 mr-2" />
                          Set Cover
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => handleToggleVisibility(list.id, list.isPublic !== false)}
                        >
                          {list.isPublic ? (
                            <>
                              <EyeOff className="h-4 w-4 mr-2" />
                              Make Private
                            </>
                          ) : (
                            <>
                              <Eye className="h-4 w-4 mr-2" />
                              Make Public
                            </>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ListCard>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">No lists yet</p>
          )}
        </section>

        {/* Followers Modal */}
        {showFollowers && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md border-[3px] dark:border-2 border-border rounded-2xl shadow-[8px_8px_0px_0px_hsl(var(--border))] dark:shadow-none">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Followers</CardTitle>
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
                            <p className="font-medium">{profile.displayName || profile.username}</p>
                            <p className="text-sm text-muted-foreground">@{profile.username}</p>
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
            <Card className="w-full max-w-md border-[3px] dark:border-2 border-border rounded-2xl shadow-[8px_8px_0px_0px_hsl(var(--border))] dark:shadow-none">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Following</CardTitle>
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
                            <p className="font-medium">{profile.displayName || profile.username}</p>
                            <p className="text-sm text-muted-foreground">@{profile.username}</p>
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
              // Refresh list previews
              if (user && lists) {
                const listIds = lists.map((list) => list.id);
                const result = await getListsPreviews(user.uid, listIds);
                if (result.previews) {
                  setListPreviews(result.previews);
                }
              }
            }}
          />
        )}
      </div>

      <BottomNav />
    </main>
  );
}
