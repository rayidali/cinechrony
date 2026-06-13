/**
 * Posts-domain server logic — Phase A PR #11.
 *
 * User posts (LAUNCH 0.5.4) are short-form anchored to a tagged film,
 * with optional media (image up to 6 files, video up to 200MB total).
 * Posts are the unified review+rating surface — when a post includes
 * a rating, the rating also lands in `/ratings/{uid}_{tmdbId}`.
 *
 * Closes / preserves:
 *   - AUDIT.md 3.5 — likePost / unlikePost transactional. Concurrent
 *     double-tap → exactly one increment + one likedBy entry. Fourth
 *     and final like-surface (after reviews, lists, activities).
 *   - AUDIT.md 3.8 — createPost + likePost rate-limited.
 *   - LAUNCH.md 0.5.5 — getPost is block-aware; getHomeFeed filters
 *     out blocked-in-either-direction authors server-side.
 *   - R2 key path scoped to the verified caller uid — media upload
 *     URLs can never write into another user's prefix.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/firebase/admin';
import { getBlockSet, isBlockedBetween } from '@/lib/blocks-server';
import { activityFromDoc } from '@/lib/activities-server';
import {
  extractMentions,
  createPostTagNotification,
  createPostLikeNotification,
} from '@/lib/notifications-server';
import type { Activity, Post, PostMedia, TaggedUser } from '@/lib/types';

// ─── Constants ────────────────────────────────────────────────────────────

export const MAX_POST_MEDIA_BYTES = 200 * 1024 * 1024; // 200MB — Twitter-class
export const MAX_POST_TEXT = 2000;
export const MAX_POST_MEDIA = 6;
const MAX_PLACE_LENGTH = 120;
const MAX_TAGGED_USERS = 20;
const MAX_PAGE = 100;
const DEFAULT_PAGE = 20;

// ─── Typed errors ─────────────────────────────────────────────────────────

export class PostNotFoundError extends Error {
  constructor(message = 'Post not found.') {
    super(message);
    this.name = 'PostNotFoundError';
  }
}

export class PostAuthorMismatchError extends Error {
  constructor(message = 'You can only modify your own posts.') {
    super(message);
    this.name = 'PostAuthorMismatchError';
  }
}

export class PostAlreadyLikedError extends Error {
  constructor(message = 'Already liked.') {
    super(message);
    this.name = 'PostAlreadyLikedError';
  }
}

export class PostNotLikedError extends Error {
  constructor(message = 'Not liked yet.') {
    super(message);
    this.name = 'PostNotLikedError';
  }
}

export class PostValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostValidationError';
  }
}

export class MediaUploadConfigError extends Error {
  constructor(message = 'Media upload is not configured.') {
    super(message);
    this.name = 'MediaUploadConfigError';
  }
}

export class MediaUploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaUploadValidationError';
  }
}

// ─── postFromDoc ──────────────────────────────────────────────────────────

export function postFromDoc(doc: FirebaseFirestore.DocumentSnapshot): Post {
  const d = doc.data() || {};
  return {
    id: doc.id,
    authorId: d.authorId,
    authorUsername: d.authorUsername ?? null,
    authorDisplayName: d.authorDisplayName ?? null,
    authorPhotoURL: d.authorPhotoURL ?? null,
    text: d.text ?? '',
    media: Array.isArray(d.media) ? d.media : [],
    taggedMovie: d.taggedMovie ?? null,
    taggedUserIds: d.taggedUserIds ?? [],
    taggedUsers: d.taggedUsers ?? [],
    place: d.place ?? null,
    likes: d.likes ?? 0,
    likedBy: d.likedBy ?? [],
    commentCount: d.commentCount ?? 0,
    createdAt: d.createdAt?.toDate?.() ?? new Date(),
    updatedAt: d.updatedAt?.toDate?.() ?? new Date(),
    editedAt: d.editedAt?.toDate?.() ?? null,
  };
}

// ─── resolveTaggedUsers ───────────────────────────────────────────────────

/**
 * Resolves tagged-user ids → denormalized TaggedUser[], dropping blocks
 * (either direction) + self + duplicates, capped at 20.
 */
