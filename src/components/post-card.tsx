'use client';

import { memo, useState, useTransition } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Heart, MessageCircle, Image as ImageIcon, Trash2, Flag } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth, useUser } from '@/firebase';
import { likePost, unlikePost, deletePost, reportContent } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { ProfileAvatar } from '@/components/profile-avatar';
import { BookmarkButton } from '@/components/bookmark-button';
import { CardOverflowMenu, type OverflowRow } from '@/components/card-overflow-menu';
import { PublicMovieDetailsModal } from '@/components/public-movie-details-modal';
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

  const [isLiked, setIsLiked] = useState(
    currentUserId ? post.likedBy?.includes(currentUserId) : false,
  );
  const [likeCount, setLikeCount] = useState(post.likes || 0);
  const [movieOpen, setMovieOpen] = useState(false);

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
        const idToken = (await auth.currentUser?.getIdToken()) ?? '';
        const res = next ? await likePost(idToken, post.id) : await unlikePost(idToken, post.id);
        if (res && 'error' in res && res.error) {
          setIsLiked(!next);
          setLikeCount((n) => Math.max(0, next ? n - 1 : n + 1));
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
        const idToken = (await auth.currentUser?.getIdToken()) ?? '';
        const res = await deletePost(idToken, post.id);
        if (res && 'error' in res && res.error) {
          toast({ variant: 'destructive', title: 'Error', description: res.error });
        } else {
          toast({ title: 'post deleted.' });
          onDeleted?.(post.id);
        }
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
                  <video
                    src={m.url}
                    controls
                    preload="metadata"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" className="w-full h-full object-cover" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Anchored film */}
        {movie && (
          <button
            onClick={() => setMovieOpen(true)}
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

        {/* Footer */}
        <div className="flex items-center justify-between mt-3.5 pt-3 border-t border-border">
          <div className="flex items-center gap-4">
            <button
              onClick={handleLike}
              disabled={!currentUserId}
              className={cn(
                'flex items-center gap-1.5 cc-meta text-[11px] transition-colors',
                isLiked ? 'text-success' : 'text-muted-foreground hover:text-foreground',
                !currentUserId && 'opacity-50 cursor-not-allowed',
              )}
              aria-label={isLiked ? 'Unlike' : 'Like'}
            >
              <Heart className={cn('h-3.5 w-3.5', isLiked && 'fill-current')} strokeWidth={1.8} />
              {likeCount > 0 && <span>{likeCount}</span>}
            </button>

            <button
              onClick={() => router.push(`/post/${post.id}`)}
              className="flex items-center gap-1.5 cc-meta text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
              {post.commentCount > 0 && <span>{post.commentCount}</span>}
            </button>

            <BookmarkButton itemType="post" itemId={post.id} />
          </div>

          {(post.taggedUsers?.length ?? 0) > 0 && (
            <span className="cc-meta text-[10px] text-muted-foreground">
              {post.taggedUsers!.length} tagged
            </span>
          )}
        </div>
      </div>

      <PublicMovieDetailsModal
        movie={movieOpen ? movieAsMovie : null}
        isOpen={movieOpen}
        onClose={() => setMovieOpen(false)}
      />
    </>
  );
});
