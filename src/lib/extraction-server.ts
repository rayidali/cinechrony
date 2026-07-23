/**
 * Phase C — film-extraction backend (C.1a scaffolding).
 *
 * Lifecycle: client POSTs a video URL → `createExtraction` canonicalizes it,
 * checks the shared cache, and either returns a cache-hit job (instantly `done`)
 * or creates a `processing` job and kicks `runExtractionPipeline` AFTER the
 * response returns (Vercel keeps it alive via `next/server` `after`). The client
 * polls `getExtraction`.
 *
 * THE PIPELINE IS STUBBED in C.1a — it returns fixture films so the routes,
 * auth, data model, cache, and the C.2 confirmation UI can all be built/tested
 * with zero API keys. C.1b/c swap the stub body for: Apify acquire → Gemini
 * watch → TMDB ground. The surrounding job/cache/stage machinery stays.
 *
 * Collections (both server-only — `firestore.rules` denies all client access):
 *   /extraction_jobs/{jobId}     — per-request, uid-scoped
 *   /extraction_cache/{urlHash}  — shared across users, results only (no uid)
 *
 * WEEKLY SCAN QUOTA: only a CLAIM (a fresh Apify+Gemini pipeline run) costs
 * real money — cache hits (`isFreshDone`) and followers ride someone else's
 * claim for free. The claim transaction below meters claims against a
 * per-week counter on `users_private/{uid}` (client-inaccessible; see
 * `firestore.rules`) and throws `QuotaExceededError` once the free tier's
 * weekly budget (`PLAN_LIMITS`, `SCAN_WEEKLY_LIMIT`-overridable) is spent. A
 * rejected claim never touches the cache doc, so the urlHash stays open for
 * the next caller. `getScanQuota` serves the read-only `{ used, limit, … }`
 * view behind `GET /api/v1/me/scan-quota`.
 */

import { createHash } from 'node:crypto';
import { after } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { BadRequestError, ForbiddenError, NotFoundError, QuotaExceededError } from '@/lib/api-handler';
import { acquireVideo, type AcquiredVideo } from '@/lib/video-acquire-server';
import { analyzeForFilms, captionCandidates, isGeminiConfigured, type GeminiAnalysis, type RawFilmCandidate } from '@/lib/gemini-server';
import { addMovieToList, ListAccessDeniedError } from '@/lib/movies-server';
import { createList } from '@/lib/lists-server';
import { rehostImageToR2 } from '@/lib/r2-server';
import { sendPushToUser } from '@/lib/push-server';
import {
  getLiveActivityStartToken,
  isLiveActivityConfigured,
  noteLiveActivityEnv,
  pruneLiveActivityToken,
  sendLiveActivityEnd,
  sendLiveActivityStart,
  sendLiveActivityUpdate,
  type LaContentState,
  type LaEnv,
  type LaStartToken,
} from '@/lib/live-activity-server';
import { parseVideoUrl, youTubeThumbnail } from '@/lib/video-utils';
import type { SearchResult } from '@/lib/types';
import type {
  ExtractionErrorCode,
  ExtractionFilm,
  ExtractionJobView,
  ExtractionProvider,
  ExtractionStage,
  ExtractionStatus,
} from '@/lib/extraction-types';

const JOBS = 'extraction_jobs';
const CACHE = 'extraction_cache';
/** Cached results are reusable for ~30 days (the plan's TTL). */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A pipeline "claim" on a urlHash is live for ~3 min; after that the winner is
 *  assumed dead and the urlHash is re-claimable. Bounds the worst-case pipeline. */
const CLAIM_TTL_MS = 3 * 60 * 1000;
/** Throttle for the best-effort `lastPolledAt` stamp in `getExtraction` — a
 *  live poll loop (the share-extension drawer or the `/extract` screen) can
 *  fire every few seconds; this caps the write to about once per 15s/job. */
const POLL_STAMP_THROTTLE_MS = 15 * 1000;
/** `sendExtractionCompletionPush` treats a `lastPolledAt` within this window as
 *  "actively watching" and skips the completion push. Deliberately a bit wider
 *  than `POLL_STAMP_THROTTLE_MS` so a continuously-polling client's throttled
 *  stamp never reads stale at the exact moment the pipeline finishes. */
const LIVE_WATCH_WINDOW_MS = 20 * 1000;

// ── Weekly scan quota (only a CLAIM costs money — cache hits + followers are
// free, see the claim transaction in `createExtraction`) ─────────────────────

/** Per-plan weekly scan budget. Only `free` exists today; an unrecognized or
 *  missing plan string falls back to it. */
export const PLAN_LIMITS: Record<string, { scansPerWeek: number }> = {
  free: { scansPerWeek: 7 },
};

/** Free-tier weekly limit, env-overridable — read at CALL time (like the other
 *  env reads in this file, e.g. `confidenceFloor`) so it's robust to env
 *  arriving after import. Falls back to `PLAN_LIMITS.free` when unset/invalid. */
function freeWeeklyLimit(): number {
  const v = Number(process.env.SCAN_WEEKLY_LIMIT);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : PLAN_LIMITS.free.scansPerWeek;
}

/** Resolves the weekly scan limit for a plan string. Unknown/missing plans are
 *  the free tier (and so pick up the env override); a recognized paid plan
 *  (none yet) uses its own fixed `scansPerWeek`. */
function weeklyLimitFor(plan: string | undefined): number {
  const limits = (plan && PLAN_LIMITS[plan]) || PLAN_LIMITS.free;
  return limits === PLAN_LIMITS.free ? freeWeeklyLimit() : limits.scansPerWeek;
}

/** The Monday of `now`'s UTC week, as `'YYYY-MM-DD'` — the quota bucket key.
 *  Quota resets Monday 00:00 UTC, so a scan's usage lands under whichever
 *  Monday its calendar week started on. Exported for the audit suite. */
export function currentWeekKey(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const sinceMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

/** ISO instant of the NEXT Monday 00:00:00 UTC after `now` — the quota's reset
 *  time, surfaced to the client so it can say "they refresh monday" honestly. */
export function weekResetsAt(now: Date = new Date()): string {
  const weekStart = new Date(`${currentWeekKey(now)}T00:00:00.000Z`);
  return new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

/** The private, server-only fields `createExtraction`/`getScanQuota` read off
 *  `users_private/{uid}` (`firestore.rules` denies all client access). */
type UsersPrivateDoc = {
  plan?: string;
  scanUsage?: { week?: string; used?: number };
};

/** The shared per-video cache doc — also the cache-stampede coordination point. */
type CacheDoc = {
  status?: 'processing' | 'done' | 'failed';
  films?: ExtractionFilm[];
  suggestedListName?: string | null;
  isFilmContent?: boolean;
  videoThumbnail?: string | null;
  canonicalUrl?: string;
  provider?: ExtractionProvider;
  analyzedBy?: string;
  startedAt?: FirebaseFirestore.Timestamp;
  createdAt?: FirebaseFirestore.Timestamp;
};
const tsMillis = (t?: FirebaseFirestore.Timestamp) => (t?.toMillis ? t.toMillis() : 0);
/** Absolute expiry stamp for the Firestore TTL policy (which deletes docs once
 *  `expiresAt` is in the past — the policy field must be a future time, NOT
 *  `createdAt`). Matches CACHE_TTL_MS so physical deletion tracks the soft TTL
 *  in `isFreshDone`; jobs share the same lifetime (an expired `/extract?jobId=`
 *  resume shows the built-in not-found state). */
const expireStamp = () => Timestamp.fromMillis(Date.now() + CACHE_TTL_MS);
/** A degraded read (the model never saw the media — caption mining only)
 *  must not poison the cache for a month: a later re-scan of the same URL
 *  deserves a fresh shot at the real pipeline once the transient cause
 *  (download failure, model outage) has passed. */
const DEGRADED_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** A usable DONE result (handles legacy docs written before the `status` field). */
function isFreshDone(c?: CacheDoc): boolean {
  if (!c) return false;
  const done = c.status === 'done' || (c.status === undefined && Array.isArray(c.films));
  if (!done) return false;
  const degraded = typeof c.analyzedBy === 'string' && c.analyzedBy.endsWith('|caption-only');
  const ttl = degraded ? DEGRADED_CACHE_TTL_MS : CACHE_TTL_MS;
  return !c.createdAt || Date.now() - tsMillis(c.createdAt) < ttl;
}
/** Someone is actively working this urlHash right now (claim not yet stale).
 *  A `failed` claim is NOT live — a user retry of a just-failed scan should
 *  re-claim and run a fresh pipeline immediately, not become a follower doomed
 *  to spin against a dead cache until the claim goes stale. */
function claimLive(c?: CacheDoc): boolean {
  return c?.status === 'processing' && Date.now() - tsMillis(c?.startedAt) < CLAIM_TTL_MS;
}

// ── URL canonicalization + provider classification ───────────────────────────

/** Tracking params we strip so the same video always hashes to one cache key. */
const STRIP_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'igshid', 'igsh', 'fbclid', 'gclid', '_r', '_t', 'is_from_webapp',
  'sender_device', 'web_id', 'feature', 'si', 'pp', 'app',
]);

