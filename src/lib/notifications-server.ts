/**
 * Notification-write helpers — Phase A PR #8 extraction.
 *
 * These were private helpers inside `src/app/actions.ts`. PR #10 will
 * migrate the notification READ surface (getNotifications,
 * markNotificationsRead, etc.); for now this module is just the WRITE
 * side that creator endpoints (reviews, likes, follows, invites) call.
 *
 * Each helper respects the recipient's `notificationPreferences` flags
 * and never self-notifies. All writes are best-effort — callers should
 * wrap in try/catch and never let a notification failure roll back the
 * primary write.
 */

import { FieldValue } from 'firebase-admin/firestore';

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
  let anyQueued = false;

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
    anyQueued = true;
  }

  if (anyQueued) await batch.commit();
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
}
