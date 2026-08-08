'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Frost } from '@/components/v3/frost';
import { NotificationBell } from '@/components/notification-bell';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserAvatar } from '@/components/user-avatar';

export type HomeFilter = 'all' | 'friends';



/**
 * Home top bar — Phase D4.2.
 *
 * WHAT CHANGED AND WHY. It used to carry the `for you · friends` underline
 * tabs, which are the FEED's filter. Once D3 demoted the feed to the bottom of
 * home, the app's most prominent chrome was controlling its least important
 * block — and the bar's opaque background put a cream band between the status
 * bar and the hero image, which is the one thing the owner's mockup does not
 * have. The tabs moved down to the feed's own header, where they belong.
 *
 * It now floats OVER the hero: transparent with white glyphs until the page
 * scrolls, then the frosted tint and hairline fade in as before. That is what
 * makes the still run to the top of the screen.
 */
export function HomeTopBar({ scrolled }: { scrolled: boolean }) {
  return (
    <Frost
      tint={scrolled ? undefined : 'transparent'}
      blur={scrolled ? 22 : 0}
      className="sticky top-0 z-40 -mx-4 md:-mx-8"
    >
      <div
        className="mx-auto max-w-2xl px-[18px] md:px-8 flex items-center justify-between gap-3"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)',
          paddingBottom: '12px',
        }}
      >
        {/* Wordmark — the mockup's left anchor. */}
        <div className="flex items-center gap-2">
          <Image
            src="/brand/cinechrony-logo.png" alt="" width={28} height={28}
            className="h-7 w-7 rounded-[8px]" unoptimized
          />
          <span
            className={cn(
              'font-headline font-bold text-[20px] lowercase tracking-[-0.035em] transition-colors',
              scrolled ? 'text-foreground' : 'text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]',
            )}
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            cinechrony
          </span>
        </div>

        {/* Right cluster — bell (with unread dot) · theme · avatar.
            `cc-over-hero` flips the icon colour to white while the bar is
            transparent; see globals.css. */}
        <div className={cn('flex items-center gap-1.5', !scrolled && 'cc-over-hero')}>
          <NotificationBell />
          <ThemeToggle />
          <UserAvatar />
        </div>
      </div>
      {scrolled && <div className="h-[0.5px] bg-rule" />}
    </Frost>
  );
}
