'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Bell, MessageSquare, AtSign, Check, UserPlus, Heart, Users } from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import { getNotifications, markNotificationsRead, acceptInvite, declineInvite } from '@/app/actions';
import { formatDistanceToNow } from 'date-fns';
import { Loader2 } from 'lucide-react';
import type { Notification } from '@/lib/types';
import { PushNotificationPrompt } from '@/components/push-notification-prompt';
import { useToast } from '@/hooks/use-toast';

export default function NotificationsPage() {
  const router = useRouter();
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track which invites are being processed (accepting or declining)
  const [processingInvites, setProcessingInvites] = useState<Record<string, 'accepting' | 'declining'>>({});

  // Fetch notifications
  useEffect(() => {
    async function fetchNotifications() {
      if (!user?.uid) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await getNotifications(user.uid);
        if (result.error) {
          console.error('Notifications error:', result.error);
          setError(result.error);
        } else if (result.notifications) {
          setNotifications(result.notifications as Notification[]);
        }
      } catch (err) {
        console.error('Failed to fetch notifications:', err);
        setError('Failed to load notifications. Please try again.');
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

  // Handle accepting a list invite from notification
  const handleAcceptInvite = async (notification: Notification, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation
    if (!user?.uid || !notification.inviteId) return;

    setProcessingInvites(prev => ({ ...prev, [notification.id]: 'accepting' }));
    try {
      const result = await acceptInvite(user.uid, notification.inviteId);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({
          title: 'Invite Accepted!',
          description: `You are now a collaborator on "${notification.listName}"`,
        });
        // Remove this notification from the list
        setNotifications(prev => prev.filter(n => n.id !== notification.id));
        // Navigate to the list
        const ownerId = result.listOwnerId || notification.listOwnerId;
        router.push(`/lists/${notification.listId}?owner=${ownerId}`);
      }
    } catch (err) {
      console.error('Failed to accept invite:', err);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to accept invite' });
    } finally {
      setProcessingInvites(prev => {
        const updated = { ...prev };
        delete updated[notification.id];
        return updated;
      });
    }
  };

  // Handle declining a list invite from notification
  const handleDeclineInvite = async (notification: Notification, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation
    if (!user?.uid || !notification.inviteId) return;

    setProcessingInvites(prev => ({ ...prev, [notification.id]: 'declining' }));
    try {
      const result = await declineInvite(user.uid, notification.inviteId);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({
          title: 'Invite Declined',
          description: 'The invitation has been declined.',
        });
        // Remove this notification from the list
        setNotifications(prev => prev.filter(n => n.id !== notification.id));
      }
    } catch (err) {
      console.error('Failed to decline invite:', err);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to decline invite' });
    } finally {
      setProcessingInvites(prev => {
        const updated = { ...prev };
        delete updated[notification.id];
        return updated;
      });
    }
  };

  // Handle notification click - navigate to appropriate page
  const handleNotificationClick = (notification: Notification) => {
    // Mark as read
    if (!notification.read && user?.uid) {
      markNotificationsRead(user.uid, [notification.id]).catch(console.error);
      setNotifications(prev =>
        prev.map(n => (n.id === notification.id ? { ...n, read: true } : n))
      );
    }

    // Navigate based on notification type
    switch (notification.type) {
      case 'follow':
        // Go to the follower's profile
        if (notification.fromUsername) {
          router.push(`/profile/${notification.fromUsername}`);
        }
        break;
      case 'list_invite':
        // Go to pending invites (lists page will show pending invites)
        router.push('/lists');
        break;
      case 'mention':
      case 'reply':
      case 'like':
        // Go to movie comments
        if (notification.tmdbId && notification.movieTitle && notification.mediaType) {
          const params = new URLSearchParams({
            title: notification.movieTitle,
            type: notification.mediaType,
          });
          router.push(`/movie/${notification.tmdbId}/comments?${params.toString()}`);
        }
        break;
    }
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
        {/* Push notification prompt - shows only if not enabled */}
        <PushNotificationPrompt variant="banner" />

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-8 w-8 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Bell className="h-12 w-12 text-destructive mb-4" />
            <p className="text-destructive font-medium">Failed to load notifications</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              {error}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
            >
              Try again
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Bell className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No notifications yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              When someone follows you, likes your comments, or invites you to a list, you&apos;ll see it here.
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
                    {notification.type === 'mention' && (
                      <>mentioned you in a comment on <span className="font-medium">{notification.movieTitle}</span></>
                    )}
                    {notification.type === 'reply' && (
                      <>replied to your comment on <span className="font-medium">{notification.movieTitle}</span></>
                    )}
                    {notification.type === 'like' && (
                      <>liked your comment on <span className="font-medium">{notification.movieTitle}</span></>
                    )}
                    {notification.type === 'follow' && (
                      <>started following you</>
                    )}
                    {notification.type === 'list_invite' && (
                      <>invited you to join <span className="font-medium">{notification.listName}</span></>
                    )}
                  </p>
                  {notification.previewText && (
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                      &ldquo;{notification.previewText}&rdquo;
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                  </p>

                  {/* Accept/Decline buttons for list invites */}
                  {notification.type === 'list_invite' && notification.inviteId && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={(e) => handleDeclineInvite(notification, e)}
                        disabled={!!processingInvites[notification.id]}
                        className="px-3 py-1.5 text-xs font-medium rounded-full border-2 border-border bg-background hover:bg-secondary transition-colors disabled:opacity-50"
                      >
                        {processingInvites[notification.id] === 'declining' ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          'Decline'
                        )}
                      </button>
                      <button
                        onClick={(e) => handleAcceptInvite(notification, e)}
                        disabled={!!processingInvites[notification.id]}
                        className="px-3 py-1.5 text-xs font-medium rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {processingInvites[notification.id] === 'accepting' ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          'Accept'
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Type indicator */}
                <div className="flex-shrink-0 mt-1">
                  {notification.type === 'mention' && <AtSign className="h-4 w-4 text-primary" />}
                  {notification.type === 'reply' && <MessageSquare className="h-4 w-4 text-primary" />}
                  {notification.type === 'like' && <Heart className="h-4 w-4 text-red-500" />}
                  {notification.type === 'follow' && <UserPlus className="h-4 w-4 text-green-500" />}
                  {notification.type === 'list_invite' && <Users className="h-4 w-4 text-blue-500" />}
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
