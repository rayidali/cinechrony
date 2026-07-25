'use client';

import Image from 'next/image';
import { Link } from '@/lib/native-nav';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from '@/lib/native-nav';
import {
  Loader2, ExternalLink, Instagram, Youtube, ChevronDown, ChevronRight,
  Bookmark, MoreHorizontal, MessageCircle, Eye, Trash2, Link2, Award, CalendarPlus,
} from 'lucide-react';
import { Drawer } from 'vaul';

import type { Movie, TMDBCast, TMDBCrew, Review, SearchResult, WatchProvider, Watch } from '@/lib/types';
import { format } from 'date-fns';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import { Button } from '@/components/ui/button';
import { SheetMenu, SheetMenuItem } from '@/components/ui/sheet-menu';
import { TiktokIcon } from './icons';
import { VideoEmbed } from './video-embed';
import { DragToRate, ClearRatingButton } from '@/components/v3/drag-to-rate';
import { FullscreenTextInput } from './fullscreen-text-input';
import { SimilarMoviesRow } from './similar-movies-row';
import { AddToListSheet } from './add-to-list-sheet';
import { HowWasItSheet } from '@/components/v3/how-was-it-sheet';
import { HeroVideoLayer } from '@/components/v3/hero-video';
import { WatchEditSheet } from '@/components/v3/watch-edit-sheet';
import { useViewportHeight } from '@/hooks/use-viewport-height';
import { useUser } from '@/firebase';
import { useUserRatingsCache } from '@/contexts/user-ratings-cache';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { readCachedAction, setCachedAction, isCachedActionFresh, invalidateCachedAction } from '@/lib/use-cached-action';
import { notifyActivitiesChanged } from '@/lib/activity-events';
import { useToast } from '@/hooks/use-toast';
import { useListMembersCache } from '@/contexts/list-members-cache';
import { getRatingStyle } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { track, AnalyticsEvent } from '@/lib/analytics';
import {
  type MediaDetails, getCachedDetails, getMovieOrTVDetails,
} from '@/lib/tmdb-details-cache';
import { rememberMovieForReturn } from '@/contexts/movie-modal-context';
import { useMovieNight } from '@/components/movie-night/movie-night-provider';
import type { MovieNightFilm } from '@/lib/movie-night-types';

// next/image throws on an empty `src` — a list movie can have a blank poster.
const POSTER_FALLBACK = 'https://picsum.photos/seed/cinechrony/500/750';

// Glassy floating control over the hero — translucent, blurred, on-brand green wash.
const GLASS_BTN =
  'w-10 h-10 rounded-full bg-black/30 backdrop-blur-md text-white flex items-center justify-center border border-white/15 transition-transform active:scale-95';

/** Where the drawer was opened from — drives the eyebrow, buttons + list extras. */
export type DrawerContext =
  | { kind: 'standalone' }
  | { kind: 'in-list'; listId: string; listOwnerId: string; listName?: string; canEdit: boolean };

type MovieDrawerProps = {
  movie: Movie | null;
  isOpen: boolean;
  onClose: () => void;
  context: DrawerContext;
  /** Full path to return to from the comments round-trip. */
  returnPath?: string;
  /**
   * List context for the comments round-trip ONLY (so "back" reopens the
   * drawer in its original list). Orthogonal to the visual `context` — a
   * standalone drawer over a public list still routes back correctly.
   */
  routeListId?: string;
  routeListOwnerId?: string;
  /** z-index class for overlay + content (default z-50). */
  stackClassName?: string;
};

function getProviderIcon(url: string | undefined) {
  const parsed = parseVideoUrl(url);
  if (!parsed) return null;
  switch (parsed.provider) {
    case 'tiktok': return TiktokIcon;
    case 'instagram': return Instagram;
    case 'youtube': return Youtube;
    default: return null;
  }
}

function tmdbIdOf(movie: Movie): number {
  if (movie.tmdbId) return movie.tmdbId;
  const m = movie.id.match(/^(?:movie|tv)_(\d+)$/);
  return m ? parseInt(m[1], 10) : parseInt(movie.id, 10) || 0;
}

function movieToSearchResult(movie: Movie): SearchResult {
  return {
    id: movie.id,
    title: movie.title,
    year: movie.year,
    posterUrl: movie.posterUrl,
    posterHint: movie.posterHint,
    mediaType: movie.mediaType === 'tv' ? 'tv' : 'movie',
    tmdbId: tmdbIdOf(movie),
    overview: movie.overview,
    rating: movie.rating,
    backdropUrl: movie.backdropUrl,
  };
}

// MN01 — the drawer's film maps straight onto a movie-night film. `runtime`
// rides `mediaDetails` (raw minutes) when it's loaded; freshly-picked films
// (via the film picker, elsewhere) don't carry it and that's fine — it's
// optional on `MovieNightFilm`.
function movieToNightFilm(movie: Movie, tmdbId: number, runtimeMinutes: number | null): MovieNightFilm {
  return {
    tmdbId,
    mediaType: movie.mediaType === 'tv' ? 'tv' : 'movie',
    title: movie.title,
    year: movie.year || '',
    posterUrl: movie.posterUrl || null,
    runtime: runtimeMinutes,
  };
}

/**
 * The unified v3 movie drawer (Phase 0.7 Wave 2 — F01 standalone + F02 in-list).
 *
 * One component, two states via `context`: opened from the feed/search/a public
 * list (`standalone`) it shows a "now showing" eyebrow + want-to-watch · comments;
 * opened from your own list (`in-list`) it shows an `IN · <list>` eyebrow +
 * list-name · comments · a watch-status button, plus collaborator list-notes.
 * Everything else — drag-to-rate, scores, where-to-watch, cast & crew, the
 * conversation, more-like-this — is shared. Built on semantic tokens so the
 * "projection room" dark theme comes for free. The thin `MovieDetailsModal` /
 * `PublicMovieDetailsModal` adapters keep every existing call site unchanged.
 */
