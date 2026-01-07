'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import { Camera, Loader2, Upload, X, ImageIcon } from 'lucide-react';

import { useUser } from '@/firebase';
import { uploadListCover, updateListCover } from '@/app/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

type CoverPickerProps = {
  isOpen: boolean;
  onClose: () => void;
  listId: string;
  listName: string;
  currentCoverUrl: string | null;
  onCoverChange?: () => void;
  listOwnerId?: string; // For collaborative lists, use the owner's ID
};

export function CoverPicker({
  isOpen,
  onClose,
  listId,
  listName,
  currentCoverUrl,
  onCoverChange,
  listOwnerId,
}: CoverPickerProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentCoverUrl);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ base64: string; name: string; type: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useUser();
  const { toast } = useToast();

  // Compress and convert image to JPEG using canvas
  const compressImage = (file: File): Promise<{ base64: string; type: string }> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        // Max dimensions for cover images
        const maxWidth = 1200;
        const maxHeight = 1500;

        let { width, height } = img;

        // Scale down if needed
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // Create canvas and draw image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to JPEG with 85% quality
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1];

        resolve({ base64, type: 'image/jpeg' });
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
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

    // Validate file size (max 15MB before compression)
    if (file.size > 15 * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'File too large',
        description: 'Please select an image under 15MB.',
      });
      return;
    }

    try {
      // Create preview
      const previewDataUrl = URL.createObjectURL(file);
      setPreviewUrl(previewDataUrl);

      // Compress and convert to JPEG
      const { base64, type } = await compressImage(file);

      setSelectedFile({ base64, name: file.name.replace(/\.[^.]+$/, '.jpg'), type });
    } catch (error) {
      console.error('Failed to process image:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to process image',
        description: 'Please try a different image.',
      });
    }
  };

  const handleSave = async () => {
    if (!user || !selectedFile) return;

    setIsUploading(true);
    // Use listOwnerId if provided (for collaborative lists), otherwise use current user
    const ownerId = listOwnerId || user.uid;

    try {
      const result = await uploadListCover(
        ownerId,
        listId,
        selectedFile.base64,
        selectedFile.name,
        selectedFile.type
      );

      if (result.error) {
        toast({
          variant: 'destructive',
          title: 'Upload failed',
          description: result.error,
        });
        return;
      }

      toast({
        title: 'Cover updated',
        description: 'Your list cover has been saved.',
      });

      onCoverChange?.();
      onClose();
    } catch (error) {
      console.error('Failed to upload cover:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: `Error: ${errorMsg}`,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveCover = async () => {
    if (!user) return;

    setIsUploading(true);
    // Use listOwnerId if provided (for collaborative lists), otherwise use current user
    const ownerId = listOwnerId || user.uid;

    try {
      const result = await updateListCover(ownerId, listId, null);

      if (result.error) {
        toast({
          variant: 'destructive',
          title: 'Failed to remove cover',
          description: result.error,
        });
        return;
      }

      toast({
        title: 'Cover removed',
        description: 'Your list cover has been removed.',
      });

      setPreviewUrl(null);
      setSelectedFile(null);
      onCoverChange?.();
      onClose();
    } catch (error) {
      console.error('Failed to remove cover:', error);
      toast({
        variant: 'destructive',
        title: 'Failed',
        description: 'Failed to remove cover. Please try again.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    setPreviewUrl(currentCoverUrl);
    setSelectedFile(null);
    onClose();
  };

  const hasChanges = selectedFile !== null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-sm border-[3px] border-border shadow-[8px_8px_0px_0px_hsl(var(--border))]">
        <DialogHeader>
          <DialogTitle className="text-xl font-headline">Set Cover Image</DialogTitle>
          <DialogDescription>
            Choose a cover image for "{listName}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Preview */}
          <div className="relative aspect-[4/5] rounded-xl overflow-hidden border-[2px] border-border bg-muted">
            {previewUrl ? (
              <Image
                src={previewUrl}
                alt="Cover preview"
                fill
                className="object-cover"
                sizes="300px"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400">
                <ImageIcon className="h-12 w-12 text-white/50" />
                <p className="text-white/70 text-sm mt-2">No cover image</p>
              </div>
            )}
            {isUploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 className="h-8 w-8 text-white animate-spin" />
              </div>
            )}
          </div>

          {/* Upload button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
            id="cover-upload"
          />
          <label
            htmlFor="cover-upload"
            className={`
              flex items-center justify-center w-full py-3 px-4
              border-[2px] border-border rounded-xl cursor-pointer
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
                <Camera className="h-4 w-4 mr-2" />
                Choose from Camera Roll
              </>
            )}
          </label>
          <p className="text-xs text-muted-foreground text-center">
            JPG, PNG or GIF. Max 5MB.
          </p>

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            {currentCoverUrl && (
              <Button
                variant="outline"
                onClick={handleRemoveCover}
                disabled={isUploading}
                className="border-[2px] border-destructive text-destructive hover:bg-destructive/10"
              >
                Remove
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleClose}
              className="flex-1 border-[2px] border-border"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isUploading}
              className="flex-1 border-[2px] border-border shadow-[3px_3px_0px_0px_hsl(var(--border))]"
            >
              {isUploading ? (
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
