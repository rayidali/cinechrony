'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, useEffect, useMemo, useRef } from 'react';
import {
  Loader2,
  Trash2,
  ExternalLink,
  Instagram,
  Youtube,
  Clock,
  Calendar,
  ChevronLeft,
  MoreHorizontal,
  Plus,
  Check,
  Film,
  Tv,
  Link2,
} from 'lucide-react';
import { Drawer } from 'vaul';

import type { Movie, TMDBCast, Review } from '@/lib/types';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import {
  updateDocumentNonBlocking,
  deleteDocumentNonBlocking,
  useFirestore,
  useUser,
} from '@/firebase';
import { getUserRating, createOrUpdateRating, deleteRating, createReview, updateMovieNote, getMovieReviews } from '@/app/actions';
import {
  type MediaDetails,
  getCachedDetails,
  getMovieOrTVDetails,
} from '@/lib/tmdb-details-cache';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TiktokIcon } from './icons';
import { VideoEmbed } from './video-embed';
import { RatingSlider } from './rating-slider';
import { FullscreenTextInput } from './fullscreen-text-input';
import { useToast } from '@/hooks/use-toast';
import { useViewportHeight } from '@/hooks/use-viewport-height';
import { useListMembersCache } from '@/contexts/list-members-cache';
import { doc } from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';
import { ImdbLogo } from './imdb-logo';
import { SimilarMoviesRow } from './similar-movies-row';
import { PublicMovieDetailsModal } from './public-movie-details-modal';

// Glassy floating control — backdrop blur over a translucent dark square.
const GLASS_BTN =
  'w-9 h-9 rounded-xl bg-black/35 backdrop-blur-md text-white flex items-center justify-center border border-white/15 transition-transform active:scale-95';

function getProviderIcon(url: string | undefined) {
  const parsed = parseVideoUrl(url);
  if (!parsed) return null;
  switch (parsed.provider) {
    case 'tiktok':
      return TiktokIcon;
    case 'instagram':
      return Instagram;
    case 'youtube':
      return Youtube;
    default:
      return null;
  }
}

type MovieDetailsModalProps = {
  movie: Movie | null;
  isOpen: boolean;
  onClose: () => void;
  listId?: string;
  listOwnerId?: string;
  canEdit?: boolean;
};

