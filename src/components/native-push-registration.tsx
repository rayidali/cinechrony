'use client';

import { useEffect } from 'react';
import { useUser } from '@/firebase';
import { useRouter } from '@/lib/native-nav';
import { registerNativePushIfApplicable } from '@/lib/native-push';
import { initLiveActivityBridge } from '@/lib/live-activity-native';

const registered = new Set<string>();

/**
 * Renders nothing. On native runtimes (Capacitor iOS/Android), registers
 * the device for push notifications once per authenticated user per
 * session, and wires notification-tap routing (the `url` carried in the
 * push's `data`, e.g. an extraction completion push's `/extract?jobId=…`).
 * No-op on the web — web push is opt-in via `<PushNotificationPrompt />` and
 * routes taps via the Service Worker's own `notificationclick` (public/sw.js).
 */
export function NativePushRegistration() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) return;
    if (registered.has(user.uid)) return;
    registered.add(user.uid);
    void registerNativePushIfApplicable(router);
    // Same gate (authenticated, once per session): wire the Live Activity
    // token bridge so the pipeline can drive the lock-screen scan tracker.
    void initLiveActivityBridge();
  }, [user, isUserLoading, router]);

  return null;
}