function classifyProvider(host: string): ExtractionProvider {
  const h = host.replace(/^www\./, '').toLowerCase();
  if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) return 'tiktok';
  if (h === 'instagram.com' || h.endsWith('.instagram.com')) return 'instagram';
  if (h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be') return 'youtube';
  return 'other';
}

/**
 * Parse + normalize a shared URL. Returns the canonical URL and provider, or
 * `null` if it isn't a usable http(s) URL. (Short links like `vm.tiktok.com/…`
 * are classified by host here; the live pipeline follows their redirects — the
 * stub doesn't need to.)
 */
export function canonicalizeUrl(
  raw: string,
): { canonicalUrl: string; provider: ExtractionProvider } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const provider = classifyProvider(u.hostname);

  // Strip tracking params (keep meaningful ones like youtube's `v`).
  for (const key of [...u.searchParams.keys()]) {
    if (STRIP_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  u.hash = '';
  u.protocol = 'https:';
  u.hostname = u.hostname.replace(/^www\./, '');
  // Drop a trailing slash on the path (but keep root "/").
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }

  return { canonicalUrl: u.toString(), provider };
}

function hashUrl(canonicalUrl: string): string {
  return createHash('sha256').update(canonicalUrl).digest('hex');
}

// ── DTO mapping ──────────────────────────────────────────────────────────────

type JobDoc = {
  uid: string;
  sourceUrl: string;
  canonicalUrl: string;
  urlHash: string;
  provider: ExtractionProvider;
  status: ExtractionStatus;
  stage: ExtractionStage;
  errorCode?: string | null;
  films?: ExtractionFilm[];
  suggestedListName?: string | null;
  isFilmContent?: boolean;
  videoThumbnail?: string | null;
  follower?: boolean; // resolves from the shared cache (didn't run its own pipeline)
  fromCache?: boolean;
  /** Set once the completion push has been sent (real pipeline only) — the
   *  check-and-set guard `sendExtractionCompletionPush` claims transactionally
   *  so re-entry can never fire it twice. Absent for stub/no-key jobs. */
  pushSentAt?: FirebaseFirestore.Timestamp;
  /** Best-effort, throttled stamp written by `getExtraction` on every
   *  successful OWNER read (~once per `POLL_STAMP_THROTTLE_MS`). Lets
   *  `sendExtractionCompletionPush` detect a live poller (the share-extension
   *  drawer or the `/extract` screen, both poll every few seconds) and skip a
   *  redundant completion push. Absent until the job's first poll. */
  lastPolledAt?: FirebaseFirestore.Timestamp;
  /** The per-job Live Activity state machine (LIVE-ACTIVITY-PLAN.md §4).
   *  Every field is a transactional claim or an eventually-consistent fact
   *  reported back by the device — never rendered to the client. */
  liveActivity?: LiveActivityJobState;
};

type LiveActivityJobState = {
  /** Push-to-start sent (claimed transactionally — starts exactly once). */
  requestedAt?: FirebaseFirestore.Timestamp;
  /** Reported by the app once the activity exists; may never arrive. */
  activityId?: string;
  /** The activity's own APNs token — needed for update/end pushes. */
  updateToken?: string;
  /** Which APNs environment this device's tokens live in (learned on the
   *  first successful send — dev builds are sandbox, TestFlight is prod). */
  env?: LaEnv;
  /** Monotonic dedupe guard: a stage push is sent only if its ordinal
   *  strictly exceeds this (guards self-heal re-entry + async races). */
  lastStageSent?: number;
  /** Terminal push sent (claimed transactionally, like `pushSentAt`). */
  endedAt?: FirebaseFirestore.Timestamp;
};

function toView(jobId: string, d: JobDoc): ExtractionJobView {
  return {
    jobId,
    status: d.status,
    stage: d.stage,
    provider: d.provider,
    sourceUrl: d.sourceUrl,
    films: d.films,
    suggestedListName: d.suggestedListName ?? null,
    isFilmContent: d.isFilmContent,
    videoThumbnail: d.videoThumbnail ?? null,
    errorCode: (d.errorCode as ExtractionJobView['errorCode']) ?? null,
  };
}

// ── Public API (consumed by the route handlers) ──────────────────────────────

/**
 * Create (or cache-resolve) an extraction job for `rawUrl`. Throws
 * `BadRequestError('UNSUPPORTED_URL')` for non-social / malformed URLs.
 */
export async function createExtraction(
  uid: string,
  rawUrl: string,
): Promise<{ jobId: string; status: ExtractionStatus }> {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new BadRequestError('A video url is required.');
  }
  const canon = canonicalizeUrl(rawUrl);
  if (!canon || canon.provider === 'other') {
    // Only TikTok / Instagram / YouTube are supported.
    throw new BadRequestError('Only TikTok, Instagram, and YouTube links can be scanned for films.');
  }
  const { canonicalUrl, provider } = canon;
  const urlHash = hashUrl(canonicalUrl);
  const db = getDb();

  const cacheRef = db.collection(CACHE).doc(urlHash);

  // Cache hit → a job that's already done (copies the shared result). Free.
  const cached = (await cacheRef.get()).data() as CacheDoc | undefined;
  if (isFreshDone(cached)) {
    const ref = db.collection(JOBS).doc();
    await ref.set({
      uid, sourceUrl: rawUrl, canonicalUrl, urlHash, provider,
      status: 'done', stage: 'done',
      films: cached!.films ?? [],
      suggestedListName: cached!.suggestedListName ?? null,
      isFilmContent: cached!.isFilmContent ?? (cached!.films?.length ?? 0) > 0,
      videoThumbnail: cached!.videoThumbnail ?? null,
      fromCache: true,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      expiresAt: expireStamp(),
    });
    return { jobId: ref.id, status: 'done' };
  }

  // CACHE-STAMPEDE PREVENTION + WEEKLY QUOTA. Atomically claim this urlHash:
  // only the WINNER runs the (expensive) Apify+Gemini pipeline. Concurrent
  // scans of the SAME video become "followers" that resolve from the shared
  // cache once the winner fills it (see getExtraction) — collapsing 1000
  // simultaneous scans of one viral clip into a SINGLE pipeline run.
  // A claim is the ONLY path that costs money, so it's also the only path
  // metered against the caller's weekly quota — reject it BEFORE writing the
  // cache claim, so a quota-exhausted caller can never poison the urlHash for
  // someone else who still has budget.
  const privRef = db.collection('users_private').doc(uid);
  const decision = await db.runTransaction(async (tx) => {
    // Firestore transactions require every read before any write — read both
    // docs up front even though the quota one is only needed on the claim path.
    const [freshSnap, privSnap] = await Promise.all([tx.get(cacheRef), tx.get(privRef)]);
    const fresh = freshSnap.data() as CacheDoc | undefined;
    if (isFreshDone(fresh)) return 'follow'; // filled between our read + the tx
    if (claimLive(fresh)) return 'follow'; // someone else is already on it

    const priv = privSnap.data() as UsersPrivateDoc | undefined;
    const limit = weeklyLimitFor(priv?.plan ?? 'free');
    const week = currentWeekKey();
    const usage = priv?.scanUsage;
    const effectiveUsed = usage?.week === week ? (usage.used ?? 0) : 0;
    if (effectiveUsed >= limit) return 'quota';

    tx.set(cacheRef, { status: 'processing', startedAt: FieldValue.serverTimestamp(), canonicalUrl, provider, expiresAt: expireStamp() });
    tx.set(privRef, { scanUsage: { week, used: effectiveUsed + 1 } }, { merge: true });
    return 'claim';
  });
  if (decision === 'quota') throw new QuotaExceededError();

  const ref = db.collection(JOBS).doc();
  await ref.set({
    uid, sourceUrl: rawUrl, canonicalUrl, urlHash, provider,
    status: 'processing',
    stage: decision === 'claim' ? 'queued' : 'watching',
    follower: decision !== 'claim',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    expiresAt: expireStamp(),
  });

  if (decision === 'claim') {
    const kick = () =>
      runExtractionPipeline(ref.id).catch((err) => console.error('[extraction] pipeline crashed for', ref.id, err));
    try {
      after(kick); // Vercel keeps the (slow) pipeline alive after the response.
    } catch {
      // No request scope (tests). The emulator drives the pipeline explicitly;
      // a real runtime gets a last-resort detached kick.
      if (!process.env.FIRESTORE_EMULATOR_HOST) void kick();
    }
  }
  // Followers don't run a pipeline — they self-heal from the cache on poll.

  return { jobId: ref.id, status: 'processing' };
}

