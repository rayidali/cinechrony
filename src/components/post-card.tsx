'use client';

import { memo, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Heart, MessageCircle, Image as ImageIcon, Trash2, Flag, Play, Film } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth, useUser } from '@/firebase';
import { reportContent } from '@/app/actions';
import { apiCall } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { ProfileAvatar } from '@/components/profile-avatar';
import { BookmarkButton } from '@/components/bookmark-button';
import { CardOverflowMenu, type OverflowRow } from '@/components/card-overflow-menu';
import { useMovieModal } from '@/contexts/movie-modal-context';
import { cn } from '@/lib/utils';
import type { Post, Movie } from '@/lib/types';

type PostCardProps = {
  post: Post;
  currentUserId: string | null;
  onDeleted?: (postId: string) => void;
};

/**
 * A user post in the home feed (LAUNCH 0.5.4) — byline, serif text, an
 * image/video grid, the anchored film, friend tags, and a like/comment/save
 * footer. The larger sibling of the system activity card.
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

  const isOwn = !!user && user.uid === post.authorId;
  const handle = post.authorUsername ? `@${post.authorUsername}` : post.authorDisplayName || 'someone';
  const profileUrl = post.authorUsername ? `/profile/${post.authorUsername}` : '#';
  const timeAgo = post.createdAt
    ? formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })
    : '';

  const handleLike = () => {
    if (!currentUserId) return;
    const next = !isLiked;
    setIsLiked(next);
    setLikeCount((n) => Math.max(0, next ? n + 1 : n - 1));
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
        const idToken = (await auth.currentUser?.getIdToken()) ?? '';
        await reportContent(idToken, 'post', post.id, `Reported post ${post.id}`);
        toast({ title: 'reported.', description: 'thanks for flagging — we’ll take a look.' });
      } catch {
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to report.' });
      }
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

  return (
    <>
      <div className="bg-card rounded-[20px] border border-border p-4 shadow-lift">
        {/* Byline */}
        <div className="flex items-center gap-2.5">
          <Link href={profileUrl} className="flex-shrink-0">
            <ProfileAvatar
              photoURL={post.authorPhotoURL}
              displayName={post.authorDisplayName}
              username={post.authorUsername}
              size="sm"
            />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={profileUrl}
                className="font-headline font-semibold text-sm tracking-tight hover:underline truncate"
              >
                {handle}
              </Link>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border cc-meta text-[10px] lowercase text-muted-foreground">
                <ImageIcon className="h-3 w-3" strokeWidth={1.8} />
                posted
              </span>
            </div>
            <p className="cc-meta text-[10px] text-muted-foreground mt-0.5">
              {timeAgo}
              {post.place ? ` · ${post.place}` : ''}
              {post.editedAt ? ' · edited' : ''}
            </p>
          </div>
          <div className="flex-shrink-0">
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

        {/* Text */}
        {post.text && (
          <p className="font-serif text-[15px] leading-relaxed text-foreground mt-3 whitespace-pre-wrap">
            {post.text}
          </p>
        )}

        {/* Media */}
        {post.media.length > 0 && (
          <div
            className={cn(
              'mt-3 grid gap-1.5',
              post.media.length === 1 ? 'grid-cols-1' : post.media.length === 2 ? 'grid-cols-2' : 'grid-cols-3',
            )}
          >
            {post.media.map((m, i) => (
              <div
                key={i}
                className={cn(
                  'relative overflow-hidden rounded-xl border border-border bg-muted',
                  post.media.length === 1 ? 'aspect-video' : 'aspect-square',
                )}
              >
                {m.type === 'video' ? (
                  <VideoTile src={m.url} posterUrl={m.thumbnailUrl} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" className="w-full h-full object-cover" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Anchored film */}
        {movie && movieAsMovie && (
          <button
            onClick={() => openMovie(movieAsMovie)}
            className="w-full flex items-center gap-3 mt-3 p-2.5 rounded-xl border border-border bg-background text-left active:opacity-70 transition-opacity"
          >
            <div className="relative w-9 h-[54px] rounded-md overflow-hidden bg-muted flex-shrink-0">
              {movie.posterUrl && (
                <Image src={movie.posterUrl} alt="" fill className="object-cover" sizes="36px" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-headline font-semibold text-sm lowercase tracking-tight truncate">
                {movie.title}
              </p>
              {movie.year && (
                <p className="cc-meta text-[11px] text-muted-foreground">{movie.year}</p>
              )}
            </div>
          </button>
        )}

        {/* Tagged friends — legacy v2 posts only. v3 composer uses inline
            @-mentions in the text and doesn't write this list. */}
        {(post.taggedUsers?.length ?? 0) > 0 && (
          <p className="cc-meta text-[11px] text-muted-foreground mt-2.5">
            with{' '}
            {post.taggedUsers!.map((t, i) => (
              <span key={t.uid}>
                {i > 0 && ', '}
                <Link href={`/profile/${t.username}`} className="hover:text-foreground">
                  @{t.username || 'user'}
                </Link>
              </span>
            ))}
          </p>
        )}

        {/* Footer — touch targets sized for thumbs: each button is min 40×40
            with a 1px outer ring removed by negative margin so the visual
            spacing stays compact. Icons bumped from h-3.5 → h-[18px] for
            legibility. */}
        <div className="flex items-center justify-between mt-2.5 pt-3 border-t border-border">
          <div className="flex items-center gap-1 -my-1">
            <button
              onClick={handleLike}
              disabled={!currentUserId}
              className={cn(
                'flex items-center gap-1.5 cc-meta text-[12px] h-10 px-2 rounded-full transition-colors active:scale-95',
                isLiked ? 'text-success' : 'text-muted-foreground hover:text-foreground',
                !currentUserId && 'opacity-50 cursor-not-allowed',
              )}
              aria-label={isLiked ? 'Unlike' : 'Like'}
            >
              <Heart className={cn('h-[18px] w-[18px]', isLiked && 'fill-current')} strokeWidth={1.8} />
              {likeCount > 0 && <span className="tabular-nums">{likeCount}</span>}
            </button>

            <button
              onClick={() => router.push(`/post/${post.id}`)}
              className="flex items-center gap-1.5 cc-meta text-[12px] h-10 px-2 rounded-full text-muted-foreground hover:text-foreground transition-colors active:scale-95"
              aria-label="View comments"
            >
              <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} />
              {post.commentCount > 0 && <span className="tabular-nums">{post.commentCount}</span>}
            </button>

            <BookmarkButton itemType="post" itemId={post.id} className="h-10 px-2 rounded-full" />
          </div>

          {(post.taggedUsers?.length ?? 0) > 0 && (
            <span className="cc-meta text-[10px] text-muted-foreground">
              {post.taggedUsers!.length} tagged
            </span>
          )}
        </div>
      </div>

    </>
  );
});

/**
 * Inline video tile.
 *
 * If `posterUrl` is set (post created after client-side poster capture
 * shipped), it's used as the `<video poster=…>` — the feed paints the
 * real first frame, no grey default. Tap → swaps to native controls and
 * autoplays inline.
 *
 * If `posterUrl` is NOT set (legacy post from before the capture, or a
 * capture that failed gracefully), we render an INTENTIONALLY-styled
 * dark placeholder with a centered play badge instead of falling back to
 * the bare `<video>` element. iOS PWA shows the bare element as a grey
 * box with the system play icon — looks broken — so a styled placeholder
 * is the better failure mode. Tap mounts the real video element on top.
 */
function VideoTile({ src, posterUrl }: { src: string; posterUrl?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const start = () => {
    setPlaying(true);
    // play() must run after the controls-rendering commit so iOS doesn't
    // hand the gesture to its own poster-tap default.
    requestAnimationFrame(() => {
      const v = videoRef.current;
      if (!v) return;
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => setPlaying(false));
    });
  };

  return (
    <div className="relative w-full h-full bg-foreground/85">
      {/* Once the user taps, the real video element mounts and takes over.
          Until then we render nothing media-wise: either the poster (set
          via `poster` attribute) OR the dark surface from the wrapper bg. */}
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

      {/* Idle state — centered play badge over the poster (or the dark
          fallback surface). A small `Film` glyph in the corner declares
          "this is a video" at a glance, even on a tiny grid tile. */}
      {!playing && (
        <button
          type="button"
          onClick={start}
          aria-label="Play video"
          className="absolute inset-0 flex items-center justify-center bg-black/15 group"
        >
          <div className="h-14 w-14 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center group-active:scale-95 transition-transform">
            <Play
              className="h-6 w-6 text-white ml-0.5"
              fill="currentColor"
              strokeWidth={0}
            />
          </div>
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/55 backdrop-blur-sm text-white cc-meta text-[9px] lowercase tracking-wider">
            <Film className="h-2.5 w-2.5" strokeWidth={2} />
            video
          </span>
        </button>
      )}
    </div>
  );
}
