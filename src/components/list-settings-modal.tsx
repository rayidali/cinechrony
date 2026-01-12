'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Drawer } from 'vaul';
import {
  X,
  Pencil,
  ImageIcon,
  Globe,
  Lock,
  Trash2,
  Loader2,
  Check,
  Camera,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { FullscreenTextInput } from './fullscreen-text-input';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase';
import { renameList, updateListVisibility, uploadListCover, deleteList } from '@/app/actions';
import type { MovieList } from '@/lib/types';

interface ListSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  listId: string;
  listOwnerId: string;
  listData: MovieList;
}

export function ListSettingsModal({
  isOpen,
  onClose,
  listId,
  listOwnerId,
  listData,
}: ListSettingsModalProps) {
  const { user } = useUser();
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(listData.name);
  const [isPublic, setIsPublic] = useState(listData.isPublic);
  const [coverPreview, setCoverPreview] = useState<string | null>(listData.coverImageUrl || null);
  const [coverFile, setCoverFile] = useState<File | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showNameEditor, setShowNameEditor] = useState(false);

  // Reset name editor when modal closes
  useEffect(() => {
    if (!isOpen) {
      setShowNameEditor(false);
    }
  }, [isOpen]);

  const hasChanges = name !== listData.name || isPublic !== listData.isPublic || coverFile !== null;

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'Invalid file', description: 'Please select an image file.' });
      return;
    }

    // Validate file size (max 10MB)
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
    if (!user) return;

    setIsSaving(true);
    try {
      // Upload cover if changed
      if (coverFile) {
        const base64Data = await fileToBase64(coverFile);
        const coverResult = await uploadListCover(
          listOwnerId,
          listId,
          base64Data,
          coverFile.name,
          coverFile.type
        );
        if (coverResult.error) {
          toast({ variant: 'destructive', title: 'Error', description: coverResult.error });
          setIsSaving(false);
          return;
        }
      }

      // Update name if changed
      if (name !== listData.name) {
        const nameResult = await renameList(user.uid, listOwnerId, listId, name);
        if (nameResult.error) {
          toast({ variant: 'destructive', title: 'Error', description: nameResult.error });
          setIsSaving(false);
          return;
        }
      }

      // Update visibility if changed
      if (isPublic !== listData.isPublic) {
        const visibilityResult = await updateListVisibility(user.uid, listOwnerId, listId, isPublic);
        if (visibilityResult.error) {
          toast({ variant: 'destructive', title: 'Error', description: visibilityResult.error });
          setIsSaving(false);
          return;
        }
      }

      toast({ title: 'Settings saved', description: 'List settings have been updated.' });
      onClose();
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
      const result = await deleteList(user.uid, listOwnerId, listId);
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

  const handleSaveName = async (newName: string) => {
    setName(newName);
    // Don't actually save to server here - wait for the main Save button
  };

  return (
    <>
      <Drawer.Root
        open={isOpen && !showNameEditor}
        onOpenChange={(open) => !open && !showNameEditor && onClose()}
        modal={true}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50" />
          <Drawer.Content
            className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-background border-t border-border outline-none"
            style={{ height: '85vh', maxHeight: '85vh' }}
          >
            {/* Drag handle */}
            <div className="mx-auto mt-4 h-1.5 w-12 flex-shrink-0 rounded-full bg-muted-foreground/40" />

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
              <button
                onClick={onClose}
                className="p-2 -ml-2 rounded-full hover:bg-secondary transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
              <Drawer.Title className="text-lg font-semibold">List Settings</Drawer.Title>
              <div className="w-9" />
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-6">
              {/* Cover Image */}
              <div>
                <label className="text-sm font-medium mb-2 block">Cover Image</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="relative w-full h-40 rounded-xl border-2 border-dashed border-border bg-secondary/50 flex items-center justify-center cursor-pointer hover:bg-secondary/70 transition-colors overflow-hidden"
                >
                  {coverPreview ? (
                    <>
                      <Image
                        src={coverPreview}
                        alt="Cover preview"
                        fill
                        className="object-cover"
                      />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                        <Camera className="h-8 w-8 text-white" />
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center text-muted-foreground">
                      <ImageIcon className="h-10 w-10 mb-2" />
                      <span className="text-sm">Tap to add cover image</span>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleCoverSelect}
                  className="hidden"
                />
              </div>

              {/* List Name - Tap to open fullscreen editor */}
              <div>
                <label className="text-sm font-medium mb-2 block">List Name</label>
                <button
                  onClick={() => setShowNameEditor(true)}
                  className="w-full flex items-center justify-between px-3 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 active:bg-secondary transition-colors border border-border/50"
                >
                  <span className={name ? 'text-foreground' : 'text-muted-foreground'}>
                    {name || 'Enter list name...'}
                  </span>
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>

              {/* Visibility */}
              <div>
                <label className="text-sm font-medium mb-2 block">Visibility</label>
                <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-secondary/30">
                  <div className="flex items-center gap-3">
                    {isPublic ? (
                      <Globe className="h-5 w-5 text-green-600" />
                    ) : (
                      <Lock className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                      <p className="font-medium">{isPublic ? 'Public' : 'Private'}</p>
                      <p className="text-xs text-muted-foreground">
                        {isPublic
                          ? 'Anyone can view this list'
                          : 'Only you and collaborators can view'}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={isPublic}
                    onCheckedChange={setIsPublic}
                  />
                </div>
              </div>

              {/* Danger Zone */}
              {!listData.isDefault && (
                <div className="pt-4 border-t border-border">
                  <label className="text-sm font-medium mb-2 block text-destructive">Danger Zone</label>
                  <Button
                    variant="outline"
                    className="w-full border-destructive text-destructive hover:bg-destructive/10"
                    onClick={() => setIsDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete List
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    This will permanently delete the list and all its movies.
                  </p>
                </div>
              )}
            </div>

            {/* Save Button */}
            <div className="flex-shrink-0 p-4 border-t border-border bg-background pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
              <Button
                onClick={handleSave}
                disabled={isSaving || !hasChanges}
                className="w-full h-12 text-base font-semibold rounded-xl"
                size="lg"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-5 w-5 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Fullscreen Name Editor */}
      <FullscreenTextInput
        isOpen={isOpen && showNameEditor}
        onClose={() => setShowNameEditor(false)}
        onSave={handleSaveName}
        initialValue={name}
        title="List Name"
        placeholder="Enter list name..."
        maxLength={50}
        singleLine={true}
        inputType="text"
      />

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent className="border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete List</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{listData.name}&quot;? This action cannot be undone.
              All movies and collaborator connections will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
