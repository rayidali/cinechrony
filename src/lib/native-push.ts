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
 * Tap routing:
 *   Tapping a delivered notification fires `notificationActionPerformed`.
 *   There's no native handler for this anywhere else in the app (the web
 *   Service Worker has its own `notificationclick` in `public/sw.js`, but
 *   that doesn't run inside the WKWebView) — so we route it here, reading
 *   `notification.data.url` (the same relative-path convention `sw.js`
 *   reads) and pushing it via the caller-supplied router. `/api/v1/*` push
 *   payloads (`src/lib/push-server.ts`) already carry this in `data`.
 *
 * Never throws. Logs internally — every error is observability, not UX.
 */

import { apiCall } from '@/lib/api-client';

let registrationInFlight = false;

/** The bits of `useRouter()` (from `@/lib/native-nav`) this module needs —
 *  kept minimal so this file doesn't have to import React/Next router types. */
type MinimalRouter = { push: (href: string) => void };

export async function registerNativePushIfApplicable(router?: MinimalRouter): Promise<void> {
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

    // If Apple/Firebase rotates the token at any point, re-save it. Both
    // listeners below are (re)registered together right after
    // removeAllListeners() so a token rotation and a notification tap both
    // keep working after this runs.
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

    // Notification tap → route to the url carried in the push's `data`
    // (e.g. an extraction completion push's `/extract?jobId=…`). Static
    // routes like `/extract` need no rewriting; `router.push` already
    // handles dynamic-route shells via native-nav when relevant.
    await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
      try {
        const data = (event?.notification?.data ?? {}) as Record<string, unknown>;
        const url = typeof data.url === 'string' ? data.url : null;
        if (url && url.startsWith('/')) router?.push(url);
      } catch (err) {
        console.error('[native-push] notification tap routing failed:', err);
      }
    });
  } catch (err) {
    console.error('[native-push] registration failed:', err);
  } finally {
    registrationInFlight = false;
  }
}
