'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Home, Bookmark, User } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  { href: '/home', icon: Home, label: 'Home', matchPaths: ['/home'] },
  { href: '/lists', icon: Bookmark, label: 'Lists', matchPaths: ['/lists'] },
  { href: '/profile', icon: User, label: 'Profile', matchPaths: ['/profile'] },
];

/**
 * Bottom navigation — design system v2.
 *
 * A dark floating pill (cinema ink), icon-only, centered. The active item
 * is a cream-filled circle. The pill is a self-contained dark island, so its
 * cream/white internals read the same in light and dark mode.
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

      {/* Mobile — dark floating pill, icon-only */}
      <nav className="fixed left-1/2 -translate-x-1/2 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 md:hidden">
        <div
          className="flex items-center gap-1 p-1.5 rounded-full border border-white/[0.07] shadow-[0_8px_28px_rgba(0,0,0,0.28)]"
          style={{ background: 'oklch(0.17 0.012 60)' }}
        >
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
                  'flex items-center justify-center w-[52px] h-11 rounded-full transition-all duration-200',
                  active
                    ? 'bg-[oklch(0.95_0.012_78)] text-[oklch(0.165_0.012_60)]'
                    : 'text-white/55 hover:text-white/85'
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.6} />
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop — dark pill at top, icon + label */}
      <nav className="hidden md:flex fixed top-4 left-1/2 -translate-x-1/2 z-50">
        <div
          className="flex items-center gap-1 p-1.5 rounded-full border border-white/[0.07] shadow-[0_8px_28px_rgba(0,0,0,0.22)]"
          style={{ background: 'oklch(0.17 0.012 60)' }}
        >
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
                  'flex items-center gap-2 px-4 h-10 rounded-full transition-all duration-200',
                  'font-headline font-semibold text-sm lowercase tracking-tight',
                  active
                    ? 'bg-[oklch(0.95_0.012_78)] text-[oklch(0.165_0.012_60)]'
                    : 'text-white/55 hover:text-white/85'
                )}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2 : 1.6} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
