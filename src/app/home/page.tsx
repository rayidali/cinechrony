'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ScanLine } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { useToast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import { ActivityFeed } from '@/components/activity-feed';
import {
  YourWeek, NeedsYou, UnfiledStrip, YourLists, useUnfiledFilms, type NeedsYouItem,
} from '@/components/home/home-blocks';
import { PullToRefresh } from '@/components/pull-to-refresh';
import { SearchOverlay } from '@/components/search-overlay';
import { PostFab } from '@/components/post-fab';
import { HomeTopBar, type HomeFilter } from '@/components/home-top-bar';
import { PresencePill } from '@/components/presence-pill';
import { Section } from '@/components/v3/section';
import { HomeSkeleton } from '@/components/page-skeletons';
import { MovieModalProvider } from '@/contexts/movie-modal-context';
import { useMovieNight } from '@/components/movie-night/movie-night-provider';
import { formatNightTimeLabel } from '@/lib/movie-night-format';
import type { MovieNightView } from '@/lib/movie-night-types';
import type { ListSummary } from '@/lib/lists-server';
import type { ListInvite } from '@/lib/types';


/**
 * Home — ONE screen whose blocks appear only when they have something to say
 * (Phase D3; `../design-refs-2026-08/screens/03-05*.png`).
 *
 *   top bar · search + scan
 *   your week          the seven-day strip, and the soonest night
 *   needs you · n      only when something is actually waiting on you
 *   unfiled · n        only when the pen is non-empty
 *   your lists
 *   the feed           always, and ALWAYS last
 *
 * WHY THAT ORDER. Everything above the feed works with zero friends on day one;
 * the feed does not. Home previously led with `for you · friends` tabs and four
 * discovery rails, which is a cold-start product wearing a movie app's clothes:
 * a new account opened to a follow-graph surface with nothing in it. The rails
 * were not deleted — they moved to the search overlay's discover pane, since
 * unlike the feed they are global rather than follow-graph and remain the only
 * thing with real content for someone who has grabbed nothing yet.
 *
 * The three mockups are three STATES of this screen, not three screens (owner
 * decision, 2026-08-07). Blocks live in `components/home/home-blocks.tsx`.
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

  // ── D3 block data ──────────────────────────────────────────────────────
  // Every source here is either already on this screen or a live listener on
  // the caller's own docs. Nothing new is fetched per render: the nights key is
  // the SAME one `activity-feed.tsx` writes (`home-mn-upcoming:{uid}`), so the
  // week strip and the feed's night card share one request rather than racing
  // two — this is a free-tier project and the read budget is the constraint
  // (see [[project_quota_read_reduction]]).
  // The key is deliberately STABLE (no refresh token folded in): folding one in
  // would mint a different key per mutation and stop sharing with the feed,
  // which is the entire point. The cost is that a night mutated in the detail
  // sheet reaches the week strip on the next revalidation rather than instantly
  // — acceptable, because the sheet the user just acted in already shows the
  // truth, and the strip is a calendar, not a confirmation.
  const { openNight } = useMovieNight();
  const nightsResult = useCachedAction<MovieNightView[]>(
    user ? `home-mn-upcoming:${user.uid}` : null,
    () => apiCall<MovieNightView[]>('GET', '/api/v1/movie-nights/upcoming'),
    { staleTime: 60_000 },
  );
  const upcomingNights = useMemo(
    () => (nightsResult.data ?? []).filter((n) => n.status === 'proposed'),
    [nightsResult.data],
  );

  const invitesResult = useCachedAction<{ invites: ListInvite[] }>(
    user ? `home-invites:${user.uid}` : null,
    () => apiCall<{ invites: ListInvite[] }>('GET', '/api/v1/me/invites'),
    { staleTime: 120_000 },
  );

  const listsResult = useCachedAction<{ lists: ListSummary[] }>(
    user ? `own-lists:${user.uid}` : null,
    () => apiCall<{ lists: ListSummary[] }>('GET', '/api/v1/lists'),
    { staleTime: 120_000 },
  );
  const allLists = useMemo(() => listsResult.data?.lists ?? [], [listsResult.data]);
  const homeLists = useMemo(
    () => allLists.slice(0, 6).map((l) => ({
      id: l.id, name: l.name, movieCount: l.movieCount, coverImageUrl: l.coverImageUrl,
    })),
    [allLists],
  );

  const unfiledFilms = useUnfiledFilms();

  // "needs you" is composed from what is already loaded above rather than from
  // its own endpoint — three things this screen holds anyway.
  const needsYou: NeedsYouItem[] = useMemo(() => {
    const out: NeedsYouItem[] = [];
    for (const n of upcomingNights) {
      // Only nights actually awaiting THIS user's answer. A night you have
      // already RSVP'd to is not an action, it is a plan.
      const mine = n.invitees.find((i) => i.uid === user?.uid);
      if (mine && !mine.answer) {
        out.push({
          id: `mn_${n.id}`, kind: 'movie-night', eyebrow: 'movie night',
          title: n.film.title,
          meta: formatNightTimeLabel(n.scheduledFor, n.tzOffsetMinutes, n.timeTbd),
          cta: 'are you in?',
          onPress: () => openNight(n.id),
        });
      }
    }
    for (const inv of invitesResult.data?.invites ?? []) {
      out.push({
        id: `inv_${inv.id}`, kind: 'list-invite', eyebrow: 'list invite',
        title: inv.listName ?? 'a list',
        meta: inv.inviterUsername ? `@${inv.inviterUsername} added you` : undefined,
        cta: 'have a look',
        onPress: () => router.push('/notifications'),
      });
    }
    if (unfiledFilms.length) {
      out.push({
        id: 'unfiled', kind: 'unfiled', eyebrow: 'unfiled',
        title: 'give them a home',
        meta: `${unfiledFilms.length} film${unfiledFilms.length === 1 ? '' : 's'} waiting`,
        cta: 'file them',
        onPress: () => router.push('/unfiled'),
      });
    }
    return out;
  }, [upcomingNights, invitesResult.data, unfiledFilms, user?.uid, openNight, router]);

  const handleRefresh = useCallback(async () => {
    setRefreshKey((prev) => prev + 1);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, []);

  const handleScan = useCallback(() => {
    haptic('selection');
    router.push('/extract');
  }, [router]);

  if (isUserLoading || !user) {
    // Paint the destination shell immediately (LCP) instead of a lone spinner —
    // real content fills in over it once auth + data resolve.
    return <HomeSkeleton />;
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

            {/* ── Phase D3 — the blocks that work with zero friends ──
                Each renders only when it has something to say (see
                home-blocks.tsx). The discovery rails that used to sit here
                moved into the search overlay's discover state: they are global
                rather than follow-graph, so they still have content on day one
                — they just stopped competing with the grab for the front door.
                The feed keeps its place at the bottom, always last. */}
            {isForYou && (
              <>
                <YourWeek nights={upcomingNights} />
                <NeedsYou items={needsYou} />
                <UnfiledStrip films={unfiledFilms} />
                <YourLists lists={homeLists} total={allLists.length} />
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

      {/* The discovery rails and their "view all" screens moved to the search
          overlay's discover pane in D3 — see the comment at their new home. */}
    </MovieModalProvider>
  );
}
