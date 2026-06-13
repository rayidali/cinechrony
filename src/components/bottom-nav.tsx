'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Home, Bookmark, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Frost } from '@/components/v3/frost';
import { useUser } from '@/firebase';
import { prefetchCachedAction } from '@/lib/use-cached-action';
import { apiCall } from '@/lib/api-client';
import type { CollaborativeListSummary } from '@/lib/lists-server';
import type { UserProfile } from '@/lib/types';
import type { FeedItem } from '@/lib/posts-server';

interface NavItem {
  href: string;
  icon: typeof Home;
  label: string;
  matchPaths?: string[];
}

/**
 * Three tabs — `home · lists · profile`.
 *
 * The v1 `add` (search) tab is retired: search is a header icon on home, and
 * adding a film happens contextually (the FAB inside a list, the post composer).
 * See UX_PATTERNS.md — "HOME — the unified feed (3-tab architecture)".
 */
const navItems: NavItem[] = [
  { href: '/home', icon: Home, label: 'home', matchPaths: ['/home'] },
  { href: '/lists', icon: Bookmark, label: 'lists', matchPaths: ['/lists'] },
  { href: '/profile', icon: UserRound, label: 'you', matchPaths: ['/profile'] },
];

/**
 * Bottom navigation — design system v3 (Phase 0.7, iOS-native).
 *
 * A floating frosted-glass capsule, centered above the home indicator. Each
 * item stacks an icon over a lowercase label; the active item is film-red with
 * a bolder stroke, inactive items are muted. Theme-aware via the `--cc-tab-tint`
 * frost token (was a solid dark island in v2). Touch-start prefetch preserved.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { user } = useUser();

  const isActive = (item: NavItem) =>
    item.matchPaths
      ? item.matchPaths.some((path) => pathname.startsWith(path))
      : pathname === item.href;

  // Warm the destination tab's data on touch-start so by the time the route
  // change commits the data is already in the SWR cache. Cheap and idempotent
  // — `prefetchCachedAction` no-ops if the key is already cached or in flight.
  // Saves ~150ms of perceived latency vs. waiting for the tap to register.
  const handlePrefetch = (href: string) => {
    if (!user) return;
    const uid = user.uid;
    if (href === '/home') {
      prefetchCachedAction(`following:${uid}`, async () => {
        const res = await apiCall<{ users: UserProfile[] }>(
          'GET',
          `/api/v1/users/${uid}/following`,
        );
        return (res.users ?? []).map((u) => u.uid);
      });
      prefetchCachedAction(`home-feed:${uid}:all`, async () => {
        const res = await apiCall<{ items: FeedItem[]; hasMore: boolean; nextCursor?: string }>(
          'GET',
          '/api/v1/home-feed',
        );
        return {
          items: res.items ?? [],
          hasMore: !!res.hasMore,
          cursor: res.nextCursor || null,
        };
      });
    } else if (href === '/lists') {
      prefetchCachedAction(`collab-lists:${uid}`, async () => {
        const res = await apiCall<{ lists: CollaborativeListSummary[] }>(
          'GET', '/api/v1/me/collaborative-lists',
        );
        return res.lists ?? [];
      });
    }
  };

  return (
    <>
      {/* Spacer so content clears the floating nav */}
      <div className="h-28 md:hidden" />

      {/* Mobile — frosted glass capsule, icon + label, film-red active */}
      <nav className="fixed left-1/2 -translate-x-1/2 bottom-[calc(1.625rem+env(safe-area-inset-bottom))] z-50 md:hidden pointer-events-none">
        <Frost
          tint="var(--cc-tab-tint)"
          blur={26}
          className={cn(
            'pointer-events-auto rounded-full border border-white/70 dark:border-white/10',
            'shadow-[0_8px_26px_rgba(0,0,0,0.14)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)]'
          )}
        >
          <div className="flex gap-1 px-2.5 py-[7px]">
            {navItems.map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                  onTouchStart={() => handlePrefetch(item.href)}
                  onMouseEnter={() => handlePrefetch(item.href)}
                  className={cn(
                    'flex flex-col items-center justify-center w-[62px] h-11 rounded-full gap-[3px] transition-colors',
                    active ? 'text-primary' : 'text-muted-foreground'
                  )}
                >
                  <Icon className="h-[21px] w-[21px]" strokeWidth={active ? 2.4 : 1.9} />
                  <span
                    className={cn(
                      'text-[9.5px] tracking-wide lowercase',
                      active ? 'font-bold' : 'font-medium'
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </Frost>
      </nav>

      {/* Desktop — frosted pill at top, icon + label */}
      <nav className="hidden md:flex fixed top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
        <Frost
          tint="var(--cc-tab-tint)"
          blur={26}
          className={cn(
            'pointer-events-auto rounded-full border border-white/70 dark:border-white/10',
            'shadow-[0_8px_26px_rgba(0,0,0,0.14)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)]'
          )}
        >
          <div className="flex items-center gap-1 p-1.5">
            {navItems.map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  onTouchStart={() => handlePrefetch(item.href)}
                  onMouseEnter={() => handlePrefetch(item.href)}
                  className={cn(
                    'flex items-center gap-2 px-4 h-10 rounded-full transition-colors',
                    'font-headline font-semibold text-sm lowercase tracking-tight',
                    active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.7} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </Frost>
      </nav>
    </>
  );
}
