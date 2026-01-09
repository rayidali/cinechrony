'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  X,
  Camera,
  Plus,
  Trash2,
  Loader2,
  Crown,
  UserMinus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
import { ProfileAvatar } from '@/components/profile-avatar';
import { InviteCollaboratorModal } from '@/components/invite-collaborator-modal';
import { useToast } from '@/hooks/use-toast';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import {
  renameList,
  updateListVisibility,
  uploadListCover,
  deleteList,
  getListMembers,
  removeCollaborator,
} from '@/app/actions';
import type { MovieList, ListMember } from '@/lib/types';

export default function ListSettingsPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listId = params.listId as string;
  const firestore = useFirestore();

  // Get list data
  const listDocRef = useMemoFirebase(() => {
    if (!user || !listId) return null;
    return doc(firestore, 'users', user.uid, 'lists', listId);
  }, [firestore, user, listId]);

  const { data: listData, isLoading: isLoadingList } = useDoc<MovieList>(listDocRef);

  // State
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [members, setMembers] = useState<ListMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<ListMember | null>(null);
  const [isRemoveOpen, setIsRemoveOpen] = useState(false);

  // Initialize form when list data loads
  useEffect(() => {
    if (listData) {
      setName(listData.name);
      setIsPublic(listData.isPublic);
      setCoverPreview(listData.coverImageUrl || null);
    }
  }, [listData]);

  // Load members
  useEffect(() => {
    async function loadMembers() {
      if (!user || !listId) return;

      setIsLoadingMembers(true);
      try {
        const result = await getListMembers(user.uid, listId);
        setMembers(result.members || []);
      } catch (error) {
        console.error('Failed to load members:', error);
      } finally {
        setIsLoadingMembers(false);
      }
    }

    loadMembers();
  }, [user, listId]);

  // Redirect if not authenticated or not owner
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  const hasChanges = listData && (
    name !== listData.name ||
    isPublic !== listData.isPublic ||
    coverFile !== null
  );

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'Invalid file', description: 'Please select an image file.' });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ variant: 'destructive', title: 'File too large', description: 'Please select an image under 10MB.' });
      return;
    }

    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
    });
  };

  const handleSave = async () => {
    if (!user || !listData) return;

    setIsSaving(true);
    try {
      if (coverFile) {
        const base64Data = await fileToBase64(coverFile);
        const coverResult = await uploadListCover(user.uid, listId, base64Data, coverFile.name, coverFile.type);
        if (coverResult.error) {
          toast({ variant: 'destructive', title: 'Error', description: coverResult.error });
          setIsSaving(false);
          return;
        }
      }

      if (name !== listData.name) {
        const nameResult = await renameList(user.uid, user.uid, listId, name);
        if (nameResult.error) {
          toast({ variant: 'destructive', title: 'Error', description: nameResult.error });
          setIsSaving(false);
          return;
        }
      }

      if (isPublic !== listData.isPublic) {
        const visibilityResult = await updateListVisibility(user.uid, user.uid, listId, isPublic);
        if (visibilityResult.error) {
          toast({ variant: 'destructive', title: 'Error', description: visibilityResult.error });
          setIsSaving(false);
          return;
        }
      }

      toast({ title: 'Settings saved', description: 'List settings have been updated.' });
      setCoverFile(null);
      router.refresh();
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save settings.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!user) return;

    setIsDeleting(true);
    try {
      const result = await deleteList(user.uid, user.uid, listId);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'List deleted', description: 'The list has been permanently deleted.' });
        router.push('/lists');
      }
    } catch (error) {
      console.error('Failed to delete list:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete list.' });
    } finally {
      setIsDeleting(false);
      setIsDeleteOpen(false);
    }
  };

  const handleRemoveCollaborator = async () => {
    if (!user || !memberToRemove) return;

    try {
      const result = await removeCollaborator(user.uid, listId, memberToRemove.uid);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'Collaborator removed', description: `@${memberToRemove.username} has been removed.` });
        setMembers(prev => prev.filter(m => m.uid !== memberToRemove.uid));
      }
    } catch (error) {
      console.error('Failed to remove:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to remove collaborator' });
    } finally {
      setIsRemoveOpen(false);
      setMemberToRemove(null);
    }
  };

  const handleMembersUpdate = (updatedMembers: ListMember[]) => {
    setMembers(updatedMembers);
  };

  // Show loading spinner while user or list is loading
  if (isUserLoading || isLoadingList) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  // Show not found only after loading completes
  if (!listData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">List not found</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Header with X button */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="flex items-center justify-between p-4">
          <div className="w-10" />
          <h1 className="text-lg font-semibold">List Settings</h1>
          <button
            onClick={() => router.back()}
            className="p-2 -mr-2 rounded-full hover:bg-secondary transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>

      <div className="p-4 pb-32 space-y-6 max-w-lg mx-auto">
        {/* Cover + Name */}
        <div className="flex gap-4 items-start">
          {/* Cover Image */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="relative w-28 h-28 rounded-xl border-2 border-border bg-secondary flex items-center justify-center cursor-pointer hover:bg-secondary/70 transition-colors overflow-hidden flex-shrink-0"
          >
            {coverPreview ? (
              <>
                <Image src={coverPreview} alt="Cover" fill className="object-cover" />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Camera className="h-6 w-6 text-white" />
                </div>
              </>
            ) : (
              <Camera className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleCoverSelect}
            className="hidden"
          />

          {/* Name Input */}
          <div className="flex-1 pt-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="List name..."
              className="text-2xl font-bold border-none bg-transparent p-0 h-auto focus-visible:ring-0"
              style={{ fontSize: '24px' }}
              maxLength={50}
            />
            <p className="text-sm text-muted-foreground mt-1">describe this list...</p>
          </div>
        </div>

        {/* Collaborators Section */}
        <div className="bg-secondary/50 rounded-2xl p-4 space-y-4">
          <h3 className="font-semibold text-sm">Collaborators</h3>

          {isLoadingMembers ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              {members.map((member) => (
                <div key={member.uid} className="flex items-center justify-between">
                  <Link
                    href={`/profile/${member.username}`}
                    className="flex items-center gap-3 flex-1 hover:opacity-80 transition-opacity"
                  >
                    <ProfileAvatar
                      photoURL={member.photoURL}
                      displayName={member.displayName}
                      username={member.username}
                      size="md"
                    />
                    <div>
                      <p className="font-medium">
                        {member.uid === user?.uid ? 'You' : member.displayName || member.username}
                      </p>
                      <p className="text-sm text-muted-foreground">@{member.username}</p>
                    </div>
                  </Link>

                  {member.role === 'owner' ? (
                    <span className="text-sm text-muted-foreground">Owner</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => {
                        setMemberToRemove(member);
                        setIsRemoveOpen(true);
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add Collaborators Button */}
          <Button
            onClick={() => setIsInviteOpen(true)}
            className="w-full h-12 rounded-full border-[3px] border-border bg-primary text-primary-foreground font-semibold shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all"
          >
            <Plus className="h-5 w-5 mr-2" />
            Add Collaborators
          </Button>
        </div>

        {/* Visibility Toggle */}
        <div className="bg-secondary/50 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{isPublic ? 'Public List' : 'Private List'}</p>
              <p className="text-sm text-muted-foreground">
                {isPublic ? 'Visible to everyone' : 'Only you and collaborators can see'}
              </p>
            </div>
            <Switch
              checked={isPublic}
              onCheckedChange={setIsPublic}
            />
          </div>
        </div>

        {/* Delete Button */}
        {listData && !listData.isDefault && (
          <button
            onClick={() => setIsDeleteOpen(true)}
            className="w-full flex items-center justify-center gap-2 text-destructive py-3 hover:bg-destructive/10 rounded-xl transition-colors"
          >
            <Trash2 className="h-5 w-5" />
            <span className="font-medium">delete this list</span>
          </button>
        )}
      </div>

      {/* Fixed Save Button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        <Button
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
          className="w-full h-14 text-lg font-semibold rounded-full bg-foreground text-background hover:bg-foreground/90"
          size="lg"
        >
          {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'save'}
        </Button>
      </div>

      {/* Invite Modal */}
      <InviteCollaboratorModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        listId={listId}
        listOwnerId={user?.uid || ''}
        listName={listData?.name || ''}
        members={members}
        onMembersUpdate={handleMembersUpdate}
      />

      {/* Remove Collaborator Confirmation */}
      <AlertDialog open={isRemoveOpen} onOpenChange={setIsRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Collaborator</AlertDialogTitle>
            <AlertDialogDescription>
              Remove @{memberToRemove?.username} from this list?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveCollaborator}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete List</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{listData?.name}&quot;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
