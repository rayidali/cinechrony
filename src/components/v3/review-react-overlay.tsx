'use client';

import { useEffect, useState } from 'react';
import { ThumbsUp, CornerUpLeft, Copy, Flag, Trash2 } from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-avatar';
import { ReactionIcon } from '@/components/v3/reaction-icon';
import { haptic } from '@/lib/haptics';
import { REACTION_TYPES, REACTION_META, type ReactionType } from '@/lib/review-reactions';
import { VERDICT_META, scoreColor } from '@/lib/review-verdict';
import type { WallReview } from '@/lib/reviews-server';

/**
 * ReviewReactOverlay (F14) — long-press a review → a dimmed wall with a floating
 * 5-reaction bar, a lifted preview of the pressed review, and an action menu
 * (mark helpful · reply · copy · report/delete). The pressed-then-active
 * reaction enlarges. Anchored near the card's on-screen position (clamped so the
 * menu always fits), iOS-context-menu style.
 *
 * z-[92] (above the bottom bar at z-[70] and the wall). Capacitor-safe: pure
 * client, `-webkit-backdrop-filter` for the WKWebView blur.
 */
export function ReviewReactOverlay({
  isOpen,
  onClose,
  review,
  anchorTop,
  isOwn,
  onReact,
  onHelpful,
  onReply,
  onCopy,
  onReportOrDelete,
}: {
  isOpen: boolean;
  onClose: () => void;
  review: WallReview | null;
  anchorTop: number;
  isOwn: boolean;
  onReact: (type: ReactionType | null) => void;
  onHelpful: () => void;
  onReply: () => void;
  onCopy: () => void;
  onReportOrDelete: () => void;
}) {
  const [vh, setVh] = useState(0);
  useEffect(() => {
    if (isOpen) setVh(window.innerHeight);
  }, [isOpen]);

  if (!isOpen || !review) return null;

  // Clamp the group into the top portion so the action menu below the preview
  // always stays on screen, regardless of where the card was tapped.
  const top = Math.min(Math.max(anchorTop - 64, 56), Math.max(56, vh * 0.26));

  const handle = review.username ? `@${review.username}` : review.userDisplayName || 'someone';
  const verdictLabel = review.verdict ? VERDICT_META[review.verdict].label : 'commented';

  const act = (fn: () => void) => () => {
    haptic('light');
    fn();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[92] overflow-y-auto bg-black/45 px-4"
      style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      onClick={onClose}
      role="dialog"
      aria-label="Review actions"
    >
      <div
        className="mx-auto w-full max-w-md"
        style={{ paddingTop: top, paddingBottom: 48 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* reaction bar */}
        <div className="mx-auto mb-3 flex w-fit items-center gap-1 rounded-full border border-hair bg-card px-2 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.22)]">
          {REACTION_TYPES.map((type) => {
            const active = review.myReaction === type;
            return (
              <button
                key={type}
                onClick={() => { haptic('selection'); onReact(active ? null : type); onClose(); }}
                aria-label={REACTION_META[type].label}
                className={`flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-90 ${
                  active ? 'scale-110 bg-background shadow' : ''
                }`}
              >
                <ReactionIcon type={type} className="h-[26px] w-[26px]" />
              </button>
            );
          })}
        </div>

        {/* lifted preview of the pressed review */}
        <div className="rounded-[18px] border border-hair bg-card p-4 shadow-[0_8px_30px_rgba(0,0,0,0.22)]">
          <div className="flex items-start gap-2.5">
            <ProfileAvatar
              photoURL={review.userPhotoUrl}
              displayName={review.userDisplayName}
              username={review.username}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="font-ui text-[15px] font-bold tracking-[-0.01em] text-foreground">{handle}</div>
              <div className="font-mono text-[11px] text-muted-foreground">{verdictLabel}</div>
            </div>
            {review.ratingAtTime != null && (
              <span className="flex items-baseline gap-0.5">
                <span className="font-headline text-[20px] font-bold tabular-nums" style={{ color: scoreColor(review.ratingAtTime) }}>
                  {review.ratingAtTime.toFixed(1)}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">/10</span>
              </span>
            )}
          </div>
          <p className="mt-2.5 line-clamp-4 font-ui text-[15px] leading-[1.45] text-foreground">{review.text}</p>
        </div>

        {/* action menu */}
        <div className="mt-3 overflow-hidden rounded-[18px] border border-hair bg-card shadow-[0_8px_30px_rgba(0,0,0,0.22)]">
          {!isOwn && (
            <MenuRow icon={ThumbsUp} label={review.myHelpful ? 'unmark helpful' : 'mark helpful'} onClick={act(onHelpful)} />
          )}
          <MenuRow icon={CornerUpLeft} label="reply" onClick={act(onReply)} />
          <MenuRow icon={Copy} label="copy text" onClick={act(onCopy)} />
          {isOwn ? (
            <MenuRow icon={Trash2} label="delete" destructive onClick={act(onReportOrDelete)} last />
          ) : (
            <MenuRow icon={Flag} label="report" destructive onClick={act(onReportOrDelete)} last />
          )}
        </div>
      </div>
    </div>
  );
}

function MenuRow({
  icon: Icon,
  label,
  onClick,
  destructive = false,
  last = false,
}: {
  icon: typeof ThumbsUp;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  last?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors active:bg-foreground/[0.05] ${
        last ? '' : 'border-b border-hair'
      } ${destructive ? 'text-primary' : 'text-foreground'}`}
    >
      <Icon className="h-[22px] w-[22px]" strokeWidth={1.9} />
      <span className="font-ui text-[16px] font-semibold lowercase tracking-[-0.01em]">{label}</span>
    </button>
  );
}
