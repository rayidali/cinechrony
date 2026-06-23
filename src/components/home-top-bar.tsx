'use client';

import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { Frost } from '@/components/v3/frost';
import { NotificationBell } from '@/components/notification-bell';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserAvatar } from '@/components/user-avatar';

export type HomeFilter = 'all' | 'friends';

const TABS: { id: HomeFilter; label: string }[] = [
  { id: 'all', label: 'for you' },
  { id: 'friends', label: 'friends' },
];

/**
 * Home top bar — Phase 0.7 / v3 (`ios-home.jsx::HomeTopBar`).
 *
 * Frosted, scroll-collapsing chrome: `for you · friends` underline tabs
 * (Bricolage 22px, `wdth 95`, film-red underline) + the bell-with-dot and
 * avatar cluster. Transparent until the feed scrolls, then the chrome tint +
 * blur + a 0.5px hairline rule fade in — exactly the design's `scrolled` state.
 */
export function HomeTopBar({
  filter,
  onSelect,
  scrolled,
}: {
  filter: HomeFilter;
  onSelect: (f: HomeFilter) => void;
  scrolled: boolean;
}) {
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
        {/* Underline tabs */}
        <div className="flex items-center gap-[18px]">
          {TABS.map((t) => {
            const active = filter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  if (filter !== t.id) haptic('selection');
                  onSelect(t.id);
                }}
                className="relative py-0.5"
                aria-current={active ? 'page' : undefined}
              >
                <span
                  className={cn(
                    'font-headline font-bold text-[22px] lowercase tracking-[-0.035em] transition-colors',
                    active ? 'text-foreground' : 'text-muted-foreground/60',
                  )}
                  style={{ fontVariationSettings: '"wdth" 95' }}
                >
                  {t.label}
                </span>
                <span
                  className={cn(
                    'absolute left-0 right-0 -bottom-[7px] h-[2.5px] rounded-full bg-primary transition-opacity duration-200',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </button>
            );
          })}
        </div>

        {/* Right cluster — bell (with unread dot) · theme · avatar */}
        <div className="flex items-center gap-1.5">
          <NotificationBell />
          <ThemeToggle />
          <UserAvatar />
        </div>
      </div>
      {scrolled && <div className="h-[0.5px] bg-rule" />}
    </Frost>
  );
}