/** The caller's weekly scan quota — one read, no write (a stale week is
 *  resolved LOGICALLY here, same as the claim transaction; the counter only
 *  gets zeroed for real on that user's next claim). Backs
 *  `GET /api/v1/me/scan-quota`. */
export async function getScanQuota(uid: string): Promise<{
  limit: number;
  used: number;
  remaining: number;
  week: string;
  resetsAt: string;
}> {
  const db = getDb();
  const snap = await db.collection('users_private').doc(uid).get();
  const priv = snap.data() as UsersPrivateDoc | undefined;
  const limit = weeklyLimitFor(priv?.plan ?? 'free');
  const week = currentWeekKey();
  const usage = priv?.scanUsage;
  const used = usage?.week === week ? Math.max(0, usage.used ?? 0) : 0;
  return { limit, used, remaining: Math.max(0, limit - used), week, resetsAt: weekResetsAt() };
}

/** Read a job. 404 if missing, 403 if it isn't the caller's.
 *  Self-heals a still-`processing` job from the shared cache — this resolves
 *  FOLLOWERS (which never ran their own pipeline) and also a winner whose
 *  pipeline filled the cache but died before updating its own job (redundancy). */
export async function getExtraction(uid: string, jobId: string): Promise<ExtractionJobView> {
  const db = getDb();
  const ref = db.collection(JOBS).doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) throw new NotFoundError('Extraction not found.');
  const d = snap.data() as JobDoc;
  if (d.uid !== uid) throw new ForbiddenError();

  // Best-effort "someone is watching" signal for `sendExtractionCompletionPush`
  // — throttled off the doc data already in hand (no extra read), fire-and-
  // forget so a stamp failure can never affect this response.
  if (Date.now() - tsMillis(d.lastPolledAt) > POLL_STAMP_THROTTLE_MS) {
    ref.update({ lastPolledAt: FieldValue.serverTimestamp() }).catch(() => {});
  }

  if (d.status === 'processing' && d.urlHash) {
    const c = (await db.collection(CACHE).doc(d.urlHash).get()).data() as CacheDoc | undefined;
    if (isFreshDone(c)) {
      const patch = {
        status: 'done' as const,
        stage: 'done' as const,
        films: c!.films ?? [],
        suggestedListName: c!.suggestedListName ?? null,
        isFilmContent: c!.isFilmContent ?? (c!.films?.length ?? 0) > 0,
        videoThumbnail: c!.videoThumbnail ?? null,
        errorCode: null,
        updatedAt: FieldValue.serverTimestamp(),
      };
      await ref.update(patch).catch(() => {});
      return toView(jobId, { ...d, ...patch });
    }
    // Follower whose winner FAILED or died (claim stale, no result) → fail fast
    // instead of spinning out the rest of the claim window.
    if (d.follower && (c?.status === 'failed' || Date.now() - tsMillis(c?.startedAt) > CLAIM_TTL_MS)) {
      const patch = { status: 'failed' as const, stage: 'failed' as const, errorCode: 'FETCH_FAILED' as const, updatedAt: FieldValue.serverTimestamp() };
      await ref.update(patch).catch(() => {});
      return toView(jobId, { ...d, ...patch });
    }
  }
  return toView(jobId, d);
}

/** The owner's live surface (share-extension drawer / `/extract`) closed while
 *  the job was still running. Clearing `lastPolledAt` disarms the live-watcher
 *  suppression in `sendExtractionCompletionPush` — without this, a poll stamped
 *  seconds before the drawer closed keeps looking "watched" for the whole
 *  `LIVE_WATCH_WINDOW_MS`, and a pipeline finishing inside that window would
 *  stay silent for someone who explicitly walked away expecting the ping. */
export async function detachExtraction(uid: string, jobId: string): Promise<{ detached: boolean }> {
  const db = getDb();
  const ref = db.collection(JOBS).doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) throw new NotFoundError('Extraction not found.');
  if ((snap.data() as JobDoc).uid !== uid) throw new ForbiddenError();
  await ref.update({ lastPolledAt: FieldValue.delete() }).catch(() => {});
  return { detached: true };
}

// ── Live Activity (the lock-screen scan tracker — LIVE-ACTIVITY-PLAN.md) ─────
// The pipeline is the single driver: it starts the activity (push-to-start),
// narrates the stages, and resolves the card. The extension and app stay
// passive. Every send is claimed transactionally BEFORE it happens (start
// once, stage ordinals strictly increasing, end once) and every push carries
// the full card state, so at-most-once APNs delivery can never corrupt it.

/** Self-explaining breadcrumb: the LAST notable Live Activity event, written
 *  onto the job doc (fire-and-forget) so a silent lock screen is diagnosable
 *  from the doc alone — 'unconfigured', 'no_token', 'start:ok:sandbox',
 *  'start:fail:InvalidProviderToken', 'end:no_update_token', … */
function laTrace(ref: FirebaseFirestore.DocumentReference, event: string): void {
  ref.update({ 'liveActivity.trace': event }).catch(() => {});
}

/** queued 0 · fetching 1 · watching 2 · matching 3 · terminal 4. */
function stageOrdinal(stage: ExtractionStage): number {
  switch (stage) {
    case 'fetching': return 1;
    case 'watching': return 2;
    case 'matching': return 3;
    case 'done':
    case 'failed': return 4;
    default: return 0;
  }
}

/** Same copy the drawer narrates, so every surface tells one story. */
function stageCardLabel(stage: ExtractionStage): string {
  switch (stage) {
    case 'watching': return 'watching it';
    case 'matching': return 'matching films';
    default: return 'getting the video';
  }
}

const workingState = (ordinal: number, label: string): LaContentState =>
  ({ stage: ordinal, label, detail: null, state: 'working' });