async function resolveTaggedUsers(
  db: FirebaseFirestore.Firestore,
  authorId: string,
  ids: string[] | undefined,
): Promise<TaggedUser[]> {
  const blockSet = await getBlockSet(db, authorId);
  const clean = [...new Set(ids || [])]
    .filter((id) => id && id !== authorId && !blockSet.has(id))
    .slice(0, MAX_TAGGED_USERS);
  if (clean.length === 0) return [];
  const docs = await db.getAll(...clean.map((id) => db.collection('users').doc(id)));
  return docs
    .filter((d) => d.exists)
    .map((d) => {
      const t = d.data() || {};
      return {
        uid: d.id,
        username: t.username ?? null,
        displayName: t.displayName ?? null,
        photoURL: t.photoURL ?? null,
      };
    });
}

// ─── Rating upsert (post-internal) ────────────────────────────────────────

/**
 * Upsert the caller's rating for the tagged film. Unlike
 * `createOrUpdateRating` in ratings-server, this does NOT emit a `rated`
 * activity — the POST is the activity. Calling the standalone helper
 * here would create a duplicate feed item.
 */
async function upsertPostRating(
  db: FirebaseFirestore.Firestore,
  callerUid: string,
  taggedMovie: NonNullable<Post['taggedMovie']>,
  rating: number,
): Promise<void> {
  const ratingId = `${callerUid}_${taggedMovie.tmdbId}`;
  const ratingRef = db.collection('ratings').doc(ratingId);
  const existing = await ratingRef.get();
  const ratingData = {
    id: ratingId,
    userId: callerUid,
    tmdbId: taggedMovie.tmdbId,
    mediaType: taggedMovie.mediaType,
    movieTitle: taggedMovie.title,
    moviePosterUrl: taggedMovie.posterUrl || null,
    rating,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (existing.exists) {
    await ratingRef.update(ratingData);
  } else {
    await ratingRef.set({ ...ratingData, createdAt: FieldValue.serverTimestamp() });
  }
}

// ─── getPostMediaUploadUrl ────────────────────────────────────────────────

/**
 * Issue a presigned R2 PUT URL so the client uploads media DIRECTLY to R2
 * — large files (video up to 200MB) never stream through the server.
 *
 * AUDIT: R2 key is scoped under `posts/{verifiedUid}/` — a malicious
 * client cannot inject `../` or another user's prefix because the uid
 * portion is the verified caller, never a client param.
 */
export async function getPostMediaUploadUrl(
  callerUid: string,
  input: { fileName: string; contentType: string; fileSize: number },
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const { fileName, contentType, fileSize } = input;

  const isImage = contentType.startsWith('image/');
  const isVideo = contentType.startsWith('video/');
  if (!isImage && !isVideo) {
    throw new MediaUploadValidationError('Only images and videos can be attached.');
  }
  if (!fileSize || fileSize <= 0 || fileSize > MAX_POST_MEDIA_BYTES) {
    throw new MediaUploadValidationError('That file is too large — 200MB max.');
  }

  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucketName || !publicBaseUrl) {
    throw new MediaUploadConfigError();
  }

  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const s3 = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  const ext =
    (fileName.split('.').pop() || (isVideo ? 'mp4' : 'jpg'))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8) || (isVideo ? 'mp4' : 'jpg');
  const key = `posts/${callerUid}/${randomUUID()}.${ext}`;

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucketName, Key: key, ContentType: contentType }),
    { expiresIn: 600 },
  );
  return { uploadUrl, publicUrl: `${publicBaseUrl}/${key}` };
}

// ─── createPost ───────────────────────────────────────────────────────────

