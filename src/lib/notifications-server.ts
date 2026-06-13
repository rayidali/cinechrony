/**
 * Notification-server module — extraction layered across multiple PRs.
 *
 *  - **Write helpers** (PR #8 / #10 / #11 / #12): creator endpoints call
 *    these. Each respects the recipient's `notificationPreferences` and
 *    never self-notifies. Writes are best-effort — callers wrap in try/
 *    catch so a notification failure never rolls back the primary write.
 *  - **Read / management** (PR #13 — bottom of file): list, mark-read,
 *    unread count; push-subscription CRUD; preference get/patch. All
 *    derive identity from the caller's UID — no userId-in-arg surface,
 *    closing the pre-migration "any client can pass any UID" gap.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { getBlockSet } from '@/lib/blocks-server';
import { sendPushToUser, type PushPayload } from '@/lib/push-server';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type Notification,
  type NotificationPreferences,
} from '@/lib/types';

// Fire-and-forget push fan-out. The notification doc has already been
// written; push delivery is observability / nice-to-have. `sendPushToUser`
// never throws — this wrapper exists to make intent explicit at the
// call sites.
function firePush(uid: string, payload: PushPayload): void {
  void sendPushToUser(uid, payload).catch((err) => {
    console.error('[notifications-server] push fan-out failed:', err);
  });
}

function fromName(ctx: { fromUsername: string | null; fromDisplayName: string | null }): string {
  return ctx.fromUsername ? `@${ctx.fromUsername}` : ctx.fromDisplayName || 'Someone';
}

// ─── @-mention extraction ─────────────────────────────────────────────────

/**
 * Extract `@username` tokens from free text. Returns lowercase usernames,
 * deduplicated, preserving first-occurrence order.
 */
export function extractMentions(text: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const username = match[1].toLowerCase();
    if (!mentions.includes(username)) {
      mentions.push(username);
    }
  }
  return mentions;
}

// ─── Mention notifications ────────────────────────────────────────────────

export type ReviewContext = {
  reviewId: string;
  reviewText: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  fromUserId: string;
  fromUsername: string | null;
  fromDisplayName: string | null;
  fromPhotoUrl: string | null;
};

/**
 * Fans out `mention` notifications to every `@username` mentioned in the
 * review text. Skips self-mentions, skips users who disabled mentions,
 * skips usernames that don't resolve. Best-effort; never throws.
 */
