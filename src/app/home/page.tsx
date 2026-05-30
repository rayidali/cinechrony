'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Users, Bookmark } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { useCachedAction } from '@/lib/use-cached-action';
import type { UserProfile } from '@/lib/types';
import { UserAvatar } from '@/components/user-avatar';
import { NotificationBell } from '@/components/notification-bell';
import { BottomNav } from '@/components/bottom-nav';
import { TrendingStrip } from '@/components/trending-strip';
import { ActivityFeed } from '@/components/activity-feed';
import { PullToRefresh } from '@/components/pull-to-refresh';
import { SearchOverlay } from '@/components/search-overlay';
import { FilterPills, type FilterPill } from '@/components/filter-pills';
import { PostFab } from '@/components/post-fab';
import { MovieModalProvider } from '@/contexts/movie-modal-context';

const CINECHRONY_LOGO = 'https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png';

/** Tabular date — `23.11.25`. */
function formatToday(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

/**
 * Home — the unified editorial feed (UX_PATTERNS.md "HOME").
 *
 * Topbar → search → filter pills → eyebrow/hairline/title → trending strip →
 * the feed. More feed sources (posts, recommendations) and more filter pills
 * (`saved`, `for you`, `trending`) fold in over the later Phase 0.5 steps.
 */
export default function HomePage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();

  const [refreshKey, setRefreshKey] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [feedFilter, setFeedFilter] = useState<'all' | 'saved' | 'friends'>('all');

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  // Following set powers the `friends` filter — SWR cached so tab returns
  // paint the prior list synchronously and refresh in the background.
  const followingResult = useCachedAction<string[]>(
    user ? `following:${user.uid}` : null,
    async () => {
      if (!user) return [];
      const res = await apiCall<{ users: UserProfile[] }>(
        'GET',
        `/api/v1/users/${user.uid}/following`,
      );
      return (res.users ?? []).map((u) => u.uid);
    },
  );
  const followingIds = followingResult.data ?? [];

  const handleRefresh = useCallback(async () => {
    setRefreshKey((prev) => prev + 1);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, []);

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src={CINECHRONY_LOGO} alt="Loading" className="h-12 w-12 animate-float" />
      </div>
    );
  }

  const pills: FilterPill[] = [
    { id: 'all', label: 'all' },
    { id: 'saved', label: 'saved', icon: Bookmark },
    { id: 'friends', label: 'friends', icon: Users },
  ];

  return (
    <MovieModalProvider returnPath="/home">
      <PullToRefresh onRefresh={handleRefresh} disabled={searchOpen}>
        <main className="min-h-screen font-body text-foreground pb-28 md:pb-8 md:pt-20">
          <div className="container mx-auto px-4 md:px-8 max-w-2xl">
            {/* Topbar — sticky */}
            <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 -mx-4 px-4 md:-mx-8 md:px-8 border-b border-border/60">
              <div
                className="flex justify-between items-center"
                style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.875rem)', paddingBottom: '0.875rem' }}
              >
                <div className="flex items-center gap-2.5">
                  <img src={CINECHRONY_LOGO} alt="Cinechrony" className="h-8 w-8" />
                  <span className="font-headline font-bold text-lg lowercase tracking-tight">
                    cinechrony
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <NotificationBell />
                  <UserAvatar />
                </div>
              </div>
            </header>

            {/* Search trigger */}
            <button
              onClick={() => setSearchOpen(true)}
              className="mt-4 w-full flex items-center gap-2.5 h-11 px-4 bg-card border border-border rounded-full shadow-press text-left transition-colors hover:border-foreground/30"
            >
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" strokeWidth={1.8} />
              <span className="font-serif italic text-sm text-muted-foreground">
                films, friends, lists…
              </span>
            </button>

            {/* Feed filter pills */}
            <div className="mt-3">
              <FilterPills
                pills={pills}
                active={feedFilter}
                onChange={(id) => setFeedFilter(id as 'all' | 'saved' | 'friends')}
              />
            </div>

            {/* Page title block */}
            <div className="mt-5 mb-6">
              <div className="cc-eyebrow">{formatToday()}</div>
              <div className="h-px bg-border my-2.5" />
              <h1 className="font-headline font-bold text-[34px] leading-[0.92] lowercase tracking-tight">
                home
              </h1>
            </div>

            {/* Trending strip — films + loved lists, mixed */}
            <TrendingStrip />

            {/* The feed */}
            <div className="mb-4">
              <div className="cc-eyebrow">the feed</div>
              <div className="h-px bg-border mt-2.5" />
            </div>
            <ActivityFeed
              currentUserId={user.uid}
              refreshKey={refreshKey}
              feedFilter={feedFilter}
              followingIds={followingIds}
            />
          </div>
        </main>
      </PullToRefresh>

      {/* Post FAB — tap to compose, long-press for the action sheet */}
      {feedFilter !== 'saved' && <PostFab onPosted={() => setRefreshKey((k) => k + 1)} />}

      {/* BottomNav OUTSIDE PullToRefresh to keep position:fixed working */}
      <BottomNav />

      {/* Fullscreen search */}
      <SearchOverlay isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </MovieModalProvider>
  );
}
