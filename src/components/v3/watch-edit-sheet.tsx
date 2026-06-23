'use client';

import { useEffect, useState } from 'react';
import { Drawer } from 'vaul';
import { Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { DragToRate, ClearRatingButton } from '@/components/v3/drag-to-rate';
import { haptic } from '@/lib/haptics';
import { useViewportHeight } from '@/hooks/use-viewport-height';
import type { Watch } from '@/lib/types';

/**
 * Edit or remove a single watch-log entry (Phase 0.7 Wave 2). Opened by tapping
 * a row in the drawer's "your history" — lets you fix a rating/note you slid by
 * accident, or remove the watch entirely (two-tap confirm). A Vaul bottom drawer
 * mirroring the F03 "how was it?" sheet; the parent drawer is closed while open.
 * Edits ONLY this log entry — the canonical rating (drag-to-rate) and your
 * review are unaffected.
 */
export function WatchEditSheet({
  isOpen,
  watch,
  onSave,
  onRemove,
  onClose,
}: {
  isOpen: boolean;
  watch: Watch | null;
  onSave: (rating: number | null, note: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [rating, setRating] = useState<number | null>(7.5);
  const [note, setNote] = useState('');
  const [removeArmed, setRemoveArmed] = useState(false);
  const height = useViewportHeight(88);

  useEffect(() => {
    if (isOpen && watch) {
      setRating(watch.rating && watch.rating > 0 ? watch.rating : 7.5);
      setNote(watch.note ?? '');
      setRemoveArmed(false);
    }
  }, [isOpen, watch]);

  if (!watch) return null;

  const label = watch.ordinal <= 1 ? 'first watch' : `rewatch no. ${watch.ordinal}`;
  const ts = new Date(watch.watchedAt).getTime();
  const dateLabel = ts > 0 ? format(new Date(watch.watchedAt), 'MMM yyyy').toLowerCase() : null;
  const heightStyle = height > 0 ? `${height}px` : 'calc(88 * var(--dvh, 1vh))';

  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[88]" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-[88] flex flex-col rounded-t-[22px] bg-card outline-none overflow-hidden"
          style={{ height: heightStyle, maxHeight: heightStyle }}
        >
          <Drawer.Title className="sr-only">edit watch</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />

          <div className="flex items-center justify-between px-5 py-2.5">
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui font-semibold text-[15px] text-muted-foreground active:opacity-60">
              cancel
            </button>
            <span className="font-headline font-bold text-[18px] lowercase tracking-[-0.02em]">edit watch</span>
            <button onClick={() => { haptic('success'); onSave(rating, note); }} className="font-ui font-bold text-[15px] text-primary active:opacity-60">
              save
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
            <div className="mt-1 mb-1 flex items-center gap-2">
              <span className="font-headline font-bold text-[16px] lowercase tracking-[-0.02em]">{label}</span>
              {dateLabel && <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{dateLabel}</span>}
              {rating != null && <span className="ml-auto"><ClearRatingButton onClear={() => setRating(null)} /></span>}
            </div>

            <div className="mt-3 rounded-2xl border border-hair bg-card p-4 shadow-press">
              <DragToRate value={rating} onChangeComplete={setRating} framed={false} />
            </div>

            <div className="mt-4">
              <div className="cc-eyebrow text-muted-foreground mb-2">note · optional</div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={4}
                placeholder="what stuck with you this time…"
                className="w-full resize-none rounded-2xl border border-hair bg-background/60 px-4 py-3 font-serif italic text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-foreground/30 transition-colors"
              />
            </div>

            {/* two-tap remove confirm */}
            <button
              onClick={() => {
                if (!removeArmed) { setRemoveArmed(true); haptic('warning'); return; }
                haptic('heavy');
                onRemove();
              }}
              className={`mt-5 w-full flex items-center justify-center gap-2 rounded-2xl py-3 font-headline font-bold text-[14px] lowercase tracking-[-0.02em] transition-colors ${
                removeArmed ? 'bg-destructive text-white' : 'border border-hair text-destructive'
              }`}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
              {removeArmed ? 'tap again to remove' : 'remove this watch'}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
