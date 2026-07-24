'use client';

import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from '@/lib/native-nav';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { nightPhase, isMorningAfterSnoozed } from '@/lib/movie-night-format';
import { CreateNightSheet } from './create-night-sheet';
import { NightDetailSheet } from './night-detail-sheet';
import { MorningAfterFlow } from './morning-after-sheet';
import { MovieNightReminderToastBridge } from './movie-night-reminder-toast';
import type { MovieNightFilm, MovieNightView } from '@/lib/movie-night-types';

/**
 * Movie Night — app-wide provider (MOVIE-NIGHT-PLAN.md § S3 client: create
 * flow + entry points + provider foundation; § S4 adds the morning-after
 * auto-offer). Mounted once in the root layout, next to `StoryShareProvider`
 * (same "hoisted singleton sheet" pattern — any screen calls
 * `useMovieNight()` instead of importing a sheet directly).
 *
 * `openCreate` mounts the MN03 create flow. `openNight` mounts the MN10
 * detail sheet keyed on the given id — the `/home?night=<id>` deep link,
 * every "see the night" tap, and every compact `MovieNightCard` all funnel
 * through it.
 *
 * The MN25 morning-after prompt is auto-OFFERED (not called directly by
 * consumers) via two independent triggers, both landing on the same
 * `morningAfterNightId` state:
 *   1. The `?night=<id>&after=1` deep link — the S2 ticker's own morning-after
 *      push carries this URL (`notifications-server.ts` `movieNightUrl` +
 *      `&after=1` override). `NightParamWatcher` below branches on `after`
 *      instead of opening the plain detail sheet.
 *   2. A one-time boot check: once the viewer is authenticated, scan
 *      `GET /movie-nights/upcoming` (the S1 window already reaches back 36h)
 *      for a night still `status:'proposed'` whose `nightPhase` reads `past`
 *      — i.e. it happened and nobody has recorded an outcome yet — and isn't
 *      snoozed (`isMorningAfterSnoozed`, a per-night "not now" flag). Runs
 *      once per app session (a ref guard), so re-navigating around the app
 *      doesn't re-trigger it; the snooze flag is what stops it from nagging
 *      on the NEXT app open.
 */

export type MovieNightListContext = {
  id: string;
  ownerId: string;
  name: string;
  /** Optional hint — the create sheet re-fetches the full member list itself
   *  (it needs live usernames/photos for the people picker), this just lets
   *  a caller that already has the ids pass them through untouched. */
  memberUids?: string[];
};

export type OpenCreateArgs = {
  film?: MovieNightFilm;
  list?: MovieNightListContext;
};

type MovieNightContextValue = {
  /** Open the MN03 create sheet. Omit `film` for the film-first path (MN02) —
   *  the sheet opens with the film slot empty and prompts the picker. */
  openCreate: (args?: OpenCreateArgs) => void;
  /** Open a night's detail (MN10). */
  openNight: (id: string) => void;
  /** Open the MN25 morning-after prompt for a specific night (C3 — driven
   *  by the same state the boot auto-offer and the `&after=1` deep link
   *  use). A `movie_night_morning_after` notification row should call this,
   *  not `openNight`, so it lands on "how was it?" instead of the plain
   *  detail sheet. */
  openMorningAfter: (id: string) => void;
  /** Bumps every time a night mutates (create/RSVP/reschedule/cancel) —
   *  feed/pin surfaces (`movie-night-feed-card.tsx`, `movie-night-pin.tsx`)
   *  fold this into their `useCachedAction` key so they revalidate instead of
   *  waiting out their own cache TTL. Read-only; call `refreshUpcoming()` to
   *  bump it (any consumer that just performed its OWN mutation may call it —
   *  the detail/create sheets already do this internally). */
  refreshToken: number;
  refreshUpcoming: () => void;
};

const MovieNightContext = createContext<MovieNightContextValue | null>(null);

export function useMovieNight(): MovieNightContextValue {
  const ctx = useContext(MovieNightContext);
  if (!ctx) throw new Error('useMovieNight must be used within a MovieNightProvider');
  return ctx;
}

/** Isolated so `useSearchParams()` can bail into a Suspense boundary during
 *  the static-export prerender without forcing one on every consumer of
 *  `MovieNightProvider` (matches the `/extract` page's Suspense pattern). */
function NightParamWatcher({
  onNightParam, onAfterParam,
}: { onNightParam: (id: string) => void; onAfterParam: (id: string) => void }) {
  const searchParams = useSearchParams();
  const nightParam = searchParams?.get('night') ?? null;
  const afterParam = searchParams?.get('after') === '1';
  const lastHandled = useRef<string | null>(null);

  useEffect(() => {
    if (!nightParam) return;
    const key = afterParam ? `${nightParam}#after` : nightParam;
    if (lastHandled.current === key) return;
    lastHandled.current = key;
    if (afterParam) onAfterParam(nightParam);
    else onNightParam(nightParam);
  }, [nightParam, afterParam, onNightParam, onAfterParam]);

  return null;
}

