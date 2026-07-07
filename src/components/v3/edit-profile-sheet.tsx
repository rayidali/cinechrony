'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, ImageIcon, Loader2 } from 'lucide-react';
import { DEFAULT_AVATARS } from '@/lib/avatars';
import { compressAvatar } from '@/lib/avatar-image';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { useToast } from '@/hooks/use-toast';
import { gradientFromSeed } from '@/components/v3/hero';

/**
 * EditProfileSheet — the v3 "edit profile" surface (design mock 13). A
 * full-screen overlay (NOT a Vaul drawer — text inputs inside Vaul hit the iOS
 * focus-trap bug). Edits the photo hero (camera roll / take photo / a house
 * avatar) + name + bio in one save.
 *
 * Handle is intentionally read-only: usernames are permanent (AUDIT 2.3) and
 * are denormalized across activities/reviews/notifications, so changing one is
 * a deliberate backend feature, not a field edit.
 */
type EditProfileSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  displayName: string;
  username: string;
  photoURL: string | null;
  bio: string;
};

export function EditProfileSheet({
  isOpen,
  onClose,
  displayName,
  username,
  photoURL,
  bio,
}: EditProfileSheetProps) {
  const { toast } = useToast();
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [draftName, setDraftName] = useState(displayName);
  const [draftBio, setDraftBio] = useState(bio);
  const [draftPhoto, setDraftPhoto] = useState<string | null>(photoURL);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Keyboard inset so the bio textarea (the LAST field) clears the iOS keyboard
  // — Keyboard resize is 'none', so a static bottom padding isn't enough.
  const [kbInset, setKbInset] = useState(0);

  // Re-seed the draft each time the sheet opens (real-time profile may have
  // changed since last open).
  useEffect(() => {
    if (isOpen) {
      setDraftName(displayName);
      setDraftBio(bio);
      setDraftPhoto(photoURL);
    }
  }, [isOpen, displayName, bio, photoURL]);

  useEffect(() => {
    if (!isOpen) return;
    const vv = window.visualViewport;
    const onResize = () => { if (vv) setKbInset(Math.max(0, window.innerHeight - vv.height)); };
    onResize();
    vv?.addEventListener('resize', onResize);
    vv?.addEventListener('scroll', onResize);
    return () => {
      vv?.removeEventListener('resize', onResize);
      vv?.removeEventListener('scroll', onResize);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'Invalid file type', description: 'Please pick an image.' });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast({ variant: 'destructive', title: 'File too large', description: 'Please pick an image under 15MB.' });
      return;
    }
    setIsUploading(true);
    try {
      const { base64, fileName, mimeType } = await compressAvatar(file);
      const { url } = await apiCall<{ url: string }>('POST', '/api/v1/me/avatar', { base64, fileName, mimeType });
      setDraftPhoto(url);
    } catch (error) {
      const friendly =
        error instanceof ApiClientError || (error instanceof Error && error.message)
          ? (error as Error).message
          : 'Failed to upload image. Please try again.';
      toast({ variant: 'destructive', title: 'Upload failed', description: friendly });
    } finally {
      setIsUploading(false);
      if (libraryRef.current) libraryRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
    }
  };

  const handleSave = async () => {
    const name = draftName.trim();
    if (!name) {
      toast({ variant: 'destructive', title: 'Name required', description: 'Your name can’t be empty.' });
      return;
    }
    const updates: { displayName?: string; bio?: string; photoURL?: string } = {};
    if (name !== (displayName || '')) updates.displayName = name;
    if (draftBio.trim() !== (bio || '')) updates.bio = draftBio.trim();
    if (draftPhoto && draftPhoto !== photoURL) updates.photoURL = draftPhoto;

    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      await apiCall('PATCH', '/api/v1/me', updates);
      haptic('success');
      toast({ title: 'profile updated' });
      onClose();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof ApiClientError ? error.message : 'Failed to save profile.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isUploading || isSaving;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      {/* hidden file inputs */}
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {/* Header — cancel · title · save */}
      <header
        className="flex items-center justify-between border-b border-border px-5 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <button
          onClick={onClose}
          disabled={busy}
          className="font-headline text-[15px] lowercase tracking-tight text-muted-foreground transition-colors active:text-foreground disabled:opacity-50"
        >
          cancel
        </button>
        <h2 className="font-headline text-[19px] font-bold lowercase tracking-tight">edit profile</h2>
        <button
          onClick={handleSave}
          disabled={busy}
          className="inline-flex items-center gap-1.5 font-headline text-[15px] font-bold lowercase tracking-tight text-primary transition-transform active:scale-95 disabled:opacity-50"
        >
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          save
        </button>
      </header>

      <div
        className="flex-1 overflow-y-auto px-5 pt-5"
        style={{ paddingBottom: `calc(env(safe-area-inset-bottom) + ${Math.max(32, kbInset + 32)}px)` }}
      >
        <div className="mx-auto max-w-2xl space-y-7">
          {/* YOUR PROFILE PHOTO */}
          <section>
            <div className="cc-eyebrow mb-2.5">your profile photo</div>
            <div className="relative h-[210px] overflow-hidden rounded-[18px] border border-hair bg-secondary">
              {draftPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draftPhoto} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                // Match the live profile Hero's seeded gradient (same seed +
                // helper) so the preview equals what the user actually has.
                <div className="absolute inset-0" style={{ background: gradientFromSeed(displayName || username || 'profile') }} />
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, transparent 38%, transparent 50%, rgba(0,0,0,0.72) 100%)',
                }}
              />
              {/* change pill */}
              <button
                onClick={() => libraryRef.current?.click()}
                disabled={busy}
                className="absolute right-3 top-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-white/20 px-3.5 text-white shadow-[0_2px_10px_rgba(0,0,0,0.18)] transition-transform active:scale-95 disabled:opacity-60"
                style={{
                  background: 'rgba(22,20,18,0.34)',
                  backdropFilter: 'blur(16px) saturate(160%)',
                  WebkitBackdropFilter: 'blur(16px) saturate(160%)',
                }}
              >
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" strokeWidth={2} />}
                <span className="font-headline text-[13px] font-semibold lowercase tracking-tight">change</span>
              </button>
              {/* identity overlay */}
              <div className="absolute inset-x-4 bottom-3">
                <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/75 [text-shadow:0_1px_6px_rgba(0,0,0,0.5)]">
                  critic · @{username}
                </div>
                <div className="mt-1 truncate font-headline text-[28px] font-bold lowercase leading-none tracking-tight text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.4)]">
                  {draftName || 'your name'}
                </div>
              </div>
            </div>

            {/* camera roll / take photo */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                onClick={() => libraryRef.current?.click()}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-card font-headline text-[14px] font-semibold lowercase tracking-tight transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                <ImageIcon className="h-4 w-4" strokeWidth={1.8} />
                camera roll
              </button>
              <button
                onClick={() => cameraRef.current?.click()}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-card font-headline text-[14px] font-semibold lowercase tracking-tight transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                <Camera className="h-4 w-4" strokeWidth={1.8} />
                take photo
              </button>
            </div>
          </section>

          {/* CAMERA-SHY? GRAB A HOUSE AVATAR */}
          <section>
            <div className="cc-eyebrow mb-2.5">camera-shy? grab a house avatar</div>
            <div className="flex items-center justify-between">
              {DEFAULT_AVATARS.map((avatar) => {
                const selected = draftPhoto === avatar.url;
                return (
                  <button
                    key={avatar.id}
                    onClick={() => setDraftPhoto(avatar.url)}
                    disabled={busy}
                    aria-label={avatar.name}
                    className={`relative h-[60px] w-[60px] overflow-hidden rounded-[18px] border-2 transition-transform active:scale-95 disabled:opacity-60 ${
                      selected ? 'border-primary' : 'border-transparent'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={avatar.url} alt={avatar.name} className="h-full w-full object-cover" loading="lazy" />
                  </button>
                );
              })}
            </div>
          </section>

          {/* WHO YOU ARE */}
          <section className="space-y-3">
            <div className="cc-eyebrow">who you are</div>

            <div className="rounded-[14px] border border-border bg-card px-3.5 py-3">
              <label className="cc-eyebrow text-[9px]">name</label>
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={50}
                placeholder="your name"
                className="mt-0.5 w-full bg-transparent font-headline text-[17px] font-bold lowercase tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
              />
            </div>

            {/* Handle — read-only (usernames are permanent; denormalized widely) */}
            <div className="rounded-[14px] border border-border bg-card px-3.5 py-3">
              <label className="cc-eyebrow text-[9px]">handle</label>
              <div className="mt-0.5 font-mono text-[15px] text-muted-foreground">@{username}</div>
            </div>

            <div className="rounded-[14px] border border-border bg-card px-3.5 py-3">
              <label className="cc-eyebrow text-[9px]">bio · one line they’ll remember</label>
              <textarea
                value={draftBio}
                onChange={(e) => setDraftBio(e.target.value)}
                maxLength={160}
                rows={2}
                placeholder="wassup bitches"
                className="mt-0.5 w-full resize-none bg-transparent font-serif text-[15px] italic leading-snug text-foreground outline-none placeholder:not-italic placeholder:text-muted-foreground/50"
              />
            </div>

            <p className="cc-meta text-[11px] text-muted-foreground">
              @{username} is yours · usernames are permanent
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
