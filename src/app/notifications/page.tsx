'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Bell, MessageSquare, AtSign, Check, UserPlus, Heart, Users, Loader2 } from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useUser } from '@/firebase';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { invalidateCachedAction, setCachedAction, readCachedAction } from '@/lib/use-cached-action';
import { formatDistanceToNow } from 'date-fns';
import type { Notification, NotificationType } from '@/lib/types';
import { PushNotificationPrompt } from '@/components/push-notification-prompt';
import { PullToRefresh } from '@/components/pull-to-refresh';
import { useToast } from '@/hooks/use-toast';

type NotifPage = { notifications: Notification[]; hasMore: boolean; nextCursor?: string };

const POSTER = 'https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png';

/** The per-type trailing glyph + its semantic (dark-mode-safe) colour. */
function typeGlyph(type: NotificationType) {
  switch (type) {
    case 'mention':
    case 'post_tag':
      return <AtSign className="h-[18px] w-[18px] text-primary" strokeWidth={2} aria-hidden />;
    case 'reply':
    case 'post_comment':
      return <MessageSquare className="h-[18px] w-[18px] text-primary" strokeWidth={2} aria-hidden />;
    case 'like':
    case 'list_like':
    case 'post_like':
      return <Heart className="h-[18px] w-[18px] text-primary fill-primary" strokeWidth={2} aria-hidden />;
    case 'follow':
      return <UserPlus className="h-[18px] w-[18px] text-success" strokeWidth={2} aria-hidden />;
    case 'list_invite':
      return <Users className="h-[18px] w-[18px] text-primary" strokeWidth={2} aria-hidden />;
    default:
      return null;
  }
}

/** The notification's destination, or null if it can't be opened. */
function notifTarget(n: Notification): string | null {
  switch (n.type) {
    case 'follow':
      return n.fromUsername ? `/profile/${n.fromUsername}` : null;
    case 'list_invite':
      return '/lists';
    case 'list_like':
      return n.listId ? `/lists/${n.listId}` : null;
    case 'post_tag':
    case 'post_like':
    case 'post_comment':
      return n.postId ? `/post/${n.postId}` : null;
    case 'mention':
    case 'reply':
    case 'like':
      if (n.tmdbId && n.movieTitle && n.mediaType) {
        const p = new URLSearchParams({ title: n.movieTitle, type: n.mediaType });
        return `/movie/${n.tmdbId}/comments?${p.toString()}`;
      }
      return null;
    default:
      return null;
  }
}

