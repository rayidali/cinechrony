'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useUser } from '@/firebase';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserAvatar } from '@/components/user-avatar';
import { NotificationBell } from '@/components/notification-bell';
import { BottomNav } from '@/components/bottom-nav';
import { TrendingMovies } from '@/components/trending-movies';

// Placeholder skeleton for activity cards
function ActivitySkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-card rounded-2xl border-[3px] dark:border-2 border-border p-4 shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none"
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
            <div className="flex-1">
              <div className="h-4 bg-muted rounded animate-pulse w-24 mb-1" />
              <div className="h-3 bg-muted rounded animate-pulse w-16" />
            </div>
            <div className="h-6 w-16 bg-muted rounded-full animate-pulse" />
          </div>

          {/* Content */}
          <div className="h-5 bg-muted rounded animate-pulse w-3/4 mb-2" />
          <div className="h-3 bg-muted rounded animate-pulse w-1/2 mb-3" />

          {/* Poster placeholder */}
          <div className="aspect-video rounded-xl bg-muted animate-pulse mb-3" />

          {/* Footer */}
          <div className="flex items-center gap-4">
            <div className="h-4 w-12 bg-muted rounded animate-pulse" />
            <div className="h-4 w-12 bg-muted rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Activity section placeholder (will be replaced in Phase 4C/4D)
function ActivitySection() {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-headline font-bold">Activity</h2>
      </div>

      <ActivitySkeleton />
    </section>
  );
}

export default function HomePage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen font-body text-foreground pb-24 md:pb-8 md:pt-20">
      <div className="container mx-auto px-4 md:px-8 max-w-2xl">
        {/* Header */}
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-4 -mx-4 px-4 md:-mx-8 md:px-8 border-b border-border/50 mb-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Cinechrony" className="h-9 w-9" />
              <h1 className="text-xl font-headline font-bold">Cinechrony</h1>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <ThemeToggle />
              <UserAvatar />
            </div>
          </div>
        </header>

        {/* Trending Section */}
        <TrendingMovies />

        {/* Activity Feed */}
        <ActivitySection />
      </div>

      <BottomNav />
    </main>
  );
}
