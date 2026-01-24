'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useUser } from '@/firebase';
import { getUnreadNotificationCount } from '@/app/actions';

export function NotificationBell() {
  const { user } = useUser();
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch unread count on mount and periodically
  const fetchCount = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const result = await getUnreadNotificationCount(user.uid);
      setUnreadCount(result.count || 0);
    } catch (err) {
      console.error('Failed to fetch notification count:', err);
    }
  }, [user?.uid]);

  useEffect(() => {
    fetchCount();
    // Poll every 30 seconds for new notifications
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  if (!user) return null;

  return (
    <Link
      href="/notifications"
      className="relative p-2 rounded-full hover:bg-secondary transition-colors"
    >
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold bg-red-500 text-white rounded-full">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
