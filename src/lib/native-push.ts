'use client';

/**
 * Native push registration (iOS / Android via Capacitor).
 *
 * Flow:
 *   1. Detect Capacitor runtime — bail on web (web push uses the existing
 *      Service Worker + web-push path in `push-notification-prompt.tsx`).
 *   2. Ask the user for permission via Capacitor Firebase Messaging.
 *      iOS shows the native "Allow notifications?" dialog the first time.
 *   3. Get the device's FCM token. APNs → FCM translation is handled by
 *      Firebase under the hood, so we always get an FCM token even on iOS.
 *   4. POST it to `/api/v1/me/push-subscription` as `{ kind: 'fcm', token,
 *      platform }`. Idempotent on the server — repeated boots are cheap.
 *
 * Token rotation:
 *   Apple may rotate APNs tokens (and FCM tokens follow). The plugin
 *   emits a `tokenReceived` event when this happens; we register a
 *   listener so the new token replaces the old one on the backend.
 *
 * Never throws. Logs internally — every error is observability, not UX.
 */

import { apiCall } from '@/lib/api-client';

let registrationInFlight = false;

export async function registerNativePushIfApplicable(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (registrationInFlight) return;

  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  if (cap?.isNativePlatform?.() !== true) return;

  registrationInFlight = true;
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');

    // Ask. On iOS this triggers the OS-level "Allow notifications?"
    // sheet on first call; subsequent calls return the cached status
    // without re-prompting.
    const perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive !== 'granted') {
      console.info('[native-push] permission not granted:', perm.receive);
      return;
    }

    const { token } = await FirebaseMessaging.getToken();
    if (!token) {
      console.warn('[native-push] FCM getToken returned empty.');
      return;
    }

    const platform = (cap.getPlatform?.() ?? 'ios') === 'android' ? 'android' : 'ios';

    await apiCall('POST', '/api/v1/me/push-subscription', {
      kind: 'fcm',
      token,
      platform,
    });

    // If Apple/Firebase rotates the token at any point, re-save it.
    await FirebaseMessaging.removeAllListeners();
    await FirebaseMessaging.addListener('tokenReceived', async (event) => {
      try {
        if (!event?.token) return;
        await apiCall('POST', '/api/v1/me/push-subscription', {
          kind: 'fcm',
          token: event.token,
          platform,
        });
      } catch (err) {
        console.error('[native-push] token rotation save failed:', err);
      }
    });
  } catch (err) {
    console.error('[native-push] registration failed:', err);
  } finally {
    registrationInFlight = false;
  }
}
