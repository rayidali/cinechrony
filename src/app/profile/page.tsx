'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Film, ArrowLeft, Pencil, Check, X, Loader2, List, Globe, Lock, MoreVertical } from 'lucide-react';
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, orderBy, query, doc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserSearch } from '@/components/user-search';
import { useToast } from '@/hooks/use-toast';
import { updateUsername, getFollowers, getFollowing, toggleListVisibility } from '@/app/actions';
import type { UserProfile, MovieList } from '@/lib/types';

const retroButtonClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";
const retroInputClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] focus:shadow-[2px_2px_0px_0px_#000] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200";

// Get initials from name
function getInitials(displayName: string | null | undefined, username: string | null | undefined, email: string | null | undefined): string {
  if (displayName) {
    const parts = displayName.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return displayName[0].toUpperCase();
  }
  if (username) {
    return username[0].toUpperCase();
  }
  if (email) {
    return email[0].toUpperCase();
  }
  return '?';
}

export default function MyProfilePage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [followers, setFollowers] = useState<UserProfile[]>([]);
  const [following, setFollowing] = useState<UserProfile[]>([]);
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);

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

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  const initials = getInitials(userProfile?.displayName, userProfile?.username, user.email);

  return (
    <main className="min-h-screen bg-background font-body text-foreground">
      <div className="container mx-auto p-4 md:p-8">
        <header className="mb-8">
          <div className="w-full flex justify-between items-center mb-6">
            <Link href="/lists">
              <Button variant="ghost" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                My Lists
              </Button>
            </Link>
          </div>

          {/* Profile Header */}
          <div className="flex flex-col items-center">
            {/* Profile Picture with Initial */}
            <div className="h-24 w-24 rounded-full bg-primary border-[3px] border-black flex items-center justify-center mb-4 shadow-[4px_4px_0px_0px_#000]">
              <span className="text-4xl font-bold text-primary-foreground">{initials}</span>
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

            {/* Follower/Following Stats */}
            <div className="flex gap-6 mt-4">
              <button
                onClick={handleLoadFollowers}
                className="text-center hover:opacity-70 transition-opacity"
              >
                <span className="font-bold text-lg">{userProfile?.followersCount || 0}</span>
                <span className="text-muted-foreground ml-1">followers</span>
              </button>
              <button
                onClick={handleLoadFollowing}
                className="text-center hover:opacity-70 transition-opacity"
              >
                <span className="font-bold text-lg">{userProfile?.followingCount || 0}</span>
                <span className="text-muted-foreground ml-1">following</span>
              </button>
            </div>
          </div>
        </header>

        {/* Search Users */}
        <section className="mb-8">
          <h2 className="text-xl font-headline font-bold mb-4">Find Friends</h2>
          <UserSearch />
        </section>

        {/* My Lists */}
        <section>
          <h2 className="text-xl font-headline font-bold mb-4">My Lists</h2>
          {isLoadingLists ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : lists && lists.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {lists.map((list) => {
                const isPublic = list.isPublic !== false;
                return (
                  <Card
                    key={list.id}
                    className="border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] md:hover:shadow-[2px_2px_0px_0px_#000] md:hover:translate-x-0.5 md:hover:translate-y-0.5 transition-all duration-200 cursor-pointer group"
                    onClick={() => router.push(`/lists/${list.id}`)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                          <List className="h-5 w-5 text-primary" />
                          <CardTitle className="text-lg">{list.name}</CardTitle>
                          {list.isDefault && (
                            <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                              Default
                            </span>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="border-[2px] border-black w-56">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/lists/${list.id}`);
                              }}
                            >
                              <List className="h-4 w-4 mr-2" />
                              Go to List
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <div
                              className="flex items-center justify-between px-2 py-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center gap-2">
                                {isPublic ? (
                                  <Globe className="h-4 w-4 text-green-600" />
                                ) : (
                                  <Lock className="h-4 w-4 text-muted-foreground" />
                                )}
                                <span className="text-sm">
                                  {isPublic ? 'Public' : 'Private'}
                                </span>
                              </div>
                              <Switch
                                checked={isPublic}
                                onCheckedChange={() => handleToggleVisibility(list.id, isPublic)}
                              />
                            </div>
                            <p className="px-2 py-1 text-xs text-muted-foreground">
                              {isPublic ? 'Followers can see this list' : 'Only you can see this list'}
                            </p>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="flex items-center gap-2">
                        {isPublic ? (
                          <>
                            <Globe className="h-3 w-3 text-green-600" />
                            <span>Public</span>
                          </>
                        ) : (
                          <>
                            <Lock className="h-3 w-3" />
                            <span>Private</span>
                          </>
                        )}
                        <span className="text-muted-foreground">•</span>
                        <span>Click to view</span>
                      </CardDescription>
                    </CardContent>
                  </Card>
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
                    {followers.map((profile) => {
                      const followerInitial = getInitials(profile.displayName, profile.username, profile.email);
                      return (
                        <li key={profile.uid}>
                          <Link
                            href={`/profile/${profile.username}`}
                            onClick={() => setShowFollowers(false)}
                            className="flex items-center gap-3 py-3 hover:opacity-70 transition-opacity"
                          >
                            <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center border-[2px] border-black">
                              <span className="text-lg font-bold text-primary-foreground">{followerInitial}</span>
                            </div>
                            <div>
                              <p className="font-medium">{profile.displayName || profile.username}</p>
                              <p className="text-sm text-muted-foreground">@{profile.username}</p>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
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
                    {following.map((profile) => {
                      const followingInitial = getInitials(profile.displayName, profile.username, profile.email);
                      return (
                        <li key={profile.uid}>
                          <Link
                            href={`/profile/${profile.username}`}
                            onClick={() => setShowFollowing(false)}
                            className="flex items-center gap-3 py-3 hover:opacity-70 transition-opacity"
                          >
                            <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center border-[2px] border-black">
                              <span className="text-lg font-bold text-primary-foreground">{followingInitial}</span>
                            </div>
                            <div>
                              <p className="font-medium">{profile.displayName || profile.username}</p>
                              <p className="text-sm text-muted-foreground">@{profile.username}</p>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
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
