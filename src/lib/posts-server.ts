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

import { FieldValue, FieldPath } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/firebase/admin';
import { getBlockSet, isBlockedBetween } from '@/lib/blocks-server';
import { getMutualIds, getCloseFriendIds } from '@/lib/follows-server';
import { recordWatchEntry } from '@/lib/watches-server';
import {
  extractMentions,
  createPostTagNotification,
  createPostLikeNotification,
} from '@/lib/notifications-server';
import type { Activity, Post, PostMedia, PostVisibility, TaggedUser } from '@/lib/types';

// ─── Constants ────────────────────────────────────────────────────────────

export const MAX_POST_MEDIA_BYTES = 200 * 1024 * 1024; // 200MB — Twitter-class
export const MAX_POST_TEXT = 2000;
export const MAX_POST_MEDIA = 10;
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
    watchType: d.watchType ?? null,
    watchedOn: d.watchedOn?.toDate?.() ?? null,
    visibility: (d.visibility as PostVisibility) ?? 'everyone',
    audienceUids: Array.isArray(d.audienceUids) ? d.audienceUids : undefined,
    likes: d.likes ?? 0,
    likedBy: d.likedBy ?? [],
    commentCount: d.commentCount ?? 0,
    createdAt: d.createdAt?.toDate?.() ?? new Date(),
    updatedAt: d.updatedAt?.toDate?.() ?? new Date(),
    editedAt: d.editedAt?.toDate?.() ?? null,
  };
}

// ─── Visibility / audience ──────────────────────────────────────────────────

const VALID_VISIBILITY: readonly PostVisibility[] = ['everyone', 'friends', 'close_friends', 'only_me'];
const MAX_AUDIENCE = 2000;

/**
 * Resolve a post's audience snapshot at WRITE time. 'everyone' carries no
 * snapshot (public). Restricted posts store the exact uid set allowed to see
 * them (the author is always allowed and is NOT included here), so the feed can
 * filter in-memory with zero per-author relationship reads at read time.
 */
async function resolveAudience(
  callerUid: string,
  visibility: PostVisibility,
): Promise<{ visibility: PostVisibility; audienceUids: string[] | null }> {
  if (visibility === 'everyone') return { visibility, audienceUids: null };
  if (visibility === 'only_me') return { visibility, audienceUids: [] };
  const ids = visibility === 'friends'
    ? await getMutualIds(callerUid)
    : await getCloseFriendIds(callerUid);
  return { visibility, audienceUids: [...new Set(ids)].filter((id) => id && id !== callerUid).slice(0, MAX_AUDIENCE) };
}

/**
 * Can `viewerUid` see this post? The single source of truth applied in EVERY
 * post read path (home feed, saved feed, post detail, profile posts). Public
 * posts are visible to all (incl. anonymous); the author always sees their own;
 * restricted posts require membership in the write-time `audienceUids` snapshot.
 */
export function canViewPost(post: Post, viewerUid: string | null): boolean {
  const vis = post.visibility ?? 'everyone';
  if (vis === 'everyone') return true;
  if (viewerUid && viewerUid === post.authorId) return true;
  if (!viewerUid) return false;
  return (post.audienceUids ?? []).includes(viewerUid);
}

/**
 * Strip the server-internal arrays before a post leaves the server, deriving the
 * one thing the client actually needs from them. MUST be applied at every point
 * a post is returned to a client — AFTER canViewPost has run (canViewPost reads
 * audienceUids). Removes:
 *   • audienceUids — the author's mutuals/close-friends snapshot (privacy leak),
 *   • likedBy — the full liker array (payload bloat + 1MB-doc-cap risk on viral
 *     posts), replaced by `myLiked` for the requesting viewer.
 */
export function serializePostForViewer(post: Post, viewerUid: string | null): Post {
  const myLiked = !!viewerUid && (post.likedBy ?? []).includes(viewerUid);
  const { likedBy: _likedBy, audienceUids: _audienceUids, ...rest } = post;
  void _likedBy; void _audienceUids; // intentionally dropped from the client view
  return { ...rest, myLiked };
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
  /** F04 "tag friends" (also accepts legacy v2 picks). v3 also extracts inline
   *  @mentions from `text`; both feed the denormalized taggedUsers + notifs. */
  taggedUserIds?: string[];
  place?: string;
  /** F04 "your watch" — 'first' | 'rewatch'. */
  watchType?: 'first' | 'rewatch' | null;
  /** F04 "watched on" — ISO date string; clamped to now (no future). */
  watchedOn?: string | null;
  /** F04 "visible to" — defaults to 'everyone'. */
  visibility?: PostVisibility;
};