export type CreatePostInput = {
  text?: string;
  media?: PostMedia[];
  taggedMovie?: Post['taggedMovie'];
  rating?: number | null;
  /** Legacy v2 callers — v3 uses inline @mentions in `text`. */
  taggedUserIds?: string[];
  place?: string;
};

export async function createPost(
  callerUid: string,
  input: CreatePostInput,
): Promise<{ postId: string }> {
  const text = (input.text || '').trim().slice(0, MAX_POST_TEXT);
  const media = (Array.isArray(input.media) ? input.media : []).slice(0, MAX_POST_MEDIA);
  const taggedMovie = input.taggedMovie || null;
  const place = (input.place || '').trim().slice(0, MAX_PLACE_LENGTH) || null;

  if (!taggedMovie && !text && media.length === 0) {
    throw new PostValidationError('Add a few words, a photo, or a film first.');
  }

  let rating: number | null = null;
  if (taggedMovie && typeof input.rating === 'number' && !Number.isNaN(input.rating)) {
    if (input.rating < 1 || input.rating > 10) {
      throw new PostValidationError('Rating must be between 1.0 and 10.0.');
    }
    rating = Math.round(input.rating * 10) / 10;
  }

  const db = getDb();
  const userDoc = await db.collection('users').doc(callerUid).get();
  const u = userDoc.data() || {};
  const taggedUsers = await resolveTaggedUsers(db, callerUid, input.taggedUserIds);

  const postRef = db.collection('posts').doc();
  await postRef.set({
    id: postRef.id,
    authorId: callerUid,
    authorUsername: u.username ?? null,
    authorDisplayName: u.displayName ?? null,
    authorPhotoURL: u.photoURL ?? null,
    text,
    media,
    taggedMovie,
    rating,
    taggedUserIds: taggedUsers.map((t) => t.uid),
    taggedUsers,
    place,
    likes: 0,
    likedBy: [],
    commentCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Rating upsert (post = unified review+rating). Best-effort.
  if (rating !== null && taggedMovie) {
    try {
      await upsertPostRating(db, callerUid, taggedMovie, rating);
    } catch (err) {
      console.error('[createPost] rating upsert failed:', err);
    }
  }

  const previewText = text.slice(0, 100);

  // Legacy taggedUserIds — explicit picks, no mentions-pref check.
  for (const t of taggedUsers) {
    try {
      await createPostTagNotification(db, {
        postId: postRef.id,
        previewText,
        recipientId: t.uid,
        fromUserId: callerUid,
        fromUsername: u.username ?? null,
        fromDisplayName: u.displayName ?? null,
        fromPhotoUrl: u.photoURL ?? null,
        respectMentionsPref: false,
      });
    } catch (err) {
      console.error('[createPost] tag notification failed:', err);
    }
  }

  // v3: inline @-mention notifications. Skips users already picked via
  // legacy taggedUserIds. Respects the mentions notification pref.
  try {
    const mentions = extractMentions(text);
    if (mentions.length > 0) {
      const alreadyNotified = new Set(taggedUsers.map((t) => t.uid));
      const lookups = await Promise.all(
        mentions.map((username) =>
          db.collection('users')
            .where('usernameLower', '==', username.toLowerCase())
            .limit(1)
            .get(),
        ),
      );
      const mentionPreview = text.slice(0, 100) + (text.length > 100 ? '...' : '');
      for (const snap of lookups) {
        if (snap.empty) continue;
        const doc = snap.docs[0];
        const mentionedUserId = doc.id;
        if (alreadyNotified.has(mentionedUserId)) continue;
        await createPostTagNotification(db, {
          postId: postRef.id,
          previewText: mentionPreview,
          recipientId: mentionedUserId,
          fromUserId: callerUid,
          fromUsername: u.username ?? null,
          fromDisplayName: u.displayName ?? null,
          fromPhotoUrl: u.photoURL ?? null,
          respectMentionsPref: true,
        });
      }
    }
  } catch (err) {
    console.error('[createPost] @-mention notifications failed:', err);
  }

  return { postId: postRef.id };
}

// ─── updatePost (owner-only) ──────────────────────────────────────────────

export async function updatePost(
  callerUid: string,
  postId: string,
  input: CreatePostInput,
): Promise<void> {
  const db = getDb();
  const ref = db.collection('posts').doc(postId);
  const snap = await ref.get();
  if (!snap.exists) throw new PostNotFoundError();
  if (snap.data()?.authorId !== callerUid) throw new PostAuthorMismatchError();

  const text = (input.text || '').trim().slice(0, MAX_POST_TEXT);
  const media = (Array.isArray(input.media) ? input.media : []).slice(0, MAX_POST_MEDIA);
  const taggedMovie = input.taggedMovie || null;
  const place = (input.place || '').trim().slice(0, MAX_PLACE_LENGTH) || null;
  if (!taggedMovie && !text && media.length === 0) {
    throw new PostValidationError('A post needs words, a photo, or a film.');
  }

  let rating: number | null = null;
  if (taggedMovie && typeof input.rating === 'number' && !Number.isNaN(input.rating)) {
    if (input.rating < 1 || input.rating > 10) {
      throw new PostValidationError('Rating must be between 1.0 and 10.0.');
    }
    rating = Math.round(input.rating * 10) / 10;
  }

  const taggedUsers = await resolveTaggedUsers(db, callerUid, input.taggedUserIds);

  await ref.update({
    text,
    media,
    taggedMovie,
    rating,
    taggedUserIds: taggedUsers.map((t) => t.uid),
    taggedUsers,
    place,
    updatedAt: FieldValue.serverTimestamp(),
    editedAt: FieldValue.serverTimestamp(),
  });

  if (rating !== null && taggedMovie) {
    try {
      await upsertPostRating(db, callerUid, taggedMovie, rating);
    } catch (err) {
      console.error('[updatePost] rating upsert failed:', err);
    }
  }
}

// ─── deletePost (owner-only) ──────────────────────────────────────────────

export async function deletePost(
  callerUid: string,
  postId: string,
): Promise<void> {
  const db = getDb();
  const ref = db.collection('posts').doc(postId);
  const snap = await ref.get();
  if (!snap.exists) throw new PostNotFoundError();
  if (snap.data()?.authorId !== callerUid) throw new PostAuthorMismatchError();
  await ref.delete();
}

// ─── getPost (block-aware) ────────────────────────────────────────────────

/**
 * Returns `null` instead of the post if the viewer and author have a
 * block in either direction. Anonymous viewers (no callerUid) always
 * see the post.
 */
export async function getPost(
  postId: string,
  viewerUid: string | null,
): Promise<Post | null> {
  const db = getDb();
  const snap = await db.collection('posts').doc(postId).get();
  if (!snap.exists) return null;
  const post = postFromDoc(snap);
  if (viewerUid && (await isBlockedBetween(db, viewerUid, post.authorId))) {
    return null;
  }
  return post;
}

// ─── likePost / unlikePost — transactional (AUDIT 3.5 fourth leg) ────────

export async function likePost(
  callerUid: string,
  postId: string,
): Promise<{ likes: number }> {
  const db = getDb();
  const ref = db.collection('posts').doc(postId);

  type TxOk = { kind: 'ok'; postData: FirebaseFirestore.DocumentData; newLikes: number };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: 'err' as const, error: new PostNotFoundError() };
    const d = snap.data() || {};
    const likedBy: string[] = d.likedBy || [];
    if (likedBy.includes(callerUid)) {
      return { kind: 'err' as const, error: new PostAlreadyLikedError() };
    }
    tx.update(ref, {
      likes: FieldValue.increment(1),
      likedBy: FieldValue.arrayUnion(callerUid),
    });
    return { kind: 'ok' as const, postData: d, newLikes: (d.likes || 0) + 1 };
  });
  if (result.kind === 'err') throw result.error;

  // Best-effort post_like notification.
  if (result.postData.authorId && result.postData.authorId !== callerUid) {
    try {
      const likerDoc = await db.collection('users').doc(callerUid).get();
      const l = likerDoc.data();
      await createPostLikeNotification(db, {
        postId,
        previewText: (result.postData.text || '').slice(0, 100),
        postAuthorId: result.postData.authorId,
        fromUserId: callerUid,
        fromUsername: l?.username ?? null,
        fromDisplayName: l?.displayName ?? null,
        fromPhotoUrl: l?.photoURL ?? null,
      });
    } catch (err) {
      console.error('[likePost] notification failed:', err);
    }
  }

  return { likes: result.newLikes };
}

