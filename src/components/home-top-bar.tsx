'use client';

import { Bookmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { Frost } from '@/components/v3/frost';
import { NotificationBell } from '@/components/notification-bell';
import { UserAvatar } from '@/components/user-avatar';

export type HomeFilter = 'all' | 'saved' | 'friends';

const TABS: { id: HomeFilter; label: string }[] = [
  { id: 'all', label: 'for you' },
  { id: 'friends', label: 'friends' },
];

/**
 * Home top bar — Phase 0.7 / v3 (`ios-home.jsx`).
 *
 * A frosted, scroll-collapsing chrome bar carrying the `for you · friends`
 * underline tabs (design's home tabs are underline-style, not the sunken
 * sliding `Segmented` used on lists/profile), plus the saved/bell/avatar
 * cluster. The saved bookmark relocates the old `saved` filter pill here so the
 * bookmarks feed stays one tap away without a third primary tab. A hairline
 * rule fades in once the feed scrolls.
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
  const savedActive = filter === 'saved';

  return (
    <Frost
      className={cn(
        'sticky top-0 z-40 -mx-4 md:-mx-8 border-b transition-colors duration-300',
        scrolled ? 'border-hair' : 'border-transparent',
      )}
    >
      <div
        className="mx-auto max-w-2xl px-4 md:px-8 flex items-center justify-between gap-3"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 0.7rem)',
          paddingBottom: '0.6rem',
        }}
      >
        {/* Underline tabs */}
        <div className="flex items-center gap-5">
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
                    'font-headline text-[19px] lowercase tracking-tight transition-colors',
                    active
                      ? 'font-bold text-foreground'
                      : 'font-semibold text-muted-foreground/70',
                  )}
                >
                  {t.label}
                </span>
                <span
                  className={cn(
                    'absolute -bottom-1.5 left-0 right-0 h-[2.5px] rounded-full bg-primary transition-opacity duration-200',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </button>
            );
          })}
        </div>

        {/* Right cluster — saved · notifications · avatar */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              haptic('selection');
              onSelect(savedActive ? 'all' : 'saved');
            }}
            aria-label={savedActive ? 'Exit saved' : 'Saved'}
            aria-pressed={savedActive}
            className={cn(
              'h-9 w-9 inline-flex items-center justify-center rounded-full transition-transform active:scale-90',
              savedActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Bookmark
              className={cn('h-[19px] w-[19px]', savedActive && 'fill-current')}
              strokeWidth={1.9}
            />
          </button>
          <NotificationBell />
          <UserAvatar />
        </div>
      </div>
    </Frost>
  );
}