export async function createMentionNotifications(
  db: FirebaseFirestore.Firestore,
  ctx: ReviewContext,
): Promise<void> {
  const mentions = extractMentions(ctx.reviewText);
  if (mentions.length === 0) return;

  const userLookups = mentions.map((username) =>
    db.collection('users')
      .where('usernameLower', '==', username.toLowerCase())
      .limit(1)
      .get(),
  );
  const userSnapshots = await Promise.all(userLookups);

  const batch = db.batch();
  const previewText = ctx.reviewText.slice(0, 100) +
    (ctx.reviewText.length > 100 ? '...' : '');
  const pushTargets: string[] = [];

  for (const snapshot of userSnapshots) {
    if (snapshot.empty) continue;

    const userDoc = snapshot.docs[0];
    const mentionedUserId = userDoc.id;
    const userData = userDoc.data();

    if (mentionedUserId === ctx.fromUserId) continue;
    const prefs = userData?.notificationPreferences;
    if (prefs && prefs.mentions === false) continue;

    const notifRef = db.collection('notifications').doc();
    batch.set(notifRef, {
      id: notifRef.id,
      userId: mentionedUserId,
      type: 'mention',
      fromUserId: ctx.fromUserId,
      fromUsername: ctx.fromUsername,
      fromDisplayName: ctx.fromDisplayName,
      fromPhotoUrl: ctx.fromPhotoUrl,
      reviewId: ctx.reviewId,
      tmdbId: ctx.tmdbId,
      mediaType: ctx.mediaType,
      movieTitle: ctx.movieTitle,
      previewText,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    pushTargets.push(mentionedUserId);
  }

  if (pushTargets.length > 0) {
    await batch.commit();
    const title = `${fromName(ctx)} mentioned you`;
    const body = `${ctx.movieTitle}: ${previewText}`;
    for (const uid of pushTargets) {
      firePush(uid, {
        title,
        body,
        data: {
          type: 'mention',
          reviewId: ctx.reviewId,
          tmdbId: String(ctx.tmdbId),
          mediaType: ctx.mediaType,
        },
      });
    }
  }
}

// ─── Reply notification ───────────────────────────────────────────────────

/**
 * Fires a single `reply` notification when a user replies to a top-level
 * review. Skips self-replies. Respects the parent author's `replies`
 * notification pref.
 */
export async function createReplyNotification(
  db: FirebaseFirestore.Firestore,
  ctx: ReviewContext & { parentAuthorId: string },
): Promise<void> {
  if (ctx.parentAuthorId === ctx.fromUserId) return;

  const userDoc = await db.collection('users').doc(ctx.parentAuthorId).get();
  const prefs = userDoc.data()?.notificationPreferences;
  if (prefs && prefs.replies === false) return;

  const previewText = ctx.reviewText.slice(0, 100) +
    (ctx.reviewText.length > 100 ? '...' : '');

  await db.collection('notifications').add({
    userId: ctx.parentAuthorId,
    type: 'reply',
    fromUserId: ctx.fromUserId,
    fromUsername: ctx.fromUsername,
    fromDisplayName: ctx.fromDisplayName,
    fromPhotoUrl: ctx.fromPhotoUrl,
    reviewId: ctx.reviewId,
    tmdbId: ctx.tmdbId,
    mediaType: ctx.mediaType,
    movieTitle: ctx.movieTitle,
    previewText,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  firePush(ctx.parentAuthorId, {
    title: `${fromName(ctx)} replied to your review`,
    body: `${ctx.movieTitle}: ${previewText}`,
    data: {
      type: 'reply',
      reviewId: ctx.reviewId,
      tmdbId: String(ctx.tmdbId),
      mediaType: ctx.mediaType,
    },
  });
}

// ─── Like notification (for reviews) ──────────────────────────────────────

export type LikeNotificationCtx = {
  reviewId: string;
  reviewText: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  reviewAuthorId: string;
  fromUserId: string;
  fromUsername: string | null;
  fromDisplayName: string | null;
  fromPhotoUrl: string | null;
};

/**
 * Fires a single `like` notification when a user likes someone else's
 * review. Skips self-likes; respects the author's `likes` notification pref.
 */
export async function createLikeNotification(
  db: FirebaseFirestore.Firestore,
  ctx: LikeNotificationCtx,
): Promise<void> {
  if (ctx.reviewAuthorId === ctx.fromUserId) return;

  const authorDoc = await db.collection('users').doc(ctx.reviewAuthorId).get();
  const prefs = authorDoc.data()?.notificationPreferences;
  if (prefs && prefs.likes === false) return;

  const previewText = ctx.reviewText.slice(0, 100) +
    (ctx.reviewText.length > 100 ? '...' : '');

  await db.collection('notifications').add({
    userId: ctx.reviewAuthorId,
    type: 'like',
    fromUserId: ctx.fromUserId,
    fromUsername: ctx.fromUsername,
    fromDisplayName: ctx.fromDisplayName,
    fromPhotoUrl: ctx.fromPhotoUrl,
    reviewId: ctx.reviewId,
    tmdbId: ctx.tmdbId,
    mediaType: ctx.mediaType,
    movieTitle: ctx.movieTitle,
    previewText,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  firePush(ctx.reviewAuthorId, {
    title: `${fromName(ctx)} liked your review`,
    body: ctx.movieTitle,
    data: {
      type: 'like',
      reviewId: ctx.reviewId,
      tmdbId: String(ctx.tmdbId),
      mediaType: ctx.mediaType,
    },
  });
}

// ─── Post tag + post like notifications (Phase A PR #11) ──────────────────

export type PostTagNotificationCtx = {
  postId: string;
  previewText: string;
  recipientId: string;
  fromUserId: string;
  fromUsername: string | null;
  fromDisplayName: string | null;
  fromPhotoUrl: string | null;
  /** Skip recipients who set `notificationPreferences.mentions === false`.
   *  Inline @-mention notifications use the `mentions` pref; legacy
   *  `taggedUserIds` notifications do NOT (they were explicit picks). */
  respectMentionsPref?: boolean;
};

/**
 * Fires a `post_tag` notification for a tagged or @-mentioned user.
 * Skips self-tags. Optionally respects the mentions pref.
 */
export async function createPostTagNotification(
  db: FirebaseFirestore.Firestore,
  ctx: PostTagNotificationCtx,
): Promise<void> {
  if (ctx.recipientId === ctx.fromUserId) return;

  if (ctx.respectMentionsPref) {
    const userDoc = await db.collection('users').doc(ctx.recipientId).get();
    const prefs = userDoc.data()?.notificationPreferences;
    if (prefs && prefs.mentions === false) return;
  }

  await db.collection('notifications').add({
    userId: ctx.recipientId,
    type: 'post_tag',
    fromUserId: ctx.fromUserId,
    fromUsername: ctx.fromUsername,
    fromDisplayName: ctx.fromDisplayName,
    fromPhotoUrl: ctx.fromPhotoUrl,
    postId: ctx.postId,
    previewText: ctx.previewText,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  firePush(ctx.recipientId, {
    title: `${fromName(ctx)} tagged you in a post`,
    body: ctx.previewText,
    data: { type: 'post_tag', postId: ctx.postId },
  });
}

export type PostLikeNotificationCtx = {
  postId: string;
  previewText: string;
  postAuthorId: string;
  fromUserId: string;
  fromUsername: string | null;
  fromDisplayName: string | null;
  fromPhotoUrl: string | null;
};

/**
 * Fires a `post_like` notification when a user likes someone else's post.
 * Skips self-likes; respects the author's `likes` notification pref.
 */
export async function createPostLikeNotification(
  db: FirebaseFirestore.Firestore,
  ctx: PostLikeNotificationCtx,
): Promise<void> {
  if (ctx.postAuthorId === ctx.fromUserId) return;

  const authorDoc = await db.collection('users').doc(ctx.postAuthorId).get();
  const prefs = authorDoc.data()?.notificationPreferences;
  if (prefs && prefs.likes === false) return;

  await db.collection('notifications').add({
    userId: ctx.postAuthorId,
    type: 'post_like',
    fromUserId: ctx.fromUserId,
    fromUsername: ctx.fromUsername,
    fromDisplayName: ctx.fromDisplayName,
    fromPhotoUrl: ctx.fromPhotoUrl,
    postId: ctx.postId,
    previewText: ctx.previewText,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  firePush(ctx.postAuthorId, {
    title: `${fromName(ctx)} liked your post`,
    body: ctx.previewText,
    data: { type: 'post_like', postId: ctx.postId },
  });
}

// ─── Post comment notification (Phase A PR #12) ───────────────────────────

export type PostCommentNotificationCtx = {
  postId: string;
  previewText: string;
  /** Top-level comment → post author. Reply → parent comment's author. */
  recipientId: string;
  fromUserId: string;
  fromUsername: string | null;
  fromDisplayName: string | null;
  fromPhotoUrl: string | null;
};

/**
 * Fires a `post_comment` notification. Skips self-comments. Recipient
 * differs by depth: top-level → POST author; reply → PARENT COMMENT's
 * author. The caller resolves which is which.
 */
export async function createPostCommentNotification(
  db: FirebaseFirestore.Firestore,
  ctx: PostCommentNotificationCtx,
): Promise<void> {
  if (ctx.recipientId === ctx.fromUserId) return;

  await db.collection('notifications').add({
    userId: ctx.recipientId,
    type: 'post_comment',
    fromUserId: ctx.fromUserId,
    fromUsername: ctx.fromUsername,
    fromDisplayName: ctx.fromDisplayName,
    fromPhotoUrl: ctx.fromPhotoUrl,
    postId: ctx.postId,
    previewText: ctx.previewText,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  firePush(ctx.recipientId, {
    title: `${fromName(ctx)} commented on your post`,
    body: ctx.previewText,
    data: { type: 'post_comment', postId: ctx.postId },
  });
}

// ═════════════════════════════════════════════════════════════════════════
// READ / MANAGEMENT (Phase A PR #13)
// ═════════════════════════════════════════════════════════════════════════

// ─── Typed errors ─────────────────────────────────────────────────────────

export class PushSubscriptionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushSubscriptionValidationError';
  }
}

// ─── Defaults ─────────────────────────────────────────────────────────────

const NOTIFICATIONS_DEFAULT_LIMIT = 50;
const NOTIFICATIONS_MAX_LIMIT = 100;

// ─── Serialization ────────────────────────────────────────────────────────

function notificationFromDoc(doc: FirebaseFirestore.QueryDocumentSnapshot): Notification {
  const d = doc.data();
  return {
    id: doc.id,
    userId: d.userId,
    type: d.type,
    fromUserId: d.fromUserId,
    fromUsername: d.fromUsername ?? null,
    fromDisplayName: d.fromDisplayName ?? null,
    fromPhotoUrl: d.fromPhotoUrl ?? null,
    reviewId: d.reviewId,
    tmdbId: d.tmdbId,
    mediaType: d.mediaType,
    movieTitle: d.movieTitle,
    previewText: d.previewText,
    listId: d.listId,
    listOwnerId: d.listOwnerId,
    listName: d.listName,
    inviteId: d.inviteId,
    postId: d.postId,
    read: d.read ?? false,
    createdAt: d.createdAt?.toDate?.() ?? new Date(),
  };
}

// ─── listNotifications — cursor pagination, block-filtered ────────────────

/**
 * List the caller's own notifications, newest first. Cursor is the last
 * notification ID on the previous page (matches the activities pattern).
 * Block-filtered: notifications from blocked users (either direction) are
 * dropped before serialization.
 */
export async function listNotifications(
  callerUid: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{ notifications: Notification[]; hasMore: boolean; nextCursor?: string }> {
  const limit = Math.min(
    Math.max(1, opts.limit ?? NOTIFICATIONS_DEFAULT_LIMIT),
    NOTIFICATIONS_MAX_LIMIT,
  );
  const db = getDb();

  let query: FirebaseFirestore.Query = db
    .collection('notifications')
    .where('userId', '==', callerUid)
    .orderBy('createdAt', 'desc');

  if (opts.cursor) {
    const cursorDoc = await db.collection('notifications').doc(opts.cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs;
  const hasMore = docs.length > limit;
  const pageDocs = hasMore ? docs.slice(0, limit) : docs;

  const blockSet = await getBlockSet(db, callerUid);
  const notifications = pageDocs
    .map(notificationFromDoc)
    .filter((n) => !n.fromUserId || !blockSet.has(n.fromUserId));

  return {
    notifications,
    hasMore,
    nextCursor: hasMore ? pageDocs[pageDocs.length - 1].id : undefined,
  };
}

// ─── getUnreadNotificationCount — cheap aggregate ────────────────────────

export async function getUnreadNotificationCount(
  callerUid: string,
): Promise<{ count: number }> {
  const db = getDb();
  const snap = await db
    .collection('notifications')
    .where('userId', '==', callerUid)
    .where('read', '==', false)
    .count()
    .get();
  return { count: snap.data().count };
}

// ─── markNotificationsRead — batch update ────────────────────────────────

/**
 * Mark notifications as read. When `ids` is omitted, marks ALL of the
 * caller's unread notifications. When provided, marks only those IDs —
 * but only the ones that belong to the caller (server enforces ownership
 * per-doc to defend against a malicious client trying to flip other
 * users' state).
 */
export async function markNotificationsRead(
  callerUid: string,
  ids?: string[],
): Promise<void> {
  const db = getDb();
  if (ids && ids.length > 0) {
    const refs = ids.map((id) => db.collection('notifications').doc(id));
    const snaps = await db.getAll(...refs);
    const batch = db.batch();
    let updates = 0;
    for (const snap of snaps) {
      if (snap.exists && snap.data()?.userId === callerUid) {
        batch.update(snap.ref, { read: true });
        updates++;
      }
    }
    if (updates > 0) await batch.commit();
    return;
  }

  const snap = await db
    .collection('notifications')
    .where('userId', '==', callerUid)
    .where('read', '==', false)
    .get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
  await batch.commit();
}

// ─── Push-subscription CRUD ──────────────────────────────────────────────

type WebPushSubscription = {
  kind: 'web';
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type FcmPushSubscription = {
  kind: 'fcm';
  token: string;
  platform: 'ios' | 'android' | 'web';
};

type PushSubscriptionInput = WebPushSubscription | FcmPushSubscription;

function assertValidPushSubscription(sub: unknown): asserts sub is PushSubscriptionInput {
  if (!sub || typeof sub !== 'object') {
    throw new PushSubscriptionValidationError('Subscription must be an object.');
  }
  const s = sub as Record<string, unknown>;

  // FCM (native iOS/Android) — added Phase B.3.
  if (s.kind === 'fcm') {
    if (typeof s.token !== 'string' || s.token.length === 0) {
      throw new PushSubscriptionValidationError('fcm: token is required.');
    }
    if (s.platform !== 'ios' && s.platform !== 'android' && s.platform !== 'web') {
      throw new PushSubscriptionValidationError('fcm: platform must be ios|android|web.');
    }
    return;
  }

  // Web push — the legacy default. `kind` is omitted on existing clients
  // for backward compatibility; treat missing kind as 'web'.
  if (typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://')) {
    throw new PushSubscriptionValidationError('endpoint must be an https URL.');
  }
  const keys = s.keys as Record<string, unknown> | undefined;
  if (!keys || typeof keys !== 'object') {
    throw new PushSubscriptionValidationError('keys is required.');
  }
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    throw new PushSubscriptionValidationError('keys.p256dh and keys.auth must be strings.');
  }
}

/**
 * Upsert a push subscription for the caller. Idempotent: web subs key
 * off `endpoint`, FCM subs key off `token`. Flips `pushEnabled` true.
 */
export async function savePushSubscription(
  callerUid: string,
  sub: unknown,
): Promise<void> {
  assertValidPushSubscription(sub);
  const db = getDb();
  const subs = db.collection('users').doc(callerUid).collection('pushSubscriptions');

  if (sub.kind === 'fcm') {
    const existing = await subs.where('token', '==', sub.token).limit(1).get();
    if (!existing.empty) {
      await existing.docs[0].ref.update({
        platform: sub.platform,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await subs.add({
        kind: 'fcm',
        token: sub.token,
        platform: sub.platform,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  } else {
    // Web push — match legacy doc shape (no `kind` field).
    const existing = await subs.where('endpoint', '==', sub.endpoint).limit(1).get();
    if (!existing.empty) {
      await existing.docs[0].ref.update({
        keys: sub.keys,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await subs.add({
        endpoint: sub.endpoint,
        keys: sub.keys,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  await db.collection('users').doc(callerUid).set(
    { pushEnabled: true },
    { merge: true },
  );
}

/**
 * Remove a push subscription by either `endpoint` (web push) or `token`
 * (FCM). If the caller has no remaining subscriptions afterward, flips
 * `pushEnabled` back to false.
 */
export async function removePushSubscription(
  callerUid: string,
  identifier: { endpoint: string } | { token: string },
): Promise<void> {
  const db = getDb();
  const subs = db.collection('users').doc(callerUid).collection('pushSubscriptions');

  let matching: FirebaseFirestore.QuerySnapshot;
  if ('endpoint' in identifier) {
    if (typeof identifier.endpoint !== 'string' || !identifier.endpoint) {
      throw new PushSubscriptionValidationError('endpoint is required.');
    }
    matching = await subs.where('endpoint', '==', identifier.endpoint).get();
  } else {
    if (typeof identifier.token !== 'string' || !identifier.token) {
      throw new PushSubscriptionValidationError('token is required.');
    }
    matching = await subs.where('token', '==', identifier.token).get();
  }

  if (!matching.empty) {
    const batch = db.batch();
    matching.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  const remaining = await subs.limit(1).get();
  if (remaining.empty) {
    await db.collection('users').doc(callerUid).set(
      { pushEnabled: false },
      { merge: true },
    );
  }
}

export async function getPushStatus(
  callerUid: string,
): Promise<{ enabled: boolean }> {
  const db = getDb();
  const userDoc = await db.collection('users').doc(callerUid).get();
  return { enabled: Boolean(userDoc.data()?.pushEnabled) };
}

// ─── Notification preferences ────────────────────────────────────────────

export async function getNotificationPreferences(
  callerUid: string,
): Promise<{ preferences: NotificationPreferences }> {
  const db = getDb();
  const userDoc = await db.collection('users').doc(callerUid).get();
  const stored = (userDoc.data()?.notificationPreferences ?? {}) as Partial<NotificationPreferences>;
  return {
    preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, ...stored },
  };
}

/**
 * Merge-update the caller's notification preferences. Only the known
 * boolean keys are accepted; unknown keys are silently dropped.
 */
export async function updateNotificationPreferences(
  callerUid: string,
  partial: Partial<NotificationPreferences>,
): Promise<void> {
  const allowed: (keyof NotificationPreferences)[] = [
    'mentions', 'replies', 'likes', 'follows', 'listInvites', 'weeklyDigest',
  ];
  const sanitized: Partial<NotificationPreferences> = {};
  for (const k of allowed) {
    if (typeof partial[k] === 'boolean') {
      sanitized[k] = partial[k];
    }
  }
  if (Object.keys(sanitized).length === 0) return;

  const db = getDb();
  const userRef = db.collection('users').doc(callerUid);
  const userDoc = await userRef.get();
  const current = (userDoc.data()?.notificationPreferences ?? {}) as Partial<NotificationPreferences>;
  await userRef.set(
    { notificationPreferences: { ...current, ...sanitized } },
    { merge: true },
  );
}
