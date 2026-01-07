'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2, MoreVertical, Pencil, Trash2, Eye, EyeOff, Film, Users, ImageIcon, X } from 'lucide-react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { UserAvatar } from '@/components/user-avatar';
import { ThemeToggle } from '@/components/theme-toggle';
import { BottomNav } from '@/components/bottom-nav';
import { ListCard } from '@/components/list-card';
import { CoverPicker } from '@/components/cover-picker';
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
import { createList, renameList, deleteList, ensureUserProfile, migrateMoviesToList, toggleListVisibility, getCollaborativeLists, getListsPreviews, getListPreview, uploadListCover, updateListCover } from '@/app/actions';
import type { MovieList } from '@/lib/types';

// Preview data for list cards
type ListPreview = {
  previewPosters: string[];
  movieCount: number;
};

// Extended type for collaborative lists with owner info
type CollaborativeList = MovieList & {
  ownerUsername?: string;
  ownerDisplayName?: string;
};

const retroInputClass = "border-[3px] border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200 bg-card";
const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

// Pending action type for deferred dialog opening
type PendingAction = {
  type: 'rename' | 'delete' | 'cover';
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
  const [listPreviews, setListPreviews] = useState<Record<string, ListPreview>>({});
  const [collabListPreviews, setCollabListPreviews] = useState<Record<string, ListPreview>>({});
  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);
  const [newListCoverPreview, setNewListCoverPreview] = useState<string | null>(null);
  const createCoverInputRef = useRef<HTMLInputElement>(null);

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

  // Fetch list previews (posters and counts) when lists change
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

  // Fetch collaborative list previews when collaborative lists change
  useEffect(() => {
    async function fetchCollabPreviews() {
      if (collaborativeLists.length === 0) return;

      try {
        const previews: Record<string, ListPreview> = {};
        // Fetch previews in parallel - each list has its own owner
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
      } else if (type === 'cover') {
        setSelectedList(list);
        setIsCoverPickerOpen(true);
      }

      setPendingAction(null);
    }
  }, [pendingAction, openDropdownId]);

  const handleCreateList = async () => {
    // Prevent double submission
    if (!user || !newListName.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = await createList(user.uid, newListName);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
        return;
      }

      // If a cover image was selected, upload it
      if (newListCoverPreview && result.listId) {
        try {
          const base64Data = newListCoverPreview.split(',')[1];
          const mimeMatch = newListCoverPreview.match(/data:([^;]+);/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
          const ext = mimeType.split('/')[1] || 'jpg';

          const uploadResult = await uploadListCover(
            user.uid,
            result.listId,
            base64Data,
            `cover.${ext}`,
            mimeType
          );

          if (uploadResult.error) {
            console.error('Cover upload failed:', uploadResult.error);
            toast({ variant: 'destructive', title: 'Cover upload failed', description: 'List created but cover image could not be uploaded.' });
          } else if (uploadResult.url) {
            await updateListCover(user.uid, result.listId, uploadResult.url);
          }
        } catch (coverError) {
          console.error('Cover upload error:', coverError);
          toast({ variant: 'destructive', title: 'Cover upload failed', description: 'List created but cover image could not be uploaded.' });
        }
      }

      toast({ title: 'List Created', description: `"${newListName}" has been created.` });
      setNewListName('');
      setNewListCoverPreview(null);
      setIsCreateOpen(false);
      if (result.listId) {
        router.push(`/lists/${result.listId}`);
      }
    } catch (error) {
      console.error('Create list error:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to create list. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setNewListCoverPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
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

  const scheduleCover = useCallback((list: MovieList) => {
    setPendingAction({ type: 'cover', list });
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

  const handleCardClick = useCallback((listId: string, e: React.MouseEvent, ownerId?: string) => {
    if (openDropdownId !== null) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (ownerId) {
      router.push(`/lists/${listId}?owner=${ownerId}`);
    } else {
      router.push(`/lists/${listId}`);
    }
  }, [openDropdownId, router]);

  if (isUserLoading || !user || isInitializing) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
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
              <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Cinechrony" className="h-10 w-10" />
              <h1 className="text-2xl md:text-3xl font-headline font-bold">Cinechrony</h1>
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
          </div>

          {isLoadingLists ? (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="aspect-[4/5] bg-secondary rounded-2xl border-[3px] border-border animate-pulse" />
              ))}
            </div>
          ) : lists && lists.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {lists.map((list) => {
                const preview = listPreviews[list.id];
                return (
                  <ListCard
                    key={list.id}
                    list={{ ...list, movieCount: preview?.movieCount ?? 0 }}
                    previewPosters={preview?.previewPosters ?? []}
                    onClick={(e) => handleCardClick(list.id, e)}
                  >
                    <DropdownMenu
                      open={openDropdownId === list.id}
                      onOpenChange={(open) => handleDropdownOpenChange(list.id, open)}
                    >
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 flex-shrink-0 text-white hover:bg-white/20"
                          onClick={(e) => e.stopPropagation()}
                          onTouchEnd={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="border-[2px] border-border rounded-xl">
                        <DropdownMenuItem onSelect={() => scheduleCover(list)}>
                          <ImageIcon className="h-4 w-4 mr-2" />
                          Set Cover
                        </DropdownMenuItem>
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
                  </ListCard>
                );
              })}
            </div>
          ) : (
            <Card className="border-[3px] border-dashed border-border rounded-2xl bg-card">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Film className="h-12 w-12 text-muted-foreground mb-4" />
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
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2].map((i) => (
                    <div key={i} className="aspect-[4/5] bg-secondary rounded-2xl border-[3px] border-border animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {collaborativeLists.map((list) => {
                    const preview = collabListPreviews[list.id];
                    return (
                      <ListCard
                        key={`collab-${list.id}`}
                        list={{ ...list, movieCount: preview?.movieCount ?? 0 }}
                        previewPosters={preview?.previewPosters ?? []}
                        onClick={(e) => handleCardClick(list.id, e, list.ownerId)}
                        isCollaborative={true}
                        ownerName={list.ownerDisplayName || list.ownerUsername || 'Unknown'}
                      >
                        <DropdownMenu
                          open={openDropdownId === `collab-${list.id}`}
                          onOpenChange={(open) => handleDropdownOpenChange(`collab-${list.id}`, open)}
                        >
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 flex-shrink-0 text-white hover:bg-white/20"
                              onClick={(e) => e.stopPropagation()}
                              onTouchEnd={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="h-5 w-5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="border-[2px] border-border rounded-xl">
                            <DropdownMenuItem onSelect={() => scheduleCover(list)}>
                              <ImageIcon className="h-4 w-4 mr-2" />
                              Set Cover
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </ListCard>
                    );
                  })}
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
            listOwnerId={selectedList.ownerId}
            onCoverChange={() => {
              // Refresh list previews for own lists
              if (user && lists) {
                const listIds = lists.map((list) => list.id);
                getListsPreviews(user.uid, listIds).then((result) => {
                  if (result.previews) {
                    setListPreviews(result.previews);
                  }
                });
              }
              // Also refresh collaborative list previews
              if (collaborativeLists.length > 0) {
                const fetchCollabPreviews = async () => {
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
                };
                fetchCollabPreviews();
              }
            }}
          />
        )}

        {/* Create List Dialog */}
        <Dialog open={isCreateOpen} onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (!open) {
            setNewListCoverPreview(null);
            setNewListName('');
          }
        }}>
          <DialogContent className="border-[3px] border-border rounded-2xl shadow-[8px_8px_0px_0px_hsl(var(--border))]">
            <DialogHeader>
              <DialogTitle className="font-headline text-center">Create New List</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Cover image picker - clickable */}
              <input
                type="file"
                ref={createCoverInputRef}
                accept="image/*"
                className="hidden"
                onChange={handleCreateCoverSelect}
              />
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => createCoverInputRef.current?.click()}
                  className="relative w-32 aspect-[4/5] rounded-xl overflow-hidden bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center border-2 border-dashed border-white/50 transition-transform active:scale-95"
                >
                  {newListCoverPreview ? (
                    <>
                      <img src={newListCoverPreview} alt="Cover preview" className="absolute inset-0 w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNewListCoverPreview(null);
                        }}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center"
                      >
                        <X className="h-4 w-4 text-white" />
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <ImageIcon className="h-8 w-8 text-white/70" />
                      <span className="text-xs text-white/70">Add Cover</span>
                    </div>
                  )}
                </button>
              </div>
              <Input
                placeholder="e.g., Horror Movies, Date Night..."
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                className={`${retroInputClass} text-center`}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateList()}
                autoFocus
              />
            </div>
            <DialogFooter className="sm:justify-center">
              <Button
                onClick={handleCreateList}
                disabled={!newListName.trim() || isSubmitting}
                className={`${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold w-full`}
              >
                {isSubmitting ? <Loader2 className="animate-spin" /> : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Floating Action Button */}
      <button
        onClick={() => setIsCreateOpen(true)}
        className="fixed bottom-24 md:bottom-8 right-4 md:right-8 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform"
      >
        <Plus className="h-7 w-7" />
      </button>

      <BottomNav />
    </main>
  );
}
