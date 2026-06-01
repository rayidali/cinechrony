'use client';

import { useState, useTransition } from 'react';
import { Drawer } from 'vaul';
import {
  MoreHorizontal,
  Bookmark,
  Link as LinkIcon,
  Share,
  VolumeX,
  type LucideIcon,
} from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { useUserBookmarksCache } from '@/contexts/user-bookmarks-cache';
import { useUserMutesCache } from '@/contexts/user-mutes-cache';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export type OverflowRow = {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
};

type CardOverflowMenuProps = {
  /** The card's author — enables "mute @user". */
  authorId?: string;
  authorUsername?: string | null;
  /** Bookmark target — enables "save". */
  itemType?: 'activity' | 'post';
  itemId?: string;
  /** Share target — enables "copy link" / "share". */
  movieTmdbId?: number;
  movieTitle?: string;
  mediaType?: 'movie' | 'tv';
  /** Extra rows (e.g. report); destructive ones render last in marker-red. */
  customRows?: OverflowRow[];
  /** Called after the author is muted so the parent can drop the card. */
  onMuted?: () => void;
};

/**
 * The per-card ⋯ overflow — a Vaul action sheet with hairline-divided rows.
 * Destructive actions land last, after a hairline, in marker-red.
 * See UX_PATTERNS.md — "Per-card overflow menu (⋯)".
 */
export function CardOverflowMenu({
  authorId,
  authorUsername,
  itemType,
  itemId,
  movieTmdbId,
  movieTitle,
  mediaType,
  customRows = [],
  onMuted,
}: CardOverflowMenuProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const { isSaved, setSaved } = useUserBookmarksCache();
  const { setMuted } = useUserMutesCache();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const saved = itemType && itemId ? isSaved(itemType, itemId) : false;
  const isOwn = !!user && user.uid === authorId;

  const shareUrl =
    typeof window !== 'undefined' && movieTmdbId
      ? `${window.location.origin}/movie/${movieTmdbId}/comments?title=${encodeURIComponent(
          movieTitle ?? '',
        )}&type=${mediaType ?? 'movie'}`
      : '';

  const close = () => setOpen(false);

  const handleSave = () => {
    if (!user || !itemType || !itemId) return;
    const next = !saved;
    setSaved(itemType, itemId, next);
    close();
    startTransition(async () => {
      try {
        if (next) {
          await apiCall('POST', '/api/v1/bookmarks', { itemType, itemId });
        } else {
          await apiCall(
            'DELETE',
            `/api/v1/bookmarks/${itemType}/${encodeURIComponent(itemId)}`,
          );
        }
      } catch {
        setSaved(itemType, itemId, !next);
      }
    });
  };

  const handleCopyLink = async () => {
    close();
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: 'link copied.' });
    } catch {
      toast({ variant: 'destructive', title: 'couldn’t copy the link.' });
    }
  };

  const handleShare = async () => {
    close();
    if (!shareUrl) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: movieTitle ?? 'cinechrony', url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast({ title: 'link copied.' });
      }
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
  };

  const handleMute = () => {
    if (!user || !authorId) return;
    close();
    setMuted(authorId, true);
    onMuted?.();
    startTransition(async () => {
      try {
        await apiCall('POST', `/api/v1/users/${authorId}/mute`);
        toast({
          title: `you won't see @${authorUsername ?? 'them'} for now.`,
          description: 'unmute anytime in settings.',
        });
      } catch {
        setMuted(authorId, false);
      }
    });
  };

  // Assemble rows: built-ins, then custom non-destructive, then destructive.
  const rows: OverflowRow[] = [];
  if (itemType && itemId) {
    rows.push({ label: saved ? 'saved' : 'save', icon: Bookmark, onSelect: handleSave });
  }
  if (shareUrl) {
    rows.push({ label: 'copy link', icon: LinkIcon, onSelect: handleCopyLink });
    rows.push({ label: 'share', icon: Share, onSelect: handleShare });
  }
  for (const r of customRows.filter((r) => !r.destructive)) rows.push(r);
  if (authorId && !isOwn) {
    rows.push({
      label: `mute @${authorUsername ?? 'user'}`,
      icon: VolumeX,
      onSelect: handleMute,
    });
  }
  const destructive = customRows.filter((r) => r.destructive);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="More"
        className="h-[22px] w-[22px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
      >
        <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>

      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[60] flex flex-col rounded-t-2xl bg-card outline-none">
            <Drawer.Title className="sr-only">Card actions</Drawer.Title>
            <div className="mx-auto mt-3 mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <div className="px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {rows.map((row, i) => (
                <OverflowRowButton key={`${row.label}_${i}`} row={row} />
              ))}
              {destructive.length > 0 && (
                <>
                  <div className="h-px bg-border my-1 mx-2" />
                  {destructive.map((row, i) => (
                    <OverflowRowButton key={`d_${row.label}_${i}`} row={row} />
                  ))}
                </>
              )}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}

function OverflowRowButton({ row }: { row: OverflowRow }) {
  const Icon = row.icon;
  return (
    <button
      onClick={row.onSelect}
      className={cn(
        'w-full flex items-center gap-3 px-2 py-3 rounded-lg text-left transition-colors hover:bg-muted',
        row.destructive ? 'text-destructive' : 'text-foreground',
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
      <span className="font-serif text-[15px] lowercase">{row.label}</span>
    </button>
  );
}
