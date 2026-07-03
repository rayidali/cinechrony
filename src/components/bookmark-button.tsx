'use client';

import { useTransition } from 'react';
import { Bookmark } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { useUserBookmarksCache } from '@/contexts/user-bookmarks-cache';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';

type BookmarkButtonProps = {
  itemType: 'activity' | 'post';
  itemId: string;
  className?: string;
};

/**
 * The save toggle that lives in every feed-card footer. Fills sage when saved
 * — the icon fill IS the feedback, no toast (UX_PATTERNS "Save behavior").
 * Saved items surface under the `saved` filter pill.
 */
export function BookmarkButton({ itemType, itemId, className }: BookmarkButtonProps) {
  const { user } = useUser();
  const { isSaved, setSaved } = useUserBookmarksCache();
  const [isPending, startTransition] = useTransition();

  const saved = isSaved(itemType, itemId);

  const toggle = () => {
    if (!user || isPending) return;
    const next = !saved;
    haptic('selection');
    setSaved(itemType, itemId, next); // optimistic

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
        setSaved(itemType, itemId, !next); // roll back
      }
    });
  };

  return (
    <button
      onClick={toggle}
      disabled={!user || isPending}
      aria-label={saved ? 'Remove from saved' : 'Save'}
      aria-pressed={saved}
      className={cn(
        'flex items-center justify-center cc-meta text-[12px] transition-colors active:scale-95',
        saved ? 'text-success' : 'text-muted-foreground hover:text-foreground',
        !user && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <Bookmark className={cn('h-[18px] w-[18px]', saved && 'fill-current')} strokeWidth={1.8} />
    </button>
  );
}
