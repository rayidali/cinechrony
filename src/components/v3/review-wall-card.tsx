'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ThumbsUp, CornerUpLeft, SmilePlus, EyeOff } from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-avatar';
import { ReactionIcon } from '@/components/v3/reaction-icon';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { REACTION_TYPES, REACTION_META, type ReactionType } from '@/lib/review-reactions';
import { VERDICT_META, scoreColor } from '@/lib/review-verdict';
import type { WallReview } from '@/lib/reviews-server';

/** Compact relative time — "now · 8m · 2h · 3d · 23.04". */
function rel(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const dt = new Date(iso);
  return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

const LONG_PRESS_MS = 420;

/**
 * useLongPress — fires after a hold without movement; suppresses the click that
 * would otherwise follow (so a long-press never also taps a nested button). The
 * returned `onClickCapture` must sit on the same element.
 */
function useLongPress(onLongPress: (top: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const clear = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };
  // End of a gesture: cancel a pending timer, and if the long-press already
  // fired, release the suppression flag on the NEXT tick — late enough that a
  // synchronous trailing click is still eaten by onClickCapture, but soon enough
  // that the next genuine tap isn't (handles the no-trailing-click case where the
  // overlay intercepts pointerup).
  const endGesture = () => {
    clear();
    if (fired.current) setTimeout(() => { fired.current = false; }, 0);
  };
  return {
    rootRef,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY };
        fired.current = false;
        clear();
        timer.current = setTimeout(() => {
          fired.current = true;
          haptic('medium');
          const top = rootRef.current?.getBoundingClientRect().top ?? 120;
          onLongPress(top);
        }, LONG_PRESS_MS);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!start.current) return;
        if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) clear();
      },
      onPointerUp: endGesture,
      onPointerCancel: endGesture,
      onPointerLeave: endGesture,
      onClickCapture: (e: React.MouseEvent) => {
        if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; }
      },
    },
  };
}

type Handlers = {
  onReact: (reviewId: string, type: ReactionType | null) => void;
  onHelpful: (reviewId: string, next: boolean) => void;
  onReply: (review: WallReview) => void;
  onLongPress: (review: WallReview, anchorTop: number) => void;
};

