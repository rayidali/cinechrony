'use client';

import { useState, useEffect, useRef, useCallback, useTransition } from 'react';
import Image from 'next/image';
import {
  X,
  Image as ImageIcon,
  Grid2x2,
  Lock,
  Globe,
  Plus,
  ChevronLeft,
  Search,
  Loader2,
  Film,
} from 'lucide-react';
import { useUser } from '@/firebase';
import {
  createList,
  uploadListCover,
  updateListCover,
  searchUsers,
} from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { ProfileAvatar } from '@/components/profile-avatar';
import { compressImage } from '@/lib/image-compress';
import { cn } from '@/lib/utils';
import type { UserProfile } from '@/lib/types';

const MAX_COLLABORATORS = 9; // owner + 9 = 10-member cap

type InvitedFriend = { uid: string; username: string | null; displayName: string | null; photoURL: string | null };

type NewListDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (listId: string) => void;
};

type Step = 'create' | 'invite-friends';

/**
 * The v3 editorial new-list creator (`pattern-new-list.html`).
 *
 * Renders as a fixed-position drawer sized to the visible viewport — cover
 * hero (16:9 dashed empty → glass change/auto pills when filled), an
 * editorial headline name field, a serif description, a 2-up visibility
 * toggle (private by default), and an inline collaborators row with `X/9`
 * count + a dashed invite pill that opens an in-drawer friend search.
 *
 * `coverMode: 'auto'` is the default — the list cover renders as a 3-poster
 * mosaic from the first 3 movies until the owner uploads a custom one.
 */