/** The terminal card — headline + one detail line built from the outcome. */
function laEndStateFor(outcome: ExtractionPushOutcome): LaContentState {
  if (outcome.kind === 'failed') {
    return { stage: 4, label: 'that reel put up a fight', detail: 'tap to run it back', state: 'failed' };
  }
  if (outcome.kind === 'zero') {
    return { stage: 4, label: 'no films in this one', detail: 'just vibes, apparently', state: 'zero' };
  }
  const films = outcome.films;
  const first = films[0];
  const year = first?.year ? ` (${first.year})` : '';
  const imdb = first?.imdbRating ? ` · imdb ${first.imdbRating}` : '';
  const more = films.length > 1 ? ` and ${films.length - 1} more` : '';
  return {
    stage: 4,
    label: `${films.length} ${films.length === 1 ? 'film' : 'films'} found`,
    detail: first ? `${first.title}${year}${imdb}${more}` : null,
    state: 'done',
  };
}

/** Outcome as reconstructed from a finished job doc (the late-token flush). */
function outcomeFromJob(d: JobDoc): ExtractionPushOutcome {
  if (d.status === 'failed') return { kind: 'failed' };
  const films = d.films ?? [];
  if (!films.length) return { kind: 'zero' };
  return { kind: 'films', films: films.map((f) => ({ title: f.title, year: f.year, imdbRating: f.imdbRating })) };
}

/**
 * One mid-pipeline stage emit. First emit push-to-STARTS the activity (claim:
 * `requestedAt`); later emits ride the activity's update token IF the app has
 * reported it yet (the token handshake is eventually consistent — a missed
 * stage is fine, the next full-state push repairs it). Best-effort by design:
 * never throws, and a slow APNs is capped by the transport timeout so the
 * tracker can't stall the pipeline it decorates.
 *
 * Exported for direct testing of the claims (49-live-activity.test.ts).
 */
export async function emitScanActivity(
  db: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.DocumentReference,
  jobId: string,
  startToken: LaStartToken | null,
  ordinal: number,
  label: string,
): Promise<void> {
  if (!isLiveActivityConfigured() || !startToken) return;
  try {
    const decision = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { kind: 'skip' as const };
      const la = (snap.data() as JobDoc).liveActivity ?? {};
      if (la.endedAt) return { kind: 'skip' as const };
      if (!la.requestedAt) {
        tx.update(ref, {
          'liveActivity.requestedAt': FieldValue.serverTimestamp(),
          'liveActivity.lastStageSent': ordinal,
        });
        return { kind: 'start' as const };
      }
      if (la.updateToken && ordinal > (la.lastStageSent ?? 0)) {
        tx.update(ref, { 'liveActivity.lastStageSent': ordinal });
        return { kind: 'update' as const, token: la.updateToken, env: la.env ?? null };
      }
      return { kind: 'skip' as const };
    });

    if (decision.kind === 'start') {
      const res = await sendLiveActivityStart(startToken.token, startToken.env, jobId, workingState(ordinal, label));
      if (res.ok && res.env) {
        noteLiveActivityEnv(startToken.ref, res.env);
        ref.update({ 'liveActivity.env': res.env, 'liveActivity.trace': `start:ok:${res.env}` }).catch(() => {});
      } else if (res.unregistered) {
        pruneLiveActivityToken(startToken.ref);
        laTrace(ref, 'start:unregistered');
      } else {
        laTrace(ref, `start:fail:${res.reason ?? 'send'}`);
      }
    } else if (decision.kind === 'update') {
      const res = await sendLiveActivityUpdate(decision.token, decision.env, workingState(ordinal, label));
      if (!res.ok) laTrace(ref, `update${ordinal}:fail:${res.reason ?? 'send'}`);
    }
  } catch (err) {
    console.warn('[extraction] live-activity stage emit failed for', jobId, err);
  }
}

/**
 * `POST /extractions/[jobId]/live-activity-token` — the app observed the
 * activity (started by our push) mint its update token and reports it here.
 * Stores it, then FLUSHES the freshest state at it immediately: the token
 * usually lands seconds after push-to-start, i.e. after stages the activity
 * missed — and can even land after the job finished, in which case the card
 * is resolved right now instead of dangling "scanning" forever (read-repair).
 */
export async function attachExtractionLiveActivityToken(
  uid: string,
  jobId: string,
  activityId: unknown,
  token: unknown,
): Promise<{ attached: boolean }> {
  if (typeof token !== 'string' || !/^[0-9a-f]{32,512}$/i.test(token)) {
    throw new BadRequestError('Invalid token.');
  }
  const cleanActivityId = typeof activityId === 'string' ? activityId.slice(0, 128) : '';

  const db = getDb();
  const ref = db.collection(JOBS).doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) throw new NotFoundError('Extraction not found.');
  if ((snap.data() as JobDoc).uid !== uid) throw new ForbiddenError();

  type Flush =
    | { kind: 'none' }
    | { kind: 'end'; env: LaEnv | null; state: LaContentState }
    | { kind: 'update'; env: LaEnv | null; state: LaContentState };

  const flush = await db.runTransaction<Flush>(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return { kind: 'none' };
    const d = s.data() as JobDoc;
    const la = d.liveActivity ?? {};
    const updates: Record<string, FieldValue | string | number> = {
      'liveActivity.updateToken': token,
      'liveActivity.activityId': cleanActivityId || FieldValue.delete(),
    };
    const env = la.env ?? null;
    const terminal = d.status === 'done' || d.status === 'failed';
    if (terminal && !la.endedAt) {
      updates['liveActivity.endedAt'] = FieldValue.serverTimestamp();
      tx.update(ref, updates);
      return { kind: 'end', env, state: laEndStateFor(outcomeFromJob(d)) };
    }
    const ordinal = stageOrdinal(d.stage);
    if (!terminal && ordinal > (la.lastStageSent ?? 0)) {
      updates['liveActivity.lastStageSent'] = ordinal;
      tx.update(ref, updates);
      return { kind: 'update', env, state: workingState(ordinal, stageCardLabel(d.stage)) };
    }
    tx.update(ref, updates);
    return { kind: 'none' };
  });

  if (isLiveActivityConfigured()) {
    if (flush.kind === 'end') await sendLiveActivityEnd(token, flush.env, flush.state);
    else if (flush.kind === 'update') await sendLiveActivityUpdate(token, flush.env, flush.state);
  }
  return { attached: true };
}

// ── Save (C.1d) — confirmed films → lists ────────────────────────────────────

const MAX_SAVE_ITEMS = 25;
const MAX_NEW_LISTS = 5;

type SaveTarget = { tempId?: string; ownerId?: string; listId?: string };
type SaveItem = { tmdbId: number; mediaType: 'movie' | 'tv'; target: SaveTarget };
export type SaveExtractionBody = {
  createLists?: { tempId: string; name: string }[];
  items?: SaveItem[];
};
type SaveItemResult = {
  tmdbId: number;
  ok: boolean;
  listId?: string;
  deduped?: boolean;
  error?: 'not_in_extraction' | 'list_not_created' | 'no_target' | 'forbidden' | 'failed';
};
export type SaveExtractionResult = {
  results: SaveItemResult[];
  createdLists: Record<string, string>; // tempId → real listId
};

function toSearchResult(f: ExtractionFilm): SearchResult {
  return {
    id: String(f.tmdbId),
    tmdbId: f.tmdbId,
    title: f.title,
    year: f.year ?? '',
    posterUrl: f.posterUrl ?? '',
    posterHint: '',
    mediaType: f.mediaType,
    overview: '',
  };
}

/**
 * Save confirmed films from a DONE extraction into lists. Robust by design:
 *  - auth: job must be the caller's + `done`;
 *  - integrity: films are resolved from THIS job's grounded results only (never
 *    trust client-supplied movie data) — so you can't inject arbitrary movies;
 *  - authorization: every write goes through `addMovieToList` → `canEditList`,
 *    so a forged `target` at someone else's list fails that ITEM (403) while the
 *    rest proceed;
 *  - idempotent: `addMovieToList` dedupes (re-saving returns `deduped: true`);
 *  - isolated + bounded: per-item try/catch, ≤25 items, ≤5 new lists, sequential
 *    (no movieCount transaction contention) → partial success is first-class.
 */
