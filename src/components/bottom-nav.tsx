'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Home, Search, Bookmark, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  icon: typeof Home;
  label: string;
  matchPaths?: string[];
}

const navItems: NavItem[] = [
  { href: '/home', icon: Home, label: 'Home', matchPaths: ['/home'] },
  { href: '/add', icon: Search, label: 'Add', matchPaths: ['/add'] },
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

  const isActive = (item: NavItem) =>
    item.matchPaths
      ? item.matchPaths.some((path) => pathname.startsWith(path))
      : pathname === item.href;

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