function RowSkeleton() {
  return (
    <div className="divide-y divide-hair">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 py-3.5">
          <div className="h-10 w-10 flex-shrink-0 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-3/4 rounded bg-muted animate-pulse" />
            <div className="h-2.5 w-1/4 rounded bg-muted animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NotificationsPage() {
  const router = useRouter();
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processingInvites, setProcessingInvites] = useState<Record<string, 'accepting' | 'declining'>>({});

  // Initial load / retry — a stable callback so the error "try again" button
  // re-runs the fetch instead of hard-reloading the WebView.
  const loadNotifications = useCallback(async () => {
    if (!user?.uid) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiCall<NotifPage>('GET', '/api/v1/notifications');
      setNotifications(result.notifications ?? []);
      setHasMore(!!result.hasMore);
      setCursor(result.nextCursor ?? null);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
      setError(err instanceof ApiClientError ? err.message : 'Failed to load notifications. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Pull-to-refresh — reset to page 1.
  const handleRefresh = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const result = await apiCall<NotifPage>('GET', '/api/v1/notifications');
      setNotifications(result.notifications ?? []);
      setHasMore(!!result.hasMore);
      setCursor(result.nextCursor ?? null);
    } catch (err) {
      console.error('Failed to refresh notifications:', err);
    }
  }, [user?.uid]);

  // Infinite scroll — load the next page only when the sentinel scrolls in
  // (no eager fetch-all: quota-first on free-tier Firestore).
  const loadMore = useCallback(async () => {
    if (!user?.uid || !hasMore || isLoadingMore || !cursor) return;
    setIsLoadingMore(true);
    try {
      const result = await apiCall<NotifPage>('GET', `/api/v1/notifications?cursor=${encodeURIComponent(cursor)}`);
      setNotifications((prev) => [...prev, ...(result.notifications ?? [])]);
      setHasMore(!!result.hasMore);
      setCursor(result.nextCursor ?? null);
    } catch (err) {
      console.error('Failed to load more notifications:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [user?.uid, hasMore, isLoadingMore, cursor]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: '400px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMore]);

  // Redirect if not logged in.
  useEffect(() => {
    if (!isUserLoading && !user) router.push('/login');
  }, [user, isUserLoading, router]);

  const handleMarkAllRead = async () => {
    if (!user?.uid) return;
    try {
      await apiCall('POST', '/api/v1/notifications/read');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setCachedAction(`notif-count:${user.uid}`, 0);
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }
  };

  const markOneRead = (id: string) => {
    if (!user?.uid) return;
    apiCall('POST', '/api/v1/notifications/read', { ids: [id] }).catch(console.error);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    const k = `notif-count:${user.uid}`;
    const cur = readCachedAction<number>(k);
    if (typeof cur === 'number') setCachedAction(k, Math.max(0, cur - 1));
    else invalidateCachedAction(k);
  };

  const removeNotif = (id: string) => setNotifications((prev) => prev.filter((n) => n.id !== id));

  const handleAcceptInvite = async (n: Notification) => {
    if (!user?.uid || !n.inviteId || processingInvites[n.id]) return;
    setProcessingInvites((p) => ({ ...p, [n.id]: 'accepting' }));
    try {
      const result = await apiCall<{ listId: string; listOwnerId: string }>(
        'POST', '/api/v1/invites/accept', { inviteId: n.inviteId },
      );
      toast({ title: 'invite accepted', description: `you're now a collaborator on "${n.listName}"` });
      removeNotif(n.id);
      invalidateCachedAction(`collab-lists:${user.uid}`);
      router.push(`/lists/${result.listId}?owner=${result.listOwnerId}`);
    } catch (err) {
      // Already accepted / revoked → treat as success: clear the stale row.
      if (err instanceof ApiClientError && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND')) {
        removeNotif(n.id);
      } else {
        console.error('Failed to accept invite:', err);
        toast({ variant: 'destructive', title: 'Error', description: err instanceof ApiClientError ? err.message : 'Failed to accept invite' });
      }
    } finally {
      setProcessingInvites((p) => { const u = { ...p }; delete u[n.id]; return u; });
    }
  };

  const handleDeclineInvite = async (n: Notification) => {
    if (!user?.uid || !n.inviteId || processingInvites[n.id]) return;
    setProcessingInvites((p) => ({ ...p, [n.id]: 'declining' }));
    try {
      await apiCall('POST', `/api/v1/invites/${n.inviteId}/decline`);
      toast({ title: 'invite declined' });
      removeNotif(n.id);
    } catch (err) {
      if (err instanceof ApiClientError && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND')) {
        removeNotif(n.id);
      } else {
        console.error('Failed to decline invite:', err);
        toast({ variant: 'destructive', title: 'Error', description: err instanceof ApiClientError ? err.message : 'Failed to decline invite' });
      }
    } finally {
      setProcessingInvites((p) => { const u = { ...p }; delete u[n.id]; return u; });
    }
  };

  const handleOpen = (n: Notification) => {
    const target = notifTarget(n);
    if (!n.read) markOneRead(n.id);
    if (target) router.push(target);
    else toast({ description: "this notification can't be opened." });
  };

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src={POSTER} alt="" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  const body = (n: Notification) => {
    const who = n.fromDisplayName || n.fromUsername || 'Someone';
    return (
      <>
        <span className="font-semibold">{who}</span>{' '}
        {n.type === 'mention' && <>mentioned you in a comment on <span className="font-semibold">{n.movieTitle}</span></>}
        {n.type === 'reply' && <>replied to your comment on <span className="font-semibold">{n.movieTitle}</span></>}
        {n.type === 'like' && <>liked your comment on <span className="font-semibold">{n.movieTitle}</span></>}
        {n.type === 'follow' && <>started following you</>}
        {n.type === 'list_invite' && <>invited you to join <span className="font-semibold">{n.listName}</span></>}
        {n.type === 'list_like' && <>liked your list <span className="font-semibold">{n.listName}</span></>}
        {n.type === 'post_tag' && <>tagged you in a post</>}
        {n.type === 'post_like' && <>liked your post</>}
        {n.type === 'post_comment' && <>commented on your post</>}
      </>
    );
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <main className="min-h-screen text-foreground pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {/* Header — frosted, safe-area, lowercase Bricolage */}
        <header
          className="sticky top-0 z-20 border-b border-hair bg-background/90 backdrop-blur-md"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="container mx-auto flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => router.back()}
                aria-label="Back"
                className="flex h-10 w-10 -ml-2 items-center justify-center rounded-full text-foreground transition-transform hover:bg-secondary active:scale-90"
              >
                <ArrowLeft className="h-[22px] w-[22px]" />
              </button>
              <h1 className="font-headline text-[22px] font-bold lowercase tracking-[-0.02em]">notifications</h1>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="flex min-h-[44px] items-center gap-1.5 px-2 font-ui text-[14px] font-semibold text-primary transition-transform active:scale-95"
              >
                <Check className="h-[18px] w-[18px]" strokeWidth={2.2} />
                mark all read
              </button>
            )}
          </div>
        </header>

        <div className="container mx-auto px-4 pt-3">
          <PushNotificationPrompt variant="banner" />

          {isLoading ? (
            <RowSkeleton />
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Bell className="mb-4 h-12 w-12 text-destructive" strokeWidth={1.5} />
              <p className="font-headline text-[20px] font-bold lowercase tracking-tight text-destructive">couldn&apos;t load notifications</p>
              <p className="mt-1.5 max-w-xs font-mono text-[12px] text-muted-foreground">{error}</p>
              <button
                onClick={loadNotifications}
                className="mt-5 h-11 rounded-full bg-foreground px-5 font-headline text-[15px] font-bold lowercase text-background transition-transform active:scale-95"
              >
                try again
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Bell className="mb-4 h-12 w-12 text-muted-foreground" strokeWidth={1.5} />
              <p className="font-headline text-[20px] font-bold lowercase tracking-tight">all caught up</p>
              <p className="mt-1.5 max-w-xs font-body text-[14px] italic text-muted-foreground">
                follows, likes, replies, and list invites will show up here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-hair">
              {notifications.map((n) => {
                const processing = processingInvites[n.id];
                return (
                  <div
                    key={n.id}
                    className={`relative rounded-[14px] transition-colors ${n.read ? '' : 'bg-primary/[0.06]'}`}
                  >
                    {/* The navigable surface — does NOT wrap the invite buttons */}
                    <button
                      onClick={() => handleOpen(n)}
                      className="flex w-full items-start gap-3 rounded-[14px] px-2.5 py-3.5 text-left outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-primary/60 active:bg-foreground/[0.05]"
                    >
                      <ProfileAvatar
                        photoURL={n.fromPhotoUrl}
                        displayName={n.fromDisplayName}
                        username={n.fromUsername}
                        size="md"
                        className="flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-ui text-[15px] leading-snug text-foreground">
                          {!n.read && <span className="sr-only">Unread. </span>}
                          {body(n)}
                        </p>
                        {n.previewText && (
                          <p className="mt-0.5 line-clamp-2 font-body text-[14px] italic text-muted-foreground">
                            &ldquo;{n.previewText}&rdquo;
                          </p>
                        )}
                        <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      <span className="mt-0.5 flex flex-shrink-0 items-center gap-2">
                        {typeGlyph(n.type)}
                        {!n.read && <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />}
                      </span>
                    </button>

                    {/* Invite actions — siblings of the nav surface (no nesting) */}
                    {n.type === 'list_invite' && n.inviteId && (
                      <div className="flex gap-2 pb-3.5 pl-[60px] pr-2.5">
                        <button
                          onClick={() => handleDeclineInvite(n)}
                          disabled={!!processing}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-full border border-hair bg-background px-4 font-ui text-[13px] font-semibold transition-colors hover:bg-secondary disabled:opacity-50"
                        >
                          {processing === 'declining' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'decline'}
                        </button>
                        <button
                          onClick={() => handleAcceptInvite(n)}
                          disabled={!!processing}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-full bg-primary px-4 font-ui text-[13px] font-semibold text-primary-foreground transition-transform active:scale-95 disabled:opacity-50"
                        >
                          {processing === 'accepting' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'accept'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* infinite-scroll sentinel + loading-more spinner */}
              {hasMore && <div ref={sentinelRef} className="h-px" />}
              {isLoadingMore && (
                <div className="flex justify-center py-5">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </PullToRefresh>
  );
}