export async function saveExtraction(
  uid: string,
  jobId: string,
  body: SaveExtractionBody,
): Promise<SaveExtractionResult> {
  const db = getDb();
  const snap = await db.collection(JOBS).doc(jobId).get();
  if (!snap.exists) throw new NotFoundError('Extraction not found.');
  const job = snap.data() as JobDoc;
  if (job.uid !== uid) throw new ForbiddenError();
  if (job.status !== 'done') throw new BadRequestError('This extraction isn’t ready to save yet.');

  const createLists = Array.isArray(body?.createLists) ? body.createLists.slice(0, MAX_NEW_LISTS) : [];
  const items = Array.isArray(body?.items) ? body.items.slice(0, MAX_SAVE_ITEMS) : [];
  if (!items.length) throw new BadRequestError('No films to save.');

  // Canonical films from THIS job only.
  const filmMap = new Map<string, ExtractionFilm>();
  for (const f of job.films ?? []) filmMap.set(`${f.mediaType}_${f.tmdbId}`, f);

  // Create the caller's new lists first; map tempId → real listId.
  const createdLists: Record<string, string> = {};
  for (const cl of createLists) {
    const name = typeof cl?.name === 'string' ? cl.name.trim() : '';
    if (!cl?.tempId || !name) continue;
    if (createdLists[cl.tempId]) continue; // dedup tempIds
    try {
      const { listId } = await createList(uid, name);
      createdLists[cl.tempId] = listId;
    } catch {
      /* leave unmapped — items targeting it fail with list_not_created */
    }
  }

  const results: SaveItemResult[] = [];
  for (const item of items) {
    const tmdbId = Number(item?.tmdbId);
    const mediaType: 'movie' | 'tv' = item?.mediaType === 'tv' ? 'tv' : 'movie';
    const film = filmMap.get(`${mediaType}_${tmdbId}`);
    if (!film) {
      results.push({ tmdbId, ok: false, error: 'not_in_extraction' });
      continue;
    }

    // Resolve the destination list.
    const t = item?.target ?? {};
    let ownerId: string | undefined;
    let listId: string | undefined;
    if (t.tempId) {
      listId = createdLists[t.tempId];
      ownerId = uid;
      if (!listId) { results.push({ tmdbId, ok: false, error: 'list_not_created' }); continue; }
    } else if (typeof t.ownerId === 'string' && typeof t.listId === 'string') {
      ownerId = t.ownerId;
      listId = t.listId;
    } else {
      results.push({ tmdbId, ok: false, error: 'no_target' });
      continue;
    }

    try {
      const { isNew } = await addMovieToList(uid, ownerId, listId, {
        movieData: toSearchResult(film),
        socialLink: job.canonicalUrl, // the video that surfaced it plays on the card later
        socialThumbnail: job.videoThumbnail || undefined, // its poster frame for the card preview
        status: 'To Watch',
      });
      results.push({ tmdbId, ok: true, listId, deduped: !isNew });
    } catch (err) {
      results.push({
        tmdbId,
        ok: false,
        listId,
        error: err instanceof ListAccessDeniedError ? 'forbidden' : 'failed',
      });
    }
  }

  return { results, createdLists };
}

// ── The pipeline ─────────────────────────────────────────────────────────────

/**
 * Use the REAL pipeline only when Gemini is configured AND we're not in the test
 * emulator. Tests + any environment without a key fall back to fixtures, so the
 * audit suite stays green and the feature degrades cleanly until keys are set.
 */
function shouldUseRealPipeline(): boolean {
  return isGeminiConfigured() && !process.env.FIRESTORE_EMULATOR_HOST;
}

export async function runExtractionPipeline(jobId: string): Promise<void> {
  return shouldUseRealPipeline() ? runRealPipeline(jobId) : runStubPipeline(jobId);
}

async function setStage(
  ref: FirebaseFirestore.DocumentReference,
  stage: ExtractionStage,
): Promise<void> {
  await ref.update({ stage, updatedAt: FieldValue.serverTimestamp() });
}

