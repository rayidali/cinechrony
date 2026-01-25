'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserAvatar } from '@/components/user-avatar';
import { NotificationBell } from '@/components/notification-bell';
import { BottomNav } from '@/components/bottom-nav';
import { TrendingMovies } from '@/components/trending-movies';
import { ActivityFeed } from '@/components/activity-feed';
import { PullToRefresh } from '@/components/pull-to-refresh';

export default function HomePage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  // Handle pull-to-refresh
  const handleRefresh = useCallback(async () => {
    // Increment refresh key to trigger ActivityFeed reload
    setRefreshKey((prev) => prev + 1);
    // Small delay for visual feedback
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, []);

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
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
          <ActivityFeed currentUserId={user.uid} refreshKey={refreshKey} />
        </div>

        <BottomNav />
      </main>
    </PullToRefresh>
  );
}
