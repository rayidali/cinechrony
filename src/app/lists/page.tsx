'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Film, Plus, Loader2, List, MoreVertical, Pencil, Trash2, Eye, EyeOff, Users } from 'lucide-react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { UserAvatar } from '@/components/user-avatar';
import { ThemeToggle } from '@/components/theme-toggle';
import { BottomNav } from '@/components/bottom-nav';
import { FolderCard, FolderCardContent } from '@/components/folder-card';
import { collection, orderBy, query } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { createList, renameList, deleteList, ensureUserProfile, migrateMoviesToList, toggleListVisibility, getCollaborativeLists } from '@/app/actions';
import type { MovieList } from '@/lib/types';

// Extended type for collaborative lists with owner info
type CollaborativeList = MovieList & {
  ownerUsername?: string;
  ownerDisplayName?: string;
};

const retroInputClass = "border-[3px] border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200 bg-card";
const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

// Pending action type for deferred dialog opening
type PendingAction = {
  type: 'rename' | 'delete';
  list: MovieList;
} | null;

export default function ListsPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [selectedList, setSelectedList] = useState<MovieList | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [collaborativeLists, setCollaborativeLists] = useState<CollaborativeList[]>([]);
  const [isLoadingCollaborative, setIsLoadingCollaborative] = useState(false);

  // Track which dropdown is open (by list id) and pending action
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  // Query for user's lists
  const listsQuery = useMemoFirebase(() => {
    if (!user) return null;
    return query(
      collection(firestore, 'users', user.uid, 'lists'),
      orderBy('createdAt', 'desc')
    );
  }, [firestore, user]);

  const { data: lists, isLoading: isLoadingLists } = useCollection<MovieList>(listsQuery);

  // Initialize user profile and handle migration for existing users
  useEffect(() => {
    async function initUser() {
      if (!user || isUserLoading) return;

      try {
        const result = await ensureUserProfile(
          user.uid,
          user.email || '',
          user.displayName
        );

        if (result.defaultListId) {
          // Check for old movies to migrate
          const migrateResult = await migrateMoviesToList(user.uid, result.defaultListId);
          if (migrateResult.migratedCount && migrateResult.migratedCount > 0) {
            toast({
              title: 'Movies Migrated',
              description: `${migrateResult.migratedCount} movies moved to your default list.`,
            });
          }
        }
      } catch (error) {
        console.error('Failed to initialize user:', error);
      } finally {
        setIsInitializing(false);
      }
    }

    initUser();
  }, [user, isUserLoading, toast]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  // Fetch collaborative lists
  useEffect(() => {
    async function fetchCollaborativeLists() {
      if (!user || isUserLoading) return;

      setIsLoadingCollaborative(true);
      try {
        const result = await getCollaborativeLists(user.uid);
        if (result.lists) {
          setCollaborativeLists(result.lists as CollaborativeList[]);
        }
      } catch (error) {
        console.error('Failed to fetch collaborative lists:', error);
      } finally {
        setIsLoadingCollaborative(false);
      }
    }

    fetchCollaborativeLists();
  }, [user, isUserLoading]);

  // Process pending action after dropdown closes
  useEffect(() => {
    if (pendingAction && openDropdownId === null) {
      const { type, list } = pendingAction;

      if (type === 'rename') {
        setSelectedList(list);
        setNewListName(list.name);
        setIsRenameOpen(true);
      } else if (type === 'delete') {
        setSelectedList(list);
        setIsDeleteOpen(true);
      }

      setPendingAction(null);
    }
  }, [pendingAction, openDropdownId]);

  const handleCreateList = async () => {
    if (!user || !newListName.trim()) return;

    setIsSubmitting(true);
    try {
      const result = await createList(user.uid, newListName);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'List Created', description: `"${newListName}" has been created.` });
        setNewListName('');
        setIsCreateOpen(false);
        if (result.listId) {
          router.push(`/lists/${result.listId}`);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRenameList = async () => {
    if (!user || !selectedList || !newListName.trim()) return;

    setIsSubmitting(true);
    try {
      const result = await renameList(user.uid, user.uid, selectedList.id, newListName);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'List Renamed', description: `List renamed to "${newListName}".` });
        setNewListName('');
        setSelectedList(null);
        setIsRenameOpen(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteList = async () => {
    if (!user || !selectedList) return;

    setIsSubmitting(true);
    try {
      const result = await deleteList(user.uid, user.uid, selectedList.id);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'List Deleted', description: `"${selectedList.name}" has been deleted.` });
        setSelectedList(null);
        setIsDeleteOpen(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const scheduleRename = useCallback((list: MovieList) => {
    setPendingAction({ type: 'rename', list });
    setOpenDropdownId(null);
  }, []);

  const scheduleDelete = useCallback((list: MovieList) => {
    setPendingAction({ type: 'delete', list });
    setOpenDropdownId(null);
  }, []);

  const handleToggleVisibility = useCallback(async (list: MovieList) => {
    if (!user) return;
    setOpenDropdownId(null);

    try {
      const result = await toggleListVisibility(user.uid, user.uid, list.id);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({
          title: list.isPublic ? 'List is now private' : 'List is now public',
          description: list.isPublic
            ? 'Only you can see this list.'
            : 'Your followers can now see this list.',
        });
      }
    } catch (error) {
      console.error('Failed to toggle visibility:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to update visibility.' });
    }
  }, [user, toast]);

  const handleDropdownOpenChange = useCallback((listId: string, open: boolean) => {
    if (open) {
      setOpenDropdownId(listId);
    } else {
      setOpenDropdownId(null);
    }
  }, []);

  const handleCardClick = useCallback((listId: string, e: React.MouseEvent) => {
    if (openDropdownId !== null) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    router.push(`/lists/${listId}`);
  }, [openDropdownId, router]);

  if (isUserLoading || !user || isInitializing) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen font-body text-foreground pb-24 md:pb-8 md:pt-20">
      <div className="container mx-auto p-4 md:p-8">
        {/* Header */}
        <header className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-primary p-2 rounded-xl border-[3px] border-border shadow-[3px_3px_0px_0px_hsl(var(--border))]">
                <Film className="h-6 w-6 text-primary-foreground" />
              </div>
              <h1 className="text-2xl md:text-3xl font-headline font-bold">MovieNight</h1>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <UserAvatar />
            </div>
          </div>
          <p className="text-muted-foreground">
            Your movie watchlists
          </p>
        </header>

        <div className="max-w-4xl mx-auto">
          {/* My Lists Section */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-headline font-bold">My Lists</h2>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className={`${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold`}>
                  <Plus className="h-5 w-5 mr-2" />
                  New List
                </Button>
              </DialogTrigger>
              <DialogContent className="border-[3px] border-border rounded-2xl shadow-[8px_8px_0px_0px_hsl(var(--border))]">
                <DialogHeader>
                  <DialogTitle className="font-headline">Create New List</DialogTitle>
                  <DialogDescription>
                    Give your list a name. You can always rename it later.
                  </DialogDescription>
                </DialogHeader>
                <Input
                  placeholder="e.g., Horror Movies, Date Night..."
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  className={retroInputClass}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateList()}
                />
                <DialogFooter>
                  <Button
                    onClick={handleCreateList}
                    disabled={!newListName.trim() || isSubmitting}
                    className={`${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold`}
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" /> : 'Create List'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {isLoadingLists ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2].map((i) => (
                <div key={i} className="h-24 bg-secondary rounded-2xl border-[3px] border-border animate-pulse" />
              ))}
            </div>
          ) : lists && lists.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {lists.map((list) => (
                <FolderCard
                  key={list.id}
                  onClick={(e) => handleCardClick(list.id, e)}
                >
                  <FolderCardContent className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <List className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      <span className="font-bold truncate">{list.name}</span>
                      {list.isDefault && (
                        <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full flex-shrink-0">
                          Default
                        </span>
                      )}
                      {list.isPublic && (
                        <span className="text-xs bg-success text-success-foreground px-2 py-0.5 rounded-full flex-shrink-0">
                          Public
                        </span>
                      )}
                    </div>
                    <DropdownMenu
                      open={openDropdownId === list.id}
                      onOpenChange={(open) => handleDropdownOpenChange(list.id, open)}
                    >
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 flex-shrink-0"
                          onClick={(e) => e.stopPropagation()}
                          onTouchEnd={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="border-[2px] border-border rounded-xl">
                        <DropdownMenuItem onSelect={() => scheduleRename(list)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => handleToggleVisibility(list)}>
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
                        {!list.isDefault && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => scheduleDelete(list)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </FolderCardContent>
                </FolderCard>
              ))}
            </div>
          ) : (
            <Card className="border-[3px] border-dashed border-border rounded-2xl bg-card">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <List className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="font-headline text-xl font-bold mb-2">No lists yet</h3>
                <p className="text-muted-foreground mb-4">Create your first watchlist to get started.</p>
                <Button onClick={() => setIsCreateOpen(true)} className={`${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold`}>
                  <Plus className="h-5 w-5 mr-2" />
                  Create List
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Collaborative Lists Section */}
          {(isLoadingCollaborative || collaborativeLists.length > 0) && (
            <div className="mt-12">
              <div className="flex items-center gap-2 mb-6">
                <Users className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-headline font-bold">Shared Lists</h2>
              </div>
              {isLoadingCollaborative ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-24 bg-secondary rounded-2xl border-[3px] border-border animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {collaborativeLists.map((list) => (
                    <FolderCard
                      key={`collab-${list.id}`}
                      onClick={() => router.push(`/lists/${list.id}?owner=${list.ownerId}`)}
                    >
                      <FolderCardContent className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Users className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="font-bold truncate block">{list.name}</span>
                            <span className="text-xs text-muted-foreground">
                              by {list.ownerDisplayName || list.ownerUsername || 'Unknown'}
                            </span>
                          </div>
                        </div>
                      </FolderCardContent>
                    </FolderCard>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rename Dialog */}
        <Dialog open={isRenameOpen} onOpenChange={(open) => {
          setIsRenameOpen(open);
          if (!open) {
            setSelectedList(null);
            setNewListName('');
          }
        }}>
          <DialogContent className="border-[3px] border-border rounded-2xl shadow-[8px_8px_0px_0px_hsl(var(--border))]">
            <DialogHeader>
              <DialogTitle className="font-headline">Rename List</DialogTitle>
              <DialogDescription>Enter a new name for this list.</DialogDescription>
            </DialogHeader>
            <Input
              placeholder="New list name"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              className={retroInputClass}
              onKeyDown={(e) => e.key === 'Enter' && handleRenameList()}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsRenameOpen(false)} className="rounded-full">Cancel</Button>
              <Button
                onClick={handleRenameList}
                disabled={!newListName.trim() || isSubmitting}
                className={`${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold`}
              >
                {isSubmitting ? <Loader2 className="animate-spin" /> : 'Rename'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={isDeleteOpen} onOpenChange={(open) => {
          setIsDeleteOpen(open);
          if (!open) {
            setSelectedList(null);
          }
        }}>
          <AlertDialogContent className="border-[3px] border-border rounded-2xl shadow-[8px_8px_0px_0px_hsl(var(--border))]">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-headline">Delete List</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{selectedList?.name}&quot;? This will remove all movies in the list. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteList}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="animate-spin" /> : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <BottomNav />
    </main>
  );
}
