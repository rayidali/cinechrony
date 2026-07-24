'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from '@/lib/native-nav';
import {
  ArrowLeft, Bell, MessageSquare, AtSign, Check, UserPlus, Heart, Users, Loader2,
  CalendarPlus, CalendarX, Clock, Popcorn, Sunrise, CircleHelp, X,
} from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useUser } from '@/firebase';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { invalidateCachedAction, setCachedAction, readCachedAction } from '@/lib/use-cached-action';
import { haptic } from '@/lib/haptics';
import { formatDistanceToNow } from 'date-fns';
import type { Notification, NotificationType } from '@/lib/types';
import type { RsvpAnswer } from '@/lib/movie-night-types';
import { useMovieNight } from '@/components/movie-night/movie-night-provider';
import { PushNotificationPrompt } from '@/components/push-notification-prompt';
import { PullToRefresh } from '@/components/pull-to-refresh';
import { useToast } from '@/hooks/use-toast';

const MOVIE_NIGHT_TYPES = new Set<NotificationType>([
  'movie_night_invite', 'movie_night_rsvp', 'movie_night_reminder',
  'movie_night_time_changed', 'movie_night_cancelled', 'movie_night_morning_after',
]);
function isMovieNightType(type: NotificationType): boolean {
  return MOVIE_NIGHT_TYPES.has(type);
}

/** `movie_night_rsvp`'s previewText already encodes the answer in one of
 *  three fixed verb phrases (`notifications-server.ts`'s `verb` — "is in
 *  for" / "might make it to" / "can't make it to") — parsed here rather than
 *  stored as a separate field on the notification doc. */
function nightRsvpAnswerFromPreview(previewText: string | undefined): RsvpAnswer {
  if (!previewText) return 'in';
  if (previewText.includes("can't make it")) return 'out';
  if (previewText.includes('might make it')) return 'maybe';
  return 'in';
}

type NotifPage = { notifications: Notification[]; hasMore: boolean; nextCursor?: string };

const POSTER = '/brand/cinechrony-icon.png';

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
    case 'invite_accepted':
      return <Users className="h-[18px] w-[18px] text-success" strokeWidth={2} aria-hidden />;
    case 'movie_night_invite':
      return <CalendarPlus className="h-[18px] w-[18px] text-primary" strokeWidth={2} aria-hidden />;
    case 'movie_night_time_changed':
      return <Clock className="h-[18px] w-[18px] text-warning" strokeWidth={2} aria-hidden />;
    case 'movie_night_cancelled':
      return <CalendarX className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={2} aria-hidden />;
    case 'movie_night_morning_after':
      return <Sunrise className="h-[18px] w-[18px] text-primary" strokeWidth={2} aria-hidden />;
    default:
      return null;
  }
}

/** `movie_night_rsvp` — sage check / amber circle-help / marker x, derived
 *  from the answer parsed out of `previewText` (see above). */
function nightRsvpGlyph(previewText: string | undefined) {
  const answer = nightRsvpAnswerFromPreview(previewText);
  if (answer === 'out') return <X className="h-[18px] w-[18px] text-destructive" strokeWidth={2.4} aria-hidden />;
  if (answer === 'maybe') return <CircleHelp className="h-[18px] w-[18px] text-warning" strokeWidth={2} aria-hidden />;
  return <Check className="h-[18px] w-[18px] text-success" strokeWidth={2.4} aria-hidden />;
}