export function ReviewWallCard({
  review,
  currentUserId,
  featured = false,
  ...h
}: { review: WallReview; currentUserId: string | null; featured?: boolean } & Handlers) {
  return (
    <div>
      {featured && (
        <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
          <span>★</span> most helpful review
        </div>
      )}
      <ReviewBody review={review} currentUserId={currentUserId} featured={featured} {...h} />
      {review.replies && review.replies.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {review.replies.map((reply) => (
            <ReplyBubble key={reply.id} reply={reply} {...h} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewBody({
  review,
  currentUserId,
  featured,
  onReact,
  onHelpful,
  onReply,
  onLongPress,
}: { review: WallReview; currentUserId: string | null; featured: boolean } & Handlers) {
  const [revealed, setRevealed] = useState(false);
  const { rootRef, handlers } = useLongPress((top) => onLongPress(review, top));

  const handle = review.username ? `@${review.username}` : review.userDisplayName || 'someone';
  const profileUrl = review.username ? `/profile/${review.username}` : '#';
  const verdictLabel = review.verdict ? VERDICT_META[review.verdict].label : 'commented';
  const reacted = REACTION_TYPES.filter((t) => (review.reactionCounts[t] ?? 0) > 0);
  const showSpoiler = review.hasSpoiler && !revealed;

  return (
    <div
      ref={rootRef}
      {...handlers}
      className={cn(
        'rounded-[18px] border p-4 transition-colors',
        featured ? 'border-primary/20 bg-primary/[0.045]' : 'border-hair bg-card',
      )}
    >
      {/* header */}
      <div className="flex items-start gap-2.5">
        <Link href={profileUrl} onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
          <ProfileAvatar photoURL={review.userPhotoUrl} displayName={review.userDisplayName} username={review.username} size="md" />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={profileUrl}
            onClick={(e) => e.stopPropagation()}
            className="block w-fit font-ui text-[16px] font-bold tracking-[-0.01em] text-foreground hover:underline"
          >
            {handle}
          </Link>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {verdictLabel} · {rel(review.createdAt)}
          </div>
        </div>
        {review.ratingAtTime != null ? (
          <span className="flex flex-shrink-0 items-baseline gap-0.5">
            <span className="font-headline text-[26px] font-bold leading-none tabular-nums" style={{ color: scoreColor(review.ratingAtTime) }}>
              {review.ratingAtTime.toFixed(1)}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">/10</span>
          </span>
        ) : (
          <span className="flex-shrink-0 rounded-md border border-rule px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            note
          </span>
        )}
      </div>

      {/* body */}
      <div className="relative mt-3">
        <p className={cn('font-ui text-[16px] leading-[1.5] text-foreground whitespace-pre-wrap', showSpoiler && 'blur-[7px] select-none')}>
          {review.text}
        </p>
        {showSpoiler && (
          <button
            onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
            className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-lg bg-background/40 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-foreground"
          >
            <EyeOff className="h-3.5 w-3.5" strokeWidth={2} /> spoiler alert · tap to reveal
          </button>
        )}
      </div>

      {/* reactions */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {reacted.map((t) => {
          const mine = review.myReaction === t;
          return (
            <button
              key={t}
              onClick={(e) => { e.stopPropagation(); haptic('light'); onReact(review.id, mine ? null : t); }}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-transform active:scale-95"
              style={{ borderColor: mine ? REACTION_META[t].color : 'var(--cc-rule, rgba(0,0,0,0.1))' }}
            >
              <span style={{ color: REACTION_META[t].color }}>
                <ReactionIcon type={t} className="h-4 w-4" />
              </span>
              <span className="font-mono text-[12px] font-bold tabular-nums text-foreground">{review.reactionCounts[t]}</span>
            </button>
          );
        })}
        <button
          onClick={(e) => { e.stopPropagation(); onLongPress(review, rootRef.current?.getBoundingClientRect().top ?? 120); }}
          aria-label="Add a reaction"
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-hair text-muted-foreground transition-transform active:scale-90"
        >
          <SmilePlus className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </button>
      </div>

      {/* footer */}
      <div className="mt-3 border-t border-rule pt-3">
        <div className="flex items-center gap-6">
          <button
            onClick={(e) => { e.stopPropagation(); if (currentUserId) { haptic('light'); onHelpful(review.id, !review.myHelpful); } }}
            disabled={!currentUserId}
            className={cn(
              'inline-flex items-center gap-1.5 font-ui text-[14px] font-semibold transition-transform active:scale-95 disabled:opacity-50',
              review.myHelpful ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <ThumbsUp className="h-[18px] w-[18px]" strokeWidth={1.9} fill={review.myHelpful ? 'currentColor' : 'none'} />
            helpful{review.helpful > 0 ? ` · ${review.helpful}` : ''}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onReply(review); }}
            className="inline-flex items-center gap-1.5 font-ui text-[14px] font-semibold text-muted-foreground transition-transform active:scale-95"
          >
            <CornerUpLeft className="h-[18px] w-[18px]" strokeWidth={1.9} />
            reply
          </button>
        </div>
      </div>
    </div>
  );
}

/** A threaded reply — a compact chat bubble under its parent, with an
 *  L-connector. Long-pressable for react/reply/report like a full review. */
function ReplyBubble({
  reply,
  onLongPress,
}: { reply: WallReview } & Pick<Handlers, 'onLongPress'> & Partial<Handlers>) {
  const { rootRef, handlers } = useLongPress((top) => onLongPress(reply, top));
  const handle = reply.username ? `@${reply.username}` : reply.userDisplayName || 'someone';
  const profileUrl = reply.username ? `/profile/${reply.username}` : '#';
  return (
    <div className="flex items-stretch gap-2 pl-3">
      {/* L-connector */}
      <div className="flex w-7 flex-shrink-0 flex-col">
        <span className="ml-3 h-5 w-3 rounded-bl-[10px] border-b border-l border-rule" />
      </div>
      <Link href={profileUrl} onClick={(e) => e.stopPropagation()} className="mt-2 flex-shrink-0 self-start">
        <ProfileAvatar photoURL={reply.userPhotoUrl} displayName={reply.userDisplayName} username={reply.username} size="sm" />
      </Link>
      <div ref={rootRef} {...handlers} className="min-w-0 flex-1 rounded-[16px] bg-secondary px-3.5 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="font-ui text-[14px] font-bold tracking-[-0.01em] text-foreground">{handle}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{rel(reply.createdAt)}</span>
        </div>
        <p className="mt-0.5 font-ui text-[15px] leading-[1.45] text-foreground whitespace-pre-wrap">{reply.text}</p>
      </div>
    </div>
  );
}
