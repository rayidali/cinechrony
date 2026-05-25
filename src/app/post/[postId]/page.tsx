'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Heart, Loader2, Send, X, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useUser, useAuth } from '@/firebase';
import {
  getPost,
  getPostComments,
  createPostComment,
  deletePostComment,
  likePostComment,
  unlikePostComment,
} from '@/app/actions';
import { PostCard } from '@/components/post-card';
import { ProfileAvatar } from '@/components/profile-avatar';
import { BottomNav } from '@/components/bottom-nav';
import { MovieModalProvider } from '@/contexts/movie-modal-context';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Post, PostComment } from '@/lib/types';

export default function PostPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.postId as string;
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const { toast } = useToast();

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(async () => {
    try {
      const idToken = user ? await user.getIdToken() : undefined;
      const [postRes, commentsRes] = await Promise.all([
        getPost(postId, idToken),
        getPostComments(postId, idToken),
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
  }, [postId, user]);

  useEffect(() => {
    if (isUserLoading) return;
    load();
  }, [isUserLoading, load]);

  const submitComment = () => {
    const text = draft.trim();
    if (!text || !user || isPending) return;
    startTransition(async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await createPostComment(idToken, postId, text, replyTo?.id ?? null);
        if (res && 'error' in res && res.error) {
          toast({ variant: 'destructive', title: 'Error', description: res.error });
        } else {
          setDraft('');
          setReplyTo(null);
          await load();
        }
      } catch {
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to comment.' });
      }
    });
  };

  const handleDeleteComment = (commentId: string) => {
    startTransition(async () => {
      try {
        const idToken = (await auth.currentUser?.getIdToken()) ?? '';
        const res = await deletePostComment(idToken, postId, commentId);
        if (!res || !('error' in res) || !res.error) {
          setComments((prev) => prev.filter((c) => c.id !== commentId && c.parentId !== commentId));
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
          className="sticky top-0 z-30 bg-background/95 backdrop-blur flex items-center gap-2 -mx-4 px-4 border-b border-border"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)', paddingBottom: '0.75rem' }}
        >
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="h-11 w-11 -ml-2 rounded-full flex items-center justify-center text-foreground/85 hover:bg-muted active:bg-muted active:scale-95 transition-all"
          >
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
          <h1 className="font-headline font-bold text-lg lowercase tracking-tight">post</h1>
        </div>

        {/* The post */}
        <div className="mt-4">
          <PostCard post={post} currentUserId={user?.uid ?? null} onDeleted={() => router.push('/home')} />
        </div>

        {/* Comments */}
        <div className="mt-6 mb-3">
          <div className="cc-eyebrow">
            {topLevel.length} {topLevel.length === 1 ? 'comment' : 'comments'}
          </div>
          <div className="h-px bg-border mt-2.5" />
        </div>

        {topLevel.length === 0 ? (
          <p className="font-serif italic text-[15px] text-muted-foreground py-6 text-center">
            start the conversation.
          </p>
        ) : (
          <div className="space-y-5">
            {topLevel.map((c) => (
              <div key={c.id}>
                <CommentRow
                  comment={c}
                  currentUserId={user?.uid ?? null}
                  postAuthorId={post.authorId}
                  onReply={() => setReplyTo(c)}
                  onDelete={() => handleDeleteComment(c.id)}
                />
                {(repliesByParent[c.id] ?? []).length > 0 && (
                  <div className="mt-3 ml-9 pl-3 border-l border-border space-y-3">
                    {repliesByParent[c.id].map((r) => (
                      <CommentRow
                        key={r.id}
                        comment={r}
                        currentUserId={user?.uid ?? null}
                        postAuthorId={post.authorId}
                        isReply
                        onReply={() => setReplyTo(c)}
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

      {/* Sticky composer */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="container mx-auto px-4 max-w-2xl py-2.5">
          {replyTo && (
            <div className="flex items-center justify-between mb-1.5 cc-meta text-[11px] text-muted-foreground">
              <span>replying to @{replyTo.username || 'user'}</span>
              <button
                onClick={() => setReplyTo(null)}
                aria-label="Cancel reply"
                className="h-8 w-8 -my-2 -mr-2 rounded-full flex items-center justify-center hover:bg-muted active:bg-muted active:scale-95 transition-all"
              >
                <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            </div>
          )}
          {user ? (
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitComment();
                }}
                placeholder="share what you thought…"
                className="flex-1 h-10 px-4 bg-background border border-border rounded-full font-serif italic text-sm outline-none focus:border-foreground/40"
              />
              <button
                onClick={submitComment}
                disabled={!draft.trim() || isPending}
                aria-label="Post comment"
                className="h-10 w-10 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-40"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" strokeWidth={1.8} />
                )}
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="block text-center py-2 font-serif italic text-sm text-muted-foreground"
            >
              sign in to join the conversation
            </Link>
          )}
        </div>
      </div>

      <BottomNav />
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
  const auth = useAuth();
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
        const idToken = (await auth.currentUser?.getIdToken()) ?? '';
        const res = next
          ? await likePostComment(idToken, comment.postId, comment.id)
          : await unlikePostComment(idToken, comment.postId, comment.id);
        if (res && 'error' in res && res.error) {
          setLiked(!next);
          setLikes((n) => Math.max(0, next ? n - 1 : n + 1));
        }
      } catch {
        setLiked(!next);
        setLikes((n) => Math.max(0, next ? n - 1 : n + 1));
      }
    });
  };

  return (
    <div className="flex gap-2.5">
      <Link href={`/profile/${comment.username}`} className="flex-shrink-0">
        <ProfileAvatar
          photoURL={comment.userPhotoUrl}
          displayName={comment.userDisplayName}
          username={comment.username}
          size={isReply ? 'sm' : 'md'}
        />
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/profile/${comment.username}`}
            className="font-headline font-semibold text-[13px] tracking-tight hover:underline truncate"
          >
            @{comment.username || 'user'}
          </Link>
          <span className="cc-meta text-[10px] text-muted-foreground">
            {comment.createdAt
              ? formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })
              : ''}
          </span>
        </div>
        <p className="font-serif text-[14px] leading-snug text-foreground mt-0.5 whitespace-pre-wrap">
          {comment.text}
        </p>
        <div className="flex items-center gap-4 mt-1.5">
          <button
            onClick={toggleLike}
            disabled={!currentUserId}
            className={cn(
              'flex items-center gap-1 cc-meta text-[10px] transition-colors',
              liked ? 'text-success' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Heart className={cn('h-3 w-3', liked && 'fill-current')} strokeWidth={1.8} />
            {likes > 0 && <span>{likes}</span>}
          </button>
          {!isReply && (
            <button
              onClick={onReply}
              className="cc-meta text-[10px] text-muted-foreground hover:text-foreground"
            >
              reply
            </button>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              aria-label="Delete comment"
              className="cc-meta text-[10px] text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