export function MovieDrawer({
  movie: movieProp,
  isOpen,
  onClose,
  context,
  returnPath,
  routeListId,
  routeListOwnerId,
  stackClassName = 'z-50',
}: MovieDrawerProps) {
  const router = useRouter();
  const { user } = useUser();
  const { toast } = useToast();
  const { getMembers } = useListMembersCache();
  const { getRating, setRating } = useUserRatingsCache();
  const { openCreate } = useMovieNight();

  const inList = context.kind === 'in-list';
  const canEdit = context.kind === 'in-list' && context.canEdit;
  const listId = context.kind === 'in-list' ? context.listId : undefined;
  const listOwnerId = context.kind === 'in-list' ? context.listOwnerId : undefined;
  const listName = context.kind === 'in-list' ? context.listName : undefined;

  // "more like this" — standalone swaps in place; in-list opens a nested
  // standalone drawer on top (list actions don't apply to the new film).
  const [override, setOverride] = useState<Movie | null>(null);
  const [similarPick, setSimilarPick] = useState<Movie | null>(null);
  const movie = override ?? movieProp;
  const scrollRef = useRef<HTMLDivElement>(null);

  const initialCached = useMemo(() => {
    if (!movieProp) return null;
    const mt = movieProp.mediaType === 'tv' ? 'tv' : 'movie';
    const id = tmdbIdOf(movieProp);
    return id ? getCachedDetails(mt, id) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [mediaDetails, setMediaDetails] = useState<MediaDetails | null>(initialCached);
  const [mediaDetailsForId, setMediaDetailsForId] = useState<string | null>(
    initialCached && movieProp ? movieProp.id : null,
  );
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [reviewPreviews, setReviewPreviews] = useState<Review[]>([]);
  const [reviewCount, setReviewCount] = useState(0);

  const [userRating, setUserRating] = useState<number | null>(null);
  const [isSavingRating, setIsSavingRating] = useState(false);
  const [localStatus, setLocalStatus] = useState<'To Watch' | 'Watched'>(movieProp?.status ?? 'To Watch');
  const [isPending, setIsPending] = useState(false);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [watchesNonce, setWatchesNonce] = useState(0);

  // overlays + editors (in-list editing)
  const [showAddToList, setShowAddToList] = useState(false);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [showSocialLinkEditor, setShowSocialLinkEditor] = useState(false);
  const [showRateOnWatch, setShowRateOnWatch] = useState(false);
  const [editingWatch, setEditingWatch] = useState<Watch | null>(null);
  const [newSocialLink, setNewSocialLink] = useState(movieProp?.socialLink ?? '');
  const [userNote, setUserNote] = useState('');

  const drawerHeight = useViewportHeight(94);
  const tmdbId = movie ? tmdbIdOf(movie) : 0;

  // Collaborator members for note-author lookup (in-list). MUST stay above the
  // `if (!movie) return null` early return so the hook order is stable when the
  // drawer mounts with a null movie and the parent assigns it a frame later
  // (the search-overlay path) — otherwise React throws a client-side exception.
  const cachedMembers = useMemo(
    () => (inList && listOwnerId && listId ? getMembers(listOwnerId, listId) : null),
    [inList, listOwnerId, listId, getMembers],
  );

  useEffect(() => { setOverride(null); }, [movieProp?.id, isOpen]);

  // Reset per-movie state on movie change.
  useEffect(() => {
    if (!movie) return;
    setLocalStatus(movie.status);
    setNewSocialLink(movie.socialLink ?? '');
    setUserRating(null);
    setUserNote(user?.uid && movie.notes?.[user.uid] ? movie.notes[user.uid] : '');
    setShowNoteEditor(false);
    setShowSocialLinkEditor(false);
    setShowRateOnWatch(false);
    setShowAddToList(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movie?.id]);

  useEffect(() => {
    if (!isOpen) {
      setShowNoteEditor(false);
      setShowSocialLinkEditor(false);
      setShowRateOnWatch(false);
      setShowAddToList(false);
      setEditingWatch(null);
    }
  }, [isOpen]);

  // user rating — read from the session-cached ratings Map (already loaded by
  // UserRatingsCacheProvider), NOT a per-open Firestore fetch. getRating is a
  // stable callback that changes when the Map updates, so this re-syncs once
  // the cache hydrates. saveRating/clearRating write back to the cache.
  useEffect(() => {
    if (tmdbId) setUserRating(getRating(tmdbId));
  }, [tmdbId, isOpen, getRating]);

  // your history (watch log) — owner-scoped, index-free fetch, TTL-gated +
  // cached so reopening the same film skips the read. `watchesNonce` (bumped by
  // logWatch) forces a refresh after a new watch.
  useEffect(() => {
    if (!isOpen || !user?.uid || !tmdbId) { setWatches([]); return; }
    const key = `drawer-watches:${user.uid}:${tmdbId}`;
    const cachedW = readCachedAction<Watch[]>(key);
    if (cachedW) setWatches(cachedW);
    if (cachedW && isCachedActionFresh(key, 300_000)) return; // fresh — skip read
    let cancelled = false;
    (async () => {
      try {
        const r = await apiCall<{ watches: Watch[] }>('GET', `/api/v1/watches?tmdbId=${tmdbId}`);
        if (!cancelled) { setWatches(r.watches ?? []); setCachedAction(key, r.watches ?? []); }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [movie?.id, isOpen, user?.uid, tmdbId, watchesNonce]);

  // review previews (top by likes) + count — TTL-gated + cached (public per
  // film), so reopening the same drawer skips the read.
  useEffect(() => {
    if (!isOpen || !tmdbId) { setReviewPreviews([]); setReviewCount(0); return; }
    const key = `drawer-reviews:${tmdbId}`;
    const cachedR = readCachedAction<{ reviews: Review[]; count: number }>(key);
    if (cachedR) { setReviewPreviews(cachedR.reviews); setReviewCount(cachedR.count); }
    else setReviewPreviews([]);
    if (cachedR && isCachedActionFresh(key, 300_000)) return; // fresh — skip read
    let cancelled = false;
    (async () => {
      try {
        const r = await apiCall<{ reviews: Review[]; total?: number }>(
          'GET', `/api/v1/reviews?tmdbId=${tmdbId}&sort=likes&limit=2`,
        );
        if (!cancelled) {
          const reviews = r.reviews ?? [];
          const count = r.total ?? reviews.length;
          setReviewPreviews(reviews);
          setReviewCount(count);
          setCachedAction(key, { reviews, count });
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [tmdbId, isOpen]);

  // details (module cache; back-nav safe)
  const loadRef = useRef(0);
  useEffect(() => {
    if (!movie || !isOpen || mediaDetailsForId === movie.id) return;
    const mt = movie.mediaType === 'tv' ? 'tv' : 'movie';
    const id = tmdbIdOf(movie);
    if (!id) return;

    const cached = getCachedDetails(mt, id);
    const usable = cached && typeof cached.overview === 'string' && cached.overview.length > 0;
    if (usable) { setMediaDetails(cached); setMediaDetailsForId(movie.id); return; }

    const myCall = ++loadRef.current;
    (async () => {
      if (cached) setMediaDetails(cached);
      setIsLoadingDetails(true);
      const d = await getMovieOrTVDetails(mt, id);
      if (loadRef.current !== myCall) return;
      if (d) setMediaDetails(d);
      setMediaDetailsForId(movie.id);
      setIsLoadingDetails(false);
    })();
  }, [movie?.id, isOpen, mediaDetailsForId]);

  if (!movie) return null;

  // ── derived ─────────────────────────────────────────────────────────────
  const parsedVideo = parseVideoUrl(movie.socialLink);
  const hasEmbeddableVideo = parsedVideo && parsedVideo.provider !== null;
  const SocialIcon = getProviderIcon(movie.socialLink);

  const posterSrc = movie.posterUrl || POSTER_FALLBACK;
  const backdropPath = mediaDetails && 'backdrop_path' in mediaDetails ? mediaDetails.backdrop_path : null;
  const imageBackdrops = mediaDetails && 'images' in mediaDetails
    ? (mediaDetails as { images?: { backdrops?: { file_path?: string }[] } }).images?.backdrops ?? []
    : [];
  // Cinematic hero — real movie stills (the primary backdrop + up to two more),
  // crossfaded with a slow Ken Burns. Falls back to the denormalized backdropUrl
  // (instant, before details load), then a blurred-poster fill (HeroBackdrop).
  const W780 = (p: string) => `https://image.tmdb.org/t/p/w780${p}`;
  const heroStills: string[] = [];
  if (backdropPath) heroStills.push(W780(backdropPath));
  for (const b of imageBackdrops) {
    if (!b?.file_path) continue;
    const u = W780(b.file_path);
    if (!heroStills.includes(u)) heroStills.push(u);
    if (heroStills.length >= 3) break;
  }
  if (heroStills.length === 0 && movie.backdropUrl) heroStills.push(movie.backdropUrl);

  // Ambient trailer preview (TMDB `videos`). Prefer an official trailer, then any
  // trailer/teaser, then the first YouTube clip. HeroVideoLayer loops the middle
  // + reveals only after YouTube's start overlay hides, so no branding shows.
  const videoResults = mediaDetails && 'videos' in mediaDetails
    ? (mediaDetails as { videos?: { results?: { key?: string; site?: string; type?: string; official?: boolean }[] } }).videos?.results ?? []
    : [];
  const ytVideos = videoResults.filter((v) => v.site === 'YouTube' && v.key);
  const trailerKey =
    (ytVideos.find((v) => v.type === 'Trailer' && v.official)
      ?? ytVideos.find((v) => v.type === 'Trailer')
      ?? ytVideos.find((v) => v.type === 'Teaser')
      ?? ytVideos[0])?.key ?? null;

  // "your history" — real watch docs, or (for films watched before the watch
  // log existed) a single synthesized "first watch" derived from the existing
  // rating + the user's own review. Read-time only — no backfill writes, and no
  // date (the rating's timestamp isn't in the ratings cache → WatchRow omits it
  // for the synthetic row).
  const history: Watch[] = watches.length > 0
    ? watches
    : userRating != null
      ? [{
          id: 'synthetic-first-watch',
          userId: user?.uid ?? '',
          tmdbId,
          mediaType: movie.mediaType === 'tv' ? 'tv' : 'movie',
          movieTitle: movie.title,
          moviePosterUrl: movie.posterUrl || null,
          watchedAt: new Date(0),
          rating: userRating,
          note: reviewPreviews.find((r) => r.userId === user?.uid)?.text ?? null,
          ordinal: 1,
          createdAt: new Date(),
        }]
      : [];

  let runtimeLabel: string | null = null;
  let runtimeMinutes: number | null = null;
  if (mediaDetails) {
    if ('runtime' in mediaDetails && mediaDetails.runtime) {
      runtimeLabel = `${Math.floor(mediaDetails.runtime / 60)}h ${mediaDetails.runtime % 60}m`;
      runtimeMinutes = mediaDetails.runtime;
    } else if ('number_of_seasons' in mediaDetails) {
      runtimeLabel = `${mediaDetails.number_of_seasons} season${mediaDetails.number_of_seasons !== 1 ? 's' : ''}`;
    }
  }

  const cast = mediaDetails?.credits?.cast ?? [];
  const crew = mediaDetails?.credits?.crew ?? [];
  const directors = crew.filter((c) => c.job === 'Director');
  const overview = mediaDetails?.overview || movie.overview;
  const genreLabel = mediaDetails?.genres?.[0]?.name?.toLowerCase() ?? null;
  const tmdbScore = typeof movie.rating === 'number' && movie.rating > 0 ? movie.rating
    : (mediaDetails && 'vote_average' in mediaDetails && mediaDetails.vote_average > 0 ? mediaDetails.vote_average : null);
  const studio = mediaDetails?.production_companies?.[0]?.name ?? null;
  const countries = (mediaDetails?.production_countries ?? []).map((c) => c.iso_3166_1.toLowerCase()).slice(0, 2).join('/');
  const wp = mediaDetails?.watchProviders ?? null;

  const heightStyle = drawerHeight > 0 ? `${drawerHeight}px` : 'calc(94 * var(--dvh, 1vh))';

  // ── handlers ────────────────────────────────────────────────────────────
  const openFullComments = () => {
    const params = new URLSearchParams({
      title: movie.title, poster: movie.posterUrl || '', type: movie.mediaType || 'movie',
    });
    const cListId = listId ?? routeListId;
    const cListOwnerId = listOwnerId ?? routeListOwnerId;
    if (returnPath) params.set('returnPath', returnPath);
    if (cListId) params.set('returnListId', cListId);
    if (cListOwnerId) params.set('returnListOwnerId', cListOwnerId);
    if (movie.id) params.set('returnMovieId', movie.id);
    rememberMovieForReturn(movie);
    onClose();
    setTimeout(() => router.push(`/movie/${tmdbId}/comments?${params.toString()}`), 220);
  };

  const saveRating = async (rating: number) => {
    if (!user?.uid || !tmdbId) return;
    setIsSavingRating(true);
    const prev = userRating;
    setUserRating(rating);
    setRating(tmdbId, rating); // write through the session ratings cache
    try {
      await apiCall('POST', '/api/v1/ratings', {
        tmdbId, mediaType: movie.mediaType || 'movie',
        movieTitle: movie.title, moviePosterUrl: movie.posterUrl, rating,
      });
      notifyActivitiesChanged(); // a first rating may add a 'rated' activity
    } catch (err) {
      setUserRating(prev);
      setRating(tmdbId, prev);
      toast({ variant: 'destructive', title: 'Error', description: err instanceof ApiClientError ? err.message : 'Failed to save rating.' });
    } finally { setIsSavingRating(false); }
  };

  const clearRating = async () => {
    if (!user?.uid || !tmdbId || userRating == null) return;
    const prev = userRating;
    haptic('light');
    setUserRating(null);
    setRating(tmdbId, null); // write through the session ratings cache
    setIsSavingRating(true);
    try {
      await apiCall('DELETE', `/api/v1/ratings/${tmdbId}`);
    } catch (err) {
      // 404 = the rating's already gone, which is exactly what clear wants —
      // treat as success (idempotent), don't bounce the rating back.
      if (err instanceof ApiClientError && err.status === 404) {
        // no-op: end state (no rating) achieved
      } else {
        setUserRating(prev);
        setRating(tmdbId, prev);
        toast({ variant: 'destructive', title: 'Error', description: err instanceof ApiClientError ? err.message : 'Failed to clear rating.' });
        return;
      }
    } finally { setIsSavingRating(false); }
    notifyActivitiesChanged(); // the 'rated' activity was removed → refresh recent
  };

  const patchStatus = (status: 'To Watch' | 'Watched') => {
    if (!listId || !listOwnerId) return;
    const prev = localStatus;
    setLocalStatus(status);
    setIsPending(true);
    void apiCall('PATCH', `/api/v1/lists/${listOwnerId}/${listId}/movies/${movie.id}`, { status })
      .catch((err) => {
        setLocalStatus(prev);
        toast({ variant: 'destructive', title: 'Update failed', description: err instanceof ApiClientError ? err.message : 'Failed to update status.' });
      })
      .finally(() => setIsPending(false));
  };

  // status button: To Watch → opens "how was it" (rate-on-watch); Watched → back to To Watch
  const onStatusTap = () => {
    haptic('light');
    if (localStatus === 'To Watch') setShowRateOnWatch(true);
    else patchStatus('To Watch');
  };

  // "how was it?" — log a watch (server upserts rating + your review), then
  // flip the list status (which emits the `watched` activity). `rating` null on
  // skip. Best-effort: a failed log shouldn't block marking the film watched.
  const logWatch = async (rating: number | null, note: string) => {
    if (!user?.uid || !tmdbId) return;
    try {
      await apiCall('POST', '/api/v1/watches', {
        tmdbId,
        mediaType: movie.mediaType || 'movie',
        movieTitle: movie.title,
        moviePosterUrl: movie.posterUrl || null,
        rating,
        note: note.trim() || null,
      });
    } catch (err) {
      console.error('[movie-drawer] logWatch failed:', err);
    }
    if (rating != null) { setUserRating(rating); setRating(tmdbId, rating); }
    // The watch (and possibly the note→review) just changed — drop the caches
    // so the history + conversation reflect the new entry on the next read.
    if (user?.uid) invalidateCachedAction(`drawer-watches:${user.uid}:${tmdbId}`);
    if (note.trim()) invalidateCachedAction(`drawer-reviews:${tmdbId}`);
    setWatchesNonce((n) => n + 1);
    notifyActivitiesChanged(); // a watch adds a 'watched' (and maybe 'rated') activity
  };

  const handleHowWasItSave = async (rating: number | null, note: string) => {
    setShowRateOnWatch(false);
    patchStatus('Watched');
    await logWatch(rating, note);
    track(AnalyticsEvent.MovieMarkedWatched);
    toast(rating != null
      ? { title: 'logged', description: `you rated ${movie.title} ${rating.toFixed(1)}/10` }
      : { title: 'logged', description: `${movie.title} — marked watched` });
  };

  const handleHowWasItSkip = async () => {
    setShowRateOnWatch(false);
    patchStatus('Watched');
    await logWatch(null, '');
    track(AnalyticsEvent.MovieMarkedWatched);
  };

  const refreshWatches = () => {
    if (user?.uid) invalidateCachedAction(`drawer-watches:${user.uid}:${tmdbId}`);
    setWatchesNonce((n) => n + 1);
  };

  const handleSaveWatchEdit = async (rating: number | null, note: string) => {
    const w = editingWatch;
    setEditingWatch(null);
    if (!w) return;
    try {
      await apiCall('PATCH', `/api/v1/watches/${w.id}`, { rating, note: note.trim() || null });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err instanceof ApiClientError ? err.message : 'Failed to save watch.' });
    }
    refreshWatches();
  };

  const handleRemoveWatch = async () => {
    const w = editingWatch;
    setEditingWatch(null);
    if (!w) return;
    try {
      await apiCall('DELETE', `/api/v1/watches/${w.id}`);
      toast({ title: 'watch removed' });
      notifyActivitiesChanged(); // removing the last watch drops the 'watched' activity
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err instanceof ApiClientError ? err.message : 'Failed to remove watch.' });
    }
    refreshWatches();
  };

  const handleRemove = () => {
    if (!listId || !listOwnerId) return;
    setIsPending(true);
    void apiCall('DELETE', `/api/v1/lists/${listOwnerId}/${listId}/movies/${movie.id}`)
      .catch((err) => toast({ variant: 'destructive', title: 'Remove failed', description: err instanceof ApiClientError ? err.message : 'Failed to remove.' }))
      .finally(() => setIsPending(false));
    toast({ title: 'removed', description: `${movie.title} removed from your list.` });
    onClose();
  };

  const handleSaveSocialLink = async (link: string) => {
    const trimmed = link.trim();
    setNewSocialLink(trimmed);
    if (!listId || !listOwnerId) return;
    void apiCall('PATCH', `/api/v1/lists/${listOwnerId}/${listId}/movies/${movie.id}`, { socialLink: trimmed })
      .catch((err) => toast({ variant: 'destructive', title: 'Update failed', description: err instanceof ApiClientError ? err.message : 'Failed to update link.' }));
    toast({ title: trimmed ? 'link updated' : 'link removed' });
  };

  const handleSaveNote = async (note: string) => {
    if (!user?.uid || !listId || !listOwnerId) return;
    try {
      await apiCall('PATCH', `/api/v1/lists/${listOwnerId}/${listId}/movies/${movie.id}`, { note });
      setUserNote(note);
      toast({ title: note.trim() ? 'note saved' : 'note removed' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err instanceof ApiClientError ? err.message : 'Failed to save note.' });
      throw err;
    }
  };

  const onSimilarPick = (picked: Movie) => {
    if (inList) {
      setSimilarPick(picked);
    } else {
      setOverride(picked);
      rememberMovieForReturn(picked);
      scrollRef.current?.scrollTo({ top: 0 });
    }
  };

  // collaborator notes (in-list) — `cachedMembers` is hoisted above the
  // early return; these two are plain derivations of `movie`.
  const allNotes = Object.entries(movie.notes || {}).sort((a) => (a[0] === user?.uid ? -1 : 1));
  const noteAuthorName = (uid: string): string => {
    if (uid === user?.uid) return 'you';
    if (movie.noteAuthors?.[uid]) return movie.noteAuthors[uid].username || movie.noteAuthors[uid].displayName || 'user';
    const m = cachedMembers?.find((x) => x.uid === uid);
    return m?.username || m?.displayName || 'user';
  };

  const drawerOpen = isOpen && !showNoteEditor && !showSocialLinkEditor && !showRateOnWatch && !editingWatch;

  return (
    <>
      <Drawer.Root open={drawerOpen} onOpenChange={(o) => !o && drawerOpen && onClose()}>
        <Drawer.Portal>
          <Drawer.Overlay className={`fixed inset-0 bg-black/60 ${stackClassName}`} />
          <Drawer.Content
            className={`fixed bottom-0 left-0 right-0 ${stackClassName} flex flex-col rounded-t-[22px] bg-card outline-none overflow-hidden`}
            style={{ height: heightStyle, maxHeight: heightStyle }}
          >
            <Drawer.Description className="sr-only">Details for {movie.title}</Drawer.Description>

            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
              {/* ── Hero — backdrop + green wash + glass controls ── */}
              <div className="relative w-full" style={{ height: 'clamp(180px, 30vh, 248px)' }}>
                <HeroBackdrop stills={heroStills} posterUrl={posterSrc} videoKey={trailerKey} />
                {/* legibility + brand green tint */}
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0.55))' }} />
                <div className="absolute inset-0 mix-blend-multiply" style={{ background: 'oklch(0.30 0.05 155 / 0.55)' }} />
                {/* controls */}
                <div className="absolute top-3 left-3 right-3 z-30 flex items-start justify-between" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
                  <button onClick={() => { haptic('light'); onClose(); }} className={GLASS_BTN} aria-label="Close">
                    <ChevronDown className="h-[22px] w-[22px]" strokeWidth={2} />
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { haptic('light'); setShowAddToList(true); }} className={GLASS_BTN} aria-label="Save to a list">
                      <Bookmark className="h-[19px] w-[19px]" strokeWidth={1.9} />
                    </button>
                    {canEdit && (
                      <SheetMenu
                        trigger={(open) => (
                          <button onClick={open} className={GLASS_BTN} aria-label="More options">
                            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} />
                          </button>
                        )}
                      >
                        {(close) => (
                          <>
                            <SheetMenuItem icon={Link2} onSelect={() => { close(); setShowSocialLinkEditor(true); }}>
                              {newSocialLink ? 'edit video link' : 'add video link'}
                            </SheetMenuItem>
                            {listId && (
                              <SheetMenuItem icon={Trash2} destructive disabled={isPending} onSelect={() => { close(); handleRemove(); }}>
                                remove from list
                              </SheetMenuItem>
                            )}
                          </>
                        )}
                      </SheetMenu>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Identity row — poster straddles hero, meta to the right ── */}
              <div className="px-5">
                <div className="flex gap-4">
                  <div className="relative -mt-14 w-[104px] flex-shrink-0 aspect-[2/3] rounded-2xl overflow-hidden shadow-photo bg-sunken ring-1 ring-black/10">
                    <Image src={posterSrc} alt={movie.title} fill className="object-cover" sizes="104px" />
                  </div>
                  <div className="flex-1 min-w-0 pt-2">
                    {/* eyebrow — in-list only; standalone gets no badge */}
                    {inList && (
                      <div className="cc-eyebrow flex items-center gap-1.5 text-muted-foreground">
                        <Bookmark className="h-3 w-3" strokeWidth={2} />
                        in · {(listName || 'a list').toLowerCase()}
                      </div>
                    )}
                    <h2 className={`font-headline font-bold text-[26px] lowercase tracking-[-0.02em] leading-[0.98] ${inList ? 'mt-1.5' : ''}`}>
                      {movie.title}
                    </h2>
                    {/* score chips */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {tmdbScore != null && (
                        <span className="px-2 py-0.5 rounded-md font-mono text-[11px] font-bold tabular-nums"
                          style={{ ...getRatingStyle(tmdbScore).background, ...getRatingStyle(tmdbScore).textOnBg }}>
                          {tmdbScore.toFixed(1)}
                        </span>
                      )}
                      {mediaDetails?.imdbRating && (
                        <span className="px-2 py-0.5 rounded-md bg-warning text-foreground font-mono text-[11px] font-bold tabular-nums">
                          IMDb {mediaDetails.imdbRating}
                        </span>
                      )}
                      {isLoadingDetails && !mediaDetails && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    </div>
                    {/* meta line */}
                    <div className="mt-2 font-mono text-[11px] text-muted-foreground tabular-nums flex flex-wrap items-center gap-x-1.5">
                      {movie.year && <span>{movie.year}</span>}
                      {runtimeLabel && <><span>·</span><span>{runtimeLabel}</span></>}
                      {genreLabel && <><span>·</span><span>{genreLabel}</span></>}
                    </div>
                  </div>
                </div>

                {/* ── Action buttons ── */}
                <div className={`grid gap-2.5 mt-4 ${inList ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  <ActionButton
                    primary icon={Bookmark}
                    label={inList ? (listName || 'this list').toLowerCase() : 'want to watch'}
                    sub="add to list"
                    onTap={() => { haptic('light'); setShowAddToList(true); }}
                  />
                  <ActionButton
                    icon={MessageCircle} label="reviews"
                    sub={reviewCount > 0 ? String(reviewCount) : undefined}
                    onTap={openFullComments}
                  />
                  {inList && (
                    <ActionButton
                      icon={Eye}
                      label={localStatus === 'Watched' ? 'watched' : 'to watch'}
                      sub={localStatus === 'Watched' ? undefined : '→ how was it?'}
                      disabled={isPending || !canEdit}
                      onTap={onStatusTap}
                    />
                  )}
                </div>

                {/* ── MN01 — plan a movie night ── */}
                {tmdbId > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      haptic('light');
                      openCreate({
                        film: movieToNightFilm(movie, tmdbId, runtimeMinutes),
                        list: inList && listId && listOwnerId
                          ? { id: listId, ownerId: listOwnerId, name: listName || 'this list', memberUids: cachedMembers?.map((m) => m.uid) }
                          : undefined,
                      });
                    }}
                    className="mt-3 flex w-full items-center gap-3.5 rounded-2xl border border-hair bg-card px-4 py-3.5 text-left shadow-lift transition-transform active:scale-[0.98]"
                  >
                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary">
                      <CalendarPlus className="h-5 w-5 text-primary-foreground" strokeWidth={2.2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-headline text-[16px] font-bold lowercase tracking-[-0.02em] text-foreground">plan a movie night</span>
                        <span className="rounded-full border border-primary px-1.5 py-[1px] font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-primary">new</span>
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">a date, a time, your people</span>
                    </span>
                    <ChevronRight className="h-[18px] w-[18px] flex-shrink-0 text-muted-foreground" strokeWidth={2} />
                  </button>
                )}

                {/* ── your rating ── (clear sits in the header, top-right) */}
                <Block
                  title="your rating"
                  trailingNode={userRating != null ? <ClearRatingButton onClear={clearRating} disabled={isSavingRating} /> : undefined}
                >
                  <DragToRate value={userRating} onChangeComplete={saveRating} disabled={isSavingRating} />
                </Block>

                {/* ── your history (watch log) ── */}
                {history.length > 0 && (
                  <Block eyebrow="your history" title={`${history.length} ${history.length === 1 ? 'watch' : 'watches'}`}>
                    <div className="rounded-2xl border border-hair bg-card divide-y divide-hair overflow-hidden">
                      {history.map((w) => (
                        <WatchRow
                          key={w.id}
                          watch={w}
                          onEdit={w.id === 'synthetic-first-watch' ? undefined : () => { haptic('light'); setEditingWatch(w); }}
                        />
                      ))}
                    </div>
                  </Block>
                )}

                {/* ── overview ── */}
                {overview ? (
                  <p className="mt-6 font-serif italic text-[15px] leading-relaxed text-foreground/90">{overview}</p>
                ) : isLoadingDetails ? (
                  <div className="mt-6 space-y-2">
                    <div className="h-3.5 w-full rounded bg-muted animate-pulse" />
                    <div className="h-3.5 w-[88%] rounded bg-muted animate-pulse" />
                  </div>
                ) : null}

                {/* ── the scores ── */}
                {(mediaDetails?.imdbRating || mediaDetails?.rottenTomatoes || mediaDetails?.metascore) && (
                  <Block title="the scores">
                    <div className="grid grid-cols-3 gap-2.5">
                      {mediaDetails?.imdbRating && <ScoreCard value={mediaDetails.imdbRating} label="imdb" tone="amber" />}
                      {mediaDetails?.rottenTomatoes && <ScoreCard value={mediaDetails.rottenTomatoes} label="rotten tomatoes" tone="red" />}
                      {mediaDetails?.metascore && <ScoreCard value={mediaDetails.metascore} label="metacritic" tone="sage" />}
                    </div>
                    {mediaDetails?.awards && (
                      <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                        <Award className="h-3.5 w-3.5 text-warning" strokeWidth={2} />
                        <span className="lowercase">{mediaDetails.awards}</span>
                      </div>
                    )}
                  </Block>
                )}

                {/* ── where to watch ── */}
                {wp && (
                  <Block title="where to watch" trailing="via justwatch">
                    <div className="flex flex-wrap gap-2.5">
                      {wp.stream.map((p) => <ProviderChip key={`s${p.providerId}`} p={p} kind="stream" link={wp.link} />)}
                      {wp.rent.slice(0, 2).map((p) => <ProviderChip key={`r${p.providerId}`} p={p} kind="rent" link={wp.link} />)}
                      {wp.stream.length === 0 && wp.rent.length === 0 &&
                        wp.buy.slice(0, 3).map((p) => <ProviderChip key={`b${p.providerId}`} p={p} kind="buy" link={wp.link} />)}
                    </div>
                  </Block>
                )}

                {/* ── cast & crew ── */}
                {(cast.length > 0 || directors.length > 0) && (
                  <Block title="cast & crew">
                    <div className="flex gap-3.5 overflow-x-auto pb-1 -mx-5 px-5 scrollbar-hide">
                      {cast.slice(0, 10).map((a: TMDBCast) => (
                        <PersonAvatar key={`c${a.id}`} name={a.name} sub={a.character} profilePath={a.profile_path} />
                      ))}
                      {directors.map((d: TMDBCrew) => (
                        <PersonAvatar key={`d${d.id}`} name={d.name} sub="director" profilePath={d.profile_path} accent />
                      ))}
                    </div>
                  </Block>
                )}

                {/* ── the conversation ── */}
                <Block
                  title="what people said"
                  eyebrow="the conversation"
                  trailing={reviewCount > 0 ? `all ${reviewCount}` : undefined}
                  onTrailingTap={reviewCount > 0 ? openFullComments : undefined}
                >
                  {reviewPreviews.length > 0 ? (
                    <div className="space-y-2.5">
                      {reviewPreviews.map((r) => <ReviewQuote key={r.id} review={r} onTap={openFullComments} />)}
                    </div>
                  ) : (
                    <button onClick={openFullComments} className="w-full flex items-center justify-between gap-3 text-left active:opacity-60 transition-opacity">
                      <span className="font-serif italic text-[15px] text-muted-foreground">be the first to say something…</span>
                      <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" strokeWidth={2.5} />
                    </button>
                  )}
                </Block>

                {/* ── list notes (in-list) ── */}
                {inList && (
                  <Block
                    title="list notes"
                    eyebrow={`in '${(listName || 'a list').toLowerCase()}'${(cachedMembers?.length ?? 0) > 1 ? ` · ${cachedMembers!.length} collaborators` : ''}`}
                  >
                    {allNotes.length === 0 ? (
                      <p className="font-serif italic text-[15px] text-muted-foreground">
                        {canEdit ? 'the margins are blank. write something they’ll remember.' : 'no notes yet.'}
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {allNotes.map(([uid, note]) => {
                          const mine = uid === user?.uid;
                          return (
                            <div key={uid} className="rounded-2xl border border-hair bg-background/60 p-3.5">
                              <div className="flex items-center justify-between">
                                <span className="font-ui font-semibold text-[13px]">{mine ? 'your note' : `@${noteAuthorName(uid)}`}</span>
                                {mine && canEdit && (
                                  <button onClick={() => setShowNoteEditor(true)} className="font-ui font-semibold text-[12px] text-primary active:opacity-60">edit</button>
                                )}
                              </div>
                              <p className="mt-1.5 font-serif italic text-[14px] leading-snug text-foreground/90 whitespace-pre-wrap break-words">“{note}”</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {canEdit && allNotes.every(([uid]) => uid !== user?.uid) && (
                      <button onClick={() => setShowNoteEditor(true)} className="mt-2.5 w-full flex items-center gap-2 rounded-2xl border border-hair bg-background/60 px-3.5 py-3 text-left active:opacity-60 transition-opacity">
                        <Link2 className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                        <span className="font-serif italic text-[14px] text-muted-foreground">add a note for collaborators…</span>
                      </button>
                    )}
                  </Block>
                )}

                {/* ── more like this ── */}
                {tmdbId > 0 && (
                  <div className="mt-7">
                    <SimilarMoviesRow tmdbId={tmdbId} mediaType={movie.mediaType === 'tv' ? 'tv' : 'movie'} onPick={onSimilarPick} />
                  </div>
                )}

                {/* ── the clip ── */}
                {(hasEmbeddableVideo || movie.socialLink) && (
                  <Block title="the clip">
                    {hasEmbeddableVideo && <VideoEmbed url={movie.socialLink} thumbnailUrl={movie.socialThumbnail} />}
                    {movie.socialLink && (
                      <Button asChild variant="outline" className="w-full mt-3">
                        <Link href={movie.socialLink} target="_blank" rel="noopener noreferrer">
                          {SocialIcon && <SocialIcon className="h-4 w-4 mr-2" />}
                          {hasEmbeddableVideo ? <>open in {getProviderDisplayName(parsedVideo?.provider || null)}</> : <><ExternalLink className="h-4 w-4 mr-2" />open link</>}
                        </Link>
                      </Button>
                    )}
                  </Block>
                )}

                {/* ── footer meta ── */}
                <div className="mt-8 mb-3 pt-4 border-t border-hair font-mono text-[10px] text-muted-foreground lowercase leading-relaxed">
                  {[directors[0] ? `dir. ${directors[0].name}` : null, studio, countries || null, runtimeLabel]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* want-to-watch / save → which list */}
      <AddToListSheet movie={showAddToList ? movieToSearchResult(movie) : null} isOpen={showAddToList} onClose={() => setShowAddToList(false)} />

      {/* F03 — how was it? (logs a watch + becomes your review) */}
      <HowWasItSheet
        isOpen={isOpen && showRateOnWatch}
        movieTitle={movie.title}
        posterUrl={posterSrc}
        listName={listName}
        initialRating={userRating}
        onSave={handleHowWasItSave}
        onSkip={handleHowWasItSkip}
        onCancel={() => setShowRateOnWatch(false)}
      />

      {/* edit / remove a single watch-log entry */}
      <WatchEditSheet
        isOpen={isOpen && !!editingWatch}
        watch={editingWatch}
        onSave={handleSaveWatchEdit}
        onRemove={handleRemoveWatch}
        onClose={() => setEditingWatch(null)}
      />

      {/* note editor */}
      <FullscreenTextInput
        isOpen={isOpen && showNoteEditor}
        onClose={() => setShowNoteEditor(false)} onSave={handleSaveNote}
        initialValue={userNote} title="note" subtitle={`for: ${movie.title}`}
        placeholder="a note for your collaborators…" maxLength={500}
      />

      {/* social link editor */}
      <FullscreenTextInput
        isOpen={isOpen && showSocialLinkEditor}
        onClose={() => setShowSocialLinkEditor(false)} onSave={handleSaveSocialLink}
        initialValue={newSocialLink} title="video link" subtitle={movie.title}
        placeholder="TikTok, Instagram, or YouTube URL" maxLength={500} singleLine inputType="url"
      />

      {/* in-list "more like this" → nested standalone drawer */}
      {inList && (
        <MovieDrawer movie={similarPick} isOpen={!!similarPick} onClose={() => setSimilarPick(null)} context={{ kind: 'standalone' }} stackClassName="z-[80]" />
      )}
    </>
  );
}

// ── section primitives ─────────────────────────────────────────────────────

function WatchRow({ watch, onEdit }: { watch: Watch; onEdit?: () => void }) {
  const label = watch.ordinal <= 1 ? 'first watch' : `rewatch no. ${watch.ordinal}`;
  // watchedAt is an ISO string over the wire (typed Date) — wrap defensively.
  // The synthesized-from-rating row carries no real date (epoch sentinel).
  const ts = new Date(watch.watchedAt).getTime();
  const date = ts > 0 ? format(new Date(watch.watchedAt), 'MMM yyyy').toLowerCase() : null;
  const style = watch.rating ? getRatingStyle(watch.rating) : null;
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className="font-headline font-bold text-[14px] lowercase tracking-[-0.02em]">{label}</span>
        {date && <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{date}</span>}
        {style && (
          <span className="ml-auto px-1.5 py-0.5 rounded-md font-mono text-[10px] font-bold tabular-nums" style={{ ...style.background, ...style.textOnBg }}>
            {watch.rating!.toFixed(1)}
          </span>
        )}
      </div>
      {watch.note && (
        <p className="mt-1.5 font-serif italic text-[14px] leading-snug text-foreground/85">“{watch.note}”</p>
      )}
    </>
  );
  // Tap a real watch to edit / remove it (synthetic rows pass no onEdit).
  if (onEdit) {
    return (
      <button onClick={onEdit} className="w-full p-3.5 text-left transition-colors active:bg-foreground/5">
        {body}
      </button>
    );
  }
  return <div className="p-3.5">{body}</div>;
}

function Block({
  title, eyebrow, trailing, onTrailingTap, trailingNode, children,
}: {
  title: string; eyebrow?: string; trailing?: string; onTrailingTap?: () => void; trailingNode?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="mt-7">
      {eyebrow && <div className="cc-eyebrow text-muted-foreground mb-1">{eyebrow}</div>}
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-headline font-bold text-[19px] lowercase tracking-[-0.02em]">{title}</h3>
        {trailingNode ? trailingNode : trailing && (
          onTrailingTap ? (
            <button onClick={onTrailingTap} className="font-ui font-semibold text-[13px] text-primary active:opacity-60">{trailing}</button>
          ) : (
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{trailing}</span>
          )
        )}
      </div>
      {children}
    </section>
  );
}

function ActionButton({
  icon: Icon, label, sub, primary, disabled, onTap,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string; sub?: string; primary?: boolean; disabled?: boolean; onTap: () => void;
}) {
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1 rounded-2xl py-3 px-2 transition-all active:scale-[0.97] disabled:opacity-50 ${
        primary ? 'bg-primary text-primary-foreground shadow-fab' : 'border border-hair bg-card text-foreground'
      }`}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
      <span className="font-headline font-bold text-[14px] lowercase tracking-[-0.02em] leading-none mt-0.5">{label}</span>
      {sub && <span className={`font-mono text-[9px] lowercase leading-none ${primary ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{sub}</span>}
    </button>
  );
}

function ScoreCard({ value, label, tone }: { value: string; label: string; tone: 'amber' | 'red' | 'sage' }) {
  const toneCls = tone === 'amber' ? 'bg-warning text-foreground' : tone === 'red' ? 'bg-destructive text-white' : 'bg-success text-white';
  return (
    <div className="rounded-2xl border border-hair bg-card p-3 flex flex-col items-center gap-2">
      <span className={`px-2.5 py-1 rounded-lg font-headline font-bold text-[15px] tabular-nums ${toneCls}`}>{value}</span>
      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground text-center">{label}</span>
    </div>
  );
}

function ProviderChip({ p, kind, link }: { p: WatchProvider; kind: 'stream' | 'rent' | 'buy'; link: string | null }) {
  const inner = (
    <div className="flex items-center gap-2 rounded-xl border border-hair bg-card pl-1.5 pr-3 py-1.5">
      <span className="h-8 w-8 rounded-lg overflow-hidden bg-sunken flex-shrink-0">
        {p.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.logoUrl} alt="" className="w-full h-full object-cover" />
        ) : null}
      </span>
      <span className="leading-tight">
        <span className="block font-headline font-bold text-[13px] lowercase tracking-[-0.02em]">{p.name.toLowerCase()}</span>
        <span className="block font-mono text-[9px] text-muted-foreground lowercase">{kind}</span>
      </span>
    </div>
  );
  return link ? (
    <a href={link} target="_blank" rel="noopener noreferrer" className="active:opacity-70 transition-opacity">{inner}</a>
  ) : inner;
}

function PersonAvatar({ name, sub, profilePath, accent }: { name: string; sub: string; profilePath: string | null; accent?: boolean }) {
  return (
    <div className="flex-shrink-0 w-16 text-center">
      <div className={`w-16 h-16 rounded-full overflow-hidden bg-sunken relative ${accent ? 'ring-2 ring-primary/40' : 'border border-hair'}`}>
        {profilePath ? (
          <Image src={`https://image.tmdb.org/t/p/w185${profilePath}`} alt={name} fill className="object-cover" sizes="64px" />
        ) : (
          <div className="w-full h-full flex items-center justify-center font-headline font-bold text-base text-muted-foreground">{name.charAt(0)}</div>
        )}
      </div>
      <p className="font-headline font-semibold text-[11px] lowercase tracking-tight mt-1.5 leading-tight line-clamp-2">{name.toLowerCase()}</p>
      <p className="font-mono text-[9px] text-muted-foreground truncate">{sub.toLowerCase()}</p>
    </div>
  );
}

function ReviewQuote({ review, onTap }: { review: Review; onTap: () => void }) {
  const rating = review.ratingAtTime;
  const style = rating ? getRatingStyle(rating) : null;
  return (
    <button onClick={onTap} className="w-full text-left rounded-2xl border border-hair bg-background/60 p-3.5 active:opacity-70 transition-opacity">
      <div className="flex items-center gap-2">
        <span className="h-6 w-6 rounded-full overflow-hidden bg-sunken flex-shrink-0 flex items-center justify-center font-headline font-bold text-[10px] text-muted-foreground">
          {review.userPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={review.userPhotoUrl} alt="" className="w-full h-full object-cover" />
          ) : (review.username || 'u').charAt(0).toUpperCase()}
        </span>
        <span className="font-ui font-semibold text-[13px]">@{review.username || 'user'}</span>
        {style && (
          <span className="ml-auto px-1.5 py-0.5 rounded-md font-mono text-[10px] font-bold tabular-nums" style={{ ...style.background, ...style.textOnBg }}>
            {rating!.toFixed(1)}
          </span>
        )}
      </div>
      <p className="mt-2 font-serif italic text-[14px] leading-snug text-foreground/90 line-clamp-3">“{review.text}”</p>
    </button>
  );
}

/**
 * HeroBackdrop — the cinematic drawer hero. Crossfades through real movie stills
 * with a slow Ken Burns (a frame of the film, not a flat poster). 1 still →
 * Ken Burns only; 0 → a blurred, scaled poster fill (still beats a sharp
 * stretched poster). Plain `<img>` layers (images are `unoptimized` app-wide;
 * `<img>` keeps the crossfade simple).
 */
function HeroBackdrop({ stills, posterUrl, videoKey }: { stills: string[]; posterUrl: string; videoKey?: string | null }) {
  const [idx, setIdx] = useState(0);
  const [showVideo, setShowVideo] = useState(false);
  const [videoShown, setVideoShown] = useState(false);
  const n = stills.length;

  useEffect(() => {
    setIdx(0);
    if (n < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % n), 5500);
    return () => clearInterval(t);
  }, [n]);

  // Mount + start the trailer almost immediately (warm it up hidden) so it's
  // already past the chrome by the time it's revealed. HeroVideoLayer drives
  // `videoShown`: true only while playing clean mid-trailer footage; false during
  // the start overlay AND the loop-seek — so the stills cover every chrome moment.
  useEffect(() => {
    setShowVideo(false);
    setVideoShown(false);
    if (!videoKey) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => setShowVideo(true), 200);
    return () => clearTimeout(t);
  }, [videoKey]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* stills base — always on, covers every YouTube-chrome moment */}
      {n === 0 ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={posterUrl} alt="" className="cc-kenburns h-full w-full scale-125 object-cover opacity-70 blur-2xl" />
      ) : (
        stills.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            src={src}
            alt=""
            className={`cc-kenburns absolute inset-0 h-full w-full object-cover transition-opacity duration-[1200ms] ease-in-out ${i === idx ? 'opacity-100' : 'opacity-0'}`}
          />
        ))
      )}
      {/* ambient trailer — opacity driven by HeroVideoLayer (clean footage only).
          duration-500 matches FADE_MS so the loop-seek lands while it's hidden. */}
      {showVideo && videoKey && (
        <div className={`absolute inset-0 transition-opacity duration-500 ${videoShown ? 'opacity-100' : 'opacity-0'}`}>
          <HeroVideoLayer ytKey={videoKey} onShownChange={setVideoShown} />
        </div>
      )}
    </div>
  );
}