async function finishJob(
  db: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.DocumentReference,
  job: JobDoc,
  films: ExtractionFilm[],
  suggestedListName: string | null,
  analyzedBy: string,
  videoThumbnail: string | null = null,
): Promise<void> {
  const isFilmContent = films.length > 0;
  await db.collection(CACHE).doc(job.urlHash).set({
    status: 'done', // followers resolve from this
    canonicalUrl: job.canonicalUrl,
    provider: job.provider,
    films,
    suggestedListName: films.length ? suggestedListName : null,
    isFilmContent,
    videoThumbnail: videoThumbnail ?? null,
    analyzedBy,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: expireStamp(),
  });
  await ref.update({
    status: 'done',
    stage: 'done',
    films,
    suggestedListName: films.length ? suggestedListName : null,
    isFilmContent,
    videoThumbnail: videoThumbnail ?? null,
    analyzedBy, // model|mode — makes a bad extraction diagnosable from its doc
    errorCode: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Best-effort poster frame for the source clip, captured at pipeline time so it's
 * persisted with the result (and re-used by every cache follower):
 *   - YouTube → the permanent public thumbnail derived from the video id.
 *   - IG/TikTok → the Apify-provided cover, RE-HOSTED to R2 so it doesn't expire
 *     (their CDN urls are signed + short-lived). If R2 isn't configured or the
 *     rehost fails, fall back to the raw url (still better than nothing short-term).
 * Always resolves (never throws) — a missing thumbnail just shows a branded
 * placeholder on the card.
 */
async function captureThumbnail(job: JobDoc, video: AcquiredVideo): Promise<string | null> {
  try {
    if (job.provider === 'youtube') {
      const vid = parseVideoUrl(job.canonicalUrl)?.videoId;
      return vid ? youTubeThumbnail(vid) : null;
    }
    // Both downloadable videos AND image posts (carousel/slideshow — first
    // slide) carry a thumbnail; only the youtube kind doesn't need one.
    if (video.kind === 'youtube' || !video.thumbnailUrl) return null;
    const key = `extraction-thumbs/${job.urlHash}.jpg`;
    const rehosted = await rehostImageToR2(video.thumbnailUrl, key);
    return rehosted || video.thumbnailUrl;
  } catch {
    return null;
  }
}

// ── Confidence escalation (accuracy over cost, but only when it matters) ─────

/** The pro-tier retry model — a ROLLING alias by default so it can never be
 *  retired out from under us. `GEMINI_MODEL_ESCALATION=0` disables. */
function escalationModel(): string | null {
  const v = (process.env.GEMINI_MODEL_ESCALATION || '').trim();
  if (v === '0' || v.toLowerCase() === 'off') return null;
  return v || 'gemini-pro-latest';
}

const maxConfidence = (a: GeminiAnalysis): number =>
  a.films.length ? Math.max(...a.films.map((f) => f.confidence)) : 0;

/** A result worth paying pro prices to double-check: the model SAW the media
 *  (never caption-only — there's no extra signal to extract from prose) and
 *  either returned nothing despite a filmy caption, or only shaky guesses. */
function analysisIsWeak(a: GeminiAnalysis, caption: string | null): boolean {
  if (a.mode === 'caption-only') return false;
  if (a.films.length) return maxConfidence(a) < 0.6;
  const c = caption ?? '';
  return /movie|film|series|show|watch|cinema|kdrama|anime|netflix|imdb/i.test(c) || captionCandidates(c).length > 0;
}

/** Escalation must never push a scan past the drawer's poll budget (~3 min)
 *  or the cache claim TTL — past this point a weak answer NOW beats a
 *  perfect answer after the surfaces gave up. */
const ESCALATION_TIME_BUDGET_MS = 75 * 1000;

/** One pro-tier retry for weak results. Best-effort: any failure keeps the
 *  original answer; the pro answer wins only when it's strictly better. */
async function escalateWeakAnalysis(
  video: AcquiredVideo,
  analysis: GeminiAnalysis,
  elapsedMs: number,
): Promise<GeminiAnalysis> {
  if (!analysisIsWeak(analysis, video.caption)) return analysis;
  if (elapsedMs > ESCALATION_TIME_BUDGET_MS) {
    console.info('[extraction] escalation skipped — pipeline already slow', Math.round(elapsedMs / 1000), 's');
    return analysis;
  }
  const pro = escalationModel();
  if (!pro || pro === analysis.model) return analysis;
  try {
    const better = await analyzeForFilms(video, pro);
    if (better.films.length && (!analysis.films.length || maxConfidence(better) > maxConfidence(analysis))) {
      console.info(`[extraction] escalation improved a weak read: ${analysis.model} → ${pro}`);
      return better;
    }
  } catch (err) {
    console.warn('[extraction] escalation failed (kept the original answer):', err);
  }
  return analysis;
}

async function failJob(
  ref: FirebaseFirestore.DocumentReference,
  code: ExtractionErrorCode,
): Promise<void> {
  await ref.update({
    status: 'failed',
    stage: 'failed',
    errorCode: code,
    updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => {});
}

function classifyError(err: unknown): ExtractionErrorCode {
  const m = String((err as Error)?.message || '').toLowerCase();
  if (m.includes('gemini')) return 'ANALYSIS_FAILED';
  if (m.includes('apify') || m.includes('acquire')) return 'FETCH_FAILED';
  return 'INTERNAL';
}

/** Mark the shared claim failed so FOLLOWERS fail fast; stays re-claimable after
 *  CLAIM_TTL_MS (a later scan of the same video can try again). */
async function markCacheFailed(db: FirebaseFirestore.Firestore, job: JobDoc): Promise<void> {
  await db.collection(CACHE).doc(job.urlHash).set({
    status: 'failed',
    startedAt: FieldValue.serverTimestamp(),
    canonicalUrl: job.canonicalUrl,
    provider: job.provider,
  }).catch(() => {});
}

/**
 * Fire the ONE "films found" completion push — called only from
 * `runRealPipeline` (never `runStubPipeline`, so tests and any environment
 * without `GEMINI_API_KEY` never send it). Guarded by a check-and-set
 * `pushSentAt` field on the job doc, claimed transactionally, so the
 * pipeline's self-healing re-entry (see `getExtraction`'s cache patch-back)
 * or any future retry can never fire it twice for the same job.
 *
 * The SAME transaction snapshot also reads `lastPolledAt` (stamped by
 * `getExtraction` on every owner poll): if the owner polled within
 * `LIVE_WATCH_WINDOW_MS`, they're actively watching a live surface (the
 * share-extension drawer or the `/extract` screen, both poll every few
 * seconds) — `pushSentAt` is still claimed (so no later re-entry can send),
 * but the actual push is skipped since a simultaneous ding would be noise.
 *
 * Best-effort: never throws — a push failure must never fail an otherwise-
 * successful extraction. Awaited (not fire-and-forget) by the caller: this
 * runs inside `after()`, already detached from the HTTP response, so there's
 * no latency to protect — and awaiting avoids the run's execution context
 * tearing down mid-send on a fire-and-forgotten promise.
 *
 * Fires for EVERY terminal outcome — films found, zero films, or a failed
 * pipeline — so someone who closed the drawer mid-scan always gets closure
 * (the original films-only ping made failures look like the app went silent).
 *
 * Returns a result string (rather than void) so the idempotency guard and the
 * watched-suppression are directly testable without mocking `sendPushToUser`:
 *   - 'sent'              — claimed, and a delivery attempt was made.
 *   - 'skipped_watched'   — claimed (blocks any later re-entry), but no send:
 *                           the owner is actively polling a live surface.
 *   - 'skipped_duplicate' — `pushSentAt` was already set, so nothing was
 *                           (re-)claimed; also the defensive fallback if the
 *                           claim transaction itself errors.
 * The caller in `runRealPipeline` ignores the return value.
 *
 * Exported for direct testing of the idempotency + watched-suppression guards
 * (see `44-extractions-auth.test.ts`).
 */
export type ExtractionPushOutcome =
  | { kind: 'films'; films: Array<{ title: string; year?: string | null; imdbRating?: string | null }> }
  | { kind: 'zero' }
  | { kind: 'failed' };

/** Notification copy — brand voice (lowercase, no emoji, no em/en dashes),
 *  detailed enough to be worth a lock screen: names the films, carries the
 *  IMDb score when we have it. Several voices per outcome, picked
 *  deterministically per job — the same scan always says the same thing,
 *  but across scans the app never repeats itself (variable reward). */
function pushBodyFor(outcome: ExtractionPushOutcome, seed: string): string {
  const pick = <T>(options: T[]): T =>
    options[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % options.length];

  if (outcome.kind === 'failed') {
    return pick([
      'that reel put up a fight. tap to run it back.',
      'that reel would not cooperate. one tap runs it back.',
      'the scan tripped on that one. tap to give it another go.',
    ]);
  }
  if (outcome.kind === 'zero') {
    return pick([
      'we watched your reel twice. no films in this one, just vibes.',
      'we watched it so you did not have to. no films, just vibes.',
      'scanned it twice. that one is films free.',
    ]);
  }
  const films = outcome.films;
  if (films.length === 1) {
    const f = films[0];
    const year = f.year ? ` (${f.year})` : '';
    const imdb = f.imdbRating ? `. imdb ${f.imdbRating}` : '';
    return pick([
      `your reel was hiding ${f.title}${year}${imdb}. tap to shelve it.`,
      `found it. ${f.title}${year}${imdb}. give it a home?`,
      `one reel, one gem. ${f.title}${year}${imdb}. tap to save it.`,
    ]);
  }
  if (films.length === 2) {
    return pick([
      `your reel name-dropped ${films[0].title} and ${films[1].title}. tap to sort them into lists.`,
      `${films[0].title} and ${films[1].title}, both bagged from one reel. tap to file them.`,
    ]);
  }
  if (films.length === 3) {
    return pick([
      `${films[0].title}, ${films[1].title} and ${films[2].title} were all in that reel. tap to sort them.`,
      `three for three. ${films[0].title}, ${films[1].title} and ${films[2].title}. tap to sort them.`,
    ]);
  }
  return pick([
    `${films.length} films hiding in one reel. we caught every one. tap to pick your keepers.`,
    `a whole watchlist in one reel. ${films.length} films caught. come pick your keepers.`,
  ]);
}

export async function sendExtractionCompletionPush(
  db: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.DocumentReference,
  jobId: string,
  uid: string,
  outcome: ExtractionPushOutcome,
): Promise<'sent' | 'skipped_watched' | 'skipped_duplicate' | 'skipped_live_activity'> {
  let claim: 'duplicate' | 'watched' | 'claimed';
  let laToken: string | null = null;
  let laEnv: LaEnv | null = null;
  let laRequested = false;
  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() as JobDoc | undefined;
      if (!snap.exists || data?.pushSentAt) return { claim: 'duplicate' as const };
      const watched = Date.now() - tsMillis(data?.lastPolledAt) < LIVE_WATCH_WINDOW_MS;
      // Claim either way — a live watcher still blocks any later re-entry.
      const updates: Record<string, FieldValue | string | number> = { pushSentAt: FieldValue.serverTimestamp() };
      // A confirmed Live Activity resolves in the SAME claim: the terminal
      // state rides the card (end push below), exactly once.
      const la = data?.liveActivity;
      const token = la?.updateToken && !la.endedAt ? la.updateToken : null;
      if (token) updates['liveActivity.endedAt'] = FieldValue.serverTimestamp();
      tx.update(ref, updates);
      return {
        claim: watched ? ('watched' as const) : ('claimed' as const),
        token,
        env: la?.env ?? null,
        requested: Boolean(la?.requestedAt),
      };
    });
    claim = result.claim;
    laToken = 'token' in result ? result.token ?? null : null;
    laEnv = 'env' in result ? result.env ?? null : null;
    laRequested = 'requested' in result ? Boolean(result.requested) : false;
  } catch (err) {
    console.error('[extraction] completion push claim failed for', jobId, err);
    return 'skipped_duplicate'; // defensive — this function must never throw
  }
  if (claim === 'duplicate') return 'skipped_duplicate'; // already sent — re-entry, never fire twice

  // Resolve the lock-screen card regardless of watched state — a card left
  // saying "scanning" forever would be a lie. If the end push lands, it IS
  // the notification: the result sits on the lock screen, so the FCM ding
  // on top of it would be noise.
  let cardResolved = false;
  if (laToken && isLiveActivityConfigured()) {
    try {
      const endResult = await sendLiveActivityEnd(laToken, laEnv, laEndStateFor(outcome));
      cardResolved = endResult.ok;
      laTrace(ref, endResult.ok ? 'end:ok' : `end:fail:${endResult.reason ?? 'send'}`);
    } catch (err) {
      console.warn('[extraction] live-activity end failed for', jobId, err);
    }
  } else if (laRequested) {
    // The start push went out but the app never reported the activity's
    // update token — the handshake never completed. Name it.
    laTrace(ref, 'end:no_update_token');
  }

  if (claim === 'watched') return 'skipped_watched'; // live surface is polling — a ding here is noise
  if (cardResolved) return 'skipped_live_activity'; // the card carries the result

  try {
    await sendPushToUser(uid, {
      title: 'cinechrony',
      body: pushBodyFor(outcome, jobId),
      data: {
        type: outcome.kind === 'failed' ? 'extraction_failed' : 'extraction_done',
        jobId,
        url: `/extract?jobId=${jobId}`,
      },
    });
  } catch (err) {
    console.error('[extraction] completion push send failed for', jobId, err);
  }
  return 'sent';
}

/** REAL pipeline: Apify acquire → Gemini watch → TMDB ground (match-or-drop). */
async function runRealPipeline(jobId: string): Promise<void> {
  const db = getDb();
  const ref = db.collection(JOBS).doc(jobId);
  let job: JobDoc | null = null;
  const pipelineStartedAt = Date.now();
  try {
    const snap = await ref.get();
    if (!snap.exists) return;
    job = snap.data() as JobDoc;

    // One lookup per pipeline: the owner's freshest push-to-start token.
    // Null (feature unconfigured / app never registered) disables every emit.
    const laStart = await getLiveActivityStartToken(db, job.uid);
    if (!isLiveActivityConfigured()) laTrace(ref, 'unconfigured');
    else if (!laStart) laTrace(ref, 'no_token');

    await setStage(ref, 'fetching');
    await emitScanActivity(db, ref, jobId, laStart, 1, 'getting the video');
    const video = await acquireVideo(job.canonicalUrl, job.provider);
    if (!video) {
      await failJob(ref, 'FETCH_FAILED');
      await markCacheFailed(db, job);
      await sendExtractionCompletionPush(db, ref, jobId, job.uid, { kind: 'failed' });
      return;
    }

    await setStage(ref, 'watching');
    await emitScanActivity(db, ref, jobId, laStart, 2, 'watching it');
    let analysis: GeminiAnalysis;
    try {
      analysis = await analyzeForFilms(video);
    } catch (err) {
      // Every Gemini model was unavailable. If we captured a caption, degrade to
      // caption-mined candidates (TMDB grounding filters junk) rather than fail.
      const cands = video.caption ? captionCandidates(video.caption) : [];
      if (!cands.length) throw err;
      console.warn('[extraction] gemini unavailable — caption fallback,', cands.length, 'candidate(s)');
      analysis = { isFilmContent: true, suggestedListName: null, films: cands, model: 'caption-net', mode: 'caption-only' };
    }
    // Weak read (nothing found on filmy media, or footage-guess confidence
    // only)? One pro-tier second opinion — pro prices paid ONLY on hard cases.
    analysis = await escalateWeakAnalysis(video, analysis, Date.now() - pipelineStartedAt);

    await setStage(ref, 'matching');
    await emitScanActivity(db, ref, jobId, laStart, 3, 'matching films');
    // Ground the films + capture the clip's poster frame concurrently.
    const [films, videoThumbnail] = await Promise.all([
      groundFilms(analysis.films),
      captureThumbnail(job, video),
    ]);

    const analyzedBy = `${analysis.model ?? 'unknown'}|${analysis.mode ?? 'unknown'}`;
    await finishJob(db, ref, job, films, analysis.suggestedListName, analyzedBy, videoThumbnail);
    await sendExtractionCompletionPush(
      db, ref, jobId, job.uid,
      films.length
        ? { kind: 'films', films: films.map((f) => ({ title: f.title, year: f.year, imdbRating: f.imdbRating })) }
        : { kind: 'zero' },
    );
  } catch (err) {
    console.error('[extraction] real pipeline failed for', jobId, err);
    await failJob(ref, classifyError(err));
    if (job) {
      await markCacheFailed(db, job);
      await sendExtractionCompletionPush(db, ref, jobId, job.uid, { kind: 'failed' });
    }
  }
}

// ── TMDB grounding (every candidate must match TMDB or it's dropped) ──────────

// Read at call time (not module load) — robust to env that arrives after import.
const tmdbToken = () => process.env.TMDB_ACCESS_TOKEN || process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN || '';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';

/** Gemini candidates below this confidence are dropped BEFORE grounding — they're
 *  the low-evidence guesses that cause false positives ("one film read as three").
 *  Tunable via EXTRACTION_CONFIDENCE_MIN; default 0.45 (drops clear junk, keeps
 *  honest footage-only guesses for the user to confirm). */
const confidenceFloor = (): number => {
  const v = Number(process.env.EXTRACTION_CONFIDENCE_MIN);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.45;
};

const normTitle = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

function titleBigrams(s: string): Set<string> {
  const t = s.replace(/\s+/g, '');
  const set = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

function diceOf(na: string, nb: string): number {
  const ba = titleBigrams(na);
  const bb = titleBigrams(nb);
  if (!ba.size || !bb.size) return 0;
  let inter = 0;
  for (const g of ba) if (bb.has(g)) inter++;
  return (2 * inter) / (ba.size + bb.size);
}

const stripArticle = (s: string) => s.replace(/^(the|a|an) /, '');

/** Best title-affinity tier between any candidate title (common + original) and
 *  any result title (localized + original):
 *    100 — exact match, leading articles ignored ("Dark Knight" = "The Dark Knight")
 *     85 — near-identical (Dice ≥ 0.8: punctuation/spacing variants)
 *     30 — merely similar (substring or Dice ≥ 0.55) — needs corroboration
 *      0 — unrelated.
 *  The tiers are the fix for the "Party (1984)" class of miss: a substring hit
 *  ("Party" ⊂ "Bachelor Party") must never outrank an exact-title hit that sits
 *  lower in TMDB's popularity ordering. */
function titleCloseness(cands: Array<string | null | undefined>, results: Array<string | null | undefined>): number {
  let best = 0;
  for (const c of cands) {
    const nc = c ? normTitle(c) : '';
    if (!nc) continue;
    for (const r of results) {
      const nr = r ? normTitle(r) : '';
      if (!nr) continue;
      if (nc === nr || stripArticle(nc) === stripArticle(nr)) return 100;
      const dice = diceOf(nc, nr);
      if (dice >= 0.8) best = Math.max(best, 85);
      else if (dice >= 0.55 || nc.includes(nr) || nr.includes(nc)) best = Math.max(best, 30);
    }
  }
  return best;
}

const EVIDENCE_CHANNELS = ['audio', 'on-screen', 'caption', 'footage', 'other'] as const;
type EvidenceChannel = (typeof EVIDENCE_CHANNELS)[number];
function normalizeEvidence(e: RawFilmCandidate['evidence']): ExtractionFilm['evidence'] {
  if (!e) return null;
  const channel = (EVIDENCE_CHANNELS as readonly string[]).includes(e.channel)
    ? (e.channel as EvidenceChannel)
    : 'other';
  return { channel, quote: e.quote, timestampSec: e.timestampSec };
}

export async function groundFilms(candidates: RawFilmCandidate[]): Promise<ExtractionFilm[]> {
  if (!candidates.length || !tmdbToken()) return [];
  // Drop low-confidence guesses + de-dup before searching (Gemini sometimes
  // repeats a title or floats a low-evidence guess that bloats the result).
  const floor = confidenceFloor();
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if ((c.confidence ?? 0) < floor) return false;
    const k = `${c.title.toLowerCase()}|${c.year ?? ''}|${c.mediaType}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const grounded = await Promise.all(unique.map(groundOne));
  // Drop misses, dedup by tmdbId keeping the highest confidence.
  const byId = new Map<number, ExtractionFilm>();
  for (const f of grounded) {
    if (!f) continue;
    const ex = byId.get(f.tmdbId);
    if (!ex || f.confidence > ex.confidence) byId.set(f.tmdbId, f);
  }
  return [...byId.values()];
}

type TmdbSearchResult = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  original_language?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  popularity?: number;
};

/** Accept floor for the scored match. Tier math: exact title alone (100)
 *  passes; similar + exact year (55) passes; similar + language match (55)
 *  passes; similar + year-off-by-one (42) passes; a bare substring hit (30)
 *  or one contradicted by the year (30 + 25 − 40 = 15) does not. */
const GROUND_ACCEPT_MIN = 40;

async function groundOne(c: RawFilmCandidate): Promise<ExtractionFilm | null> {
  try {
    const path = c.mediaType === 'tv' ? 'tv' : 'movie';
    const search = async (withYear: boolean): Promise<TmdbSearchResult[]> => {
      const yearParam = withYear && c.year ? `&${path === 'tv' ? 'first_air_date_year' : 'year'}=${c.year}` : '';
      const url = `https://api.themoviedb.org/3/search/${path}?query=${encodeURIComponent(c.title)}${yearParam}&include_adult=false&language=en-US&page=1`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${tmdbToken()}` } });
      if (!res.ok) return [];
      const j = (await res.json()) as { results?: TmdbSearchResult[] };
      return j.results || [];
    };
    // Gemini's year can be off (festival vs release year) — if the year-filtered
    // search comes up dry, retry unfiltered and let the scorer weigh the year.
    let results = await search(true);
    if (!results.length && c.year) results = await search(false);
    if (!results.length) return null;

    // Score EVERY hit, take the best above the floor — never "first that passes".
    // TMDB orders by popularity, which is exactly wrong for foreign films that
    // share a title+year with a popular hit ("Party" 1984 hi vs "Bachelor Party"
    // 1984 en). Exact titles dominate; year and original-language corroborate;
    // popularity is only a whisper of a tiebreak.
    let best: TmdbSearchResult | null = null;
    let bestScore = -Infinity;
    for (const r of results) {
      const closeness = titleCloseness(
        [c.title, c.originalTitle],
        [r.title ?? r.name, r.original_title ?? r.original_name],
      );
      if (!closeness) continue; // the title must resemble — a year alone is never enough
      let score = closeness;
      const rYear = (r.release_date || r.first_air_date || '').slice(0, 4);
      if (c.year && rYear) {
        const dy = Math.abs(Number(rYear) - Number(c.year));
        score += dy === 0 ? 25 : dy === 1 ? 12 : -40;
      }
      if (c.originalLanguage && r.original_language === c.originalLanguage) score += 25;
      score += Math.min(r.popularity ?? 0, 10) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (!best || bestScore < GROUND_ACCEPT_MIN) return null;
    const date = best.release_date || best.first_air_date || '';
    // IMDb rating is best-effort (OMDB) — it must never block or fail grounding.
    const imdbRating = await imdbRatingFor(best.id, c.mediaType);
    return {
      tmdbId: best.id,
      title: best.title || best.name || c.title,
      year: date ? date.slice(0, 4) : c.year,
      mediaType: c.mediaType,
      posterUrl: best.poster_path ? `${TMDB_IMG}${best.poster_path}` : null,
      confidence: c.confidence,
      evidence: normalizeEvidence(c.evidence),
      imdbRating,
    };
  } catch {
    return null;
  }
}

// ── IMDb rating (TMDB external_ids → OMDB), best-effort + cached + bounded ─────

const OMDB_FETCH_TIMEOUT_MS = 4500;
const IMDB_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Process-local cache so repeat films across scans don't re-hit OMDB (whose
 *  free tier is 1k/day). The shared extraction_cache already dedupes per-video;
 *  this dedupes per-film across different videos in the same warm instance. */
