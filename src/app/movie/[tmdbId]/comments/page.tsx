'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, Loader2, MessageSquare, Send } from 'lucide-react';
import { ReviewCard } from '@/components/review-card';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useUser, useFirestore } from '@/firebase';
import { getMovieReviews, createReview } from '@/app/actions';
import { doc, getDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
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

  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Handle back navigation - return to movie modal if context available
  const handleBack = () => {
    if (returnListId && returnMovieId) {
      // Navigate to list with openMovie param to reopen the modal
      const params = new URLSearchParams({ openMovie: returnMovieId });
      if (returnListOwnerId) params.set('owner', returnListOwnerId);
      router.push(`/lists/${returnListId}?${params.toString()}`);
    } else {
      router.back();
    }
  };

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
    try {
      const result = await createReview(
        user.uid,
        tmdbId,
        mediaType,
        movieTitle,
        moviePoster || undefined,
        commentText.trim()
      );

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.review) {
        // Add to list optimistically
        setReviews(prev => [result.review as Review, ...prev]);
        setCommentText('');

        // Blur input to dismiss keyboard
        inputRef.current?.blur();

        toast({
          title: 'Comment posted',
          description: 'Your comment has been added.',
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
  }, []);

  // Handle review edit (for now, just remove and let them re-add)
  const handleEditReview = useCallback((review: Review) => {
    // Pre-fill the input with the review text for editing
    setCommentText(review.text);
    inputRef.current?.focus();
    // Note: In Phase 2, we'll implement proper edit functionality
  }, []);

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCommentText(e.target.value);
    // Reset height to auto to get the correct scrollHeight
    e.target.style.height = 'auto';
    // Set height to scrollHeight, max 120px
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      {/* Fixed Header */}
      <header className="flex-shrink-0 border-b border-border bg-background z-10">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={handleBack}
            className="p-2 -ml-2 rounded-full hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          {moviePoster && (
            <Image
              src={moviePoster}
              alt={movieTitle}
              width={40}
              height={60}
              className="rounded border border-border object-cover flex-shrink-0"
            />
          )}

          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-sm truncate">{movieTitle}</h1>
            <p className="text-xs text-muted-foreground">
              {reviews.length} {reviews.length === 1 ? 'comment' : 'comments'}
            </p>
          </div>
        </div>

        {/* Sort options */}
        {reviews.length > 1 && (
          <div className="px-4 py-2 flex gap-2 border-t border-border">
            <button
              onClick={() => setSortBy('recent')}
              className={`text-xs px-3 py-1 rounded-full transition-colors ${
                sortBy === 'recent'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              Recent
            </button>
            <button
              onClick={() => setSortBy('likes')}
              className={`text-xs px-3 py-1 rounded-full transition-colors ${
                sortBy === 'likes'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              Top
            </button>
          </div>
        )}
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
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No comments yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Be the first to share your thoughts!
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {reviews.map(review => (
              <ReviewCard
                key={review.id}
                review={review}
                currentUserId={user?.uid}
                onDelete={handleDeleteReview}
                onEdit={handleEditReview}
              />
            ))}
          </div>
        )}
      </div>

      {/* Fixed Bottom Input */}
      {user && (
        <div
          className="flex-shrink-0 border-t border-border bg-background px-4 py-3"
          style={{
            paddingBottom: keyboardHeight > 0 ? Math.max(12, keyboardHeight - 20) : 12,
            transition: 'padding-bottom 0.1s ease-out',
          }}
        >
          <div className="flex items-end gap-3">
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
                placeholder="Add a comment..."
                rows={1}
                maxLength={1000}
                className="w-full px-4 py-2 pr-12 rounded-2xl border-2 border-border bg-secondary/30 focus:outline-none focus:border-primary resize-none"
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
                className="absolute right-2 bottom-2 p-2 rounded-full bg-primary text-primary-foreground disabled:opacity-50 disabled:bg-muted"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
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
            className="block w-full text-center py-3 rounded-2xl bg-primary text-primary-foreground font-medium"
          >
            Sign in to comment
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