/** The notification's destination, or null if it can't be opened. */
function notifTarget(n: Notification): string | null {
  switch (n.type) {
    case 'follow':
      return n.fromUsername ? `/profile/${n.fromUsername}` : null;
    case 'list_invite':
      return '/lists';
    case 'invite_accepted':
      return n.listId
        ? `/lists/${n.listId}${n.listOwnerId ? `?owner=${n.listOwnerId}` : ''}`
        : null;
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
  const { openNight, refreshUpcoming } = useMovieNight();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processingInvites, setProcessingInvites] = useState<Record<string, 'accepting' | 'declining'>>({});
  // MN16 — inline "i'm in" / "can't" quick actions on a movie_night_invite
  // row. Busy = mid-request; done = settled (the row swaps its buttons for a
  // mono confirmation, mirroring the invite accept/decline pattern above but
  // without removing the row — the notification itself still stands).
  const [nightRsvpBusy, setNightRsvpBusy] = useState<Record<string, boolean>>({});
  const [nightRsvpDone, setNightRsvpDone] = useState<Record<string, RsvpAnswer>>({});

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

  const handleNightRsvp = async (n: Notification, answer: RsvpAnswer) => {
    if (!n.nightId || nightRsvpBusy[n.id]) return;
    haptic('light');
    setNightRsvpBusy((p) => ({ ...p, [n.id]: true }));
    try {
      await apiCall('POST', `/api/v1/movie-nights/${n.nightId}/rsvp`, { answer });
      haptic('success');
      setNightRsvpDone((p) => ({ ...p, [n.id]: answer }));
      refreshUpcoming();
      if (!n.read) markOneRead(n.id);
    } catch (err) {
      haptic('error');
      toast({
        variant: 'destructive',
        title: 'error',
        description: err instanceof ApiClientError ? err.message : 'could not save your answer.',
      });
    } finally {
      setNightRsvpBusy((p) => { const u = { ...p }; delete u[n.id]; return u; });
    }
  };

  const handleOpen = (n: Notification) => {
    if (!n.read) markOneRead(n.id);
    if (isMovieNightType(n.type) && n.nightId) {
      openNight(n.nightId);
      return;
    }
    const target = notifTarget(n);
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
    // movie_night_* previewText is already a complete, self-contained
    // sentence (built server-side from `fromName(ctx)` — "@sam planned a
    // movie night: …") — render it plainly instead of the bold-name-prefix
    // pattern the other types use below (which would just repeat the name).
    // The reminder is the one system-authored exception (no `who`): bold its
    // leading "tonight:" / "fri 24.07:" clause, matching MN16's `<b>` treatment.
    if (n.type === 'movie_night_reminder' && n.previewText) {
      const colonAt = n.previewText.indexOf(':');
      if (colonAt > 0) {
        return <><span className="font-semibold">{n.previewText.slice(0, colonAt + 1)}</span>{n.previewText.slice(colonAt + 1)}</>;
      }
    }
    if (isMovieNightType(n.type)) return <>{n.previewText}</>;

    const who = n.fromDisplayName || n.fromUsername || 'Someone';
    return (
      <>
        <span className="font-semibold">{who}</span>{' '}
        {n.type === 'mention' && <>mentioned you in a comment on <span className="font-semibold">{n.movieTitle}</span></>}
        {n.type === 'reply' && <>replied to your comment on <span className="font-semibold">{n.movieTitle}</span></>}
        {n.type === 'like' && <>liked your comment on <span className="font-semibold">{n.movieTitle}</span></>}
        {n.type === 'follow' && <>started following you</>}
        {n.type === 'list_invite' && <>invited you to join <span className="font-semibold">{n.listName}</span></>}
        {n.type === 'invite_accepted' && <>joined <span className="font-semibold">{n.listName}</span></>}
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
                const isReminder = n.type === 'movie_night_reminder';
                const isNight = isMovieNightType(n.type);
                const nightBusy = nightRsvpBusy[n.id];
                const nightDone = nightRsvpDone[n.id];
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
                      {/* movie_night_reminder is system-authored (the S2 ticker,
                          not a person) — a film-red popcorn tile stands in for
                          the usual from-user avatar. */}
                      {isReminder ? (
                        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] bg-primary">
                          <Popcorn className="h-5 w-5 text-primary-foreground" strokeWidth={2} />
                        </span>
                      ) : (
                        <ProfileAvatar
                          photoURL={n.fromPhotoUrl}
                          displayName={n.fromDisplayName}
                          username={n.fromUsername}
                          size="md"
                          className="flex-shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-ui text-[15px] leading-snug text-foreground">
                          {!n.read && <span className="sr-only">Unread. </span>}
                          {body(n)}
                        </p>
                        {n.previewText && !isNight && (
                          <p className="mt-0.5 line-clamp-2 font-body text-[14px] italic text-muted-foreground">
                            &ldquo;{n.previewText}&rdquo;
                          </p>
                        )}
                        <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      <span className="mt-0.5 flex flex-shrink-0 items-center gap-2">
                        {n.type === 'movie_night_rsvp' ? nightRsvpGlyph(n.previewText) : typeGlyph(n.type)}
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

                    {/* MN16 — inline movie-night rsvp quick actions, settling
                        to a mono confirmation once answered. */}
                    {n.type === 'movie_night_invite' && n.nightId && (
                      nightDone ? (
                        <div className="pb-3.5 pl-[60px] pr-2.5">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {nightDone === 'in' ? "you're in" : "you're out"}
                          </span>
                        </div>
                      ) : (
                        <div className="flex gap-2 pb-3.5 pl-[60px] pr-2.5">
                          <button
                            onClick={() => handleNightRsvp(n, 'out')}
                            disabled={!!nightBusy}
                            className="inline-flex min-h-[40px] items-center justify-center rounded-full border border-hair bg-background px-4 font-ui text-[13px] font-semibold transition-colors hover:bg-secondary disabled:opacity-50"
                          >
                            can&apos;t
                          </button>
                          <button
                            onClick={() => handleNightRsvp(n, 'in')}
                            disabled={!!nightBusy}
                            className="inline-flex min-h-[40px] items-center justify-center rounded-full bg-primary px-4 font-ui text-[13px] font-semibold text-primary-foreground transition-transform active:scale-95 disabled:opacity-50"
                          >
                            {nightBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "i'm in"}
                          </button>
                        </div>
                      )
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
