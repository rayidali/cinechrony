'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Film, Plus, Loader2, List, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { UserAvatar } from '@/components/user-avatar';
import { collection, orderBy, query } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { createList, renameList, deleteList, ensureUserProfile, migrateMoviesToList } from '@/app/actions';
import type { MovieList } from '@/lib/types';

const retroInputClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] focus:shadow-[2px_2px_0px_0px_#000] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200";
const retroButtonClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

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
      const result = await renameList(user.uid, selectedList.id, newListName);
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
      const result = await deleteList(user.uid, selectedList.id);
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

  const openRenameDialog = (list: MovieList) => {
    setSelectedList(list);
    setNewListName(list.name);
    setIsRenameOpen(true);
  };

  const openDeleteDialog = (list: MovieList) => {
    setSelectedList(list);
    setIsDeleteOpen(true);
  };

  if (isUserLoading || !user || isInitializing) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background font-body text-foreground">
      <div className="container mx-auto p-4 md:p-8">
        <header className="mb-12">
          <div className="w-full flex justify-end mb-4">
            <UserAvatar />
          </div>
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-4 mb-6">
              <Film className="h-10 w-10 md:h-12 md:w-12 text-primary" />
              <h1 className="text-4xl md:text-6xl font-headline font-bold text-center tracking-tighter">
                MovieNight
              </h1>
            </div>
            <p className="max-w-2xl text-center text-muted-foreground mb-8">
              Your movie watchlists. Create lists for different moods, genres, or watch parties.
            </p>
          </div>
        </header>

        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-headline font-bold">My Lists</h2>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className={retroButtonClass}>
                  <Plus className="h-5 w-5 mr-2" />
                  New List
                </Button>
              </DialogTrigger>
              <DialogContent className="border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
                <DialogHeader>
                  <DialogTitle>Create New List</DialogTitle>
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
                    className={retroButtonClass}
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" /> : 'Create List'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {isLoadingLists ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <div key={i} className="h-32 bg-secondary rounded-lg border-[3px] border-black animate-pulse" />
              ))}
            </div>
          ) : lists && lists.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {lists.map((list) => (
                <Card
                  key={list.id}
                  className="border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] hover:shadow-[2px_2px_0px_0px_#000] hover:translate-x-0.5 hover:translate-y-0.5 transition-all duration-200 cursor-pointer group"
                >
                  <Link href={`/lists/${list.id}`} className="block">
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
                          <DropdownMenuTrigger asChild onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="border-[2px] border-black">
                            <DropdownMenuItem onSelect={() => openRenameDialog(list)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Rename
                            </DropdownMenuItem>
                            {!list.isDefault && (
                              <DropdownMenuItem
                                onSelect={() => openDeleteDialog(list)}
                                className="text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>
                        Click to view and manage movies
                      </CardDescription>
                    </CardContent>
                  </Link>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="border-[3px] border-dashed border-black rounded-lg bg-secondary">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <List className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="font-headline text-xl font-bold mb-2">No lists yet</h3>
                <p className="text-muted-foreground mb-4">Create your first watchlist to get started.</p>
                <Button onClick={() => setIsCreateOpen(true)} className={retroButtonClass}>
                  <Plus className="h-5 w-5 mr-2" />
                  Create List
                </Button>
              </CardContent>
            </Card>
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
          <DialogContent className="border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
            <DialogHeader>
              <DialogTitle>Rename List</DialogTitle>
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
              <Button variant="outline" onClick={() => setIsRenameOpen(false)}>Cancel</Button>
              <Button
                onClick={handleRenameList}
                disabled={!newListName.trim() || isSubmitting}
                className={retroButtonClass}
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
          <AlertDialogContent className="border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete List</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{selectedList?.name}&quot;? This will remove all movies in the list. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteList}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="animate-spin" /> : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </main>
  );
}
