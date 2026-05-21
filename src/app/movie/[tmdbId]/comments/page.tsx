'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Loader2, X, ChevronDown, ChevronUp, ChevronLeft, ArrowUp } from 'lucide-react';
import { ReviewCard } from '@/components/review-card';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useUser, useFirestore } from '@/firebase';
import { getMovieReviews, createReview, updateReview, getReviewReplies } from '@/app/actions';
import { doc, getDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { getRatingStyle } from '@/lib/utils';
import type { Review } from '@/lib/types';

function CommentsPageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  // Get movie info from URL params
  const tmdbId = Number(params.tmdbId);
  const movieTitle = searchParams.get('title') || 'Movie';
  const moviePoster = searchParams.get('poster') || '';
  const mediaType = (searchParams.get('type') || 'movie') as 'movie' | 'tv';

  // Return context for proper back navigation
  // SECURITY: returnPath takes precedence - it preserves the original route context
  // (e.g., /profile/username/lists/listId for public profile views)
  // This prevents redirecting to /lists/{id} which could expose edit controls
  const returnPath = searchParams.get('returnPath');
  const returnListId = searchParams.get('returnListId');
  const returnListOwnerId = searchParams.get('returnListOwnerId');
  const returnMovieId = searchParams.get('returnMovieId');

  // State
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'recent' | 'likes'>('recent');
  const [commentText, setCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [userProfile, setUserProfile] = useState<{ photoURL?: string; displayName?: string; username?: string } | null>(null);

  // Reply state - track both the root parent and who we're directly replying to
  const [replyingTo, setReplyingTo] = useState<Review | null>(null);
  const [rootParentId, setRootParentId] = useState<string | null>(null); // Always the top-level comment ID
  // AUDIT.md 2.6: tracks which review we're editing. When set, handleSubmit
  // calls updateReview instead of createReview (the old code posted a new
  // duplicate comment instead of editing the original).
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, Review[]>>({});
  const [loadingReplies, setLoadingReplies] = useState<Record<string, boolean>>({});

  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Handle back navigation - return to movie modal if context available
  // SECURITY: Use returnPath if available to preserve original route context
  // This ensures we return to public profile views correctly instead of /lists/{id}
  const handleBack = useCallback(() => {
    if (returnPath && returnMovieId) {
      // Use the explicit return path (preserves public profile context)
      const params = new URLSearchParams({ openMovie: returnMovieId });
      router.replace(`${returnPath}?${params.toString()}`);
    } else if (returnListId && returnMovieId) {
      // Fallback to legacy behavior for backwards compatibility
      const params = new URLSearchParams({ openMovie: returnMovieId });
      if (returnListOwnerId) params.set('owner', returnListOwnerId);
      router.replace(`/lists/${returnListId}?${params.toString()}`);
    } else {
      router.back();
    }
  }, [returnPath, returnListId, returnMovieId, returnListOwnerId, router]);

  // Intercept browser back navigation (swipe gesture on iOS) to redirect properly
  // SECURITY: Use returnPath if available to preserve original route context
  useEffect(() => {
    // Need either returnPath or returnListId to handle back navigation
    if ((!returnPath && !returnListId) || !returnMovieId) return;

    // Push a state so we can intercept the back navigation
    window.history.pushState({ commentsPage: true }, '');

    const handlePopState = (e: PopStateEvent) => {
      // User swiped back or pressed browser back - redirect to correct page with modal open
      e.preventDefault();
      const params = new URLSearchParams({ openMovie: returnMovieId });

      if (returnPath) {
        // Use explicit return path (preserves public profile context)
        router.replace(`${returnPath}?${params.toString()}`);
      } else if (returnListId) {
        // Fallback to legacy behavior
        if (returnListOwnerId) params.set('owner', returnListOwnerId);
        router.replace(`/lists/${returnListId}?${params.toString()}`);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [returnPath, returnListId, returnMovieId, returnListOwnerId, router]);

  // Fetch reviews
  useEffect(() => {
    async function fetchReviews() {
      setIsLoading(true);
      try {
        const result = await getMovieReviews(tmdbId, sortBy);
        if (result.reviews) {
          setReviews(result.reviews as Review[]);
        }
      } catch (error) {
        console.error('Failed to fetch reviews:', error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchReviews();
  }, [tmdbId, sortBy]);

  // Fetch user profile for avatar
  useEffect(() => {
    async function fetchUserProfile() {
      if (!user || !firestore) return;
      try {
        const userDoc = await getDoc(doc(firestore, 'users', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserProfile({
            photoURL: data?.photoURL,
            displayName: data?.displayName,
            username: data?.username,
          });
        }
      } catch (err) {
        console.error('Failed to fetch user profile:', err);
      }
    }
    fetchUserProfile();
  }, [user, firestore]);

  // Handle iOS keyboard with visualViewport API
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleResize = () => {
      // Calculate keyboard height as difference between window and viewport
      const kbHeight = window.innerHeight - viewport.height;
      setKeyboardHeight(kbHeight > 0 ? kbHeight : 0);

      // Scroll to bottom when keyboard opens
      if (kbHeight > 0 && scrollContainerRef.current) {
        setTimeout(() => {
          scrollContainerRef.current?.scrollTo({
            top: scrollContainerRef.current.scrollHeight,
            behavior: 'smooth',
          });
        }, 100);
      }
    };

    viewport.addEventListener('resize', handleResize);
    viewport.addEventListener('scroll', handleResize);

    return () => {
      viewport.removeEventListener('resize', handleResize);
      viewport.removeEventListener('scroll', handleResize);
    };
  }, []);

  // Handle comment submission
  const handleSubmitComment = async () => {
    if (!user || !commentText.trim() || isSubmitting) return;

    setIsSubmitting(true);

    // AUDIT.md 2.6: edit path — patches the existing review in place instead
    // of creating a duplicate. Replies/parent logic is irrelevant when editing
    // (we're updating an existing doc, not posting a new one).
    if (editingReview) {
      try {
        const newText = commentText.trim();
        const res = await updateReview(await user.getIdToken(), editingReview.id, newText);
        if ('error' in res) throw new Error(res.error);

        // Patch local state so the UI updates without a refetch. Top-level
        // reviews live in `reviews`; replies live under their root in
        // `expandedReplies`. Update whichever holds this review.
        if (editingReview.parentId) {
          const root = editingReview.parentId;
          setExpandedReplies(prev => {
            const list = prev[root];
            if (!list) return prev;
            return {
              ...prev,
              [root]: list.map(r => (r.id === editingReview.id ? { ...r, text: newText, updatedAt: new Date() } : r)),
            };
          });
        } else {
          setReviews(prev => prev.map(r => (r.id === editingReview.id ? { ...r, text: newText, updatedAt: new Date() } : r)));
        }

        setEditingReview(null);
        setCommentText('');
        inputRef.current?.blur();
        toast({ title: 'Comment updated' });
      } catch (error: any) {
        toast({ variant: 'destructive', title: 'Failed to update comment', description: error.message || 'Please try again.' });
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Use rootParentId for replies (Instagram/TikTok style - all replies under root)
    const parentId = rootParentId || null;

    try {
      const result = await createReview(
        await user.getIdToken(),
        tmdbId,
        mediaType,
        movieTitle,
        moviePoster || undefined,
        commentText.trim(),
        undefined, // ratingAtTime
        parentId // parentId for replies
      );

      if ('error' in result) {
        throw new Error(result.error);
      }

      if (result.review) {
        if (parentId) {
          // Add reply to expanded replies if parent is expanded
          if (expandedReplies[parentId]) {
            setExpandedReplies(prev => ({
              ...prev,
              [parentId]: [...prev[parentId], result.review as Review],
            }));
          }
          // Update root parent's reply count
          setReviews(prev => prev.map(r =>
            r.id === rootParentId ? { ...r, replyCount: (r.replyCount || 0) + 1 } : r
          ));
          // Clear replying state
          setReplyingTo(null);
          setRootParentId(null);
        } else {
          // Add top-level comment to list
          setReviews(prev => [result.review as Review, ...prev]);
        }

        setCommentText('');

        // Blur input to dismiss keyboard
        inputRef.current?.blur();

        toast({
          title: parentId ? 'Reply posted' : 'Comment posted',
          description: parentId ? 'Your reply has been added.' : 'Your comment has been added.',
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Failed to post comment',
        description: error.message || 'Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle review deletion
  const handleDeleteReview = useCallback((reviewId: string) => {
    setReviews(prev => prev.filter(r => r.id !== reviewId));
    // Also remove from expanded replies if it was a reply
    setExpandedReplies(prev => {
      const updated = { ...prev };
      for (const parentId in updated) {
        updated[parentId] = updated[parentId].filter(r => r.id !== reviewId);
      }
      return updated;
    });
  }, []);

  // Handle starting a reply - Instagram/TikTok style: all replies go under root parent
  const handleStartReply = useCallback((review: Review, parentIdOverride?: string) => {
    // Replying overrides any in-progress edit (mutually exclusive composer modes).
    setEditingReview(null);
    setReplyingTo(review);
    // If this review is already a reply, use its parentId as root. Otherwise, use this review's id.
    const rootId = review.parentId || review.id;
    setRootParentId(parentIdOverride || rootId);
    setCommentText(`@${review.username || review.userDisplayName || 'user'} `);
    inputRef.current?.focus();
  }, []);

  // Cancel replying
  const handleCancelReply = useCallback(() => {
    setReplyingTo(null);
    setRootParentId(null);
    setCommentText('');
  }, []);

  // Toggle showing replies for a review
  const handleToggleReplies = useCallback(async (review: Review) => {
    const parentId = review.id;

    // If already expanded, collapse
    if (expandedReplies[parentId]) {
      setExpandedReplies(prev => {
        const updated = { ...prev };
        delete updated[parentId];
        return updated;
      });
      return;
    }

    // Fetch replies
    setLoadingReplies(prev => ({ ...prev, [parentId]: true }));
    try {
      const result = await getReviewReplies(parentId);
      if (result.replies) {
        setExpandedReplies(prev => ({
          ...prev,
          [parentId]: result.replies as Review[],
        }));
      }
    } catch (error) {
      console.error('Failed to fetch replies:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to load replies',
      });
    } finally {
      setLoadingReplies(prev => ({ ...prev, [parentId]: false }));
    }
  }, [expandedReplies, toast]);

  // AUDIT.md 2.6: real edit (was a pre-fill that posted a duplicate on save).
  const handleEditReview = useCallback((review: Review) => {
    setEditingReview(review);
    setCommentText(review.text);
    // Editing precludes replying.
    setReplyingTo(null);
    setRootParentId(null);
    inputRef.current?.focus();
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingReview(null);
    setCommentText('');
  }, []);

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCommentText(e.target.value);
    // Reset height to auto to get the correct scrollHeight
    e.target.style.height = 'auto';
    // Set height to scrollHeight, max 120px
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  // Featured = the most-liked review, lifted out as a magazine pull-quote.
  const featured = (() => {
    if (reviews.length < 2) return null;
    const top = [...reviews].sort((a, b) => (b.likes || 0) - (a.likes || 0))[0];
    return top && (top.likes || 0) > 0 ? top : null;
  })();
  const restReviews = featured ? reviews.filter((r) => r.id !== featured.id) : reviews;
  const threadCount = reviews.filter((r) => (r.replyCount || 0) > 0).length;

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      {/* Sticky context header */}
      <header className="flex-shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 z-10">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={handleBack}
            className="p-1.5 -ml-1.5 rounded-full hover:bg-secondary transition-colors"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>

          {moviePoster && (
            <Image
              src={moviePoster}
              alt={movieTitle}
              width={32}
              height={48}
              className="rounded-[5px] border border-border object-cover flex-shrink-0"
            />
          )}

          <div className="min-w-0 flex-1">
            <h1 className="font-headline font-semibold text-sm lowercase tracking-tight truncate">{movieTitle}</h1>
            <p className="cc-meta text-[11px] text-muted-foreground">
              {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
              {threadCount > 0 ? ` · ${threadCount} ${threadCount === 1 ? 'thread' : 'threads'}` : ''}
            </p>
          </div>
        </div>
      </header>

      {/* Scrollable Comments List */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4"
        style={{ paddingBottom: keyboardHeight > 0 ? 0 : undefined }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : reviews.length === 0 ? (
          <div className="py-16 text-center">
            <div className="cc-eyebrow">reviews</div>
            <p className="font-serif italic text-[17px] text-muted-foreground mt-3">
              no reviews yet. be the first to write something.
            </p>
          </div>
        ) : (
          <>
            {/* Sort line */}
            <div className="flex items-baseline justify-between py-3 border-b border-border">
              <span className="cc-eyebrow">reviews</span>
              <div className="flex gap-3 cc-meta text-[11px]">
                <button
                  onClick={() => setSortBy('recent')}
                  className={sortBy === 'recent' ? 'text-foreground border-b border-primary pb-0.5' : 'text-muted-foreground hover:text-foreground'}
                >
                  most recent
                </button>
                <button
                  onClick={() => setSortBy('likes')}
                  className={sortBy === 'likes' ? 'text-foreground border-b border-primary pb-0.5' : 'text-muted-foreground hover:text-foreground'}
                >
                  most liked
                </button>
              </div>
            </div>

            {/* Featured pull-quote — the most-liked take, set like a magazine */}
            {featured && (
              <div className="py-5 border-b border-border">
                <div className="cc-eyebrow text-primary">★ featured review</div>
                <p className="font-serif italic font-light text-[21px] leading-snug text-foreground mt-3">
                  &ldquo;{featured.text}&rdquo;
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <ProfileAvatar
                    photoURL={featured.userPhotoUrl ?? null}
                    displayName={featured.userDisplayName ?? null}
                    username={featured.username}
                    size="sm"
                  />
                  <span className="cc-meta text-[11px] text-muted-foreground">
                    {featured.username ? `@${featured.username}` : 'anonymous'}
                  </span>
                  {featured.ratingAtTime != null && (
                    <span
                      className="px-1.5 py-0.5 rounded font-headline font-bold text-[11px] tabular-nums"
                      style={{
                        ...getRatingStyle(featured.ratingAtTime).background,
                        ...getRatingStyle(featured.ratingAtTime).textOnBg,
                      }}
                    >
                      {featured.ratingAtTime.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Comment list */}
            <div className="divide-y divide-border">
              {restReviews.map(review => (
                <div key={review.id}>
                  {/* Parent review */}
                  <ReviewCard
                    review={review}
                    currentUserId={user?.uid}
                    onDelete={handleDeleteReview}
                    onEdit={handleEditReview}
                    onReply={handleStartReply}
                  />

                  {/* View replies button */}
                  {(review.replyCount || 0) > 0 && (
                    <div className="pl-11 pb-2">
                      <button
                        onClick={() => handleToggleReplies(review)}
                        disabled={loadingReplies[review.id]}
                        className="flex items-center gap-1.5 cc-meta text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        {loadingReplies[review.id] ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : expandedReplies[review.id] ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                        {expandedReplies[review.id]
                          ? 'hide replies'
                          : `${review.replyCount} ${review.replyCount === 1 ? 'reply' : 'replies'}`
                        }
                      </button>
                    </div>
                  )}

                  {/* Inline replies — ReviewCard handles its own left-rule */}
                  {expandedReplies[review.id] && (
                    <div className="pb-2">
                      {expandedReplies[review.id].map(reply => (
                        <ReviewCard
                          key={reply.id}
                          review={reply}
                          currentUserId={user?.uid}
                          onDelete={handleDeleteReview}
                          onReply={(r) => handleStartReply(r, review.id)}
                          isReply
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Fixed Bottom Input */}
      {user && (
        <div
          className="flex-shrink-0 border-t border-border bg-background"
          style={{
            paddingBottom: keyboardHeight > 0 ? Math.max(12, keyboardHeight - 20) : 12,
            transition: 'padding-bottom 0.1s ease-out',
          }}
        >
          {/* Reply indicator */}
          {replyingTo && (
            <div className="flex items-center justify-between px-4 py-2 bg-secondary/50 border-b border-border">
              <span className="text-sm text-muted-foreground">
                Replying to <span className="font-medium text-foreground">@{replyingTo.username || replyingTo.userDisplayName || 'user'}</span>
              </span>
              <button
                onClick={handleCancelReply}
                className="p-1 rounded-full hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* AUDIT.md 2.6: edit indicator (mirror of the reply indicator). */}
          {editingReview && (
            <div className="flex items-center justify-between px-4 py-2 bg-secondary/50 border-b border-border">
              <span className="text-sm text-muted-foreground">Editing your comment</span>
              <button
                onClick={cancelEdit}
                className="p-1 rounded-full hover:bg-secondary"
                aria-label="Cancel edit"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-3 px-4 py-3">
            <ProfileAvatar
              photoURL={userProfile?.photoURL}
              displayName={userProfile?.displayName}
              username={userProfile?.username}
              size="sm"
            />

            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={commentText}
                onChange={handleTextareaChange}
                placeholder={replyingTo ? 'write a reply…' : 'share what you thought…'}
                rows={1}
                maxLength={1000}
                className="w-full px-4 py-2 pr-12 rounded-2xl border border-border bg-secondary/30 focus:outline-none focus:border-primary resize-none"
                style={{
                  fontSize: '16px', // Prevents iOS zoom
                  lineHeight: '1.5',
                  maxHeight: '120px',
                }}
                onKeyDown={(e) => {
                  // Submit on Enter (without shift)
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitComment();
                  }
                }}
              />

              <button
                onClick={handleSubmitComment}
                disabled={!commentText.trim() || isSubmitting}
                className="absolute right-2 bottom-1.5 p-2 rounded-full bg-foreground text-background disabled:opacity-40"
                aria-label="Post comment"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" strokeWidth={2.2} />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Login prompt for non-authenticated users */}
      {!user && (
        <div className="flex-shrink-0 border-t border-border bg-background px-4 py-3">
          <Link
            href="/login"
            className="block w-full text-center py-3 rounded-full bg-foreground text-background font-headline font-semibold lowercase tracking-tight"
          >
            sign in to comment
          </Link>
        </div>
      )}
    </div>
  );
}

// Loading fallback
function CommentsLoading() {
  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

// Default export with Suspense for useSearchParams
export default function CommentsPage() {
  return (
    <Suspense fallback={<CommentsLoading />}>
      <CommentsPageContent />
    </Suspense>
  );
}
