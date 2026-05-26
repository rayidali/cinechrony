'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import { Camera, Check, Loader2, Upload, X } from 'lucide-react';

import { DEFAULT_AVATARS } from '@/lib/avatars';
import { useUser } from '@/firebase';
import { uploadAvatar } from '@/app/actions';
import { Button } from '@/components/ui/button';

/**
 * Decode → downscale → re-encode as JPEG. Used to be a hard 2MB client
 * cap; phone photos are routinely 4–8MB, so we now accept any reasonable
 * input and shrink it ourselves.
 *
 * Why we use <Image> + canvas rather than the shared `compressImage`
 * (which uses createImageBitmap): we MUST produce a web-renderable
 * format. If `createImageBitmap` fails on a HEIC file in a non-Apple
 * browser, the shared helper silently returns the original — which
 * would upload as `.heic` and then fail to render in any browser that
 * later tries to display the avatar. The img-tag path throws cleanly
 * on decode failure, surfacing a user-friendly error instead.
 *
 * Output: 512px square-capped JPEG at q=0.85 → typically 50–150KB even
 * from a 12MP source.
 */
async function compressAvatar(
  file: File,
): Promise<{ base64: string; mimeType: string; fileName: string }> {
  const MAX_EDGE = 512; // an avatar is displayed at <=128px — 512 is plenty
  const QUALITY = 0.85;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error("Couldn't read this image — please pick another."));
      el.src = objectUrl;
    });

    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = Math.min(1, MAX_EDGE / longest);
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Couldn't prepare image — please try again.");
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
    const base64 = dataUrl.split(',')[1];
    if (!base64) throw new Error("Couldn't process this image — please pick another.");

    const fileName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return { base64, mimeType: 'image/jpeg', fileName };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
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

    // Raw input cap — modern phone photos can be 6–12MB. We compress
    // client-side below to ~100–300KB before upload, so the 15MB ceiling
    // here is just a sanity guard against pathological inputs.
    if (file.size > 15 * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'File too large',
        description: 'Please select an image under 15MB.',
      });
      return;
    }

    setIsUploading(true);

    try {
      // Decode → downscale to 512px → re-encode as q=0.85 JPEG. Output is
      // typically <150KB regardless of input size, so even a 12MP HEIC
      // ends up well under the server's 5MB ceiling.
      const { base64, mimeType, fileName } = await compressAvatar(file);

      // Upload via server action
      const result = await uploadAvatar(
        await user.getIdToken(),
        base64,
        fileName,
        mimeType,
      );

      if (result.error) {
        toast({
          variant: 'destructive',
          title: 'Upload failed',
          description: result.error,
        });
        return;
      }

      if (result.url) {
        setSelectedUrl(result.url);
        toast({
          title: 'Image uploaded',
          description: 'Click Save to use this as your profile picture.',
        });
      }
    } catch (error) {
      console.error('Failed to upload image:', error);
      // Surface the friendly compressor message when present (decode failed,
      // canvas unavailable, etc.). Falls back to a generic line otherwise.
      const friendly =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to upload image. Please try again.';
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: friendly,
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
      <DialogContent className="max-w-md border border-border shadow-photo">
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
              <div className="relative w-32 h-32 rounded-full border border-border shadow-photo overflow-hidden bg-secondary">
                {selectedUrl ? (
                  <Image
                    src={selectedUrl}
                    alt="Selected avatar"
                    fill
                    className="object-cover"
                    sizes="128px"
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
                  className={`relative aspect-square rounded-lg overflow-hidden border transition-all ${
                    selectedUrl === avatar.url
                      ? 'border-primary shadow-press scale-105'
                      : 'border-border hover:border-primary'
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
            {/*
              Mobile-friendly file input:
              - accept="image/*" allows all image types
              - capture attribute would force camera, but we omit it to show photo library option
            */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
              id="avatar-upload"
            />
            <label
              htmlFor="avatar-upload"
              className={`
                flex items-center justify-center w-full py-3 px-4
                border border-border rounded-lg cursor-pointer
                bg-background hover:bg-secondary transition-colors
                ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Choose from Camera Roll
                </>
              )}
            </label>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Any phone photo works — we&apos;ll optimize it for you.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border border-border"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving || isUploading}
              className="flex-1 border border-border shadow-lift"
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
