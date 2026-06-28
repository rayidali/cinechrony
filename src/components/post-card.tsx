'use client';

import { memo, useState, useTransition } from 'react';
import Image from 'next/image';
import { Link } from '@/lib/native-nav';
import { useRouter } from '@/lib/native-nav';
import {
  Heart,
  MessageCircle,
  Trash2,
  Flag,
  Play,
  Plus,
  Share,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth, useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import { BookmarkButton } from '@/components/bookmark-button';
import { CardOverflowMenu, type OverflowRow } from '@/components/card-overflow-menu';
import { AddToListSheet } from '@/components/add-to-list-sheet';
import { ReelViewer } from '@/components/v3/reel-viewer';
import { useStoryShare } from '@/components/story-share-provider';
import { VerifiedBadge } from '@/components/verified-badge';
import { useMovieModal } from '@/contexts/movie-modal-context';
import { cn } from '@/lib/utils';
import type { Post, Movie, SearchResult } from '@/lib/types';

type PostCardProps = {
  post: Post;
  currentUserId: string | null;
  onDeleted?: (postId: string) => void;
  /** True on the post-detail page itself, where tapping the post is a no-op
   *  (it's already open). In the feed (default) the caption opens the thread. */
  disableThreadNav?: boolean;
};

/**
 * DiaryEntry — a film-diary post in the reel (Phase 0.7 / v3,
 * `ios-home.jsx::DiaryEntry`). Byline (system-sans handle + tabular time) →
 * serif-italic caption → cinema "movie cell" (poster · title · `+ to a list`)
 * → media gallery (hero + thumbnail rail) → heart / comment / share / bookmark.
 *
 * Pure restyle — every handler (like, comment nav, delete/report, bookmark,
 * movie-modal open, add-to-list) is preserved from the v2 card.
 */
export const PostCard = memo(function PostCard({
  post,
  currentUserId,
  onDeleted,
  disableThreadNav = false,
}: PostCardProps) {
  const { user } = useUser();
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  const { openMovie } = useMovieModal();
  const story = useStoryShare();
  const [isLiked, setIsLiked] = useState(
    currentUserId ? post.likedBy?.includes(currentUserId) : false,
  );
  const [likeCount, setLikeCount] = useState(post.likes || 0);
  const [addOpen, setAddOpen] = useState(false);
  const [reelIndex, setReelIndex] = useState<number | null>(null);

  const openThread = () => { if (!disableThreadNav) router.push(`/post/${post.id}`); };

  const isOwn = !!user && user.uid === post.authorId;
  const handle = post.authorUsername
    ? `@${post.authorUsername}`
    : post.authorDisplayName || 'someone';
  const profileUrl = post.authorUsername ? `/profile/${post.authorUsername}` : '#';
  const avatarLetter = (post.authorUsername || post.authorDisplayName || 'S')
    .charAt(0)
    .toUpperCase();
  const timeAgo = post.createdAt
    ? formatDistanceToNow(new Date(post.createdAt), { addSuffix: false })
    : '';

  const handleLike = () => {
    if (!currentUserId) return;
    const next = !isLiked;
    setIsLiked(next);
    setLikeCount((n) => Math.max(0, next ? n + 1 : n - 1));
    haptic('light');
    startTransition(async () => {
      try {
        if (next) {
          await apiCall('POST', `/api/v1/posts/${post.id}/like`);
        } else {
          await apiCall('DELETE', `/api/v1/posts/${post.id}/like`);
        }
      } catch {
        setIsLiked(!next);
        setLikeCount((n) => Math.max(0, next ? n - 1 : n + 1));
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await apiCall('DELETE', `/api/v1/posts/${post.id}`);
        toast({ title: 'post deleted.' });
        onDeleted?.(post.id);
      } catch {
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete.' });
      }
    });
  };

  const handleReport = () => {
    startTransition(async () => {
      try {
        await apiCall('POST', '/api/v1/reports', {
          contentType: 'post',
          targetId: post.id,
          reason: `Reported post ${post.id}`,
        });
        toast({ title: 'reported.', description: 'thanks for flagging — we’ll take a look.' });
      } catch {
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to report.' });
      }
    });
  };

  const handleShare = async () => {
    haptic('light');
    // Recreate the post as a branded 9:16 "shared a post" story card. Film is
    // optional — text/photo posts still render (byline + caption + stats).
    const film = post.taggedMovie;
    const firstMedia = post.media?.[0];
    const mediaImg = firstMedia
      ? firstMedia.type === 'image'
        ? firstMedia.url
        : firstMedia.thumbnailUrl || null
      : null;
    story.open({
      kind: 'post',
      user: post.authorUsername || post.authorDisplayName || 'someone',
      avatar: post.authorPhotoURL,
      caption: post.text || null,
      timeAgo: timeAgo ? `${timeAgo} ago` : null,
      likes: likeCount,
      comments: post.commentCount || 0,
      media: mediaImg,
      isVideo: firstMedia?.type === 'video',
      title: film?.title || null,
      year: film?.year || null,
      rating: post.rating ?? null,
      poster: film?.posterUrl || null,
    });
  };

  const customRows: OverflowRow[] = isOwn
    ? [{ label: 'delete post', icon: Trash2, onSelect: handleDelete, destructive: true }]
    : [{ label: 'report', icon: Flag, onSelect: handleReport, destructive: true }];

  const movie = post.taggedMovie;
  const movieAsMovie: Movie | null = movie
    ? {
        id: `${movie.mediaType}_${movie.tmdbId}`,
        title: movie.title,
        year: movie.year,
        posterUrl: movie.posterUrl || '/placeholder-poster.png',
        posterHint: `${movie.title} poster`,
        addedBy: '',
        status: 'To Watch',
        mediaType: movie.mediaType,
        tmdbId: movie.tmdbId,
      }
    : null;
  const movieAsSearchResult: SearchResult | null = movie
    ? {
        id: String(movie.tmdbId),
        title: movie.title,
        year: movie.year || 'N/A',
        posterUrl: movie.posterUrl || '/placeholder-poster.png',
        posterHint: `${movie.title} poster`,
        mediaType: movie.mediaType,
        tmdbId: movie.tmdbId,
      }
    : null;

  return (
    <>
      <article className="py-5">
        {/* Byline */}
        <div className="flex items-center gap-[11px]">
          <Link href={profileUrl} aria-label={handle} className="flex-shrink-0">
            <span className="h-10 w-10 rounded-full overflow-hidden bg-muted inline-flex items-center justify-center">
              {post.authorPhotoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img loading="lazy" decoding="async" src={post.authorPhotoURL} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-headline font-bold text-sm text-muted-foreground">
                  {avatarLetter}
                </span>
              )}
            </span>
          </Link>
          <div className="flex-1 min-w-0">
            <Link
              href={profileUrl}
              className="inline-flex items-center gap-1 font-ui font-bold text-[15px] text-foreground tracking-[-0.01em] hover:underline w-fit max-w-full"
            >
              <span className="truncate">{handle}</span>
              <VerifiedBadge uid={post.authorId} />
            </Link>
            <p className="font-mono text-[10px] text-muted-foreground mt-0.5 tabular-nums">
              {timeAgo ? `${timeAgo} ago` : ''}
              {post.editedAt ? ' · edited' : ''}
            </p>
          </div>
          <div className="flex-shrink-0 -mr-1">
            <CardOverflowMenu
              authorId={post.authorId}
              authorUsername={post.authorUsername}
              itemType="post"
              itemId={post.id}
              movieTmdbId={movie?.tmdbId}
              movieTitle={movie?.title}
              mediaType={movie?.mediaType}
              customRows={customRows}
            />
          </div>
        </div>

        {/* Caption — tapping it opens the thread (like X), except on the detail
            page itself. Bricolage Grotesque (font-headline). Case preserved. */}
        {post.text && (
          <p
            onClick={openThread}
            className={cn(
              'font-headline text-[16.5px] leading-[1.5] text-foreground tracking-[-0.01em] mt-[11px] whitespace-pre-wrap',
              !disableThreadNav && 'cursor-pointer',
            )}
          >
            {post.text}
          </p>
        )}

        {/* Movie cell */}
        {movie && movieAsMovie && (
          <div className="mt-[13px]">
            <MovieCell
              movie={movie}
              onOpen={() => openMovie(movieAsMovie)}
              onAdd={() => {
                haptic('light');
                setAddOpen(true);
              }}
            />
          </div>
        )}

        {/* Media gallery */}
        {post.media.length > 0 && (
          <div className="mt-3">
            <MediaGallery media={post.media} onOpenReel={(k) => { haptic('light'); setReelIndex(k); }} />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-[22px] mt-3.5">
          <button
            onClick={handleLike}
            disabled={!currentUserId}
            className={cn(
              'inline-flex items-center gap-[7px] font-ui text-[13px] font-semibold transition-transform active:scale-95',
              isLiked ? 'text-primary' : 'text-foreground',
              !currentUserId && 'opacity-50',
            )}
            aria-label={isLiked ? 'Unlike' : 'Like'}
          >
            <Heart
              className={cn('h-[19px] w-[19px]', isLiked ? 'fill-primary text-primary' : 'text-primary')}
              strokeWidth={1.9}
            />
            {likeCount > 0 && <span className="tabular-nums">{likeCount}</span>}
          </button>

          <button
            onClick={openThread}
            className="inline-flex items-center gap-[7px] font-ui text-[13px] font-medium text-muted-foreground transition-transform active:scale-95"
            aria-label="View comments"
          >
            <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.9} />
            {post.commentCount > 0 && <span className="tabular-nums">{post.commentCount}</span>}
          </button>

          <span className="flex-1" />

          <button
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rule text-foreground transition-transform active:scale-95"
            aria-label="Share"
          >
            <Share className="h-[15px] w-[15px]" strokeWidth={1.9} />
            <span className="font-ui text-[12.5px] font-semibold tracking-[-0.01em]">share</span>
          </button>

          <BookmarkButton itemType="post" itemId={post.id} />
        </div>
      </article>

      {movieAsSearchResult && (
        <AddToListSheet
          movie={addOpen ? movieAsSearchResult : null}
          isOpen={addOpen}
          onClose={() => setAddOpen(false)}
        />
      )}

      <ReelViewer
        isOpen={reelIndex !== null}
        initialIndex={reelIndex ?? 0}
        onClose={() => setReelIndex(null)}
        media={post.media}
        author={{
          uid: post.authorId,
          username: post.authorUsername,
          displayName: post.authorDisplayName,
          photoURL: post.authorPhotoURL,
        }}
        caption={post.text}
        film={movie}
        currentUserId={currentUserId}
        onOpenFilm={movieAsMovie ? () => { setReelIndex(null); openMovie(movieAsMovie); } : undefined}
        onShare={handleShare}
      />
    </>
  );
});

/**
 * Movie cell — the app's movie-row language: poster chip · lowercase title ·
 * meta · a film-red `+ to a list`. Tap the body to open the movie drawer; the
 * `+` opens the add-to-list sheet (nested-button-safe: sibling buttons).
 */
function MovieCell({
  movie,
  onOpen,
  onAdd,
}: {
  movie: NonNullable<Post['taggedMovie']>;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const meta = [movie.year, movie.mediaType === 'tv' ? 'tv' : 'film'].filter(Boolean).join(' · ');
  return (
    <div className="w-full flex items-center gap-3 px-3.5 py-3 rounded-[14px] bg-background border-[0.5px] border-hair">
      <button
        onClick={onOpen}
        className="flex items-center gap-3 flex-1 min-w-0 text-left transition-opacity active:opacity-70"
      >
        <span className="relative w-12 h-[72px] rounded-[10px] overflow-hidden bg-muted flex-shrink-0">
          {movie.posterUrl && (
            <Image src={movie.posterUrl} alt="" fill className="object-cover" sizes="48px" />
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-headline font-bold text-[17px] lowercase tracking-[-0.025em] text-foreground truncate leading-tight">
            {movie.title}
          </span>
          {meta && (
            <span className="block font-mono text-[11px] text-muted-foreground mt-1 tabular-nums">
              {meta}
            </span>
          )}
        </span>
      </button>
      <button
        onClick={onAdd}
        aria-label="add to a list"
        className="w-11 h-11 inline-flex items-center justify-center flex-shrink-0 transition-transform active:scale-90"
      >
        {/* 34px disc kept for visual weight; hit area padded to the 44px min. */}
        <span className="w-[34px] h-[34px] rounded-full bg-primary text-primary-foreground inline-flex items-center justify-center">
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.6} />
        </span>
      </button>
    </div>
  );
}

/**
 * Media gallery — a hero (4:3) + a thumbnail rail. EVERY tile opens the
 * full-screen story-style reel viewer (F22) at its index — the hero at 0, each
 * thumb at its own index. Videos show a poster + play badge.
 */
function MediaGallery({ media, onOpenReel }: { media: Post['media']; onOpenReel: (index: number) => void }) {
  const n = media.length;
  const hero = media[0];

  return (
    <div>
      <button
        onClick={() => onOpenReel(0)}
        aria-label="Open reel"
        className="relative block w-full aspect-[4/3] rounded-[18px] overflow-hidden border-[0.5px] border-hair bg-muted shadow-lift active:opacity-95 transition-opacity"
      >
        <div className="absolute inset-0">
          {hero.type === 'video' ? (
            <>
              {hero.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img loading="lazy" decoding="async" src={hero.thumbnailUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="block w-full h-full bg-foreground/85" />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/15">
                <span className="h-[52px] w-[52px] rounded-full bg-black/35 backdrop-blur-sm border-[0.5px] border-white/45 flex items-center justify-center">
                  <Play className="h-[21px] w-[21px] text-white ml-0.5" fill="currentColor" strokeWidth={0} />
                </span>
              </span>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img loading="lazy" decoding="async" src={hero.url} alt="" className="w-full h-full object-cover" />
          )}
        </div>
        {n > 1 && (
          <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm font-mono text-[10px] font-bold text-white tabular-nums">
            1/{n}
          </span>
        )}
      </button>

      {n > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto scrollbar-hide p-px">
          {media.map((m, k) => (
            <button
              key={k}
              onClick={() => onOpenReel(k)}
              aria-label={`Open reel at ${k + 1}`}
              className="relative flex-shrink-0 w-16 h-16 rounded-[12px] overflow-hidden border-[0.5px] border-hair active:opacity-70"
            >
              {m.type === 'video' ? (
                m.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img loading="lazy" decoding="async" src={m.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="block w-full h-full bg-foreground/80" />
                )
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img loading="lazy" decoding="async" src={m.url} alt="" className="w-full h-full object-cover" />
              )}
              {m.type === 'video' && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="h-5 w-5 rounded-full bg-black/55 flex items-center justify-center">
                    <Play className="h-[11px] w-[11px] text-white ml-px" fill="currentColor" strokeWidth={0} />
                  </span>
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

