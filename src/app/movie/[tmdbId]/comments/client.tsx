'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from '@/lib/native-nav';
import Link from 'next/link';
import { ChevronLeft, Loader2, ArrowUp, X, Star } from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-avatar';
import { SwipeBackContainer } from '@/components/swipe-back-container';
import { ReviewsSummaryCard } from '@/components/v3/reviews-summary-card';
import { ReviewWallCard } from '@/components/v3/review-wall-card';
import { ReviewComposerSheet, type ComposerFilm } from '@/components/v3/review-composer-sheet';
import { ReviewReactOverlay } from '@/components/v3/review-react-overlay';
import { useStoryShare } from '@/components/story-share-provider';
import { useUser, useFirestore } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { readCachedAction, setCachedAction, isCachedActionFresh } from '@/lib/use-cached-action';
import { useToast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import { getMovieOrTVDetails } from '@/lib/tmdb-details-cache';
import { verdictForRating } from '@/lib/review-verdict';
import { useUserRatingsCache } from '@/contexts/user-ratings-cache';
import type { ReactionType, ReactionCounts } from '@/lib/review-reactions';
import type { WallReview, ReviewsWall } from '@/lib/reviews-server';
import type { Review, TMDBCrew } from '@/lib/types';

type Sort = 'helpful' | 'recent' | 'highest';

// SWR window: a re-open within this paints from cache instantly + skips the
// refetch. Own-action mutations write the cache in lockstep, so it's never
// stale after the viewer's own post/react/reply.
const WALL_STALE_MS = 30_000;

/** Map a freshly-created server Review → the wall shape (no reactions/helpful yet). */
function reviewToWall(r: Review): WallReview {
  const createdAt =
    r.createdAt instanceof Date
      ? r.createdAt.toISOString()
      : typeof r.createdAt === 'string'
        ? r.createdAt
        : new Date().toISOString();
  return {
    id: r.id,
    tmdbId: r.tmdbId,
    mediaType: r.mediaType,
    movieTitle: r.movieTitle,
    moviePosterUrl: r.moviePosterUrl ?? null,
    userId: r.userId,
    username: r.username,
    userDisplayName: r.userDisplayName,
    userPhotoUrl: r.userPhotoUrl,
    text: r.text,
    ratingAtTime: r.ratingAtTime,
    verdict: verdictForRating(r.ratingAtTime),
    hasSpoiler: !!r.hasSpoiler,
    parentId: r.parentId,
    replyCount: r.replyCount ?? 0,
    helpful: r.likes ?? 0,
    myHelpful: false,
    reactionCounts: {},
    myReaction: null,
    createdAt,
  };
}

/** Optimistic reaction math (one-per-user): apply `newType` (null = remove). */
function applyReactionLocally(r: WallReview, newType: ReactionType | null) {
  const counts: Record<string, number> = { ...(r.reactionCounts as Record<string, number>) };
  if (r.myReaction) counts[r.myReaction] = Math.max(0, (counts[r.myReaction] ?? 1) - 1);
  if (newType) counts[newType] = (counts[newType] ?? 0) + 1;
  for (const k of Object.keys(counts)) if (!counts[k]) delete counts[k];
  return { counts: counts as ReactionCounts, myReaction: newType };
}

const SORTS: { id: Sort; label: string }[] = [
  { id: 'helpful', label: 'helpful' },
  { id: 'recent', label: 'recent' },
  { id: 'highest', label: 'highest' },
];

/**
 * SortTabs — the F12 sort control: a compact, content-sized track with a
 * HIGH-CONTRAST active pill (black-in-light / white-in-dark, per the design).
 * Deliberately not the shared full-width `Segmented` (its flex-1 cells collapse
 * + overlap when dropped into a content-width slot, and its thumb is the wrong,
 * low-contrast colour for this surface).
 */
function SortTabs({ value, onChange }: { value: Sort; onChange: (s: Sort) => void }) {
  return (
    <div className="inline-flex flex-shrink-0 items-center rounded-full bg-sunken p-0.5">
      {SORTS.map((s) => {
        const active = value === s.id;
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={active}
            onClick={() => { if (!active) haptic('selection'); onChange(s.id); }}
            className={`h-8 rounded-full px-2.5 font-ui text-[12.5px] font-semibold lowercase tracking-tight transition-colors ${
              active ? 'bg-foreground text-background' : 'text-muted-foreground active:text-foreground'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function CommentsPageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { getRating } = useUserRatingsCache();
  const story = useStoryShare();

  const tmdbId = Number(params.tmdbId);
  const movieTitle = searchParams.get('title') || 'this film';
  const moviePoster = searchParams.get('poster') || '';
  const mediaType = (searchParams.get('type') || 'movie') as 'movie' | 'tv';

  const returnPath = searchParams.get('returnPath');
  const returnListId = searchParams.get('returnListId');
  const returnListOwnerId = searchParams.get('returnListOwnerId');
  const returnMovieId = searchParams.get('returnMovieId');

  // Per-caller, per-film cache key (the wall payload carries the viewer's own
  // reaction/helpful state + friends-seen, so it can't be shared across users).
  const wallKey = `reviews-wall:${user?.uid ?? 'anon'}:${tmdbId}`;

  const [wall, setWall] = useState<ReviewsWall | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sort, setSort] = useState<Sort>('helpful');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [userProfile, setUserProfile] = useState<{ photoURL?: string; displayName?: string; username?: string } | null>(null);
  const [filmMeta, setFilmMeta] = useState<{ year: string | null; director: string | null }>({ year: null, director: null });

  // composer (F13)
  const [composer, setComposer] = useState<{ open: boolean; mode: 'rate' | 'write' }>({ open: false, mode: 'write' });
  // long-press react/action overlay (F14)
  const [reactTarget, setReactTarget] = useState<{ review: WallReview; top: number } | null>(null);
  // reply mode (F15)
  const [replyingTo, setReplyingTo] = useState<WallReview | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  const replyInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Per-review guard: debounce overlapping helpful toggles (a fast double-tap
  // must not fire two /like POSTs and desync the UI from the server).
  const helpfulInFlight = useRef<Set<string>>(new Set());

  // ── Back navigation (preserves the original route context — security) ─────
  const handleBack = useCallback(() => {
    if (returnPath && returnMovieId) {
      router.replace(`${returnPath}?${new URLSearchParams({ openMovie: returnMovieId }).toString()}`);
    } else if (returnListId && returnMovieId) {
      const p = new URLSearchParams({ openMovie: returnMovieId });
      if (returnListOwnerId) p.set('owner', returnListOwnerId);
      router.replace(`/lists/${returnListId}?${p.toString()}`);
    } else {
      router.back();
    }
  }, [returnPath, returnListId, returnMovieId, returnListOwnerId, router]);

  useEffect(() => {
    if ((!returnPath && !returnListId) || !returnMovieId) return;
    window.history.pushState({ commentsPage: true }, '');
    const onPop = () => {
      const p = new URLSearchParams({ openMovie: returnMovieId });
      if (returnPath) router.replace(`${returnPath}?${p.toString()}`);
      else if (returnListId) {
        if (returnListOwnerId) p.set('owner', returnListOwnerId);
        router.replace(`/lists/${returnListId}?${p.toString()}`);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [returnPath, returnListId, returnMovieId, returnListOwnerId, router]);

  // ── Load the wall (one read; sort happens client-side) ────────────────────
  const loadWall = useCallback(async () => {
    try {
      const result = await apiCall<ReviewsWall>('GET', `/api/v1/movies/${tmdbId}/reviews-wall`);
      setWall(result);
      setCachedAction(wallKey, result);
    } catch (err) {
      console.error('Failed to load reviews wall:', err);
    } finally {
      setIsLoading(false);
    }
  }, [tmdbId, wallKey]);

  // SWR: paint the cached wall instantly on (re)open, then refresh in the
  // background only if it's stale. Gated on auth resolving so the key + the
  // per-caller my-state are correct (no anon→uid double-fetch).
  useEffect(() => {
    if (isUserLoading) return;
    const cached = readCachedAction<ReviewsWall>(wallKey);
    if (cached) {
      setWall(cached);
      setIsLoading(false);
    }
    if (!cached || !isCachedActionFresh(wallKey, WALL_STALE_MS)) {
      if (!cached) setIsLoading(true);
      loadWall();
    }
  }, [isUserLoading, wallKey, loadWall]);

  // Viewer avatar (freshest from Firestore) for the bottom bar.
  useEffect(() => {
    if (!user || !firestore) return;
    let cancelled = false;
    getDoc(doc(firestore, 'users', user.uid)).then((d) => {
      if (cancelled || !d.exists()) return;
      const data = d.data();
      setUserProfile({ photoURL: data?.photoURL, displayName: data?.displayName, username: data?.username });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user, firestore]);

  // Film subtitle (year · director) for the composer header — module-cached.
  useEffect(() => {
    if (!Number.isFinite(tmdbId)) return;
    let cancelled = false;
    getMovieOrTVDetails(mediaType, tmdbId).then((d) => {
      if (cancelled || !d) return;
      const raw = (d as { release_date?: string; first_air_date?: string }).release_date
        || (d as { first_air_date?: string }).first_air_date || '';
      const crew = (d?.credits?.crew ?? []) as TMDBCrew[];
      setFilmMeta({ year: raw ? raw.slice(0, 4) : null, director: crew.find((c) => c.job === 'Director')?.name ?? null });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [mediaType, tmdbId]);

  // iOS keyboard inset for the bottom bar (mirrors the proven pattern).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKeyboardHeight(Math.max(0, window.innerHeight - vv.height));
    onResize();
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    return () => { vv.removeEventListener('resize', onResize); vv.removeEventListener('scroll', onResize); };
  }, []);

  // ── Tree mutators ─────────────────────────────────────────────────────────
  const patchReview = useCallback((reviewId: string, patch: Partial<WallReview>) => {
    setWall((w) => {
      if (!w) return w;
      const reviews = w.reviews.map((r) => {
        if (r.id === reviewId) return { ...r, ...patch };
        if (r.replies?.some((rep) => rep.id === reviewId)) {
          return { ...r, replies: r.replies.map((rep) => (rep.id === reviewId ? { ...rep, ...patch } : rep)) };
        }
        return r;
      });
      const next = { ...w, reviews };
      // Keep the SWR cache in lockstep so a re-open never shows a state older
      // than the viewer's own just-made react/helpful.
      setCachedAction(wallKey, next);
      return next;
    });
  }, [wallKey]);

  const findReview = useCallback((reviewId: string): WallReview | undefined => {
    for (const r of wall?.reviews ?? []) {
      if (r.id === reviewId) return r;
      const rep = r.replies?.find((x) => x.id === reviewId);
      if (rep) return rep;
    }
    return undefined;
  }, [wall]);

  // ── React / helpful (optimistic, reconciled with the server response) ─────
  const handleReact = useCallback(async (reviewId: string, type: ReactionType | null) => {
    if (!user) { toast({ title: 'sign in to react' }); return; }
    const r = findReview(reviewId);
    if (!r) { loadWall(); return; } // target fell out of state (capped/stale) — reconcile
    const optimistic = applyReactionLocally(r, type);
    patchReview(reviewId, { reactionCounts: optimistic.counts, myReaction: optimistic.myReaction });
    try {
      const res = type
        ? await apiCall<{ counts: ReactionCounts; myReaction: ReactionType }>('POST', `/api/v1/reviews/${reviewId}/react`, { type })
        : await apiCall<{ counts: ReactionCounts; myReaction: null }>('DELETE', `/api/v1/reviews/${reviewId}/react`);
      patchReview(reviewId, { reactionCounts: res.counts, myReaction: res.myReaction });
    } catch {
      patchReview(reviewId, { reactionCounts: r.reactionCounts, myReaction: r.myReaction });
      toast({ variant: 'destructive', title: 'reaction failed' });
    }
  }, [user, findReview, patchReview, toast, loadWall]);

  const handleHelpful = useCallback(async (reviewId: string, next: boolean) => {
    if (!user) { toast({ title: 'sign in to mark helpful' }); return; }
    if (helpfulInFlight.current.has(reviewId)) return; // debounce overlapping toggles
    const r = findReview(reviewId);
    if (!r) { loadWall(); return; } // target fell out of state — reconcile
    helpfulInFlight.current.add(reviewId);
    patchReview(reviewId, { myHelpful: next, helpful: Math.max(0, r.helpful + (next ? 1 : -1)) });
    try {
      const res = next
        ? await apiCall<{ likes: number }>('POST', `/api/v1/reviews/${reviewId}/like`)
        : await apiCall<{ likes: number }>('DELETE', `/api/v1/reviews/${reviewId}/like`);
      patchReview(reviewId, { helpful: res.likes, myHelpful: next });
    } catch (err) {
      // 409 = the server is already in the desired state (a racing duplicate
      // toggle) — keep the optimistic state rather than reverting into a desync.
      if (err instanceof ApiClientError && err.status === 409) {
        patchReview(reviewId, { myHelpful: next });
      } else {
        patchReview(reviewId, { myHelpful: r.myHelpful, helpful: r.helpful });
      }
    } finally {
      helpfulInFlight.current.delete(reviewId);
    }
  }, [user, findReview, patchReview, toast, loadWall]);

  // ── Reply (F15) ───────────────────────────────────────────────────────────
  const startReply = useCallback((review: WallReview) => {
    setReplyingTo(review);
    setReplyText('');
    setTimeout(() => replyInputRef.current?.focus(), 60);
  }, []);

  const sendReply = useCallback(async () => {
    if (!replyingTo || !replyText.trim() || replySending) return;
    const root = replyingTo.parentId || replyingTo.id;
    setReplySending(true);
    try {
      const { review } = await apiCall<{ review: Review }>('POST', '/api/v1/reviews', {
        tmdbId, mediaType, movieTitle, moviePosterUrl: moviePoster || undefined,
        text: replyText.trim(), parentId: root,
      });
      const wr = reviewToWall(review);
      setWall((w) => {
        if (!w) return w;
        const next = {
          ...w,
          reviews: w.reviews.map((r) =>
            r.id === root ? { ...r, replyCount: r.replyCount + 1, replies: [...(r.replies ?? []), wr] } : r,
          ),
        };
        setCachedAction(wallKey, next);
        return next;
      });
      setReplyText('');
      setReplyingTo(null);
      replyInputRef.current?.blur();
    } catch (err) {
      toast({ variant: 'destructive', title: 'reply failed', description: err instanceof ApiClientError ? err.message : undefined });
    } finally {
      setReplySending(false);
    }
  }, [replyingTo, replyText, replySending, tmdbId, mediaType, movieTitle, moviePoster, toast, wallKey]);

  // ── Overlay actions ───────────────────────────────────────────────────────
  const handleCopy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).then(() => toast({ title: 'copied' })).catch(() => {});
  }, [toast]);

  const handleReportOrDelete = useCallback(async (review: WallReview) => {
    const own = !!user && user.uid === review.userId;
    if (own) {
      try {
        await apiCall('DELETE', `/api/v1/reviews/${review.id}`);
        haptic('success');
        await loadWall();
        toast({ title: 'deleted' });
      } catch {
        toast({ variant: 'destructive', title: 'delete failed' });
      }
    } else {
      try {
        await apiCall('POST', '/api/v1/reports', { contentType: 'review', targetId: review.id, reason: `Reported review ${review.id}` });
        toast({ title: 'reported', description: 'thanks — we’ll take a look.' });
      } catch {
        toast({ variant: 'destructive', title: 'report failed' });
      }
    }
  }, [user, loadWall, toast]);

  // ── Derived: client-side sort + featured most-helpful ─────────────────────
  const sorted = useMemo(() => {
    const list = [...(wall?.reviews ?? [])];
    const t = (r: WallReview) => Date.parse(r.createdAt) || 0;
    if (sort === 'helpful') list.sort((a, b) => b.helpful - a.helpful || t(b) - t(a));
    else if (sort === 'highest') list.sort((a, b) => (b.ratingAtTime ?? -1) - (a.ratingAtTime ?? -1) || t(b) - t(a));
    else list.sort((a, b) => t(b) - t(a));
    return list;
  }, [wall, sort]);

  const featured = sort === 'helpful' && sorted[0] && sorted[0].helpful > 0 ? sorted[0] : null;
  const rest = featured ? sorted.slice(1) : sorted;

  const composerFilm: ComposerFilm = {
    tmdbId, mediaType, title: movieTitle, year: filmMeta.year, director: filmMeta.director,
    posterUrl: moviePoster || null,
  };

  const summary = wall?.summary;
  const hasReviews = (wall?.reviews.length ?? 0) > 0;
  // Resolve the long-pressed review against LIVE state each render, so the
  // overlay's label / active-reaction / helpful direction never act on a stale
  // snapshot captured at press time.
  const liveReactReview = reactTarget ? findReview(reactTarget.review.id) ?? reactTarget.review : null;

  const cardHandlers = {
    onReact: handleReact,
    onHelpful: handleHelpful,
    onReply: startReply,
    onLongPress: (review: WallReview, top: number) => { haptic('medium'); setReactTarget({ review, top }); },
  };

  return (
    <SwipeBackContainer onBack={handleBack} disabled={keyboardHeight > 0 || composer.open || !!reactTarget} className="bg-background flex flex-col">
      {/* header */}
      <header
        className="z-10 flex-shrink-0 border-b border-hair/70 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <div className="flex items-center px-3 pb-2.5">
          <button onClick={handleBack} aria-label="Back" className="-ml-1.5 flex h-10 w-10 items-center justify-center text-primary transition-transform active:scale-90">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <h1 className="flex-1 text-center font-headline text-[18px] font-bold lowercase tracking-tight">reviews</h1>
          <div className="-mr-1.5 h-10 w-10" aria-hidden />
        </div>
      </header>

      {/* scroll body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 pb-6 pt-4">
          {isLoading ? (
            <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : !hasReviews ? (
            <div className="py-20 text-center">
              <div className="cc-eyebrow">reviews</div>
              <p className="mt-3 font-serif text-[17px] italic text-muted-foreground">no reviews yet. be the first to write one.</p>
            </div>
          ) : (
            <>
              {summary && <ReviewsSummaryCard title={movieTitle} posterUrl={moviePoster || null} summary={summary} />}

              {/* friends-seen rail */}
              {summary && summary.friendsSeenCount > 0 && (
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex -space-x-2.5">
                    {summary.friendsSeen.map((f) => (
                      <span key={f.uid} className="ring-2 ring-background rounded-full">
                        <ProfileAvatar photoURL={f.photoURL} displayName={f.displayName} username={f.username} size="sm" />
                      </span>
                    ))}
                  </div>
                  <span className="font-ui text-[14px] text-muted-foreground">
                    {summary.friendsSeenCount} {summary.friendsSeenCount === 1 ? 'friend' : 'friends'} reviewed this
                  </span>
                </div>
              )}

              {/* the reviews + sort */}
              <div className="mt-7 flex items-center justify-between gap-2">
                <h2 className="min-w-0 truncate font-headline text-[22px] font-bold lowercase tracking-tight text-foreground">the reviews</h2>
                <SortTabs value={sort} onChange={setSort} />
              </div>

              <div className="mt-4 space-y-4">
                {featured && (
                  <ReviewWallCard key={featured.id} review={featured} currentUserId={user?.uid ?? null} featured {...cardHandlers} />
                )}
                {rest.map((review) => (
                  <ReviewWallCard key={review.id} review={review} currentUserId={user?.uid ?? null} {...cardHandlers} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* bottom bar — write-a-review / rate, or reply mode (F15) */}
      <div
        className="flex-shrink-0 border-t border-hair bg-background"
        style={{ paddingBottom: keyboardHeight > 0 ? Math.max(12, keyboardHeight - 20) : undefined, transition: 'padding-bottom 0.12s ease-out' }}
      >
        {!replyingTo ? (
          <div className="flex items-center gap-2.5 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
            <ProfileAvatar photoURL={userProfile?.photoURL} displayName={userProfile?.displayName} username={userProfile?.username} size="sm" />
            {user ? (
              <>
                <button
                  onClick={() => { haptic('light'); setComposer({ open: true, mode: 'write' }); }}
                  className="h-11 flex-1 rounded-full border border-hair bg-sunken px-4 text-left font-ui text-[15px] text-muted-foreground active:opacity-70"
                >
                  write a review…
                </button>
                <button
                  onClick={() => { haptic('light'); setComposer({ open: true, mode: 'rate' }); }}
                  className="inline-flex h-11 flex-shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 font-headline text-[15px] font-bold lowercase text-primary-foreground shadow-fab transition-transform active:scale-95"
                >
                  <Star className="h-4 w-4" strokeWidth={2.2} /> rate
                </button>
              </>
            ) : (
              <Link href="/login" className="h-11 flex-1 inline-flex items-center justify-center rounded-full bg-foreground font-headline text-[15px] font-semibold lowercase text-background">
                sign in to review
              </Link>
            )}
          </div>
        ) : (
          <div>
            {/* replying-to context bar */}
            <div className="flex items-center gap-3 border-b border-hair px-4 py-2.5">
              <span className="w-0.5 self-stretch flex-shrink-0 rounded-full bg-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-ui text-[13px] font-semibold text-foreground">
                  replying to <span className="text-primary">@{replyingTo.username || replyingTo.userDisplayName || 'someone'}</span>’s review
                </p>
                <p className="truncate font-ui text-[12.5px] text-muted-foreground">{replyingTo.text}</p>
              </div>
              <button onClick={() => { setReplyingTo(null); setReplyText(''); }} aria-label="Cancel reply" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90">
                <X className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>
            <div className="flex items-center gap-2.5 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
              <ProfileAvatar photoURL={userProfile?.photoURL} displayName={userProfile?.displayName} username={userProfile?.username} size="sm" />
              <input
                ref={replyInputRef}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendReply(); } }}
                placeholder="write a reply…"
                maxLength={1000}
                className="h-11 flex-1 rounded-full border border-primary bg-paper px-4 font-ui text-foreground outline-none placeholder:text-muted-foreground/60"
                style={{ fontSize: '16px' }}
              />
              <button
                onClick={sendReply}
                disabled={!replyText.trim() || replySending}
                aria-label="Send reply"
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-fab transition-transform active:scale-90 disabled:opacity-40 disabled:shadow-none"
              >
                {replySending ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.4} />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* composer (F13) */}
      <ReviewComposerSheet
        isOpen={composer.open}
        onClose={() => setComposer((c) => ({ ...c, open: false }))}
        film={composerFilm}
        initialRating={Number.isFinite(tmdbId) ? getRating(tmdbId) : null}
        startMode={composer.mode}
        onPosted={() => { loadWall(); }}
      />

      {/* long-press react + actions (F14) */}
      <ReviewReactOverlay
        isOpen={!!reactTarget}
        onClose={() => setReactTarget(null)}
        review={liveReactReview}
        anchorTop={reactTarget?.top ?? 120}
        isOwn={!!user && !!liveReactReview && user.uid === liveReactReview.userId}
        onReact={(type) => { if (liveReactReview) handleReact(liveReactReview.id, type); }}
        onHelpful={() => { if (liveReactReview) handleHelpful(liveReactReview.id, !liveReactReview.myHelpful); }}
        onReply={() => { if (liveReactReview) startReply(liveReactReview); }}
        onCopy={() => { if (liveReactReview) handleCopy(liveReactReview.text); }}
        onShareStory={liveReactReview ? () => {
          story.open({
            kind: 'review',
            user: liveReactReview.username || liveReactReview.userDisplayName || 'someone',
            avatar: liveReactReview.userPhotoUrl,
            title: movieTitle,
            year: filmMeta.year,
            director: filmMeta.director,
            rating: liveReactReview.ratingAtTime,
            quote: liveReactReview.text,
          });
        } : undefined}
        onReportOrDelete={() => { if (liveReactReview) handleReportOrDelete(liveReactReview); }}
      />
    </SwipeBackContainer>
  );
}

export default function CommentsPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <CommentsPageContent />
    </Suspense>
  );
}