export function MovieDetailsModal({
  movie,
  isOpen,
  onClose,
  listId,
  listOwnerId,
  canEdit = true,
}: MovieDetailsModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Seed `mediaDetails` from the module-level cache on first render. If the
  // user has opened this film before in this session, the cache is warm and
  // the full payload paints on the very first frame — no loading flash, and
  // critically, no second fetch that could fail to the back-nav race.
  const initialCached = useMemo(() => {
    if (!movie) return null;
    const mediaType = movie.mediaType === 'tv' ? 'tv' : 'movie';
    const tmdbIdNum = movie.tmdbId
      || (movie.id ? parseInt(movie.id.replace(/^(movie|tv)_/, ''), 10) : 0);
    if (!tmdbIdNum || isNaN(tmdbIdNum)) return null;
    return getCachedDetails(mediaType, tmdbIdNum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // First-render only — re-mounts (via key) get a fresh read.
  const [mediaDetails, setMediaDetails] = useState<MediaDetails | null>(initialCached);
  const [mediaDetailsForId, setMediaDetailsForId] = useState<string | null>(
    initialCached && movie ? movie.id : null,
  );
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [reviewPreviews, setReviewPreviews] = useState<Review[]>([]);
  // "more like this" pick — opens a read-only detail over this editable one.
  const [similarPick, setSimilarPick] = useState<Movie | null>(null);
  const [newSocialLink, setNewSocialLink] = useState('');
  const [localStatus, setLocalStatus] = useState<'To Watch' | 'Watched'>('To Watch');
  const [userRating, setUserRating] = useState<number | null>(null);
  const [isSavingRating, setIsSavingRating] = useState(false);
  const [showRateOnWatchModal, setShowRateOnWatchModal] = useState(false);
  const [userNote, setUserNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [showSocialLinkEditor, setShowSocialLinkEditor] = useState(false);
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();
  const { getMembers } = useListMembersCache();

  // Get cached list members for note author lookup
  // Re-read cache when modal opens (isOpen) to catch async-populated cache
  const cachedMembers = useMemo(() => {
    if (!isOpen || !listOwnerId || !listId) return null;
    return getMembers(listOwnerId, listId);
  }, [isOpen, listOwnerId, listId, getMembers]);

  // Use denormalized user data from movie doc - no fetch needed!
  const addedByInfo = useMemo(() => {
    if (!movie) return null;
    const isAddedByCurrentUser = movie.addedBy === user?.uid;
    if (isAddedByCurrentUser) {
      return {
        displayName: user?.displayName || user?.email?.split('@')[0] || 'You',
        photoURL: user?.photoURL || null,
      };
    }
    return {
      displayName: movie.addedByDisplayName || movie.addedByUsername || 'Someone',
      photoURL: movie.addedByPhotoURL || null,
    };
  }, [movie, user?.uid, user?.displayName, user?.email, user?.photoURL]);

  // Build note authors using denormalized noteAuthors data - no fetch needed!
  const noteAuthors = useMemo(() => {
    if (!movie?.notes) return {};
    const authors: Record<string, { name: string; photoURL: string | null }> = {};
    Object.keys(movie.notes).forEach(uid => {
      if (uid === user?.uid) {
        // Current user
        authors[uid] = {
          name: user?.displayName || user?.email?.split('@')[0] || 'You',
          photoURL: user?.photoURL || null,
        };
      } else if (movie.noteAuthors?.[uid]) {
        // Use denormalized note author data (most reliable)
        const author = movie.noteAuthors[uid];
        authors[uid] = {
          name: author.username || author.displayName || 'User',
          photoURL: author.photoURL || null,
        };
      } else if (uid === movie.addedBy && movie.addedByUsername) {
        // Fallback: movie adder's denormalized data
        authors[uid] = {
          name: movie.addedByUsername,
          photoURL: movie.addedByPhotoURL || null,
        };
      } else if (cachedMembers) {
        // Fallback: cached list members
        const member = cachedMembers.find(m => m.uid === uid);
        if (member) {
          authors[uid] = {
            name: member.username || member.displayName || 'User',
            photoURL: member.photoURL || null,
          };
        } else {
          authors[uid] = { name: 'User', photoURL: null };
        }
      } else {
        authors[uid] = { name: 'User', photoURL: null };
      }
    });
    return authors;
  }, [movie?.notes, movie?.noteAuthors, movie?.addedBy, movie?.addedByUsername, movie?.addedByPhotoURL, cachedMembers, user?.uid, user?.displayName, user?.email, user?.photoURL]);

  // Use shared hook for viewport height (fixes iOS Safari issue)
  const drawerHeight = useViewportHeight(92);

  // Get TMDB ID for reviews
  const tmdbId = movie?.tmdbId || (movie?.id ? parseInt(movie.id.replace(/^(movie|tv)_/, ''), 10) : 0);

  // Reset state when movie ID changes (not status changes).
  // NOTE: we deliberately do NOT zero `mediaDetails` here — the fetch effect
  // below owns that state and races against this reset if both fire on the
  // same render (a fresh-mount triggered by the parent's `key` prop). The
  // loader uses a ref counter so a stale result can't overwrite a newer one;
  // it's the single source of truth for `mediaDetails`.
  useEffect(() => {
    if (movie) {
      setNewSocialLink(movie.socialLink || '');
      setLocalStatus(movie.status);
      setUserRating(null);
      setShowRateOnWatchModal(false);
      setShowNoteEditor(false);
      setShowSocialLinkEditor(false);
      // Initialize user's note from movie data
      setUserNote(user?.uid && movie.notes?.[user.uid] ? movie.notes[user.uid] : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movie?.id]); // Only reset on movie ID change, not status changes

  // Reset editors when modal closes
  useEffect(() => {
    if (!isOpen) {
      setShowNoteEditor(false);
      setShowSocialLinkEditor(false);
      setShowRateOnWatchModal(false);
    }
  }, [isOpen]);

  // Fetch user's rating for this movie
  useEffect(() => {
    async function fetchUserRating() {
      if (!movie || !isOpen || !user?.uid || !tmdbId) return;

      try {
        const result = await getUserRating(user.uid, tmdbId);
        if (result.rating) {
          setUserRating(result.rating.rating);
        }
      } catch (error) {
        console.error('Failed to fetch user rating:', error);
      }
    }
    fetchUserRating();
  }, [movie?.id, isOpen, user?.uid, tmdbId]);

  // Fetch the most-liked reviews for the in-modal preview (non-critical).
  useEffect(() => {
    if (!isOpen || !tmdbId) {
      setReviewPreviews([]);
      return;
    }
    let cancelled = false;
    setReviewPreviews([]);
    (async () => {
      try {
        const result = await getMovieReviews(tmdbId, 'likes', 2);
        if (!cancelled) setReviewPreviews((result.reviews ?? []) as Review[]);
      } catch {
        /* the preview is non-critical — leave it empty on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tmdbId, isOpen]);

  // Load movie/TV details via the module-level cache. First open warms it;
  // every reopen in the same session is an instant hit — no network call,
  // and therefore no possible race with the back-navigation transition that
  // was wiping the details on the second open.
  //
  // The ref counter handles the case where the modal switches movies in
  // place (the similar-movies row swaps `movie?.id` without unmounting):
  // only the latest call may write to state.
  const loadDetailsCallRef = useRef(0);
  useEffect(() => {
    if (!movie || !isOpen) return;
    if (mediaDetailsForId === movie.id) return; // already have it for this movie

    const targetMovie = movie;
    const targetMediaType = targetMovie.mediaType === 'tv' ? 'tv' : 'movie';

    let tmdbIdLocal: number;
    if (targetMovie.tmdbId) {
      tmdbIdLocal = targetMovie.tmdbId;
    } else {
      const idMatch = targetMovie.id.match(/^(?:movie|tv)_(\d+)$/);
      tmdbIdLocal = idMatch
        ? parseInt(idMatch[1], 10)
        : parseInt(targetMovie.id, 10);
    }
    if (!tmdbIdLocal || isNaN(tmdbIdLocal)) return;

    // Synchronous cache hit — set state without a render flicker.
    const cached = getCachedDetails(targetMediaType, tmdbIdLocal);
    if (cached) {
      setMediaDetails(cached);
      setMediaDetailsForId(targetMovie.id);
      return;
    }

    const myCallId = ++loadDetailsCallRef.current;
    (async () => {
      setIsLoadingDetails(true);
      const details = await getMovieOrTVDetails(targetMediaType, tmdbIdLocal);
      if (loadDetailsCallRef.current !== myCallId) return;
      setMediaDetails(details);
      setMediaDetailsForId(targetMovie.id);
      setIsLoadingDetails(false);
    })();
  }, [movie?.id, isOpen, mediaDetailsForId]);

  if (!movie || !user) return null;

  const effectiveOwnerId = listOwnerId || user.uid;
  const movieDocRef = listId
    ? doc(firestore, 'users', effectiveOwnerId, 'lists', listId, 'movies', movie.id)
    : doc(firestore, 'users', user.uid, 'movies', movie.id);

  const parsedVideo = parseVideoUrl(movie.socialLink);
  const hasEmbeddableVideo = parsedVideo && parsedVideo.provider !== null;
  const SocialIcon = getProviderIcon(movie.socialLink);

  const handleStatusChange = (newStatus: 'To Watch' | 'Watched') => {
    if (newStatus === localStatus) return;

    if (newStatus === 'Watched') {
      setShowRateOnWatchModal(true);
      return;
    }

    setLocalStatus(newStatus);
    startTransition(() => {
      updateDocumentNonBlocking(movieDocRef, { status: newStatus });
    });
  };

  // Handler for rate-on-watch fullscreen input (comment: string, rating?: number)
  const handleRateOnWatchSave = async (comment: string, rating?: number) => {
    if (!user?.uid || !tmdbId) return;

    const finalRating = rating ?? 7;

    await createOrUpdateRating(
      await user.getIdToken(),
      tmdbId,
      movie.mediaType || 'movie',
      movie.title,
      movie.posterUrl,
      finalRating
    );
    setUserRating(finalRating);

    if (comment.trim()) {
      await createReview(
        await user.getIdToken(),
        tmdbId,
        movie.mediaType || 'movie',
        movie.title,
        movie.posterUrl,
        comment,
        finalRating
      );
    }

    setLocalStatus('Watched');
    startTransition(() => {
      updateDocumentNonBlocking(movieDocRef, { status: 'Watched' });
    });

    toast({
      title: 'Marked as Watched',
      description: `You rated ${movie.title} ${finalRating.toFixed(1)}/10`,
    });
  };

  const handleRateOnWatchSkip = () => {
    setLocalStatus('Watched');
    startTransition(() => {
      updateDocumentNonBlocking(movieDocRef, { status: 'Watched' });
    });
  };

  const handleRemove = () => {
    startTransition(() => {
      deleteDocumentNonBlocking(movieDocRef);
      const itemType = movie.mediaType === 'tv' ? 'TV Show' : 'Movie';
      toast({
        title: `${itemType} Removed`,
        description: `${movie.title} has been removed from your list.`,
      });
      onClose();
    });
  };

  // Handler for saving social link from fullscreen input
  const handleSaveSocialLink = async (link: string) => {
    const trimmedLink = link.trim();
    setNewSocialLink(trimmedLink);
    startTransition(() => {
      updateDocumentNonBlocking(movieDocRef, { socialLink: trimmedLink || null });
      toast({
        title: 'Link Updated',
        description: trimmedLink ? 'Social link has been updated.' : 'Social link has been removed.',
      });
    });
  };

  const handleRatingSave = async (rating: number) => {
    if (!user?.uid || !tmdbId) return;

    setIsSavingRating(true);
    try {
      const result = await createOrUpdateRating(
        await user.getIdToken(),
        tmdbId,
        movie.mediaType || 'movie',
        movie.title,
        movie.posterUrl,
        rating
      );
      if ('error' in result) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        setUserRating(rating);
        toast({ title: 'Rating saved', description: `You rated this ${rating.toFixed(1)}/10` });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save rating.' });
    } finally {
      setIsSavingRating(false);
    }
  };

  const handleRatingClear = async () => {
    if (!user?.uid || !tmdbId) return;

    setIsSavingRating(true);
    try {
      const result = await deleteRating(await user.getIdToken(), tmdbId);
      if ('error' in result) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        setUserRating(null);
        toast({ title: 'Rating removed' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to remove rating.' });
    } finally {
      setIsSavingRating(false);
    }
  };

  const handleSaveNote = async (noteToSave: string) => {
    if (!user?.uid || !listId || !listOwnerId) return;

    setIsSavingNote(true);
    try {
      const result = await updateMovieNote(await user.getIdToken(), listOwnerId, listId, movie.id, noteToSave);
      if ('error' in result) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
        throw new Error(result.error);
      } else {
        // Update local state with the saved note
        setUserNote(noteToSave);
        toast({
          title: noteToSave.trim() ? 'Note saved' : 'Note removed',
        });
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save note.' });
      throw error;
    } finally {
      setIsSavingNote(false);
    }
  };

  // Navigate to full-screen comments page
  const handleOpenFullComments = () => {
    const params = new URLSearchParams({
      title: movie.title,
      poster: movie.posterUrl || '',
      type: movie.mediaType || 'movie',
    });
    // Pass return context so back navigation can reopen the modal
    if (listId) params.set('returnListId', listId);
    if (listOwnerId) params.set('returnListOwnerId', listOwnerId);
    if (movie.id) params.set('returnMovieId', movie.id);
    onClose(); // Close the drawer first
    router.push(`/movie/${tmdbId}/comments?${params.toString()}`);
  };

  // Use addedByInfo computed above for display
  const displayName = addedByInfo?.displayName || 'Someone';

  // Hero photo — TMDB backdrop is cinematic (widescreen); fall back to poster.
  const backdropPath =
    mediaDetails && 'backdrop_path' in mediaDetails ? mediaDetails.backdrop_path : null;
  const heroSrc = backdropPath ? `https://image.tmdb.org/t/p/w780${backdropPath}` : movie.posterUrl;

  // Runtime / season label for the metric row.
  let runtimeLabel: string | null = null;
  if (mediaDetails) {
    if ('runtime' in mediaDetails && mediaDetails.runtime) {
      runtimeLabel = `${Math.floor(mediaDetails.runtime / 60)}h ${mediaDetails.runtime % 60}m`;
    } else if ('number_of_seasons' in mediaDetails) {
      runtimeLabel = `${mediaDetails.number_of_seasons} season${mediaDetails.number_of_seasons !== 1 ? 's' : ''}`;
    }
  }

  const cast = mediaDetails?.credits?.cast ?? [];
  const overview = mediaDetails?.overview || movie.overview;
  const allNotes = Object.entries(movie.notes || {}).sort((a) => (a[0] === user.uid ? -1 : 1));
  const heightStyle = drawerHeight > 0 ? `${drawerHeight}px` : 'calc(92 * var(--dvh, 1vh))';

  return (
    <>
      {/* Movie detail — Vaul drawer with the cinematic-open pattern.
          Close when any fullscreen editor is open to release the focus trap. */}
      <Drawer.Root
        open={isOpen && !showNoteEditor && !showSocialLinkEditor && !showRateOnWatchModal}
        onOpenChange={(open) => !open && !showNoteEditor && !showSocialLinkEditor && !showRateOnWatchModal && onClose()}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50" />
          <Drawer.Content
            className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-card outline-none overflow-hidden"
            style={{ height: heightStyle, maxHeight: heightStyle }}
          >
            <Drawer.Description className="sr-only">Details for {movie.title}</Drawer.Description>

            {/* Glassy floating controls — stay fixed over the hero while scrolling */}
            <div className="absolute top-3 left-3 right-3 z-30 flex items-start justify-between">
              <button onClick={onClose} className={GLASS_BTN} aria-label="Back">
                <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className={GLASS_BTN} aria-label="More options">
                      <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="border border-border rounded-xl">
                    <DropdownMenuItem onSelect={() => setShowSocialLinkEditor(true)}>
                      <Link2 className="h-4 w-4 mr-2" />
                      {newSocialLink ? 'edit video link' : 'add video link'}
                    </DropdownMenuItem>
                    {listId && (
                      <DropdownMenuItem onSelect={handleRemove} className="text-destructive" disabled={isPending}>
                        <Trash2 className="h-4 w-4 mr-2" />
                        remove from list
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Scrollable — hero photo + content sheet */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* Hero — full-bleed, bleeds to the drawer's top edge */}
              <div className="relative w-full" style={{ height: 'clamp(240px, 42vh, 360px)', background: 'oklch(0.165 0.012 60)' }}>
                <Image
                  src={heroSrc}
                  alt={`Poster art for ${movie.title}`}
                  fill
                  priority
                  className="object-cover"
                  sizes="100vw"
                />
                {/* scrim — keeps the glassy controls legible; the title now
                    lives only once, in the content sheet below */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/45" />
              </div>

              {/* Content sheet — slides up over the bottom of the hero */}
              <div className="relative -mt-6 rounded-t-[26px] bg-card px-5 pt-2 pb-7">
                {/* drag handle */}
                <div className="mx-auto mb-3.5 h-1 w-10 rounded-full bg-muted-foreground/30" />

                {/* eyebrow chip */}
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border cc-meta text-[10px] lowercase text-muted-foreground">
                  {movie.mediaType === 'tv' ? (
                    <Tv className="h-3 w-3" strokeWidth={1.8} />
                  ) : (
                    <Film className="h-3 w-3" strokeWidth={1.8} />
                  )}
                  {movie.mediaType === 'tv' ? 'tv series' : 'film'}
                </span>

                {/* title — also the drawer's accessible title */}
                <Drawer.Title className="font-headline font-bold text-2xl lowercase tracking-tight leading-[0.95] mt-2.5">
                  {movie.title}
                </Drawer.Title>

                {/* metric chips — runtime · imdb · year */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 cc-meta text-xs text-foreground">
                  {runtimeLabel && (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
                      {runtimeLabel}
                    </span>
                  )}
                  {mediaDetails?.imdbRating && mediaDetails.imdbRating !== 'N/A' && (
                    mediaDetails.imdbId ? (
                      <a
                        href={`https://www.imdb.com/title/${mediaDetails.imdbId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 hover:text-primary transition-colors"
                      >
                        <ImdbLogo className="h-3.5" />
                        {mediaDetails.imdbRating}
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <ImdbLogo className="h-3.5" />
                        {mediaDetails.imdbRating}
                      </span>
                    )
                  )}
                  {movie.year && (
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
                      {movie.year}
                    </span>
                  )}
                  {isLoadingDetails && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>

                {/* genres — hairline mono pills */}
                {mediaDetails?.genres && mediaDetails.genres.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {mediaDetails.genres.map((genre) => (
                      <span
                        key={genre.id}
                        className="px-2 py-0.5 rounded-full border border-border cc-meta text-[10px] lowercase text-muted-foreground"
                      >
                        {genre.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="h-px bg-border my-4" />

                {/* description — editorial serif */}
                {overview ? (
                  <p className="font-serif text-[15px] leading-relaxed text-foreground">{overview}</p>
                ) : !isLoadingDetails ? (
                  <p className="font-serif italic text-sm text-muted-foreground">no overview available</p>
                ) : null}

                {/* cast — horizontal scroll */}
                {cast.length > 0 && (
                  <section className="mt-6">
                    <div className="cc-eyebrow">cast</div>
                    <div className="h-px bg-border my-3" />
                    <div className="flex gap-3 overflow-x-auto pb-1 -mx-5 px-5 scrollbar-hide">
                      {cast.slice(0, 12).map((actor: TMDBCast) => (
                        <div key={actor.id} className="flex-shrink-0 w-14 text-center">
                          <div className="w-14 h-14 rounded-full overflow-hidden border border-border bg-muted relative">
                            {actor.profile_path ? (
                              <Image
                                src={`https://image.tmdb.org/t/p/w185${actor.profile_path}`}
                                alt={actor.name}
                                fill
                                className="object-cover"
                                sizes="56px"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center font-headline font-bold text-sm text-muted-foreground">
                                {actor.name.charAt(0)}
                              </div>
                            )}
                          </div>
                          <p className="font-headline font-semibold text-[11px] lowercase tracking-tight truncate mt-1.5">
                            {actor.name}
                          </p>
                          <p className="cc-meta text-[9px] text-muted-foreground truncate">
                            {actor.character}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* your rating */}
                <section className="mt-6">
                  <div className="cc-eyebrow">your rating</div>
                  <div className="h-px bg-border my-3" />
                  <RatingSlider
                    value={userRating}
                    onChangeComplete={handleRatingSave}
                    onClear={handleRatingClear}
                    disabled={isSavingRating}
                    size="md"
                    label=""
                  />
                </section>

                {/* reviews — featured pull-quotes, then the full discussion */}
                <section className="mt-6">
                  <div className="cc-eyebrow">reviews</div>
                  <div className="h-px bg-border my-3" />
                  {reviewPreviews.length > 0 ? (
                    <div className="space-y-4">
                      {reviewPreviews.map((review) => (
                        <button
                          key={review.id}
                          onClick={handleOpenFullComments}
                          className="block w-full text-left pl-3 border-l-2 border-border"
                        >
                          <p className="font-serif italic text-[15px] leading-snug text-foreground line-clamp-3">
                            “{review.text}”
                          </p>
                          <p className="cc-meta text-[10px] text-muted-foreground mt-1.5">
                            — @{review.username || 'user'} ·{' '}
                            {formatDistanceToNow(new Date(review.createdAt), { addSuffix: true })}
                          </p>
                        </button>
                      ))}
                      <button
                        onClick={handleOpenFullComments}
                        className="cc-meta text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        see all reviews →
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleOpenFullComments}
                      className="w-full flex items-center justify-between gap-3 group"
                    >
                      <span className="font-serif italic text-[15px] text-muted-foreground text-left">
                        be the first to review…
                      </span>
                      <span className="cc-meta text-[11px] text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0">
                        see all →
                      </span>
                    </button>
                  )}
                </section>

                {/* More like this — opens the picked film read-only */}
                {tmdbId > 0 && (
                  <SimilarMoviesRow
                    tmdbId={tmdbId}
                    mediaType={movie.mediaType === 'tv' ? 'tv' : 'movie'}
                    onPick={setSimilarPick}
                  />
                )}

                {/* marginalia — notes from you + your collaborators */}
                {listId && (
                  <section className="mt-6">
                    <div className="cc-eyebrow">
                      marginalia{allNotes.length > 0 ? ` · ${allNotes.length} ${allNotes.length === 1 ? 'note' : 'notes'}` : ''}
                    </div>
                    <div className="h-px bg-border my-3" />
                    {allNotes.length === 0 ? (
                      <p className="font-serif italic text-sm text-muted-foreground">
                        {canEdit
                          ? "the margins are blank. write something they'll remember."
                          : 'no annotations yet.'}
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {allNotes.map(([uid, note]) => {
                          const isMine = uid === user.uid;
                          const author = isMine ? 'you' : noteAuthors[uid]?.name || 'user';
                          return (
                            <blockquote key={uid} className="pl-3 border-l border-border">
                              <p className="font-serif italic text-[15px] leading-snug text-foreground whitespace-pre-wrap break-words">
                                {note}
                              </p>
                              <p className="cc-meta text-[10px] text-muted-foreground mt-1.5">
                                — {isMine ? 'you' : `@${author}`}
                              </p>
                            </blockquote>
                          );
                        })}
                      </div>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => setShowNoteEditor(true)}
                        className="mt-4 inline-flex items-center justify-center h-9 px-4 rounded-full border border-foreground font-headline font-semibold text-[13px] lowercase tracking-tight transition-transform active:scale-[0.98]"
                      >
                        {userNote ? 'edit your note' : 'add your note'}
                      </button>
                    )}
                  </section>
                )}

                {/* the clip — attached TikTok / Reel / YouTube */}
                {(hasEmbeddableVideo || movie.socialLink) && (
                  <section className="mt-6">
                    <div className="cc-eyebrow">the clip</div>
                    <div className="h-px bg-border my-3" />
                    {hasEmbeddableVideo && <VideoEmbed url={movie.socialLink} autoLoad={true} autoPlay={true} />}
                    {movie.socialLink && (
                      <Button asChild variant="outline" className="w-full mt-3">
                        <Link href={movie.socialLink} target="_blank" rel="noopener noreferrer">
                          {SocialIcon && <SocialIcon className="h-4 w-4 mr-2" />}
                          {hasEmbeddableVideo ? (
                            <>open in {getProviderDisplayName(parsedVideo?.provider || null)}</>
                          ) : (
                            <>
                              <ExternalLink className="h-4 w-4 mr-2" />
                              open link
                            </>
                          )}
                        </Link>
                      </Button>
                    )}
                  </section>
                )}

                {/* added by */}
                <p className="cc-meta text-[10px] text-muted-foreground mt-6 text-center">
                  added by {displayName}
                </p>
              </div>
            </div>

            {/* Sticky action bar — two CTAs, max */}
            {canEdit && (
              <div
                className="flex-shrink-0 bg-card border-t border-border px-4 pt-3"
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
              >
                <div className="flex gap-2">
                  <button
                    onClick={() => handleStatusChange('To Watch')}
                    disabled={isPending}
                    className={`flex-1 h-12 rounded-full inline-flex items-center justify-center gap-2 font-headline font-bold text-sm lowercase tracking-tight transition-all disabled:opacity-60 ${
                      localStatus === 'To Watch'
                        ? 'bg-foreground text-background'
                        : 'bg-transparent border border-foreground text-foreground'
                    }`}
                  >
                    <Plus className="h-[15px] w-[15px]" strokeWidth={2.2} />
                    to watch
                  </button>
                  <button
                    onClick={() => handleStatusChange('Watched')}
                    disabled={isPending}
                    className={`flex-1 h-12 rounded-full inline-flex items-center justify-center gap-2 font-headline font-bold text-sm lowercase tracking-tight transition-all disabled:opacity-60 ${
                      localStatus === 'Watched'
                        ? 'bg-foreground text-background'
                        : 'bg-transparent border border-foreground text-foreground'
                    }`}
                  >
                    <Check className="h-[15px] w-[15px]" strokeWidth={2.5} />
                    watched
                  </button>
                </div>
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Rate on Watch - Fullscreen Input with Rating (iOS Safari safe) */}
      <FullscreenTextInput
        isOpen={isOpen && showRateOnWatchModal}
        onClose={() => {
          handleRateOnWatchSkip();
          setShowRateOnWatchModal(false);
        }}
        onSave={handleRateOnWatchSave}
        initialValue=""
        title="Rate & Review"
        subtitle={movie.title}
        placeholder="Share your thoughts... (optional)"
        maxLength={500}
        showRating={true}
        initialRating={7}
        ratingLabel="Your Rating"
      />

      {/* Fullscreen Note Editor - Renders INSTEAD of drawer (not alongside it) */}
      {/* This matches the working pattern in add-movie-modal: drawer closes, fullscreen opens */}
      <FullscreenTextInput
        isOpen={isOpen && showNoteEditor}
        onClose={() => setShowNoteEditor(false)}
        onSave={handleSaveNote}
        initialValue={userNote}
        title="Note"
        subtitle={`For: ${movie.title}`}
        placeholder="Add a personal note about this movie..."
        maxLength={500}
      />

      {/* Fullscreen Social Link Editor */}
      <FullscreenTextInput
        isOpen={isOpen && showSocialLinkEditor}
        onClose={() => setShowSocialLinkEditor(false)}
        onSave={handleSaveSocialLink}
        initialValue={newSocialLink}
        title="Video Link"
        subtitle={movie.title}
        placeholder="TikTok, Instagram, or YouTube URL"
        maxLength={500}
        singleLine={true}
        inputType="url"
      />

      {/* "more like this" pick — read-only detail layered over this one */}
      <PublicMovieDetailsModal
        movie={similarPick}
        isOpen={!!similarPick}
        onClose={() => setSimilarPick(null)}
      />
    </>
  );
}
