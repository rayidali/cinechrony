'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ScanLine } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { useToast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import type { DigInCategory } from '@/lib/tmdb-client';
import { DigIn } from '@/components/dig-in';
import { TopWatchers } from '@/components/top-watchers';
import { FeaturedCarousel } from '@/components/featured-carousel';
import { CommunityLists } from '@/components/community-lists';
import { DigInAll } from '@/components/dig-in-all';
import { TopWatchersAll } from '@/components/top-watchers-all';
import { CommunityListsAll } from '@/components/community-lists-all';
import { ActivityFeed } from '@/components/activity-feed';
import { PullToRefresh } from '@/components/pull-to-refresh';
import { SearchOverlay } from '@/components/search-overlay';
import { PostFab } from '@/components/post-fab';
import { HomeTopBar, type HomeFilter } from '@/components/home-top-bar';
import { PresencePill } from '@/components/presence-pill';
import { Section } from '@/components/v3/section';
import { MovieModalProvider } from '@/contexts/movie-modal-context';

const CINECHRONY_LOGO = '/brand/cinechrony-icon.png';

/**
 * Home — the unified editorial feed, v3 iOS-native (Phase 0.7.3.1, `ios-home.jsx`).
 *
 * Frosted scroll-collapsing top bar (`for you · friends` underline tabs + bell +
 * avatar) → search + `scan` row → discovery rail (`TrendingStrip`, for-you only)
 * → "the reel" (presence pill + the `DiaryEntry` feed). The full discovery rails
 * (dig in / leaderboard / featured / lists-for-you) land in slice c — they need
 * the 0.7.5 backend; the feed below is the existing real-data `ActivityFeed`.
 */
export default function HomePage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const { toast } = useToast();

  const [refreshKey, setRefreshKey] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [feedFilter, setFeedFilter] = useState<HomeFilter>('all');
  const [scrolled, setScrolled] = useState(false);
  // Which rail "view all" detail screen is open (F15/F16/F17).
  const [detail, setDetail] = useState<null | 'dig-in' | 'top-watchers' | 'community'>(null);
  // The dig-in category to open the F15 grid on (a tile tap or "view all").
  const [digInTab, setDigInTab] = useState<DigInCategory>('trending');

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  // Chrome collapse — fade the top-bar tint + hairline in once the feed scrolls.
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
      // ids-only, FULL follow graph (cap 2000) — the friends filter must see
      // all your follows, not the arbitrary 50 the profile-hydrating endpoint
      // returned (a user following >50 people silently lost follows #51+).
      const res = await apiCall<{ ids: string[] }>('GET', '/api/v1/me/following-ids');
      return res.ids ?? [];
    },
    { staleTime: 300_000 }, // follow set changes rarely — 5 min
  );
  const followingIds = followingResult.data ?? [];

  const handleRefresh = useCallback(async () => {
    setRefreshKey((prev) => prev + 1);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, []);

  const handleScan = useCallback(() => {
    haptic('selection');
    router.push('/extract');
  }, [router]);

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src={CINECHRONY_LOGO} alt="Loading" className="h-12 w-12 animate-float" />
      </div>
    );
  }

  const isForYou = feedFilter === 'all';

  return (
    <MovieModalProvider returnPath="/home">
      <PullToRefresh onRefresh={handleRefresh} disabled={searchOpen}>
        <main className="min-h-screen font-ui text-foreground pb-28 md:pb-8">
          <div className="container mx-auto px-[18px] md:px-8 max-w-2xl">
            <HomeTopBar filter={feedFilter} onSelect={setFeedFilter} scrolled={scrolled} />

            {/* Search + scan — one rounded unit, scan is the Phase C hook */}
            <div className="mt-1.5 flex items-center h-12 rounded-[14px] border border-hair bg-sunken overflow-hidden">
              <button
                onClick={() => setSearchOpen(true)}
                className="flex-1 h-full flex items-center gap-2.5 px-[13px] text-left transition-colors active:bg-foreground/[0.03]"
              >
                <Search className="h-[18px] w-[18px] text-muted-foreground flex-shrink-0" strokeWidth={2} />
                <span className="font-ui text-[16px] text-muted-foreground">
                  films, tv, genres, people
                </span>
              </button>
              <button
                onClick={handleScan}
                aria-label="Scan a poster"
                data-tour="scan"
                className="h-full flex items-center gap-[5px] pl-2.5 pr-[13px] text-primary transition-colors active:bg-primary/5"
              >
                <ScanLine className="h-[15px] w-[15px]" strokeWidth={2} />
                <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] font-bold">
                  scan
                </span>
              </button>
            </div>

            {/* Discovery rails — for-you only (real data; each rail hides when
                empty). Order matches the design: dig in → top watchers →
                featured hero → from the community. */}
            {isForYou && (
              <>
                <div className="mt-5">
                  <DigIn
                    onViewAll={(cat) => {
                      setDigInTab(cat ?? 'trending');
                      setDetail('dig-in');
                    }}
                  />
                </div>
                <div className="mt-7">
                  <TopWatchers onViewAll={() => setDetail('top-watchers')} />
                </div>
                <div className="mt-7">
                  <FeaturedCarousel />
                </div>
                <div className="mt-7">
                  <CommunityLists onViewAll={() => setDetail('community')} />
                </div>
              </>
            )}

            {/* The reel */}
            <div className="mt-8 mb-4">
              <Section
                eyebrow="the reel"
                title="watching lately"
                trailing={
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    live
                  </span>
                }
              />
              <div className="mt-3">
                <PresencePill userId={user.uid} />
              </div>
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
      <PostFab onPosted={() => setRefreshKey((k) => k + 1)} />


      {/* Fullscreen search */}
      <SearchOverlay isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Rail "view all" detail screens (F15/F16/F17). Rendered OUTSIDE
          PullToRefresh — a transform on an ancestor breaks their position:fixed. */}
      <DigInAll isOpen={detail === 'dig-in'} initialTab={digInTab} onClose={() => setDetail(null)} />
      <TopWatchersAll isOpen={detail === 'top-watchers'} onClose={() => setDetail(null)} />
      <CommunityListsAll isOpen={detail === 'community'} onClose={() => setDetail(null)} />
    </MovieModalProvider>
  );
}
