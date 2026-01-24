'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2, Film, Users, ImageIcon, X } from 'lucide-react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { UserAvatar } from '@/components/user-avatar';
import { ThemeToggle } from '@/components/theme-toggle';
// TODO: Re-enable in Phase 3 (Notifications)
// import { NotificationBell } from '@/components/notification-bell';
import { BottomNav } from '@/components/bottom-nav';
import { ListCard } from '@/components/list-card';
import { collection, orderBy, query } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { createList, ensureUserProfile, migrateMoviesToList, getCollaborativeLists, getListsPreviews, getListPreview, uploadListCover, updateListCover } from '@/app/actions';
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

const retroInputClass = "border-[3px] border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] focus:border-primary transition-shadow duration-200 bg-card";
const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

export default function ListsPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [collaborativeLists, setCollaborativeLists] = useState<CollaborativeList[]>([]);
  const [isLoadingCollaborative, setIsLoadingCollaborative] = useState(false);
  const [listPreviews, setListPreviews] = useState<Record<string, ListPreview>>({});
  const [collabListPreviews, setCollabListPreviews] = useState<Record<string, ListPreview>>({});
  const [newListCoverPreview, setNewListCoverPreview] = useState<string | null>(null);
  const createCoverInputRef = useRef<HTMLInputElement>(null);

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

  // Compress image for create list cover
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        const maxWidth = 1200;
        const maxHeight = 1500;
        let { width, height } = img;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  };

  const handleCreateCoverSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const compressedDataUrl = await compressImage(file);
        setNewListCoverPreview(compressedDataUrl);
      } catch (error) {
        console.error('Failed to compress image:', error);
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to process image.' });
      }
    }
  };

  const handleCardClick = useCallback((listId: string, e: React.MouseEvent, ownerId?: string) => {
    if (ownerId) {
      router.push(`/lists/${listId}?owner=${ownerId}`);
    } else {
      router.push(`/lists/${listId}`);
    }
  }, [router]);

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
            <div className="flex items-center gap-2">
              {/* TODO: Re-enable in Phase 3 (Notifications) */}
              {/* <NotificationBell /> */}
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
                  />
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
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

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
        className="fixed bottom-24 md:bottom-8 right-4 md:right-8 z-50 h-12 px-5 rounded-full bg-yellow-400 text-black border-[3px] border-black dark:border-2 dark:border-border shadow-[4px_4px_0px_0px_#000] dark:shadow-none flex items-center justify-center gap-2 hover:shadow-[2px_2px_0px_0px_#000] hover:translate-x-0.5 hover:translate-y-0.5 active:shadow-none active:translate-x-1 active:translate-y-1 transition-all font-headline font-bold"
      >
        <Plus className="h-5 w-5" strokeWidth={3} />
        <span>New List</span>
      </button>

      <BottomNav />
    </main>
  );
}