/** Shared parse/validate for the v3 post fields written by create + update. */
function parsePostFields(input: CreatePostInput) {
  const text = (input.text || '').trim().slice(0, MAX_POST_TEXT);
  const media = (Array.isArray(input.media) ? input.media : []).slice(0, MAX_POST_MEDIA);
  const taggedMovie = input.taggedMovie || null;
  const place = (input.place || '').trim().slice(0, MAX_PLACE_LENGTH) || null;

  let rating: number | null = null;
  if (taggedMovie && typeof input.rating === 'number' && !Number.isNaN(input.rating)) {
    if (input.rating < 1 || input.rating > 10) {
      throw new PostValidationError('Rating must be between 1.0 and 10.0.');
    }
    rating = Math.round(input.rating * 10) / 10;
  }

  const watchType = taggedMovie && (input.watchType === 'first' || input.watchType === 'rewatch')
    ? input.watchType
    : null;

  let watchedOn: Date | null = null;
  if (taggedMovie && input.watchedOn) {
    const d = new Date(input.watchedOn);
    if (!Number.isNaN(d.getTime())) watchedOn = d.getTime() > Date.now() ? new Date() : d;
  }

  const visibility: PostVisibility = VALID_VISIBILITY.includes(input.visibility as PostVisibility)
    ? (input.visibility as PostVisibility)
    : 'everyone';

  return { text, media, taggedMovie, place, rating, watchType, watchedOn, visibility };
}

