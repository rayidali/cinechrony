/**
 * Push delivery — unified entry point for web push (browser Service Worker)
 * AND Firebase Cloud Messaging (iOS/Android via Capacitor).
 *
 * Why this file exists:
 *   - Each user can have devices of multiple kinds at the same time
 *     (desktop browser + iPhone + iPad). Each one stores its own
 *     subscription doc under /users/{uid}/pushSubscriptions/{id}.
 *   - The doc shape varies: web push subs have `{ endpoint, keys }`; FCM
 *     subs have `{ token, platform }`. The `kind` discriminator (default
 *     'web' for legacy docs) tells us which API to dispatch through.
 *   - Callers (notification creators) shouldn't have to think about any
 *     of this — they call `sendPushToUser(uid, payload)` and trust this
 *     module to do the right thing.
 *
 * Failure mode:
 *   Push delivery is *best-effort*. Notification doc creation already
 *   succeeded; the user can see the new bell badge regardless. If APNs
 *   is down or a token has rotated, we log and prune the dead sub.
 *   This function never throws — it returns a counts summary for
 *   observability and absorbs every error internally.
 */

import { getMessaging } from 'firebase-admin/messaging';
import { getDb } from '@/firebase/admin';

// ─── Types ────────────────────────────────────────────────────────────────

export type PushPayload = {
  title: string;
  body: string;
  /** Optional deep-link target. Sent in FCM's `data` field and in the web
   *  push JSON body. Keys + values must be strings (FCM requirement). */
  data?: Record<string, string>;
  /** Optional icon URL — used by the browser; ignored by iOS native. */
  icon?: string;
};

export type PushSendResult = {
  attempted: number;
  delivered: number;
  pruned: number;
  failed: number;
};

// ─── Web push (lazy VAPID setup) ──────────────────────────────────────────

type WebpushApi = {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, options?: { TTL?: number }) => Promise<unknown>;
};

let webpushModule: WebpushApi | null = null;
let webpushConfigured = false;

async function getWebpush(): Promise<WebpushApi | null> {
  if (webpushConfigured) return webpushModule;
  webpushConfigured = true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.warn('[push-server] VAPID keys not configured — web push disabled.');
    return null;
  }

  // web-push is CJS; dynamic import returns the namespace whose default
  // export is the actual API surface. Cast to our minimal interface.
  const mod = (await import('web-push')) as unknown as { default: WebpushApi };
  const api = mod.default;
  api.setVapidDetails(
    'mailto:support@cinechrony.com',
    publicKey,
    privateKey,
  );
  webpushModule = api;
  return api;
}

// ─── Subscription doc shape (read-only) ───────────────────────────────────

type WebSubDoc = {
  kind?: 'web';
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type FcmSubDoc = {
  kind: 'fcm';
  token: string;
  platform?: 'ios' | 'android' | 'web';
};

type SubDoc = WebSubDoc | FcmSubDoc;

function isFcmSub(doc: SubDoc): doc is FcmSubDoc {
  return (doc as FcmSubDoc).kind === 'fcm';
}

// ─── Web push send ────────────────────────────────────────────────────────

async function sendWebPush(
  sub: WebSubDoc,
  payload: PushPayload,
): Promise<'delivered' | 'prune' | 'fail'> {
  const wp = await getWebpush();
  if (!wp) return 'fail';

  try {
    await wp.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon ?? '/icon-192.png',
        data: payload.data ?? {},
      }),
      { TTL: 60 * 60 * 24 }, // 24h — beyond that the notification is stale
    );
    return 'delivered';
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    // 404 + 410 are the "this subscription is gone forever" signals.
    if (status === 404 || status === 410) return 'prune';
    console.error('[push-server] web push failed:', err);
    return 'fail';
  }
}

// ─── FCM send ─────────────────────────────────────────────────────────────

async function sendFcm(
  sub: FcmSubDoc,
  payload: PushPayload,
): Promise<'delivered' | 'prune' | 'fail'> {
  try {
    await getMessaging().send({
      token: sub.token,
      notification: { title: payload.title, body: payload.body },
      data: payload.data ?? {},
      // APNs-specific: ensure the notification wakes the screen and
      // increments the badge. iOS ignores `notification.title/body`
      // for silent pushes unless this aps.alert is set; firebase-admin
      // synthesises it from `notification` for us by default.
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'content-available': 1,
          },
        },
      },
      // Android: high-priority + tap action routing key
      android: {
        priority: 'high',
        notification: {
          channelId: 'cinechrony-default',
        },
      },
    });
    return 'delivered';
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    // FCM error codes that mean "this token will never work again":
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token' ||
      code === 'messaging/invalid-argument'
    ) {
      return 'prune';
    }
    console.error('[push-server] FCM failed:', err);
    return 'fail';
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────

/**
 * Deliver a push to every device the user has registered. Reads
 * `/users/{uid}/pushSubscriptions/{id}` and dispatches per-doc based on
 * `kind` (default 'web' for legacy docs).
 *
 * Never throws. Returns a counts summary for logging/observability.
 */
export async function sendPushToUser(
  uid: string,
  payload: PushPayload,
): Promise<PushSendResult> {
  const db = getDb();
  const subs = db.collection('users').doc(uid).collection('pushSubscriptions');

  let snapshot: FirebaseFirestore.QuerySnapshot;
  try {
    snapshot = await subs.get();
  } catch (err) {
    console.error('[push-server] sub fetch failed:', err);
    return { attempted: 0, delivered: 0, pruned: 0, failed: 0 };
  }

  if (snapshot.empty) {
    return { attempted: 0, delivered: 0, pruned: 0, failed: 0 };
  }

  const result: PushSendResult = { attempted: 0, delivered: 0, pruned: 0, failed: 0 };
  const toDelete: FirebaseFirestore.DocumentReference[] = [];

  await Promise.all(
    snapshot.docs.map(async (docSnap) => {
      const data = docSnap.data() as SubDoc;
      result.attempted++;
      const outcome = isFcmSub(data)
        ? await sendFcm(data, payload)
        : await sendWebPush(data as WebSubDoc, payload);
      if (outcome === 'delivered') result.delivered++;
      else if (outcome === 'prune') {
        result.pruned++;
        toDelete.push(docSnap.ref);
      } else {
        result.failed++;
      }
    }),
  );

  if (toDelete.length > 0) {
    try {
      const batch = db.batch();
      toDelete.forEach((ref) => batch.delete(ref));
      await batch.commit();

      // If the user now has zero subs left, flip pushEnabled flag.
      const remaining = await subs.limit(1).get();
      if (remaining.empty) {
        await db.collection('users').doc(uid).set(
          { pushEnabled: false },
          { merge: true },
        );
      }
    } catch (err) {
      console.error('[push-server] dead-sub cleanup failed:', err);
    }
  }

  return result;
}
