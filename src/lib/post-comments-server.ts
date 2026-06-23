/**
 * Post-comment server logic — Phase A PR #12.
 *
 * Post comments are 1-level threaded (Instagram/TikTok style — replies
 * roll up to a root comment, no nested replies). Stored under
 * `/posts/{postId}/comments/{commentId}`. Counts:
 *  - parent comment `replyCount` increments on reply;
 *  - post `commentCount` increments on top-level only.
 *
 * Closes / preserves:
 *   - AUDIT.md 3.5 — `likePostComment` / `unlikePostComment` transactional.
 *     This is the only like surface that wasn't covered by PRs #8–#11.
 *   - AUDIT.md 3.8 — `createPostComment` (review bucket) and
 *     `likePostComment` (like bucket) rate-limited.
 *   - LAUNCH.md 0.5.5 — no commenting across a block; getPostComments
 *     filters out blocked authors from the result list.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { getBlockSet, isBlockedBetween } from '@/lib/blocks-server';
import { createPostCommentNotification } from '@/lib/notifications-server';
import { postFromDoc, canViewPost } from '@/lib/posts-server';
import type { PostComment } from '@/lib/types';

// ─── Typed errors ─────────────────────────────────────────────────────────

export class PostNotFoundError extends Error {
  constructor(message = 'Post not found.') {
    super(message);
    this.name = 'PostNotFoundError';
  }
}

export class CommentNotFoundError extends Error {
  constructor(message = 'Comment not found.') {
    super(message);
    this.name = 'CommentNotFoundError';
  }
}

export class CommentAuthorizationError extends Error {
  constructor(message = 'You can only delete your own comments.') {
    super(message);
    this.name = 'CommentAuthorizationError';
  }
}

export class BlockedCommentError extends Error {
  constructor(message = "You can't comment on this post.") {
    super(message);
    this.name = 'BlockedCommentError';
  }
}

export class CommentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommentValidationError';
  }
}

export class CommentAlreadyLikedError extends Error {
  constructor(message = 'Already liked.') {
    super(message);
    this.name = 'CommentAlreadyLikedError';
  }
}

export class CommentNotLikedError extends Error {
  constructor(message = 'Not liked yet.') {
    super(message);
    this.name = 'CommentNotLikedError';
  }
}

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_COMMENT_TEXT = 1000;
const COMMENTS_PAGE_LIMIT = 300;

// ─── Serialization ────────────────────────────────────────────────────────

function commentFromDoc(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  postId: string,
): PostComment {
  const c = doc.data();
  return {
    id: doc.id,
    postId,
    userId: c.userId,
    username: c.username ?? null,
    userDisplayName: c.userDisplayName ?? null,
    userPhotoUrl: c.userPhotoUrl ?? null,
    text: c.text ?? '',
    likes: c.likes ?? 0,
    likedBy: c.likedBy ?? [],
    parentId: c.parentId ?? null,
    replyCount: c.replyCount ?? 0,
    createdAt: c.createdAt?.toDate?.() ?? new Date(),
  };
}

// ─── createPostComment ────────────────────────────────────────────────────

/**
 * Comment on a post or reply to a comment (1-level deep). Counts are bumped
 * accordingly. Block-checked against the POST author (you can't comment on
 * someone's post who blocks you or who you blocked).
 */
