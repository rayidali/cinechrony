'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import { Camera, Check, Loader2, Upload, X } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

import { DEFAULT_AVATARS } from '@/lib/avatars';
import { useUser, useStorage } from '@/firebase';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

type AvatarPickerProps = {
  isOpen: boolean;
  onClose: () => void;
  currentAvatarUrl: string | null;
  onAvatarChange: (url: string) => Promise<void>;
};

export function AvatarPicker({
  isOpen,
  onClose,
  currentAvatarUrl,
  onAvatarChange,
}: AvatarPickerProps) {
  const [selectedUrl, setSelectedUrl] = useState<string | null>(currentAvatarUrl);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useUser();
  const storage = useStorage();
  const { toast } = useToast();

  const handleSelectDefault = (url: string) => {
    setSelectedUrl(url);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        variant: 'destructive',
        title: 'Invalid file type',
        description: 'Please select an image file.',
      });
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'File too large',
        description: 'Please select an image under 2MB.',
      });
      return;
    }

    setIsUploading(true);

    try {
      // Upload to Firebase Storage
      const storageRef = ref(storage, `avatars/${user.uid}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      setSelectedUrl(downloadUrl);
      toast({
        title: 'Image uploaded',
        description: 'Click Save to use this as your profile picture.',
      });
    } catch (error) {
      console.error('Failed to upload image:', error);
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: 'Failed to upload image. Please try again.',
      });
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSave = async () => {
    if (!selectedUrl) return;

    setIsSaving(true);
    try {
      await onAvatarChange(selectedUrl);
      toast({
        title: 'Profile picture updated',
        description: 'Your new profile picture has been saved.',
      });
      onClose();
    } catch (error) {
      console.error('Failed to save avatar:', error);
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: 'Failed to update profile picture. Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = selectedUrl !== currentAvatarUrl;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
        <DialogHeader>
          <DialogTitle className="text-xl font-headline">Choose Profile Picture</DialogTitle>
          <DialogDescription>
            Select a default avatar or upload your own image.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Current selection preview */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="w-24 h-24 rounded-full border-[3px] border-black shadow-[4px_4px_0px_0px_#000] overflow-hidden bg-secondary">
                {selectedUrl ? (
                  <Image
                    src={selectedUrl}
                    alt="Selected avatar"
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Camera className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
              </div>
              {isUploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full">
                  <Loader2 className="h-8 w-8 text-white animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* Default avatars */}
          <div>
            <h3 className="text-sm font-medium mb-3">Default Avatars</h3>
            <div className="grid grid-cols-4 gap-3">
              {DEFAULT_AVATARS.map((avatar) => (
                <button
                  key={avatar.id}
                  onClick={() => handleSelectDefault(avatar.url)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-[2px] transition-all ${
                    selectedUrl === avatar.url
                      ? 'border-primary shadow-[2px_2px_0px_0px_#000] scale-105'
                      : 'border-black hover:border-primary'
                  }`}
                  title={avatar.name}
                >
                  <Image
                    src={avatar.url}
                    alt={avatar.name}
                    fill
                    className="object-cover"
                  />
                  {selectedUrl === avatar.url && (
                    <div className="absolute inset-0 flex items-center justify-center bg-primary/30">
                      <Check className="h-6 w-6 text-white drop-shadow-lg" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Custom upload */}
          <div>
            <h3 className="text-sm font-medium mb-3">Or Upload Your Own</h3>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
              id="avatar-upload"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full border-[2px] border-black"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Image
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              JPG, PNG or GIF. Max 2MB.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-[2px] border-black"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving || isUploading}
              className="flex-1 border-[2px] border-black shadow-[3px_3px_0px_0px_#000]"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
