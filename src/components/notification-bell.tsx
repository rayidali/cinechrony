'use client';

import { useState, useEffect, useCallback } from 'react';
import { Link } from '@/lib/native-nav';
import { Bell } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { readCachedAction, setCachedAction, isCachedActionFresh } from '@/lib/use-cached-action';

// The badge tolerates lag — push notifications deliver the real-time signal and
// the route's count() is server-cached. A 2-min poll + a remount-dedup gate
// cuts the idle badge from ~120 reads/hour to ~30. [free-tier]
const POLL_MS = 120_000;
const COUNT_FRESH_MS = 30_000;

export function NotificationBell() {
  const { user } = useUser();
  const countKey = user?.uid ? `notif-count:${user.uid}` : null;
  const [unreadCount, setUnreadCount] = useState<number>(
    () => (countKey ? readCachedAction<number>(countKey) ?? 0 : 0),
  );

  const fetchCount = useCallback(async (force = false) => {
    if (!user?.uid) return;
    const key = `notif-count:${user.uid}`;
    // Skip the read if a recent poll (this or another mount) already has it.
    if (!force && isCachedActionFresh(key, COUNT_FRESH_MS)) {
      const c = readCachedAction<number>(key);
      if (c !== undefined) setUnreadCount(c);
      return;
    }
    try {
      const { count } = await apiCall<{ count: number }>(
        'GET', '/api/v1/notifications/unread-count',
      );
      setUnreadCount(count || 0);
      setCachedAction(key, count || 0);
    } catch (err) {
      console.error('Failed to fetch notification count:', err);
    }
  }, [user?.uid]);

  useEffect(() => {
    fetchCount();
    // Poll only while the tab/app is visible — a backgrounded PWA or an app in
    // the background should not keep firing serverless reads (at 1000s of
    // concurrent clients an always-on poll is a constant baseline of function
    // invocations doing nothing user-visible). Refetch immediately on return to
    // foreground so the badge is fresh when the user looks.
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchCount();
      }
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchCount();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchCount]);

  if (!user) return null;

  return (
    <Link
      href="/notifications"
      className="relative p-2 rounded-full hover:bg-secondary transition-colors"
    >
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold bg-primary text-primary-foreground rounded-full">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
