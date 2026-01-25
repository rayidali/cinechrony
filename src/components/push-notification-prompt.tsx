'use client';

import { useState, useEffect } from 'react';
import { Bell, BellOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import { savePushSubscription, removePushSubscription, getPushStatus } from '@/app/actions';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

// Convert VAPID key to Uint8Array format
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

type PushNotificationPromptProps = {
  variant?: 'banner' | 'compact';
  onDismiss?: () => void;
};

export function PushNotificationPrompt({ variant = 'banner', onDismiss }: PushNotificationPromptProps) {
  const { user } = useUser();
  const [isSupported, setIsSupported] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [dismissed, setDismissed] = useState(false);

  // Check if push notifications are supported
  useEffect(() => {
    const checkSupport = async () => {
      const supported = 'serviceWorker' in navigator &&
                       'PushManager' in window &&
                       'Notification' in window &&
                       !!VAPID_PUBLIC_KEY;
      setIsSupported(supported);

      if (supported) {
        setPermission(Notification.permission);
      }
    };
    checkSupport();
  }, []);

  // Check if user already has push enabled
  useEffect(() => {
    const checkStatus = async () => {
      if (!user?.uid) return;
      const result = await getPushStatus(user.uid);
      setIsEnabled(result.enabled);
    };
    checkStatus();
  }, [user?.uid]);

  // Register service worker and subscribe to push
  const enablePushNotifications = async () => {
    if (!user?.uid || !VAPID_PUBLIC_KEY) return;

    setIsLoading(true);
    try {
      // Request permission
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);

      if (permissionResult !== 'granted') {
        setIsLoading(false);
        return;
      }

      // Register service worker
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // Get the subscription as JSON
      const subscriptionJson = subscription.toJSON();

      if (!subscriptionJson.endpoint || !subscriptionJson.keys) {
        throw new Error('Invalid subscription');
      }

      // Save to Firestore
      const result = await savePushSubscription(user.uid, {
        endpoint: subscriptionJson.endpoint,
        keys: {
          p256dh: subscriptionJson.keys.p256dh!,
          auth: subscriptionJson.keys.auth!,
        },
      });

      if (result.success) {
        setIsEnabled(true);
      }
    } catch (error) {
      console.error('Failed to enable push notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Unsubscribe from push
  const disablePushNotifications = async () => {
    if (!user?.uid) return;

    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
          await removePushSubscription(user.uid, subscription.endpoint);
        }
      }
      setIsEnabled(false);
    } catch (error) {
      console.error('Failed to disable push notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  // Don't show if not supported, already enabled, permission denied, or dismissed
  if (!isSupported || isEnabled || permission === 'denied' || dismissed) {
    return null;
  }

  if (variant === 'compact') {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={enablePushNotifications}
        disabled={isLoading}
        className="gap-2"
      >
        <Bell className="h-4 w-4" />
        {isLoading ? 'Enabling...' : 'Enable Notifications'}
      </Button>
    );
  }

  return (
    <div className="relative bg-primary/10 border border-primary/20 rounded-xl p-4 mb-4">
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 p-1 rounded-full hover:bg-primary/10"
      >
        <X className="h-4 w-4 text-muted-foreground" />
      </button>

      <div className="flex items-start gap-3">
        <div className="p-2 bg-primary/20 rounded-full">
          <Bell className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-sm">Enable Weekly Updates</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Get a weekly summary of your friends&apos; activity and new followers.
          </p>
          <Button
            size="sm"
            onClick={enablePushNotifications}
            disabled={isLoading}
            className="mt-3"
          >
            {isLoading ? 'Enabling...' : 'Enable Notifications'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Settings toggle version for use in settings page
export function PushNotificationToggle() {
  const { user } = useUser();
  const [isSupported, setIsSupported] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    const checkSupport = async () => {
      const supported = 'serviceWorker' in navigator &&
                       'PushManager' in window &&
                       'Notification' in window &&
                       !!VAPID_PUBLIC_KEY;
      setIsSupported(supported);

      if (supported) {
        setPermission(Notification.permission);
      }
    };
    checkSupport();
  }, []);

  useEffect(() => {
    const checkStatus = async () => {
      if (!user?.uid) return;
      const result = await getPushStatus(user.uid);
      setIsEnabled(result.enabled);
    };
    checkStatus();
  }, [user?.uid]);

  const toggleNotifications = async () => {
    if (!user?.uid || !VAPID_PUBLIC_KEY) return;

    setIsLoading(true);
    try {
      if (isEnabled) {
        // Disable
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            await subscription.unsubscribe();
            await removePushSubscription(user.uid, subscription.endpoint);
          }
        }
        setIsEnabled(false);
      } else {
        // Enable
        const permissionResult = await Notification.requestPermission();
        setPermission(permissionResult);

        if (permissionResult !== 'granted') {
          setIsLoading(false);
          return;
        }

        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });

        const subscriptionJson = subscription.toJSON();

        if (subscriptionJson.endpoint && subscriptionJson.keys) {
          await savePushSubscription(user.uid, {
            endpoint: subscriptionJson.endpoint,
            keys: {
              p256dh: subscriptionJson.keys.p256dh!,
              auth: subscriptionJson.keys.auth!,
            },
          });
          setIsEnabled(true);
        }
      }
    } catch (error) {
      console.error('Failed to toggle push notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isSupported) {
    return (
      <div className="flex items-center justify-between py-3">
        <div>
          <p className="font-medium">Push Notifications</p>
          <p className="text-sm text-muted-foreground">Not supported on this device</p>
        </div>
        <BellOff className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div className="flex items-center justify-between py-3">
        <div>
          <p className="font-medium">Push Notifications</p>
          <p className="text-sm text-muted-foreground">Blocked - enable in browser settings</p>
        </div>
        <BellOff className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="font-medium">Weekly Digest</p>
        <p className="text-sm text-muted-foreground">
          {isEnabled ? 'Get weekly activity summaries' : 'Enable weekly activity summaries'}
        </p>
      </div>
      <button
        onClick={toggleNotifications}
        disabled={isLoading}
        className={`relative w-12 h-7 rounded-full transition-colors ${
          isEnabled ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <div
          className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            isEnabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}