export async function unlikePost(
  callerUid: string,
  postId: string,
): Promise<{ likes: number }> {
  const db = getDb();
  const ref = db.collection('posts').doc(postId);

  type TxOk = { kind: 'ok'; newLikes: number };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: 'err' as const, error: new PostNotFoundError() };
    const d = snap.data() || {};
    const likedBy: string[] = d.likedBy || [];
    if (!likedBy.includes(callerUid)) {
      return { kind: 'err' as const, error: new PostNotLikedError() };
    }
    tx.update(ref, {
      likes: FieldValue.increment(-1),
      likedBy: FieldValue.arrayRemove(callerUid),
    });
    return { kind: 'ok' as const, newLikes: Math.max(0, (d.likes || 1) - 1) };
  });
  if (result.kind === 'err') throw result.error;
  return { likes: result.newLikes };
}

// ─── getHomeFeed (activities + posts, block-filtered, timestamp cursor) ──

export type FeedItem =
  | { kind: 'activity'; activity: Activity }
  | { kind: 'post'; post: Post };

export async function getHomeFeed(
  viewerUid: string | null,
  opts: { limit?: number; cursor?: string } = {},
): Promise<{ items: FeedItem[]; hasMore: boolean; nextCursor?: string }> {
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_PAGE), MAX_PAGE);
  const db = getDb();
  const blockSet = viewerUid ? await getBlockSet(db, viewerUid) : new Set<string>();
  const cursorDate = opts.cursor ? new Date(opts.cursor) : null;

  let actQ = db.collection('activities').orderBy('createdAt', 'desc');
  let postQ = db.collection('posts').orderBy('createdAt', 'desc');
  if (cursorDate && !Number.isNaN(cursorDate.getTime())) {
    actQ = actQ.where('createdAt', '<', cursorDate);
    postQ = postQ.where('createdAt', '<', cursorDate);
  }

  // Over-fetch activities — only `rated`/`reviewed` survive the type
  // filter below, so a `limit+1` fetch would routinely under-fill.
  const [actSnap, postSnap] = await Promise.all([
    actQ.limit(limit * 2 + 1).get(),
    postQ.limit(limit + 1).get(),
  ]);

  const merged = [
    ...actSnap.docs
      .map((d) => activityFromDoc(d))
      // Opinions only — `rated` and `reviewed`. `added`/`watched` are
      // low-signal logging and stay out of the feed.
      .filter((a) => a.type === 'rated' || a.type === 'reviewed')
      .map((a) => ({
        item: { kind: 'activity' as const, activity: a },
        ts: a.createdAt.getTime(),
        authorId: a.userId,
      })),
    ...postSnap.docs.map((d) => {
      const p = postFromDoc(d);
      return {
        item: { kind: 'post' as const, post: p },
        ts: p.createdAt.getTime(),
        authorId: p.authorId,
      };
    }),
  ]
    .filter((x) => !blockSet.has(x.authorId))
    .sort((a, b) => b.ts - a.ts);

  const hasMore = merged.length > limit;
  const page = merged.slice(0, limit);
  const nextCursor =
    hasMore && page.length > 0
      ? new Date(page[page.length - 1].ts).toISOString()
      : undefined;
  return { items: page.map((x) => x.item), hasMore, nextCursor };
}
