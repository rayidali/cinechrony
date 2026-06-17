'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Heart, Loader2, ArrowUp, X, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useUser } from '@/firebase';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { PostCard } from '@/components/post-card';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useUserProfile } from '@/contexts/user-profile-cache';
import { MovieModalProvider } from '@/contexts/movie-modal-context';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Post, PostComment } from '@/lib/types';

export default function PostPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.postId as string;
  const { user, isUserLoading } = useUser();
  const myProfile = useUserProfile(user?.uid ?? '');
  const { toast } = useToast();

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  // The handle to SHOW in the "replying to @…" banner. For a reply to a nested
  // reply it's the tapped reply's author, while replyTo (→ parentId) stays the
  // root comment so threading remains 1-level.
  const [replyHandle, setReplyHandle] = useState<string | null>(null);
  // How much the iOS keyboard obscures the bottom — the reply bar lifts above it
  // (X-style), instead of hiding behind the keyboard.
  const [kbInset, setKbInset] = useState(0);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(async () => {
    try {
      const [postRes, commentsRes] = await Promise.all([
        apiCall<{ post: Post | null }>('GET', `/api/v1/posts/${postId}`),
        apiCall<{ comments: PostComment[] }>('GET', `/api/v1/posts/${postId}/comments`),
      ]);
      if (!postRes.post) {
        setNotFound(true);
      } else {
        setPost(postRes.post);
        setComments(commentsRes.comments ?? []);
      }
    } catch {
      setNotFound(true);
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    if (isUserLoading) return;
    load();
  }, [isUserLoading, load]);

  // Track the keyboard so the fixed reply bar rides above it on iOS.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setKbInset(Math.max(0, window.innerHeight - vv.height));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);

  const submitComment = () => {
    const text = draft.trim();
    if (!text || !user || isPending) return;
    startTransition(async () => {
      try {
        await apiCall('POST', `/api/v1/posts/${postId}/comments`, {
          text,
          parentId: replyTo?.id ?? null,
        });
        setDraft('');
        setReplyTo(null);
        setReplyHandle(null);
        await load();
      } catch (err) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: err instanceof ApiClientError ? err.message : 'Failed to comment.',
        });
      }
    });
  };

  const handleDeleteComment = (commentId: string) => {
    // Keep the embedded card's comment pill in sync — the server decrements
    // post.commentCount only for a TOP-LEVEL comment, so mirror that locally.
    const wasTopLevel = comments.some((c) => c.id === commentId && !c.parentId);
    startTransition(async () => {
      try {
        await apiCall('DELETE', `/api/v1/posts/${postId}/comments/${commentId}`);
        setComments((prev) => prev.filter((c) => c.id !== commentId && c.parentId !== commentId));
        if (wasTopLevel) {
          setPost((p) => (p ? { ...p, commentCount: Math.max(0, p.commentCount - 1) } : p));
        }
      } catch {
        /* ignore */
      }
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <main className="min-h-screen text-foreground">
        <div className="container mx-auto px-4 max-w-2xl flex flex-col items-center justify-center min-h-[60vh] text-center">
          <div className="cc-eyebrow">not found</div>
          <h1 className="font-headline font-bold text-2xl lowercase tracking-tight mt-3">
            this post is gone
          </h1>
          <Link
            href="/home"
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 border border-foreground rounded-full font-headline font-semibold text-sm lowercase"
          >
            back home
          </Link>
        </div>
      </main>
    );
  }

  const topLevel = comments.filter((c) => !c.parentId);
  const repliesByParent = comments.reduce<Record<string, PostComment[]>>((acc, c) => {
    if (c.parentId) (acc[c.parentId] ||= []).push(c);
    return acc;
  }, {});

  return (
    <MovieModalProvider returnPath={`/post/${postId}`}>
    <main className="min-h-screen text-foreground pb-40">
      <div className="container mx-auto px-4 md:px-8 max-w-2xl">
        {/* Header */}
        <div
          className="sticky top-0 z-30 bg-background/90 backdrop-blur flex items-center -mx-4 px-4 border-b border-hair"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)', paddingBottom: '0.75rem' }}
        >
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="h-11 w-11 -ml-2 rounded-full flex items-center justify-center text-foreground active:bg-foreground/5 active:scale-95 transition-all"
          >
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
          <h1 className="flex-1 text-center font-headline font-bold text-[17px] lowercase tracking-[-0.02em]">post</h1>
          <div className="h-11 w-11 -mr-2" aria-hidden />
        </div>

        {/* The post */}
        <div className="mt-4">
          <PostCard post={post} currentUserId={user?.uid ?? null} onDeleted={() => router.push('/home')} disableThreadNav />
        </div>

        {/* Replies */}
        <div className="mt-6 mb-1">
          <div className="cc-eyebrow">
            {comments.length} {comments.length === 1 ? 'reply' : 'replies'}
          </div>
          <div className="h-px bg-rule mt-2.5" />
        </div>

        {topLevel.length === 0 ? (
          <p className="font-serif italic text-[15px] text-muted-foreground py-8 text-center">
            start the conversation.
          </p>
        ) : (
          <div>
            {topLevel.map((c) => (
              <div key={c.id} className="border-b border-rule last:border-b-0 py-4">
                <CommentRow
                  comment={c}
                  currentUserId={user?.uid ?? null}
                  postAuthorId={post.authorId}
                  onReply={() => { setReplyTo(c); setReplyHandle(c.username); }}
                  onDelete={() => handleDeleteComment(c.id)}
                />
                {(repliesByParent[c.id] ?? []).length > 0 && (
                  <div className="mt-3 ml-[26px] pl-3.5 border-l border-rule space-y-4">
                    {repliesByParent[c.id].map((r) => (
                      <CommentRow
                        key={r.id}
                        comment={r}
                        currentUserId={user?.uid ?? null}
                        postAuthorId={post.authorId}
                        isReply
                        onReply={() => { setReplyTo(c); setReplyHandle(r.username); }}
                        onDelete={() => handleDeleteComment(r.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sticky reply composer — no bottom nav on a detail page (X-style); the
          bar rides above the keyboard via the visualViewport inset. */}
      <div
        className="fixed left-0 right-0 z-40 bg-card/95 backdrop-blur border-t border-hair"
        style={{ bottom: kbInset, paddingBottom: kbInset > 0 ? '0.5rem' : 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="container mx-auto px-4 max-w-2xl py-2.5">
          {replyTo && (
            <div className="flex items-center justify-between mb-1.5 font-mono text-[11px] text-muted-foreground">
              <span>replying to @{replyHandle || replyTo.username || 'user'}</span>
              <button
                onClick={() => { setReplyTo(null); setReplyHandle(null); }}
                aria-label="Cancel reply"
                className="h-8 w-8 -my-2 -mr-2 rounded-full flex items-center justify-center active:bg-foreground/5 active:scale-95 transition-all"
              >
                <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            </div>
          )}
          {user ? (
            <div className="flex items-center gap-2.5">
              <ProfileAvatar
                photoURL={myProfile?.photoURL ?? user.photoURL}
                displayName={myProfile?.displayName ?? user.displayName}
                username={myProfile?.username ?? null}
                size="sm"
                className="flex-shrink-0"
              />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitComment(); }}
                placeholder="add a reply…"
                className="flex-1 h-11 px-4 bg-sunken border border-hair rounded-full font-headline text-[15px] tracking-[-0.01em] outline-none focus:border-foreground/30 transition-colors"
              />
              <button
                onClick={submitComment}
                disabled={!draft.trim() || isPending}
                aria-label="Post reply"
                className="h-11 w-11 flex-shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" strokeWidth={2.4} />}
              </button>
            </div>
          ) : (
            <Link href="/login" className="block text-center py-2 font-serif italic text-sm text-muted-foreground">
              sign in to join the conversation
            </Link>
          )}
        </div>
      </div>
    </main>
    </MovieModalProvider>
  );
}

function CommentRow({
  comment,
  currentUserId,
  postAuthorId,
  isReply,
  onReply,
  onDelete,
}: {
  comment: PostComment;
  currentUserId: string | null;
  postAuthorId: string;
  isReply?: boolean;
  onReply: () => void;
  onDelete: () => void;
}) {
  const [liked, setLiked] = useState(
    currentUserId ? comment.likedBy?.includes(currentUserId) : false,
  );
  const [likes, setLikes] = useState(comment.likes || 0);
  const [, startTransition] = useTransition();

  const canDelete = currentUserId === comment.userId || currentUserId === postAuthorId;

  const toggleLike = () => {
    if (!currentUserId) return;
    const next = !liked;
    setLiked(next);
    setLikes((n) => Math.max(0, next ? n + 1 : n - 1));
    startTransition(async () => {
      try {
        if (next) {
          await apiCall(
            'POST',
            `/api/v1/posts/${comment.postId}/comments/${comment.id}/like`,
          );
        } else {
          await apiCall(
            'DELETE',
            `/api/v1/posts/${comment.postId}/comments/${comment.id}/like`,
          );
        }
      } catch {
        setLiked(!next);
        setLikes((n) => Math.max(0, next ? n - 1 : n + 1));
      }
    });
  };

  const time = comment.createdAt
    ? formatDistanceToNow(new Date(comment.createdAt), { addSuffix: false })
        .replace('about ', '').replace('almost ', '').replace('over ', '')
        .replace(' minutes', 'm').replace(' minute', 'm')
        .replace(' hours', 'h').replace(' hour', 'h')
        .replace(' days', 'd').replace(' day', 'd')
        .replace(' months', 'mo').replace(' month', 'mo')
        .replace(' years', 'y').replace(' year', 'y')
        .replace('less than am', 'now')
    : '';

  return (
    <div className="flex gap-3">
      <Link href={`/profile/${comment.username}`} className="flex-shrink-0">
        <ProfileAvatar
          photoURL={comment.userPhotoUrl}
          displayName={comment.userDisplayName}
          username={comment.username}
          size={isReply ? 'xs' : 'sm'}
        />
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/profile/${comment.username}`}
            className="font-mono font-bold text-[12.5px] text-foreground hover:underline truncate"
          >
            @{comment.username || 'user'}
          </Link>
          <span className="font-mono text-[10px] text-muted-foreground">{time}</span>
        </div>
        <p className="font-headline text-[14.5px] leading-[1.45] tracking-[-0.01em] text-foreground mt-1 whitespace-pre-wrap">
          {comment.text}
        </p>
        <div className="flex items-center gap-4 mt-1.5">
          <button onClick={onReply} className="font-mono text-[11px] text-muted-foreground active:text-foreground transition-colors">
            reply
          </button>
          {canDelete && (
            <button
              onClick={onDelete}
              aria-label="Delete comment"
              className="font-mono text-[11px] text-muted-foreground active:text-destructive transition-colors"
            >
              <Trash2 className="h-3 w-3" strokeWidth={1.9} />
            </button>
          )}
        </div>
      </div>

      {/* like column (right) */}
      <button
        onClick={toggleLike}
        disabled={!currentUserId}
        aria-label="Like comment"
        className={cn(
          'flex-shrink-0 flex flex-col items-center gap-0.5 pt-0.5 transition-colors active:scale-90',
          liked ? 'text-primary' : 'text-muted-foreground active:text-foreground',
        )}
      >
        <Heart className={cn('h-[18px] w-[18px]', liked && 'fill-current')} strokeWidth={1.9} />
        {likes > 0 && <span className="font-mono text-[10px] tabular-nums">{likes}</span>}
      </button>
    </div>
  );
}
