'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Bell, MessageSquare, AtSign, Check } from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import { getNotifications, markNotificationsRead } from '@/app/actions';
import { formatDistanceToNow } from 'date-fns';
import type { Notification } from '@/lib/types';

export default function NotificationsPage() {
  const router = useRouter();
  const { user, isUserLoading } = useUser();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch notifications
  useEffect(() => {
    async function fetchNotifications() {
      if (!user?.uid) return;
      setIsLoading(true);
      try {
        const result = await getNotifications(user.uid);
        if (result.notifications) {
          setNotifications(result.notifications as Notification[]);
        }
      } catch (err) {
        console.error('Failed to fetch notifications:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchNotifications();
  }, [user?.uid]);

  // Redirect if not logged in
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  // Mark all as read
  const handleMarkAllRead = async () => {
    if (!user?.uid) return;
    try {
      await markNotificationsRead(user.uid);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }
  };

  // Navigate to the movie comments page
  const handleNotificationClick = (notification: Notification) => {
    // Mark as read
    if (!notification.read && user?.uid) {
      markNotificationsRead(user.uid, [notification.id]).catch(console.error);
      setNotifications(prev =>
        prev.map(n => (n.id === notification.id ? { ...n, read: true } : n))
      );
    }

    // Navigate to the movie comments
    const params = new URLSearchParams({
      title: notification.movieTitle,
      type: notification.mediaType,
    });
    router.push(`/movie/${notification.tmdbId}/comments?${params.toString()}`);
  };

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <main className="min-h-screen font-body text-foreground pb-8">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 -ml-2 rounded-full hover:bg-secondary transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-headline font-bold">Notifications</h1>
          </div>

          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAllRead}
              className="text-primary"
            >
              <Check className="h-4 w-4 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="container mx-auto px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-8 w-8 animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Bell className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No notifications yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              When someone mentions you or replies to your comments, you&apos;ll see it here.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {notifications.map(notification => (
              <button
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={`w-full text-left flex items-start gap-3 p-3 rounded-xl transition-colors ${
                  notification.read
                    ? 'hover:bg-secondary/50'
                    : 'bg-primary/5 hover:bg-primary/10'
                }`}
              >
                {/* Avatar */}
                <ProfileAvatar
                  photoURL={notification.fromPhotoUrl}
                  displayName={notification.fromDisplayName}
                  username={notification.fromUsername}
                  size="md"
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold">
                      {notification.fromDisplayName || notification.fromUsername || 'Someone'}
                    </span>
                    {' '}
                    {notification.type === 'mention' ? (
                      <>mentioned you in a comment on <span className="font-medium">{notification.movieTitle}</span></>
                    ) : (
                      <>replied to your comment on <span className="font-medium">{notification.movieTitle}</span></>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                    &ldquo;{notification.previewText}&rdquo;
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                  </p>
                </div>

                {/* Type indicator */}
                <div className="flex-shrink-0 mt-1">
                  {notification.type === 'mention' ? (
                    <AtSign className="h-4 w-4 text-primary" />
                  ) : (
                    <MessageSquare className="h-4 w-4 text-primary" />
                  )}
                </div>

                {/* Unread dot */}
                {!notification.read && (
                  <div className="flex-shrink-0 mt-2">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