export function MovieNightProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [createArgs, setCreateArgs] = useState<OpenCreateArgs | null>(null);
  const [openNightId, setOpenNightId] = useState<string | null>(null);
  const [morningAfterNightId, setMorningAfterNightId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const openCreate = useCallback((args: OpenCreateArgs = {}) => {
    setCreateArgs(args);
  }, []);

  const openNight = useCallback((id: string) => {
    setOpenNightId(id);
  }, []);

  const openMorningAfter = useCallback((id: string) => {
    setMorningAfterNightId(id);
  }, []);

  const refreshUpcoming = useCallback(() => {
    setRefreshToken((n) => n + 1);
  }, []);

  // C2 — mutual exclusion for the boot-time morning-after auto-offer.
  // Latest-value refs (NOT the state itself) so the async boot check can
  // read what's open at RESOLVE time, not just at launch time — a create/
  // detail/morning-after sheet opened WHILE the `/upcoming` request was in
  // flight must still win.
  const openNightIdRef = useRef<string | null>(null);
  const morningAfterNightIdRef = useRef<string | null>(null);
  const createArgsRef = useRef<OpenCreateArgs | null>(null);
  useEffect(() => { openNightIdRef.current = openNightId; }, [openNightId]);
  useEffect(() => { morningAfterNightIdRef.current = morningAfterNightId; }, [morningAfterNightId]);
  useEffect(() => { createArgsRef.current = createArgs; }, [createArgs]);

  // A `?night` deep link consumed THIS SESSION (with or without `&after=1`)
  // permanently skips the boot scan — the user already engaged with a
  // specific night via the link; the boot auto-offer shouldn't also fire.
  const nightParamConsumedRef = useRef(false);
  const handleNightParam = useCallback((id: string) => {
    nightParamConsumedRef.current = true;
    openNight(id);
  }, [openNight]);
  const handleAfterParam = useCallback((id: string) => {
    nightParamConsumedRef.current = true;
    openMorningAfter(id);
  }, [openMorningAfter]);

  // The boot-time auto-offer — once per authenticated uid this session (keyed
  // per uid, not a plain boolean, so signing into a DIFFERENT account in the
  // same app session re-checks for that account instead of staying silent
  // forever after the first user's boot check ran).
  const checkedBootForUid = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.uid || checkedBootForUid.current === user.uid) return;
    checkedBootForUid.current = user.uid;
    if (nightParamConsumedRef.current) return;
    (async () => {
      try {
        const nights = await apiCall<MovieNightView[]>('GET', '/api/v1/movie-nights/upcoming');
        // Re-check at RESOLVE time — a deep link may have been consumed, or
        // the create/detail/morning-after sheet may have opened, WHILE this
        // request was in flight.
        if (nightParamConsumedRef.current) return;
        if (openNightIdRef.current || morningAfterNightIdRef.current || createArgsRef.current) return;
        const due = nights.find(
          (n) => n.status === 'proposed' && nightPhase(n.scheduledFor) === 'past' && !isMorningAfterSnoozed(n.id),
        );
        if (due) setMorningAfterNightId(due.id);
      } catch {
        // Non-critical — the ticker's push + the next app open both retry this.
      }
    })();
  }, [user?.uid]);

  const value = useMemo(
    () => ({ openCreate, openNight, openMorningAfter, refreshToken, refreshUpcoming }),
    [openCreate, openNight, openMorningAfter, refreshToken, refreshUpcoming],
  );

  return (
    <MovieNightContext.Provider value={value}>
      <Suspense fallback={null}>
        <NightParamWatcher onNightParam={handleNightParam} onAfterParam={handleAfterParam} />
      </Suspense>
      {children}
      <CreateNightSheet
        args={createArgs}
        onClose={() => setCreateArgs(null)}
        onOpenNight={openNight}
        onNightMutated={refreshUpcoming}
      />
      <NightDetailSheet
        nightId={openNightId}
        onClose={() => setOpenNightId(null)}
        onMutated={refreshUpcoming}
      />
      <MorningAfterFlow
        nightId={morningAfterNightId}
        onClose={() => setMorningAfterNightId(null)}
        onOpenNight={openNight}
        onMutated={refreshUpcoming}
      />
      <MovieNightReminderToastBridge onOpenNight={openNight} />
    </MovieNightContext.Provider>
  );
}