export function NewListDrawer({ isOpen, onClose, onCreated }: NewListDrawerProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false); // v3 default: private
  const [coverPreview, setCoverPreview] = useState<string | null>(null); // base64 data URL
  const [coverMode, setCoverMode] = useState<'auto' | 'custom'>('auto');
  const [invites, setInvites] = useState<InvitedFriend[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step / sub-picker
  const [step, setStep] = useState<Step>('create');
  const [friendQuery, setFriendQuery] = useState('');
  const [friendResults, setFriendResults] = useState<UserProfile[]>([]);

  // Visible viewport — keyboard handling.
  const [viewportHeight, setViewportHeight] = useState('100dvh');

  // ── Effects ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    const vv = window.visualViewport;
    if (!vv) {
      setViewportHeight('100dvh');
      return;
    }
    const update = () => setViewportHeight(`${vv.height}px`);
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Debounced friend search.
  useEffect(() => {
    if (step !== 'invite-friends' || !user) return;
    const q = friendQuery.trim();
    if (q.length < 1) {
      setFriendResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchUsers(q, user.uid)
        .then((r) => setFriendResults(r.users ?? []))
        .catch(() => {});
    }, 260);
    return () => clearTimeout(t);
  }, [friendQuery, step, user]);

  // Reset on close.
  const resetAll = useCallback(() => {
    setName('');
    setDescription('');
    setIsPublic(false);
    setCoverPreview(null);
    setCoverMode('auto');
    setInvites([]);
    setStep('create');
    setFriendQuery('');
    setFriendResults([]);
  }, []);

  // ── Cover upload ───────────────────────────────────────────────────────

  const handleCoverSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      const reader = new FileReader();
      reader.onload = () => {
        setCoverPreview(reader.result as string);
        setCoverMode('custom');
      };
      reader.readAsDataURL(compressed);
    } catch (err) {
      console.error('[NewListDrawer] cover read failed:', err);
      toast({ variant: 'destructive', title: 'cover failed to load.' });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const useAutoCover = () => {
    setCoverMode('auto');
    // Don't clear coverPreview — let the user toggle back; we just won't
    // upload it on submit when mode is 'auto'.
  };

  // ── Friend invites ─────────────────────────────────────────────────────

  const toggleInvite = (u: UserProfile) => {
    setInvites((prev) => {
      const exists = prev.some((p) => p.uid === u.uid);
      if (exists) return prev.filter((p) => p.uid !== u.uid);
      if (prev.length >= MAX_COLLABORATORS) {
        toast({ variant: 'destructive', title: `up to ${MAX_COLLABORATORS} collaborators.` });
        return prev;
      }
      return [
        ...prev,
        {
          uid: u.uid,
          username: u.username,
          displayName: u.displayName,
          photoURL: u.photoURL,
        },
      ];
    });
  };

  const removeInvite = (uid: string) => {
    setInvites((prev) => prev.filter((p) => p.uid !== uid));
  };

  // ── Submission ─────────────────────────────────────────────────────────

  const canSubmit = !!user && name.trim().length > 0 && !isSubmitting;

  const handleCreate = () => {
    if (!canSubmit || !user) return;
    setIsSubmitting(true);
    startTransition(async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await createList(idToken, name.trim(), {
          isPublic,
          description: description.trim() || undefined,
          coverMode,
          collaboratorInvites: invites.map((i) => ({
            uid: i.uid,
            username: i.username,
          })),
        });

        if ('error' in res && res.error) {
          toast({ variant: 'destructive', title: 'Error', description: res.error });
          setIsSubmitting(false);
          return;
        }

        const listId = (res as { listId?: string }).listId;
        if (!listId) {
          toast({ variant: 'destructive', title: 'Error', description: 'List id missing.' });
          setIsSubmitting(false);
          return;
        }

        // Upload custom cover if provided + mode is custom.
        if (coverPreview && coverMode === 'custom') {
          try {
            const base64Data = coverPreview.split(',')[1];
            const mimeMatch = coverPreview.match(/data:([^;]+);/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
            const ext = mimeType.split('/')[1] || 'jpg';
            const uploadRes = await uploadListCover(
              idToken,
              user.uid,
              listId,
              base64Data,
              `cover.${ext}`,
              mimeType,
            );
            if (uploadRes.error) {
              toast({
                variant: 'destructive',
                title: 'cover upload failed',
                description: 'list created but cover did not save.',
              });
            } else if (uploadRes.url) {
              await updateListCover(idToken, user.uid, listId, uploadRes.url);
            }
          } catch (coverErr) {
            console.error('[NewListDrawer] cover upload failed:', coverErr);
          }
        }

        toast({ title: 'list created.' });
        const inviteCount = invites.length;
        if (inviteCount > 0) {
          toast({
            title: `${inviteCount} invite${inviteCount === 1 ? '' : 's'} sent.`,
            description: 'collaborators get a notification.',
          });
        }
        resetAll();
        setIsSubmitting(false);
        onCreated(listId);
      } catch (err) {
        console.error('[NewListDrawer] create failed:', err);
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to create list.' });
        setIsSubmitting(false);
      }
    });
  };

  const handleCancel = () => {
    resetAll();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed left-0 right-0 top-0 z-[70] bg-card flex flex-col animate-sheet-rise"
      style={{ height: viewportHeight }}
    >
      {/* ── Header — cancel · create ─────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4 border-b border-border"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)', paddingBottom: '0.75rem' }}
      >
        <button
          onClick={step === 'invite-friends' ? () => setStep('create') : handleCancel}
          className="cc-meta text-[12px] text-muted-foreground active:text-foreground transition-colors"
        >
          {step === 'invite-friends' ? 'back' : 'cancel'}
        </button>
        <span className="font-headline font-bold text-[13px] lowercase tracking-tight text-foreground">
          {step === 'invite-friends' ? 'invite friends' : 'new list'}
        </span>
        {step === 'create' ? (
          <button
            onClick={handleCreate}
            disabled={!canSubmit}
            className={cn(
              'h-9 px-5 rounded-full font-headline font-bold text-[12px] lowercase tracking-tight transition-all',
              canSubmit
                ? 'bg-primary text-white shadow-fab active:scale-[0.97]'
                : 'bg-muted text-muted-foreground/55 cursor-not-allowed',
            )}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'create'}
          </button>
        ) : (
          <button
            onClick={() => setStep('create')}
            className="h-9 px-5 rounded-full font-headline font-bold text-[12px] lowercase tracking-tight bg-primary text-white shadow-fab active:scale-[0.97]"
          >
            done ({invites.length})
          </button>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      {step === 'invite-friends' ? (
        <FriendPicker
          query={friendQuery}
          onQuery={setFriendQuery}
          results={friendResults}
          selectedUids={new Set(invites.map((i) => i.uid))}
          onToggle={toggleInvite}
        />
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
          {/* Cover hero */}
          <CoverHero
            coverPreview={coverPreview}
            coverMode={coverMode}
            onUpload={() => fileInputRef.current?.click()}
            onAuto={useAutoCover}
            onCustom={() => fileInputRef.current?.click()}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleCoverSelect}
          />

          {/* NAME */}
          <Field label="name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 80))}
              placeholder="your list name…"
              autoFocus
              className="w-full bg-transparent border-0 outline-none font-headline font-bold text-[24px] lowercase leading-[1] tracking-[-0.04em] placeholder:text-muted-foreground placeholder:font-bold placeholder:lowercase"
            />
          </Field>

          {/* DESCRIPTION */}
          <Field label="description · optional">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 280))}
              placeholder="what's this list about?"
              rows={3}
              className="w-full bg-transparent border-0 outline-none resize-none font-serif italic font-light text-[15px] leading-[1.4] placeholder:text-muted-foreground placeholder:italic min-h-[40px]"
            />
          </Field>

          {/* VISIBILITY */}
          <Field label="visibility">
            <div className="flex gap-2">
              <VisibilityCard
                icon={Lock}
                label="private"
                sub="just you + collaborators"
                active={!isPublic}
                onClick={() => setIsPublic(false)}
              />
              <VisibilityCard
                icon={Globe}
                label="public"
                sub="anyone can see &amp; like"
                active={isPublic}
                onClick={() => setIsPublic(true)}
              />
            </div>
          </Field>

          {/* COLLABORATORS */}
          <Field label={`collaborators · ${invites.length}/${MAX_COLLABORATORS}`}>
            <div className="flex items-center gap-2 flex-wrap py-1">
              {invites.map((i) => (
                <div key={i.uid} className="relative">
                  <ProfileAvatar
                    photoURL={i.photoURL}
                    displayName={i.displayName}
                    username={i.username}
                    size="sm"
                  />
                  <button
                    onClick={() => removeInvite(i.uid)}
                    aria-label={`Remove ${i.username || 'friend'}`}
                    className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-foreground text-background flex items-center justify-center"
                  >
                    <X className="h-2.5 w-2.5" strokeWidth={2.5} />
                  </button>
                </div>
              ))}
              {invites.length < MAX_COLLABORATORS && (
                <button
                  onClick={() => setStep('invite-friends')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-border bg-transparent cc-meta text-[11px] text-muted-foreground active:opacity-60"
                >
                  <Plus className="h-3 w-3" strokeWidth={1.8} />
                  {invites.length === 0 ? 'invite friends' : 'add more'}
                </button>
              )}
            </div>
          </Field>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="cc-eyebrow">{label}</div>
      <div className="h-px bg-border mt-1.5 mb-2" />
      {children}
    </div>
  );
}