export async function createPostComment(
  callerUid: string,
  postId: string,
  text: string,
  parentId: string | null,
): Promise<{ commentId: string }> {
  const trimmed = (text || '').trim().slice(0, MAX_COMMENT_TEXT);
  if (!trimmed) throw new CommentValidationError('Write something first.');

  const db = getDb();
  const postRef = db.collection('posts').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) throw new PostNotFoundError();
  const post = postSnap.data() || {};

  // F04 audience: an out-of-audience caller can't even see the post — they
  // can't comment on it either. Return the same "not found" as a missing post
  // so the restricted post's existence isn't revealed.
  if (!canViewPost(postFromDoc(postSnap), callerUid)) throw new PostNotFoundError();

  if (await isBlockedBetween(db, callerUid, post.authorId)) {
    throw new BlockedCommentError();
  }

  const userDoc = await db.collection('users').doc(callerUid).get();
  const u = userDoc.data() || {};

  const commentRef = postRef.collection('comments').doc();
  await commentRef.set({
    id: commentRef.id,
    postId,
    userId: callerUid,
    username: u.username ?? null,
    userDisplayName: u.displayName ?? null,
    userPhotoUrl: u.photoURL ?? null,
    text: trimmed,
    likes: 0,
    likedBy: [],
    parentId: parentId || null,
    replyCount: 0,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Counts: reply bumps parent.replyCount; top-level bumps post.commentCount.
  if (parentId) {
    try {
      await postRef.collection('comments').doc(parentId).update({
        replyCount: FieldValue.increment(1),
      });
    } catch (err) {
      console.error('[createPostComment] parent replyCount bump failed:', err);
    }
  } else {
    await postRef.update({ commentCount: FieldValue.increment(1) });
  }

  // Recipient: parent comment's author for replies, post author for top-level.
  let recipientId: string | null = post.authorId ?? null;
  if (parentId) {
    try {
      const parent = await postRef.collection('comments').doc(parentId).get();
      recipientId = (parent.data()?.userId as string) ?? null;
    } catch {
      // Fall back to the post author.
    }
  }
  if (recipientId) {
    try {
      await createPostCommentNotification(db, {
        postId,
        previewText: trimmed.slice(0, 100),
        recipientId,
        fromUserId: callerUid,
        fromUsername: u.username ?? null,
        fromDisplayName: u.displayName ?? null,
        fromPhotoUrl: u.photoURL ?? null,
      });
    } catch (err) {
      console.error('[createPostComment] notification failed:', err);
    }
  }

  return { commentId: commentRef.id };
}

// ─── getPostComments (block-filtered) ─────────────────────────────────────

/**
 * Flat list of all comments + replies on a post, oldest first. Cap at 300
 * (1-level threading + small audiences → unlikely to overflow; if it ever
 * does, pagination is a future PR). Comments from blocked authors (either
 * direction, viewer-relative) are filtered out.
 */
export async function getPostComments(
  postId: string,
  viewerUid: string | null,
): Promise<{ comments: PostComment[] }> {
  const db = getDb();
  // F04 audience: the conversation under a restricted post is as private as the
  // post — gate the whole thread on canViewPost (mirrors getPost).
  const postSnap = await db.collection('posts').doc(postId).get();
  if (!postSnap.exists || !canViewPost(postFromDoc(postSnap), viewerUid)) {
    return { comments: [] };
  }
  const blockSet = viewerUid ? await getBlockSet(db, viewerUid) : new Set<string>();
  const snap = await db
    .collection('posts').doc(postId)
    .collection('comments')
    .orderBy('createdAt', 'asc')
    .limit(COMMENTS_PAGE_LIMIT)
    .get();
  const comments = snap.docs
    .map((d) => commentFromDoc(d, postId))
    .filter((c) => !blockSet.has(c.userId));
  return { comments };
}

// ─── deletePostComment (comment author OR post author) ────────────────────

/**
 * Delete a post comment. Either the comment's author or the post's author
 * can delete (moderation right for the post owner). Counts are decremented:
 * a reply decrements the parent's replyCount; a top-level decrements the
 * post's commentCount.
 */
export async function deletePostComment(
  callerUid: string,
  postId: string,
  commentId: string,
): Promise<void> {
  const db = getDb();
  const postRef = db.collection('posts').doc(postId);
  const commentRef = postRef.collection('comments').doc(commentId);
  const [postSnap, commentSnap] = await Promise.all([postRef.get(), commentRef.get()]);
  if (!commentSnap.exists) throw new CommentNotFoundError();

  const comment = commentSnap.data() || {};
  const isCommentAuthor = comment.userId === callerUid;
  const isPostAuthor = postSnap.data()?.authorId === callerUid;
  if (!isCommentAuthor && !isPostAuthor) {
    throw new CommentAuthorizationError();
  }

  await commentRef.delete();

  if (comment.parentId) {
    try {
      await postRef.collection('comments').doc(comment.parentId).update({
        replyCount: FieldValue.increment(-1),
      });
    } catch {
      // Parent may have been deleted by now — no-op.
    }
  } else {
    await postRef.update({ commentCount: FieldValue.increment(-1) });
  }
}

// ─── likePostComment / unlikePostComment (AUDIT 3.5) ──────────────────────

export async function likePostComment(
  callerUid: string,
  postId: string,
  commentId: string,
): Promise<{ likes: number }> {
  const db = getDb();
  const ref = db.collection('posts').doc(postId).collection('comments').doc(commentId);

  type TxOk = { kind: 'ok'; newLikes: number };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return { kind: 'err' as const, error: new CommentNotFoundError() };
    }
    const data = snap.data() || {};
    const likedBy: string[] = data.likedBy || [];
    if (likedBy.includes(callerUid)) {
      return { kind: 'err' as const, error: new CommentAlreadyLikedError() };
    }
    tx.update(ref, {
      likes: FieldValue.increment(1),
      likedBy: FieldValue.arrayUnion(callerUid),
    });
    return { kind: 'ok' as const, newLikes: (data.likes || 0) + 1 };
  });
  if (result.kind === 'err') throw result.error;
  return { likes: result.newLikes };
}

export async function unlikePostComment(
  callerUid: string,
  postId: string,
  commentId: string,
): Promise<{ likes: number }> {
  const db = getDb();
  const ref = db.collection('posts').doc(postId).collection('comments').doc(commentId);

  type TxOk = { kind: 'ok'; newLikes: number };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return { kind: 'err' as const, error: new CommentNotFoundError() };
    }
    const data = snap.data() || {};
    const likedBy: string[] = data.likedBy || [];
    if (!likedBy.includes(callerUid)) {
      return { kind: 'err' as const, error: new CommentNotLikedError() };
    }
    tx.update(ref, {
      likes: FieldValue.increment(-1),
      likedBy: FieldValue.arrayRemove(callerUid),
    });
    return { kind: 'ok' as const, newLikes: Math.max(0, (data.likes || 1) - 1) };
  });
  if (result.kind === 'err') throw result.error;
  return { likes: result.newLikes };
}
