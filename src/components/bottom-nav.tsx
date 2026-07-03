'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Link } from '@/lib/native-nav';
import { Home, Bookmark, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
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
 * Which routes wear the tab bar. Mounted once in the root layout (see
 * `shouldShowNav` gating below), so this list is the single source of truth for
 * "is this a tab-bearing screen". Works for both the real web paths and the
 * Capacitor static-export `_` shells (`/lists/_`, `/profile/_/lists/_`, …)
 * because it matches on prefix. Settings screens under `/lists/*` are excluded
 * (they push over the tab, X-style), as are all detail pages (post, comments,
 * reel, notifications, extract, invite, onboarding, auth).
 */
function shouldShowNav(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/home' || p === '/add' || p === '/settings') return true;
  if (p === '/lists') return true;
  if (p.startsWith('/lists/')) return !p.endsWith('/settings');
  if (p === '/profile' || p.startsWith('/profile/')) return true;
  return false;
}

/**
 * Per-tab scroll memory. iOS tab bars preserve each tab's scroll offset; a
 * plain Next `<Link>` navigation always resets to the top. We save the outgoing
 * tab's offset on the tab tap and restore it on arrival. Module-level so it
 * survives the component's own life and every route swap. Keys are only ever
 * the three exact tab roots (we only write on a tab-bar tap), so this never
 * interferes with browser back/forward scroll restoration on detail pages.
 */
const tabScroll = new Map<string, number>();

/**
 * Bottom navigation — design system v3 (Phase 0.7, iOS-native).
 *
 * A floating frosted-glass capsule, centered above the home indicator. Each
 * item stacks an icon over a lowercase label; the active item is film-red with
 * a bolder stroke, inactive items are muted. Theme-aware via the `--cc-tab-tint`
 * frost token.
 *
 * PERSISTENT MOUNT (2026-07): rendered exactly once, in the root layout, as a
 * SIBLING of (not inside) `<NativeTransitions>`. Previously each tab page
 * mounted its own copy, so every navigation unmounted the nav — WKWebView tore
 * down and re-rasterized the `backdrop-filter` blur layer, making the capsule
 * visibly blink out on every tab switch; and because it sat inside the
 * transition wrapper's transform it slid/dimmed/dragged with the page during
 * push/pop/swipe. Hoisted out, it never unmounts and never transforms — it
 * stays put like a real UITabBar. Self-gates via `shouldShowNav`.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { user } = useUser();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  // Restore the saved scroll offset when arriving at a tab we left earlier.
  // rAF puts us after Next's scroll-to-top; a single delayed retry covers tabs
  // whose content paints a beat late (e.g. the lists grid from its snapshot).
  useEffect(() => {
    const y = tabScroll.get(pathname);
    if (y == null || y <= 0) return;
    tabScroll.delete(pathname); // one-shot: re-saved on the next tab tap
    let raf = requestAnimationFrame(() => window.scrollTo(0, y));
    const retry = window.setTimeout(() => {
      if (Math.abs(window.scrollY - y) > 4) window.scrollTo(0, y);
    }, 120);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(retry);
    };
  }, [pathname]);

  // Warm the destination tab's data on touch-start so by the time the route
  // change commits the data is already in the SWR cache. Cheap and idempotent
  // — `prefetchCachedAction` no-ops if the key is already cached or in flight.
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

  const isActive = (item: NavItem) =>
    item.matchPaths
      ? item.matchPaths.some((path) => pathname.startsWith(path))
      : pathname === item.href;

  // Tap handling: active tab → scroll to top (iOS convention); inactive tab →
  // save the current scroll offset (so returning restores it) + selection haptic.
  const handleTap = (item: NavItem, active: boolean) =>
    (e: React.MouseEvent) => {
      if (active) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        haptic('light');
        return;
      }
      tabScroll.set(pathRef.current, window.scrollY);
      haptic('selection');
    };

  if (!shouldShowNav(pathname)) return null;

  return (
    <>
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
                  data-tour={`tab-${item.href.slice(1)}`}
                  onTouchStart={() => handlePrefetch(item.href)}
                  onMouseEnter={() => handlePrefetch(item.href)}
                  onClick={handleTap(item, active)}
                  className={cn(
                    'flex flex-col items-center justify-center w-[62px] h-11 rounded-full gap-[3px] transition-transform active:scale-90',
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
                  onClick={handleTap(item, active)}
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