function VisibilityCard({
  icon: Icon,
  label,
  sub,
  active,
  onClick,
}: {
  icon: typeof Lock;
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 px-3 py-2.5 rounded-xl border text-left transition-colors',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-transparent',
      )}
    >
      <div className="flex items-center gap-1.5 font-headline font-bold text-[13px] lowercase tracking-tight">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
        {label}
      </div>
      <div
        className={cn(
          'cc-meta text-[10px] mt-1',
          active ? 'text-background/60' : 'text-muted-foreground',
        )}
      >
        {sub}
      </div>
    </button>
  );
}

function CoverHero({
  coverPreview,
  coverMode,
  onUpload,
  onAuto,
  onCustom,
}: {
  coverPreview: string | null;
  coverMode: 'auto' | 'custom';
  onUpload: () => void;
  onAuto: () => void;
  onCustom: () => void;
}) {
  const hasCustom = !!coverPreview && coverMode === 'custom';

  if (hasCustom) {
    return (
      <div className="relative aspect-[16/9] rounded-[14px] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={coverPreview!} alt="" className="w-full h-full object-cover" />
        <div className="absolute right-2.5 bottom-2.5 flex gap-1.5">
          <GlassPill icon={ImageIcon} label="change" onClick={onCustom} />
          <GlassPill icon={Grid2x2} label="auto" onClick={onAuto} />
        </div>
      </div>
    );
  }

  // Auto / empty state — dashed paper, three placeholder mosaic tiles +
  // tap-to-upload affordance.
  return (
    <button
      onClick={onUpload}
      className="relative aspect-[16/9] w-full rounded-[14px] border border-dashed border-border bg-background flex flex-col items-center justify-center active:opacity-70"
    >
      {coverPreview && coverMode === 'auto' ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 opacity-30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverPreview} alt="" className="w-full h-full object-cover rounded-[12px]" />
        </div>
      ) : null}
      <div className="relative flex flex-col items-center gap-1.5 text-muted-foreground">
        <div className="flex gap-1">
          <MosaicTile />
          <MosaicTile />
          <MosaicTile />
        </div>
        <span className="font-serif italic text-[13px]">
          {coverMode === 'auto'
            ? 'mosaic of your first 3 films'
            : 'tap to add a cover'}
        </span>
      </div>
      {coverMode === 'auto' && (
        <div className="absolute right-2.5 bottom-2.5">
          <GlassPill icon={ImageIcon} label="upload" onClick={onUpload} dark />
        </div>
      )}
    </button>
  );
}

