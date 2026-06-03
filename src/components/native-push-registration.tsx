'use client';

import { useEffect } from 'react';
import { useUser } from '@/firebase';
import { registerNativePushIfApplicable } from '@/lib/native-push';

const registered = new Set<string>();

/**
 * Renders nothing. On native runtimes (Capacitor iOS/Android), registers
 * the device for push notifications once per authenticated user per
 * session. No-op on the web — web push is opt-in via
 * `<PushNotificationPrompt />`.
 */
export function NativePushRegistration() {
  const { user, isUserLoading } = useUser();

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) return;
    if (registered.has(user.uid)) return;
    registered.add(user.uid);
    void registerNativePushIfApplicable();
  }, [user, isUserLoading]);

  return null;
}
