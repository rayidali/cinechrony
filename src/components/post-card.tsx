'use client';

import { memo, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Heart,
  MessageCircle,
  Trash2,
  Flag,
  Play,
  Film,
  Plus,
  Share,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth, useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import { shareOrigin } from '@/lib/share';
import { BookmarkButton } from '@/components/bookmark-button';
import { CardOverflowMenu, type OverflowRow } from '@/components/card-overflow-menu';
import { AddToListSheet } from '@/components/add-to-list-sheet';
import { useMovieModal } from '@/contexts/movie-modal-context';
import { cn } from '@/lib/utils';
import type { Post, Movie, SearchResult } from '@/lib/types';

type PostCardProps = {
  post: Post;
  currentUserId: string | null;
  onDeleted?: (postId: string) => void;
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
}: PostCardProps) {
  const { user } = useUser();
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  const { openMovie } = useMovieModal();
  const [isLiked, setIsLiked] = useState(
    currentUserId ? post.likedBy?.includes(currentUserId) : false,
  );
  const [likeCount, setLikeCount] = useState(post.likes || 0);
  const [addOpen, setAddOpen] = useState(false);

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
    const url = `${shareOrigin()}/post/${post.id}`;
    const text = post.text ? post.text.slice(0, 140) : 'a film note on cinechrony';
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: 'cinechrony', text, url });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast({ title: 'link copied' });
      }
    } catch {
      /* user dismissed the share sheet — no-op */
    }
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
          <Link href={profileUrl} className="flex-shrink-0">
            <span className="h-10 w-10 rounded-full overflow-hidden bg-muted inline-flex items-center justify-center">
              {post.authorPhotoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.authorPhotoURL} alt="" className="h-full w-full object-cover" />
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
              className="font-ui font-bold text-[15px] text-foreground tracking-[-0.01em] hover:underline truncate block w-fit max-w-full"
            >
              {handle}
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

        {/* Caption — Bricolage Grotesque (font-headline), same face as the
            section titles ("dig in" / "watching lately"). Case preserved. */}
        {post.text && (
          <p className="font-headline text-[16.5px] leading-[1.5] text-foreground tracking-[-0.01em] mt-[11px] whitespace-pre-wrap">
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
            <MediaGallery media={post.media} />
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
            onClick={() => router.push(`/post/${post.id}`)}
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
    <div className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[14px] bg-background border-[0.5px] border-hair">
      <button
        onClick={onOpen}
        className="flex items-center gap-3 flex-1 min-w-0 text-left transition-opacity active:opacity-70"
      >
        <span className="relative w-10 h-[60px] rounded-[7px] overflow-hidden bg-muted flex-shrink-0">
          {movie.posterUrl && (
            <Image src={movie.posterUrl} alt="" fill className="object-cover" sizes="40px" />
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-headline font-bold text-[16px] lowercase tracking-[-0.025em] text-foreground truncate leading-tight">
            {movie.title}
          </span>
          {meta && (
            <span className="block font-mono text-[10px] text-muted-foreground mt-[3px] tabular-nums">
              {meta}
            </span>
          )}
        </span>
      </button>
      <button
        onClick={onAdd}
        aria-label="add to a list"
        className="w-[34px] h-[34px] rounded-full bg-primary text-primary-foreground inline-flex items-center justify-center flex-shrink-0 transition-transform active:scale-90"
      >
        <Plus className="h-[18px] w-[18px]" strokeWidth={2.6} />
      </button>
    </div>
  );
}

/**
 * Media gallery — a Corner-style swipeable hero (4:3) + a thumbnail rail. The
 * hero shows the selected media; tapping a thumb switches. Counter top-right.
 * Video playback reuses the inline `VideoTile`.
 */
function MediaGallery({ media }: { media: Post['media'] }) {
  const [i, setI] = useState(0);
  const n = media.length;
  const idx = Math.min(i, n - 1);
  const cur = media[idx];

  return (
    <div>
      <div className="relative aspect-[4/3] rounded-[18px] overflow-hidden border-[0.5px] border-hair bg-muted shadow-lift">
        <div className="absolute inset-0">
          {cur.type === 'video' ? (
            <VideoTile src={cur.url} posterUrl={cur.thumbnailUrl} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cur.url} alt="" className="w-full h-full object-cover" />
          )}
        </div>
        {n > 1 && (
          <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm font-mono text-[10px] font-bold text-white tabular-nums">
            {idx + 1}/{n}
          </span>
        )}
      </div>

      {n > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto scrollbar-hide p-px">
          {media.map((m, k) => {
            const active = k === idx;
            return (
              <button
                key={k}
                onClick={() => setI(k)}
                className={cn(
                  'relative flex-shrink-0 w-[58px] h-[58px] rounded-[10px] overflow-hidden',
                  active ? 'ring-2 ring-primary' : 'border-[0.5px] border-hair',
                )}
              >
                {m.type === 'video' ? (
                  m.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="block w-full h-full bg-foreground/80" />
                  )
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" className="w-full h-full object-cover" />
                )}
                {!active && <span className="absolute inset-0 bg-background/30" />}
                {m.type === 'video' && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="h-5 w-5 rounded-full bg-black/55 flex items-center justify-center">
                      <Play className="h-[11px] w-[11px] text-white ml-px" fill="currentColor" strokeWidth={0} />
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Inline video tile (unchanged behavior from v2). Poster frame when known,
 * styled dark placeholder otherwise; tap mounts the real element + plays.
 */
function VideoTile({ src, posterUrl }: { src: string; posterUrl?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const start = () => {
    setPlaying(true);
    requestAnimationFrame(() => {
      const v = videoRef.current;
      if (!v) return;
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => setPlaying(false));
    });
  };

  return (
    <div className="relative w-full h-full bg-foreground/85">
      {(playing || posterUrl) && (
        <video
          ref={videoRef}
          src={src}
          poster={posterUrl}
          preload="none"
          playsInline
          controls={playing}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="w-full h-full object-cover"
        />
      )}

      {!playing && (
        <button
          type="button"
          onClick={start}
          aria-label="Play video"
          className="absolute inset-0 flex items-center justify-center bg-black/15 group"
        >
          <div className="h-[52px] w-[52px] rounded-full bg-black/35 backdrop-blur-sm border-[0.5px] border-white/45 flex items-center justify-center group-active:scale-95 transition-transform">
            <Play className="h-[21px] w-[21px] text-white ml-0.5" fill="currentColor" strokeWidth={0} />
          </div>
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/55 backdrop-blur-sm text-white font-mono text-[9px] lowercase tracking-wider">
            <Film className="h-2.5 w-2.5" strokeWidth={2} />
            video
          </span>
        </button>
      )}
    </div>
  );
}