function MosaicTile() {
  return (
    <div className="w-7 h-10 rounded-[3px] border border-dashed border-border bg-card flex items-center justify-center">
      <Film className="h-3 w-3 text-muted-foreground/60" strokeWidth={1.6} />
    </div>
  );
}

function GlassPill({
  icon: Icon,
  label,
  onClick,
  dark,
}: {
  icon: typeof ImageIcon;
  label: string;
  onClick: () => void;
  dark?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'h-7 px-2.5 rounded-full inline-flex items-center gap-1 backdrop-blur-md border cc-meta text-[10px]',
        dark
          ? 'bg-foreground/85 border-foreground/0 text-background'
          : 'bg-white/25 border-white/30 text-white',
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={1.8} />
      {label}
    </button>
  );
}

function FriendPicker({
  query,
  onQuery,
  results,
  selectedUids,
  onToggle,
}: {
  query: string;
  onQuery: (q: string) => void;
  results: UserProfile[];
  selectedUids: Set<string>;
  onToggle: (u: UserProfile) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="px-3 pt-3 pb-2 border-b border-border">
        <div className="flex items-center gap-2 h-10 px-3 rounded-full border border-border bg-background">
          <Search className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="@username or name…"
            className="flex-1 bg-transparent border-0 outline-none font-serif italic text-sm placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {results.map((u) => {
          const tagged = selectedUids.has(u.uid);
          return (
            <button
              key={u.uid}
              onClick={() => onToggle(u)}
              className="w-full flex items-center gap-3 py-2.5 text-left active:opacity-60"
            >
              <ProfileAvatar
                photoURL={u.photoURL}
                displayName={u.displayName}
                username={u.username}
                size="md"
              />
              <div className="flex-1 min-w-0">
                <p className="font-headline font-semibold text-sm tracking-tight truncate">
                  {u.displayName || u.username || 'user'}
                </p>
                <p className="cc-meta text-[10px] text-muted-foreground truncate">
                  @{u.username}
                </p>
              </div>
              <span
                className={cn(
                  'cc-meta text-[10px] px-2 py-1 rounded-full',
                  tagged ? 'bg-success/15 text-success' : 'text-muted-foreground',
                )}
              >
                {tagged ? 'invited' : 'invite'}
              </span>
            </button>
          );
        })}
        {query.trim().length >= 1 && results.length === 0 && (
          <p className="font-serif italic text-sm text-muted-foreground py-6 text-center">
            nobody by that name.
          </p>
        )}
        {query.trim().length === 0 && (
          <p className="font-serif italic text-sm text-muted-foreground py-6 text-center">
            search for friends to collaborate on this list.
          </p>
        )}
      </div>
    </div>
  );
}