const imdbCache = new Map<string, { rating: string | null; exp: number }>();

async function fetchJsonWithTimeout(url: string, headers?: Record<string, string>): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OMDB_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Resolve the IMDb rating for a TMDB id. Returns null on any miss/failure. */
async function imdbRatingFor(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<string | null> {
  const omdbKey = process.env.OMDB_API_KEY;
  const token = tmdbToken();
  if (!omdbKey || !token) return null;

  const cacheKey = `${mediaType}:${tmdbId}`;
  const hit = imdbCache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.rating;

  let rating: string | null = null;
  try {
    const path = mediaType === 'tv' ? 'tv' : 'movie';
    const ext = (await fetchJsonWithTimeout(
      `https://api.themoviedb.org/3/${path}/${tmdbId}/external_ids`,
      { Authorization: `Bearer ${token}` },
    )) as { imdb_id?: string } | null;
    const imdbId = ext?.imdb_id;
    if (imdbId) {
      const omdb = (await fetchJsonWithTimeout(
        `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${omdbKey}`,
      )) as { imdbRating?: string } | null;
      if (omdb?.imdbRating && omdb.imdbRating !== 'N/A') rating = omdb.imdbRating;
    }
  } catch {
    rating = null;
  }
  imdbCache.set(cacheKey, { rating, exp: Date.now() + IMDB_CACHE_TTL_MS });
  return rating;
}

// ── STUB pipeline (fixtures) — tests + before keys are configured ─────────────

async function runStubPipeline(jobId: string): Promise<void> {
  const db = getDb();
  const ref = db.collection(JOBS).doc(jobId);
  try {
    const snap = await ref.get();
    if (!snap.exists) return;
    const job = snap.data() as JobDoc;
    await setStage(ref, 'fetching');
    await setStage(ref, 'watching');
    await setStage(ref, 'matching');
    await finishJob(db, ref, job, FIXTURE_FILMS, 'crime classics', 'stub');
  } catch (err) {
    console.error('[extraction] stub pipeline failed for', jobId, err);
    await failJob(ref, 'INTERNAL');
  }
}

/** Real TMDB ids so the C.2 confirmation UI + the save endpoint can be exercised. */
const FIXTURE_FILMS: ExtractionFilm[] = [
  { tmdbId: 949, title: 'Heat', year: '1995', mediaType: 'movie', posterUrl: null, confidence: 0.95,
    evidence: { channel: 'on-screen', quote: '#3 HEAT', timestampSec: 34 } },
  { tmdbId: 769, title: 'GoodFellas', year: '1990', mediaType: 'movie', posterUrl: null, confidence: 0.9,
    evidence: { channel: 'audio', quote: 'as good as Goodfellas', timestampSec: 58 } },
  { tmdbId: 680, title: 'Pulp Fiction', year: '1994', mediaType: 'movie', posterUrl: null, confidence: 0.88,
    evidence: { channel: 'caption', quote: 'pulp fiction energy', timestampSec: null } },
];
