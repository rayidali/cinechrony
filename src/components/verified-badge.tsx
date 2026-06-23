'use client';

import { BadgeCheck } from 'lucide-react';
import { useUserVerified } from '@/contexts/user-verified-cache';
import { cn } from '@/lib/utils';

/**
 * VerifiedBadge — the official/verified checkmark shown next to a handle.
 *
 * Self-contained: give it the author's uid and it renders nothing unless that
 * uid is in the verified set (O(1) via the global cache). So callers just drop
 * `<VerifiedBadge uid={authorId} />` next to a name — no verified state to thread.
 *
 * Film-red filled badge + white check (the brand accent), so it reads on light
 * and dark and never collides with the rating colours.
 */
export function VerifiedBadge({
  uid,
  verified,
  size = 15,
  className,
}: {
  /** Author uid — checked against the global verified set (feeds, comments…). */
  uid?: string | null;
  /** Explicit override — pass when you already have the flag (e.g. a profile
   *  page with `profile.verified`) so the badge shows without waiting on the cache. */
  verified?: boolean;
  size?: number;
  className?: string;
}) {
  const { isVerified } = useUserVerified();
  const show = verified ?? isVerified(uid);
  if (!show) return null;
  return (
    <BadgeCheck
      aria-label="Verified account"
      className={cn('inline-block flex-shrink-0 fill-primary text-white', className)}
      style={{ width: size, height: size }}
      strokeWidth={2.25}
    />
  );
}
