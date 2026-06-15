'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ScanLine } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { useToast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import type { UserProfile } from '@/lib/types';
import { BottomNav } from '@/components/bottom-nav';
import { TrendingStrip } from '@/components/trending-strip';
import { ActivityFeed } from '@/components/activity-feed';
import { PullToRefresh } from '@/components/pull-to-refresh';
import { SearchOverlay } from '@/components/search-overlay';
import { PostFab } from '@/components/post-fab';
import { HomeTopBar, type HomeFilter } from '@/components/home-top-bar';
import { PresencePill } from '@/components/presence-pill';
import { MovieModalProvider } from '@/contexts/movie-modal-context';

const CINECHRONY_LOGO = 'https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png';

/**
 * Home — the unified editorial feed, v3 iOS-native shell (Phase 0.7.3.1a).
 *
 * Frosted scroll-collapsing top bar (`for you · friends` underline tabs + saved
 * + bell + avatar) → search + `scan` row → discovery rail (`TrendingStrip`, for
 * you only) → "the reel" framing (presence pill) → the feed. The reel cards,
 * discovery rails (dig in / leaderboard / featured), and richer data land in
 * the b/c slices — the feed below is the existing real-data `ActivityFeed`.
 */
export default function HomePage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const { toast } = useToast();

  const [refreshKey, setRefreshKey] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [feedFilter, setFeedFilter] = useState<HomeFilter>('all');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  // Chrome collapse — fade the top-bar hairline in once the feed scrolls.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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

  const handleScan = useCallback(() => {
    haptic('selection');
    toast({
      title: 'scan — coming soon',
      description: 'point at a poster or a screen to log a film. landing with the extractor.',
    });
  }, [toast]);

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src={CINECHRONY_LOGO} alt="Loading" className="h-12 w-12 animate-float" />
      </div>
    );
  }

  const isSaved = feedFilter === 'saved';
  const isForYou = feedFilter === 'all';

  return (
    <MovieModalProvider returnPath="/home">
      <PullToRefresh onRefresh={handleRefresh} disabled={searchOpen}>
        <main className="min-h-screen font-body text-foreground pb-28 md:pb-8">
          <div className="container mx-auto px-4 md:px-8 max-w-2xl">
            <HomeTopBar filter={feedFilter} onSelect={setFeedFilter} scrolled={scrolled} />

            {/* Search + scan — one rounded unit, scan is the Phase C hook */}
            <div className="mt-3.5 flex items-center h-12 rounded-[14px] border border-hair bg-sunken overflow-hidden">
              <button
                onClick={() => setSearchOpen(true)}
                className="flex-1 h-full flex items-center gap-2.5 px-4 text-left transition-colors active:bg-foreground/[0.03]"
              >
                <Search className="h-[18px] w-[18px] text-muted-foreground flex-shrink-0" strokeWidth={1.9} />
                <span className="font-serif italic text-[15px] text-muted-foreground">
                  films, tv, genres, people
                </span>
              </button>
              <button
                onClick={handleScan}
                aria-label="Scan a poster"
                className="h-full flex items-center gap-1.5 pl-3 pr-4 border-l border-hair text-primary transition-colors active:bg-primary/5"
              >
                <ScanLine className="h-[18px] w-[18px]" strokeWidth={1.9} />
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] font-semibold">
                  scan
                </span>
              </button>
            </div>

            {/* Discovery rail — for-you only (films + loved lists) */}
            {isForYou && (
              <div className="mt-6">
                <TrendingStrip />
              </div>
            )}

            {/* The reel — section framing + presence */}
            {isSaved ? (
              <div className="mt-7 mb-5">
                <div className="cc-eyebrow">your archive</div>
                <h2 className="mt-1.5 font-headline font-bold text-[26px] leading-none lowercase tracking-tight">
                  saved
                </h2>
                <div className="h-px bg-hair mt-3.5" />
              </div>
            ) : (
              <div className="mt-7 mb-5">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="cc-eyebrow">the reel</div>
                    <h2 className="mt-1.5 font-headline font-bold text-[26px] leading-none lowercase tracking-tight">
                      watching lately
                    </h2>
                  </div>
                  <span className="inline-flex items-center gap-1.5 pb-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                    <span className="cc-eyebrow text-success">live</span>
                  </span>
                </div>
                <div className="h-px bg-hair mt-3.5" />
                <PresencePill userId={user.uid} />
              </div>
            )}

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
      {!isSaved && <PostFab onPosted={() => setRefreshKey((k) => k + 1)} />}

      {/* BottomNav OUTSIDE PullToRefresh to keep position:fixed working */}
      <BottomNav />

      {/* Fullscreen search */}
      <SearchOverlay isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </MovieModalProvider>
  );
}