export async function createPost(
  callerUid: string,
  input: CreatePostInput,
): Promise<{ postId: string }> {
  const { text, media, taggedMovie, place, rating, watchType, watchedOn, visibility } =
    parsePostFields(input);

  if (!taggedMovie && !text && media.length === 0) {
    throw new PostValidationError('Add a few words, a photo, or a film first.');
  }

  const db = getDb();
  const userDoc = await db.collection('users').doc(callerUid).get();
  const u = userDoc.data() || {};
  const taggedUsers = await resolveTaggedUsers(db, callerUid, input.taggedUserIds);
  const audience = await resolveAudience(callerUid, visibility);

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
    watchType,
    watchedOn: watchedOn ?? null,
    visibility: audience.visibility,
    ...(audience.audienceUids ? { audienceUids: audience.audienceUids } : {}),
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

  // A post about a film RECORDS a viewing in the watch log (F04 "your watch"),
  // so "your history" in the movie drawer stays consistent. Lean entry only —
  // the post body is the take (no duplicate /reviews doc); the rating is already
  // upserted above. Best-effort: a watch-log hiccup never fails the post.
  if (taggedMovie) {
    try {
      await recordWatchEntry(callerUid, {
        tmdbId: taggedMovie.tmdbId,
        mediaType: taggedMovie.mediaType,
        movieTitle: taggedMovie.title,
        moviePosterUrl: taggedMovie.posterUrl,
        rating,
        note: null,
        watchedAt: (watchedOn ?? new Date()).toISOString(),
      });
    } catch (err) {
      console.error('[createPost] watch-log entry failed:', err);
    }
  }

  const previewText = text.slice(0, 100);

  // A tag/@-mention notification carries the post's preview text — so it must
  // only go to recipients who are allowed to SEE the post. For a restricted
  // post, never notify (and never leak the preview to) anyone outside the
  // write-time audience; an 'only_me' post notifies no one.
  const audienceSet = audience.audienceUids ? new Set(audience.audienceUids) : null;
  const canRecipientSee = (uid: string): boolean =>
    audience.visibility === 'everyone' || uid === callerUid || (audienceSet?.has(uid) ?? false);

  // Legacy taggedUserIds — explicit picks, no mentions-pref check.
  for (const t of taggedUsers) {
    if (!canRecipientSee(t.uid)) continue;
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
        if (!canRecipientSee(mentionedUserId)) continue;
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

  const { text, media, taggedMovie, place, rating, watchType, watchedOn, visibility } =
    parsePostFields(input);
  if (!taggedMovie && !text && media.length === 0) {
    throw new PostValidationError('A post needs words, a photo, or a film.');
  }

  const taggedUsers = await resolveTaggedUsers(db, callerUid, input.taggedUserIds);
  const audience = await resolveAudience(callerUid, visibility);

  // Editing does NOT re-log a watch (the viewing already happened at create).
  await ref.update({
    text,
    media,
    taggedMovie,
    rating,
    taggedUserIds: taggedUsers.map((t) => t.uid),
    taggedUsers,
    place,
    watchType,
    watchedOn: watchedOn ?? null,
    visibility: audience.visibility,
    // Clear the snapshot when going public; otherwise replace it.
    audienceUids: audience.audienceUids ?? FieldValue.delete(),
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
  if (!canViewPost(post, viewerUid)) return null;
  if (viewerUid && (await isBlockedBetween(db, viewerUid, post.authorId))) {
    return null;
  }
  return serializePostForViewer(post, viewerUid);
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
    // F04 audience: an out-of-audience caller gets the same 404 as a missing
    // post — no liking, and no existence oracle on restricted posts.
    if (!canViewPost(postFromDoc(snap), callerUid)) {
      return { kind: 'err' as const, error: new PostNotFoundError() };
    }
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
    if (!canViewPost(postFromDoc(snap), callerUid)) {
      return { kind: 'err' as const, error: new PostNotFoundError() };
    }
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
  // Keyset cursor: `<createdAt ISO>|<docId>`. A legacy bare-ISO cursor still
  // parses (docId empty → timestamp-only resume, as before).
  const cSep = opts.cursor ? opts.cursor.lastIndexOf('|') : -1;
  const cIso = opts.cursor ? (cSep > 0 ? opts.cursor.slice(0, cSep) : opts.cursor) : null;
  const cursorDocId = cSep > 0 ? opts.cursor!.slice(cSep + 1) : '';
  const cursorDate = cIso ? new Date(cIso) : null;

  // The reel is user-authored posts only. System activities (`added`,
  // `watched`, `rated`, `reviewed`) are intentionally kept out of the home
  // feed — they're low-signal logging; opinions belong in a written post.
  //
  // Block + F04-audience filtering happens in-memory AFTER the read, so a window
  // can shrink below `limit` (others' private posts). Pagination MUST be keyed
  // off the RAW scan, not the visible count — otherwise a single hidden post
  // could set hasMore=false and dead-end infinite scroll. We scan in bounded
  // rounds (cap reads under the free-tier budget) until we have a full visible
  // page or the collection is exhausted, advancing the cursor past the last
  // RAW doc each round so hidden docs are never re-scanned.
  // KEYSET pagination on (createdAt DESC, __name__ ASC). The explicit
  // documentId() tiebreak matches Firestore's implicit `__name__ ASC`, so no new
  // index — and it fixes the tie-skip: a bare `where('createdAt','<', cursor)`
  // excluded EVERY post sharing the boundary millisecond, dropping the tail of a
  // same-timestamp group (two posts in one server-ms) from the feed. The cursor
  // now carries (createdAt, docId) so pagination resumes precisely.
  const baseQ = db
    .collection('posts')
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId(), 'asc');
  const MAX_ROUNDS = 5;
  const ROUND = limit + 1;

  const visible: { item: FeedItem; ts: number; id: string }[] = [];
  let scanCursor: Date | null = cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate : null;
  let scanCursorId: string = cursorDocId; // keyset partner for scanCursor
  let rawCursor: string | undefined; // ISO of the last RAW doc scanned
  let rawCursorId: string | undefined; // its docId
  let exhausted = false;
  let rounds = 0;

  // Scan until we have one MORE than the page (so we know there's a next page)
  // or the collection runs out — keep going past hidden posts.
  for (; rounds < MAX_ROUNDS && visible.length <= limit; rounds++) {
    let q = baseQ;
    if (scanCursor) {
      q = scanCursorId
        ? q.startAfter(scanCursor, scanCursorId)
        : q.where('createdAt', '<', scanCursor); // legacy bare-ts cursor
    }
    const snap = await q.limit(ROUND).get();
    if (snap.empty) { exhausted = true; break; }
    for (const d of snap.docs) {
      const p = postFromDoc(d);
      rawCursor = p.createdAt.toISOString();
      rawCursorId = d.id;
      scanCursor = p.createdAt;
      scanCursorId = d.id;
      if (blockSet.has(p.authorId)) continue;
      if (!canViewPost(p, viewerUid)) continue;
      visible.push({ item: { kind: 'post', post: serializePostForViewer(p, viewerUid) }, ts: p.createdAt.getTime(), id: d.id });
    }
    if (snap.size < ROUND) { exhausted = true; break; }
  }

  // Stable sort keeps the scan order (createdAt desc, id asc) for equal ts, so
  // page[last]'s (ts, id) is a valid keyset cursor and surplus visible items are
  // re-included (exclusively) on the next page — never dropped, never duplicated.
  visible.sort((a, b) => b.ts - a.ts);
  const page = visible.slice(0, limit);
  const rawKeyset = rawCursor && rawCursorId ? `${rawCursor}|${rawCursorId}` : rawCursor;

  let hasMore: boolean;
  let nextCursor: string | undefined;
  if (visible.length > limit) {
    // There's a confirmed next visible post — resume just after the LAST
    // RETURNED item (not the last raw doc) so the surplus visible isn't dropped.
    hasMore = true;
    const last = page[page.length - 1];
    nextCursor = last ? `${new Date(last.ts).toISOString()}|${last.id}` : rawKeyset;
  } else if (rounds >= MAX_ROUNDS && !exhausted) {
    // Hit the scan cap on a dense run of hidden posts — there may be more;
    // advance past everything scanned so we don't re-scan the hidden run.
    hasMore = true;
    nextCursor = rawKeyset;
  } else {
    hasMore = false;
    nextCursor = undefined;
  }
  return { items: page.map((x) => x.item), hasMore, nextCursor };
}
