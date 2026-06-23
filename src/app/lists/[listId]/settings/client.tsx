'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  ChevronLeft,
  Camera,
  Plus,
  Trash2,
  Loader2,
  LogOut,
} from 'lucide-react';
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
import { Frost } from '@/components/v3/frost';
import { CtaButton } from '@/components/v3/onboarding-kit';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { useListMembersCache } from '@/contexts/list-members-cache';
import { doc } from 'firebase/firestore';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { invalidateCachedAction } from '@/lib/use-cached-action';
import type { MovieList, ListMember } from '@/lib/types';
import { processImage, fileToBase64, isImageFile } from '@/lib/image-utils';

export default function ListSettingsPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listId = params.listId as string;
  const firestore = useFirestore();
  const { getMembers: getCachedMembers, setMembers: cacheMembers, invalidate: invalidateCache } = useListMembersCache();

  // Determine if viewing own list or collaborative list
  const ownerFromParams = searchParams.get('owner');
  const effectiveOwnerId = ownerFromParams || user?.uid;
  const isOwner = !ownerFromParams || ownerFromParams === user?.uid;

  // Get list data from the correct owner's path
  const listDocRef = useMemoFirebase(() => {
    if (!effectiveOwnerId || !listId) return null;
    return doc(firestore, 'users', effectiveOwnerId, 'lists', listId);
  }, [firestore, effectiveOwnerId, listId]);

  const { data: listData, isLoading: isLoadingList } = useDoc<MovieList>(listDocRef);

  // State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [members, setMembers] = useState<ListMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);

  const [isSaving, setIsSaving] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<ListMember | null>(null);
  const [isRemoveOpen, setIsRemoveOpen] = useState(false);
  const [isLeaveOpen, setIsLeaveOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  // Initialize form when list data loads
  useEffect(() => {
    if (listData) {
      setName(listData.name);
      setDescription(listData.description || '');
      setIsPublic(listData.isPublic);
      setCoverPreview(listData.coverImageUrl || null);
    }
  }, [listData]);

  // Track collaboratorIds to detect changes (for real-time updates when someone accepts an invite)
  const collaboratorIdsRef = useRef<string[] | undefined>(listData?.collaboratorIds);
  const collaboratorIdsKey = listData?.collaboratorIds?.sort().join(',') || '';

  // Load members (check cache first for instant display, but refetch if collaboratorIds changed)
  useEffect(() => {
    async function loadMembers() {
      if (!effectiveOwnerId || !listId) return;

      // Check if collaboratorIds changed (someone joined/left)
      const prevIds = collaboratorIdsRef.current?.sort().join(',') || '';
      const currentIds = listData?.collaboratorIds?.sort().join(',') || '';
      const collaboratorIdsChanged = prevIds !== currentIds;

      if (collaboratorIdsChanged) {
        // Invalidate cache when members change
        invalidateCache(effectiveOwnerId, listId);
        collaboratorIdsRef.current = listData?.collaboratorIds;
      }

      // Check cache first - if cached and collaboratorIds didn't change, show instantly
      if (!collaboratorIdsChanged) {
        const cachedMembers = getCachedMembers(effectiveOwnerId, listId);
        if (cachedMembers) {
          setMembers(cachedMembers);
          setIsLoadingMembers(false);
          return;
        }
      }

      // Not cached or collaboratorIds changed, fetch from server
      setIsLoadingMembers(true);
      try {
        const result = await apiCall<{ members: ListMember[] }>(
          'GET', `/api/v1/lists/${effectiveOwnerId}/${listId}/members`,
        );
        const loadedMembers = result.members || [];
        setMembers(loadedMembers);
        cacheMembers(effectiveOwnerId, listId, loadedMembers);
      } catch (error) {
        console.error('Failed to load members:', error);
      } finally {
        setIsLoadingMembers(false);
      }
    }

    loadMembers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveOwnerId, listId, collaboratorIdsKey, getCachedMembers, cacheMembers, invalidateCache]);

  // Redirect if not authenticated or not owner
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  const hasChanges = listData && (
    name !== listData.name ||
    description !== (listData.description || '') ||
    isPublic !== listData.isPublic ||
    coverFile !== null
  );

  const handleCoverSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate it's an image (checks both MIME type and extension for iOS compatibility)
    if (!isImageFile(file)) {
      toast({ variant: 'destructive', title: 'Invalid file', description: 'Please select an image file.' });
      return;
    }

    // Check raw file size before processing (generous limit since we'll compress)
    if (file.size > 50 * 1024 * 1024) {
      toast({ variant: 'destructive', title: 'File too large', description: 'Please select an image under 50MB.' });
      return;
    }

    // Process the image: convert HEIC to JPEG, resize, and compress
    setIsProcessingImage(true);
    try {
      const processed = await processImage(file, {
        maxWidth: 1200,
        maxHeight: 1200,
        quality: 0.85,
        outputType: 'image/jpeg',
      });

      setCoverFile(processed.file);
      setCoverPreview(processed.previewUrl);

      // Show success for large files that got compressed significantly
      if (file.size > 5 * 1024 * 1024) {
        const originalMB = (file.size / (1024 * 1024)).toFixed(1);
        const newMB = (processed.file.size / (1024 * 1024)).toFixed(1);
        toast({
          title: 'Image optimized',
          description: `Compressed from ${originalMB}MB to ${newMB}MB`,
        });
      }
    } catch (error) {
      console.error('Failed to process image:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to process image',
        description: error instanceof Error ? error.message : 'Please try a different image.',
      });
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleSave = async () => {
    if (!user || !listData || !effectiveOwnerId) return;

    setIsSaving(true);
    try {
      // Cover upload first (owner-or-collaborator can do this).
      if (coverFile) {
        const base64Data = await fileToBase64(coverFile);
        await apiCall(
          'POST',
          `/api/v1/lists/${effectiveOwnerId}/${listId}/cover`,
          { base64: base64Data, fileName: coverFile.name, mimeType: coverFile.type },
        );
      }

      // Collapse rename + description + visibility into one owner-only PATCH.
      // Only include fields that actually changed; if none changed, skip the
      // PATCH entirely (the route would 400 on empty body).
      const fieldUpdates: Record<string, unknown> = {};
      if (name !== listData.name) fieldUpdates.name = name;
      if (description !== (listData.description || '')) fieldUpdates.description = description;
      if (isOwner && isPublic !== listData.isPublic) fieldUpdates.isPublic = isPublic;

      if (Object.keys(fieldUpdates).length > 0) {
        await apiCall(
          'PATCH',
          `/api/v1/lists/${effectiveOwnerId}/${listId}`,
          fieldUpdates,
        );
      }

      toast({ title: 'Settings saved', description: 'List settings have been updated.' });
      setCoverFile(null);
      router.refresh();
    } catch (error) {
      console.error('Failed to save settings:', error);
      const message = error instanceof ApiClientError ? error.message : 'Failed to save settings.';
      toast({ variant: 'destructive', title: 'Error', description: message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    // Only owners can delete
    if (!user || !isOwner || !effectiveOwnerId) return;

    setIsDeleting(true);
    try {
      await apiCall('DELETE', `/api/v1/lists/${effectiveOwnerId}/${listId}`);
      toast({ title: 'List deleted', description: 'The list has been permanently deleted.' });
      router.push('/lists');
    } catch (error) {
      console.error('Failed to delete list:', error);
      const message = error instanceof ApiClientError ? error.message : 'Failed to delete list.';
      toast({ variant: 'destructive', title: 'Error', description: message });
    } finally {
      setIsDeleting(false);
      setIsDeleteOpen(false);
    }
  };

  const handleRemoveCollaborator = async () => {
    // Only owners can remove collaborators
    if (!user || !memberToRemove || !isOwner || !effectiveOwnerId) return;

    try {
      await apiCall(
        'DELETE',
        `/api/v1/lists/${effectiveOwnerId}/${listId}/collaborators/${memberToRemove.uid}`,
      );
      toast({ title: 'Collaborator removed', description: `@${memberToRemove.username} has been removed.` });
      setMembers(prev => prev.filter(m => m.uid !== memberToRemove.uid));
    } catch (error) {
      console.error('Failed to remove:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof ApiClientError ? error.message : 'Failed to remove collaborator',
      });
    } finally {
      setIsRemoveOpen(false);
      setMemberToRemove(null);
    }
  };

  const handleMembersUpdate = (updatedMembers: ListMember[]) => {
    setMembers(updatedMembers);
  };

  // Collaborator leaves the list — only callable when !isOwner.
  // Owners cannot leave their own list (server rejects with 400); the
  // button is gated client-side so this is defense-in-depth.
  const handleLeave = async () => {
    if (!user || !effectiveOwnerId || isOwner) return;

    setIsLeaving(true);
    try {
      await apiCall(
        'POST',
        `/api/v1/lists/${effectiveOwnerId}/${listId}/leave`,
      );
      toast({
        title: 'Left list',
        description: `You are no longer a collaborator on "${listData?.name ?? 'this list'}".`,
      });
      // The /lists page reads this user's collaborative lists via a cached
      // action; invalidate so the next mount fetches fresh data without
      // the list we just left.
      invalidateCachedAction(`collab-lists:${user.uid}`);
      // Members cache for THIS list is now stale too — the membership we
      // had is gone.
      invalidateCache(effectiveOwnerId, listId);
      // Navigate away — we no longer have edit access to this list's
      // settings page (its useDoc subscription will continue returning
      // data but the route gate that brought us here is gone).
      router.push('/lists');
    } catch (error) {
      console.error('Failed to leave list:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof ApiClientError ? error.message : 'Failed to leave list.',
      });
    } finally {
      setIsLeaving(false);
      setIsLeaveOpen(false);
    }
  };

  // Show loading spinner while user or list is loading
  if (isUserLoading || isLoadingList) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-pulse" />
      </div>
    );
  }

  // Show not found only after loading completes
  if (!listData) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <p className="font-ui text-[15px] text-muted-foreground">list not found</p>
      </div>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      {/* sticky frosted header */}
      <Frost className="sticky top-0 z-40 border-b border-hair" tint="var(--cc-chrome)">
        <div className="px-4 pt-safe">
          <div className="flex items-center gap-2 py-2.5">
            <button
              onClick={() => { haptic('light'); router.back(); }}
              aria-label="back"
              className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-opacity active:opacity-60"
            >
              <ChevronLeft className="h-[22px] w-[22px]" />
            </button>
            <h1
              className="font-headline text-[22px] font-bold lowercase tracking-[-0.02em]"
              style={{ fontVariationSettings: '"wdth" 95' }}
            >
              list settings
            </h1>
          </div>
        </div>
      </Frost>

      <div className="mx-auto max-w-lg space-y-7 px-5 pb-36 pt-6">
        {/* Cover + Name */}
        <div className="flex items-start gap-4">
          {/* Cover Image */}
          <button
            type="button"
            onClick={() => !isProcessingImage && fileInputRef.current?.click()}
            disabled={isProcessingImage}
            aria-label="Change cover image"
            className="relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-[16px] border border-hair bg-sunken transition-colors active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
          >
            {isProcessingImage ? (
              <div className="flex flex-col items-center gap-1">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="font-mono text-[10px] text-muted-foreground">processing…</span>
              </div>
            ) : coverPreview ? (
              <>
                <Image src={coverPreview} alt="Cover" fill className="object-cover" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Camera className="h-6 w-6 text-white" />
                </div>
              </>
            ) : (
              <Camera className="h-8 w-8 text-muted-foreground" />
            )}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleCoverSelect} className="hidden" />

          {/* Name + Description Input */}
          <div className="flex-1 pt-1">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="list name…"
              className="w-full bg-transparent font-headline text-[24px] font-bold tracking-[-0.01em] text-foreground outline-none placeholder:text-muted-foreground/40"
              style={{ fontSize: '24px' }}
              maxLength={50}
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="describe this list…"
              className="mt-2 w-full resize-none border-none bg-transparent p-0 font-serif text-muted-foreground outline-none placeholder:text-muted-foreground/50 focus:text-foreground"
              style={{ fontSize: '16px' }}
              rows={2}
              maxLength={200}
            />
          </div>
        </div>

        {/* Collaborators */}
        <div className="rounded-[18px] border border-hair bg-card p-4">
          <h3 className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            collaborators
          </h3>

          {isLoadingMembers ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              {members.map((member) => (
                <div key={member.uid} className="flex items-center justify-between">
                  <Link href={`/profile/${member.username}`} className="flex flex-1 items-center gap-3 transition-opacity active:opacity-70">
                    <ProfileAvatar photoURL={member.photoURL} displayName={member.displayName} username={member.username} size="md" />
                    <div className="min-w-0">
                      <p className="truncate font-ui text-[15px] font-semibold text-foreground">
                        {member.uid === user?.uid ? 'you' : member.displayName || member.username}
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">@{member.username}</p>
                    </div>
                  </Link>

                  {member.role === 'owner' ? (
                    <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">owner</span>
                  ) : isOwner ? (
                    <button
                      onClick={() => { setMemberToRemove(member); setIsRemoveOpen(true); }}
                      className="rounded-full border border-destructive/30 px-3.5 py-1.5 font-ui text-[13px] font-semibold text-destructive transition-all active:scale-[0.97]"
                    >
                      remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {/* Add Collaborators */}
          <button
            onClick={() => { haptic('light'); setIsInviteOpen(true); }}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-ui text-[15px] font-semibold text-primary-foreground shadow-fab transition-all active:scale-[0.98]"
          >
            <Plus className="h-5 w-5" />
            add collaborators
          </button>
        </div>

        {/* Visibility - Owner only */}
        {isOwner && (
          <div className="flex items-center justify-between gap-3 rounded-[18px] border border-hair bg-card p-4">
            <div>
              <p className="font-ui text-[15px] font-semibold lowercase text-foreground">
                {isPublic ? 'public list' : 'private list'}
              </p>
              <p className="font-ui text-[12px] text-muted-foreground">
                {isPublic ? 'visible to everyone' : 'only you and collaborators can see'}
              </p>
            </div>
            <button
              onClick={() => { haptic('selection'); setIsPublic((v) => !v); }}
              role="switch"
              aria-checked={isPublic}
              className={cn('relative h-[30px] w-[50px] shrink-0 rounded-full border-0 p-0 transition-colors', isPublic ? 'bg-primary' : 'bg-foreground/15')}
            >
              <span className={cn('absolute top-[3px] left-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform duration-200', isPublic ? 'translate-x-[20px]' : 'translate-x-0')} />
            </button>
          </div>
        )}

        {/* Delete - Owner only */}
        {isOwner && listData && !listData.isDefault && (
          <button
            onClick={() => { haptic('warning'); setIsDeleteOpen(true); }}
            className="flex w-full items-center justify-center gap-2 rounded-[14px] py-3 font-ui text-[15px] font-semibold text-destructive transition-colors active:bg-destructive/10"
          >
            <Trash2 className="h-5 w-5" />
            delete this list
          </button>
        )}

        {/* Leave - Collaborator only */}
        {!isOwner && listData && (
          <button
            onClick={() => { haptic('warning'); setIsLeaveOpen(true); }}
            className="flex w-full items-center justify-center gap-2 rounded-[14px] py-3 font-ui text-[15px] font-semibold text-destructive transition-colors active:bg-destructive/10"
          >
            <LogOut className="h-5 w-5" />
            leave this list
          </button>
        )}
      </div>

      {/* Fixed Save Button */}
      <div className="fixed inset-x-0 bottom-0 border-t border-hair bg-background/95 px-5 pt-3 backdrop-blur-xl pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <CtaButton
          label={isProcessingImage ? 'processing…' : 'save'}
          onClick={handleSave}
          disabled={isSaving || isProcessingImage || !hasChanges}
          loading={isSaving}
        />
      </div>

      {/* Invite Modal */}
      <InviteCollaboratorModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        listId={listId}
        listOwnerId={effectiveOwnerId || ''}
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

      {/* Leave Confirmation (collaborator-only) */}
      <AlertDialog open={isLeaveOpen} onOpenChange={(open) => !isLeaving && setIsLeaveOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave List</AlertDialogTitle>
            <AlertDialogDescription>
              Leave &quot;{listData?.name}&quot;? You&apos;ll lose access to the list and will need a new invite to rejoin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLeaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeave}
              disabled={isLeaving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLeaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Leave'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
