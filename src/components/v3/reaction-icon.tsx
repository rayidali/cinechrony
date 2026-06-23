'use client';

import { Heart, Flame, Droplet, Laugh, Sparkles, type LucideIcon } from 'lucide-react';
import type { ReactionType } from '@/lib/review-reactions';

/** The lucide glyph for each review reaction (F14). Kept here so the card chips
 *  and the long-press reaction bar render identical icons. */
export const REACTION_ICONS: Record<ReactionType, LucideIcon> = {
  heart: Heart,
  flame: Flame,
  droplet: Droplet,
  grin: Laugh,
  sparkle: Sparkles,
};

export function ReactionIcon({
  type,
  className,
  filled = false,
}: {
  type: ReactionType;
  className?: string;
  filled?: boolean;
}) {
  const Icon = REACTION_ICONS[type];
  return <Icon className={className} strokeWidth={2} fill={filled ? 'currentColor' : 'none'} />;
}
