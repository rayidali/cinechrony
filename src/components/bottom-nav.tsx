'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Home, Search, List, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  icon: React.ReactNode;
  label: string;
  matchPaths?: string[];
}

const navItems: NavItem[] = [
  {
    href: '/home',
    icon: <Home className="h-6 w-6" />,
    label: 'Home',
    matchPaths: ['/home'],
  },
  {
    href: '/add',
    icon: <Search className="h-6 w-6" />,
    label: 'Add',
    matchPaths: ['/add'],
  },
  {
    href: '/lists',
    icon: <List className="h-6 w-6" />,
    label: 'Lists',
    matchPaths: ['/lists'],
  },
  {
    href: '/profile',
    icon: <User className="h-6 w-6" />,
    label: 'Profile',
    matchPaths: ['/profile'],
  },
];

export function BottomNav() {
  const pathname = usePathname();

  const isActive = (item: NavItem) => {
    if (item.matchPaths) {
      return item.matchPaths.some(path => pathname.startsWith(path));
    }
    return pathname === item.href;
  };

  return (
    <>
      {/* Spacer to prevent content from being hidden behind nav */}
      <div className="h-24 md:hidden" />

      {/* Bottom navigation - mobile only */}
      <nav className="fixed bottom-4 left-4 right-4 z-50 md:hidden">
        <div className="bg-card border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] px-2 py-2">
          <ul className="flex items-center justify-around">
            {navItems.map((item) => {
              const active = isActive(item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex flex-col items-center justify-center w-14 h-14 rounded-full transition-all duration-200',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {item.icon}
                    <span className="text-[10px] font-medium mt-0.5">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* Desktop sidebar/top nav could go here */}
      <nav className="hidden md:flex fixed top-4 left-1/2 -translate-x-1/2 z-50">
        <div className="bg-card border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] px-4 py-2">
          <ul className="flex items-center gap-2">
            {navItems.map((item) => {
              const active = isActive(item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200 font-medium',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                    )}
                  >
                    {item.icon}
                    <span className="text-sm">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </>
  );
}
