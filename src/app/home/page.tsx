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
  YourWeek, NeedsYou, UnfiledStrip, TonightHero, useUnfiledFilms,
  type NeedsYouItem,
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
import type { ListInvite } from '@/lib/types';
import type { TonightFilm } from '@/lib/tonight-server';
import { getMovieOrTVDetails } from '@/lib/tmdb-details-cache';


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
  const { openNight, openCreate } = useMovieNight();
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

  const unfiledFilms = useUnfiledFilms();

  // ── D4 — the tonight hero ──────────────────────────────────────────────
  // A night scheduled for today outranks any suggestion: the decision is made,
  // and the hero's job becomes making it tappable rather than second-guessing
  // it. Only then does the "what should we watch?" variant get a turn.
  const tonightNight = useMemo(
    () => upcomingNights.find(
      (n) => new Date(n.scheduledFor).toDateString() === new Date().toDateString(),
    ) ?? null,
    [upcomingNights],
  );

  // A POOL, shuffled on the client — `another` must be free, so it never
  // re-fetches (see tonight-server.ts).
  const tonightResult = useCachedAction<{ films: TonightFilm[] }>(
    user && !tonightNight ? `tonight:${user.uid}` : null,
    () => apiCall<{ films: TonightFilm[] }>('GET', '/api/v1/tonight'),
    { staleTime: 300_000 },
  );
  const pool = tonightResult.data?.films ?? [];
  const [shuffleIdx, setShuffleIdx] = useState(0);
  const suggestion = pool.length ? pool[shuffleIdx % pool.length] : null;

  // Runtime for the ONE film on screen, client-direct from the module-cached
  // TMDB helper — no Firestore read, and nothing fetched for the other 29.
  const [runtimeLabel, setRuntimeLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRuntimeLabel(null);
    if (!suggestion) return;
    (async () => {
      const d = await getMovieOrTVDetails(suggestion.mediaType, suggestion.tmdbId);
      if (cancelled || !d) return;
      const mins = 'runtime' in d && typeof d.runtime === 'number' ? d.runtime : null;
      if (mins) setRuntimeLabel(`${Math.floor(mins / 60)}h ${mins % 60}m`);
    })();
    return () => { cancelled = true; };
  }, [suggestion?.tmdbId, suggestion?.mediaType]);

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

  // ── which hero ─────────────────────────────────────────────────────────
  // One decision, made once, rather than three branches in the JSX. Order is a
  // product claim: a plan beats a suggestion, and a suggestion beats a pitch.
  const heroFilm = tonightNight
    ? { tmdbId: tonightNight.film.tmdbId, mediaType: tonightNight.film.mediaType }
    : suggestion
      ? { tmdbId: suggestion.tmdbId, mediaType: suggestion.mediaType }
      : null;
  const [heroBackdrop, setHeroBackdrop] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHeroBackdrop(null);
    if (!heroFilm) return;
    (async () => {
      // Client-direct + module-cached: the hero's image costs no Firestore read.
      const d = await getMovieOrTVDetails(heroFilm.mediaType, heroFilm.tmdbId);
      if (cancelled || !d) return;
      const path = 'backdrop_path' in d ? (d as { backdrop_path?: string | null }).backdrop_path : null;
      if (path) setHeroBackdrop(`https://image.tmdb.org/t/p/w780${path}`);
      const mins = 'runtime' in d && typeof d.runtime === 'number' ? d.runtime : null;
      if (mins) setRuntimeLabel(`${Math.floor(mins / 60)}h ${mins % 60}m`);
    })();
    return () => { cancelled = true; };
  }, [heroFilm?.tmdbId, heroFilm?.mediaType]);

  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase();
  const heroProps = tonightNight
    ? {
        kind: 'night' as const,
        eyebrow: `tonight · ${weekday}`,
        title: tonightNight.film.title,
        line: [
          formatNightTimeLabel(tonightNight.scheduledFor, tonightNight.tzOffsetMinutes, tonightNight.timeTbd),
          tonightNight.invitees.filter((i) => i.answer === 'in').length
            ? `${tonightNight.invitees.filter((i) => i.answer === 'in').length} in`
            : null,
        ].filter(Boolean).join(' · '),
        backdropUrl: heroBackdrop,
        seed: tonightNight.id,
        primaryLabel: 'see the night',
        primaryIcon: 'calendar' as const,
        onPrimary: () => openNight(tonightNight.id),
      }
    : suggestion
      ? {
          kind: 'suggestion' as const,
          eyebrow: `tonight · ${weekday}`,
          title: suggestion.title,
          line: [
            suggestion.listCount > 0 ? `on ${suggestion.listCount} of your lists` : 'waiting in unfiled',
            suggestion.year || null,
            runtimeLabel,
          ].filter(Boolean).join(' · '),
          backdropUrl: heroBackdrop,
          seed: String(suggestion.tmdbId),
          primaryLabel: "that's the one",
          primaryIcon: 'check' as const,
          onPrimary: () => openCreate({
            film: {
              tmdbId: suggestion.tmdbId, mediaType: suggestion.mediaType,
              title: suggestion.title, year: suggestion.year,
              posterUrl: suggestion.posterUrl, runtime: null,
            },
          }),
          onShuffle: pool.length > 1 ? () => setShuffleIdx((i) => i + 1) : undefined,
        }
      : {
          // Nothing planned, nothing saved: a brand-new account. Showing it an
          // empty calendar was the cold-start failure this phase exists to fix,
          // so the hero becomes the pitch and the one button that starts the loop.
          kind: 'first-run' as const,
          eyebrow: 'start here',
          title: 'share the reel.\nkeep the film.',
          line: 'hit share on any tiktok, reel or short and cinechrony pulls the films out of it.',
          backdropUrl: null,
          seed: user?.uid ?? 'cinechrony',
          primaryLabel: 'scan a reel',
          primaryIcon: 'scan' as const,
          onPrimary: () => { haptic('selection'); router.push('/extract'); },
        };

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
                <TonightHero {...heroProps} />
                <NeedsYou items={needsYou} />
                <UnfiledStrip films={unfiledFilms} />
                {/* The week strip only when it has something to say: a night
                    later this week. With a night TONIGHT the hero already is
                    the week's headline, and with no nights at all it is seven
                    empty circles pretending to be information.
                    `your lists` is gone from home entirely — there is a lists
                    tab one thumb away, and duplicating it here bought nothing. */}
                {!tonightNight && upcomingNights.length > 0 && (
                  <YourWeek nights={upcomingNights} />
                )}
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
