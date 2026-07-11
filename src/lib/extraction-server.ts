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
 */

import { createHash } from 'node:crypto';
import { after } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { BadRequestError, ForbiddenError, NotFoundError } from '@/lib/api-handler';
import { acquireVideo, type AcquiredVideo } from '@/lib/video-acquire-server';
import { analyzeForFilms, captionCandidates, isGeminiConfigured, type GeminiAnalysis, type RawFilmCandidate } from '@/lib/gemini-server';
import { addMovieToList, ListAccessDeniedError } from '@/lib/movies-server';
import { createList } from '@/lib/lists-server';
import { rehostImageToR2 } from '@/lib/r2-server';
import { sendPushToUser } from '@/lib/push-server';
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

/** The shared per-video cache doc — also the cache-stampede coordination point. */
type CacheDoc = {
  status?: 'processing' | 'done' | 'failed';
  films?: ExtractionFilm[];
  suggestedListName?: string | null;
  isFilmContent?: boolean;
  videoThumbnail?: string | null;
  canonicalUrl?: string;
  provider?: ExtractionProvider;
  startedAt?: FirebaseFirestore.Timestamp;
  createdAt?: FirebaseFirestore.Timestamp;
};
const tsMillis = (t?: FirebaseFirestore.Timestamp) => (t?.toMillis ? t.toMillis() : 0);
/** A usable DONE result (handles legacy docs written before the `status` field). */
function isFreshDone(c?: CacheDoc): boolean {
  if (!c) return false;
  const done = c.status === 'done' || (c.status === undefined && Array.isArray(c.films));
  return done && (!c.createdAt || Date.now() - tsMillis(c.createdAt) < CACHE_TTL_MS);
}
/** Someone is actively working this urlHash right now (claim not yet stale). */
function claimLive(c?: CacheDoc): boolean {
  return (c?.status === 'processing' || c?.status === 'failed') && Date.now() - tsMillis(c?.startedAt) < CLAIM_TTL_MS;
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
    });
    return { jobId: ref.id, status: 'done' };
  }

  // CACHE-STAMPEDE PREVENTION. Atomically claim this urlHash: only the WINNER
  // runs the (expensive) Apify+Gemini pipeline. Concurrent scans of the SAME
  // video become "followers" that resolve from the shared cache once the winner
  // fills it (see getExtraction) — collapsing 1000 simultaneous scans of one
  // viral clip into a SINGLE pipeline run.
  const decision = await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(cacheRef)).data() as CacheDoc | undefined;
    if (isFreshDone(fresh)) return 'follow'; // filled between our read + the tx
    if (claimLive(fresh)) return 'follow'; // someone else is already on it
    tx.set(cacheRef, { status: 'processing', startedAt: FieldValue.serverTimestamp(), canonicalUrl, provider });
    return 'claim';
  });

  const ref = db.collection(JOBS).doc();
  await ref.set({
    uid, sourceUrl: rawUrl, canonicalUrl, urlHash, provider,
    status: 'processing',
    stage: decision === 'claim' ? 'queued' : 'watching',
    follower: decision !== 'claim',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
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
    // Follower whose winner died (claim went stale with no result) → fail fast.
    if (d.follower && Date.now() - tsMillis(c?.startedAt) > CLAIM_TTL_MS) {
      const patch = { status: 'failed' as const, stage: 'failed' as const, errorCode: 'FETCH_FAILED' as const, updatedAt: FieldValue.serverTimestamp() };
      await ref.update(patch).catch(() => {});
      return toView(jobId, { ...d, ...patch });
    }
  }
  return toView(jobId, d);
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
  });
  await ref.update({
    status: 'done',
    stage: 'done',
    films,
    suggestedListName: films.length ? suggestedListName : null,
    isFilmContent,
    videoThumbnail: videoThumbnail ?? null,
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
    if (video.kind !== 'media' || !video.thumbnailUrl) return null;
    const key = `extraction-thumbs/${job.urlHash}.jpg`;
    const rehosted = await rehostImageToR2(video.thumbnailUrl, key);
    return rehosted || video.thumbnailUrl;
  } catch {
    return null;
  }
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
 * Best-effort: never throws — a push failure must never fail an otherwise-
 * successful extraction. Awaited (not fire-and-forget) by the caller: this
 * runs inside `after()`, already detached from the HTTP response, so there's
 * no latency to protect — and awaiting avoids the run's execution context
 * tearing down mid-send on a fire-and-forgotten promise.
 *
 * Exported for direct testing of the idempotency guard (see
 * `44-extractions-auth.test.ts`).
 */
export async function sendExtractionCompletionPush(
  db: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.DocumentReference,
  jobId: string,
  uid: string,
  filmCount: number,
): Promise<void> {
  if (filmCount < 1) return; // no push for zero-film results
  try {
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()?.pushSentAt) return false;
      tx.update(ref, { pushSentAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!claimed) return; // already sent — re-entry, never fire twice

    const body = filmCount === 1
      ? '1 film found in your reel. tap to pick lists.'
      : `${filmCount} films found in your reel. tap to pick lists.`;
    await sendPushToUser(uid, {
      title: 'cinechrony',
      body,
      data: { type: 'extraction_done', jobId, url: `/extract?jobId=${jobId}` },
    });
  } catch (err) {
    console.error('[extraction] completion push failed for', jobId, err);
  }
}

/** REAL pipeline: Apify acquire → Gemini watch → TMDB ground (match-or-drop). */
async function runRealPipeline(jobId: string): Promise<void> {
  const db = getDb();
  const ref = db.collection(JOBS).doc(jobId);
  let job: JobDoc | null = null;
  try {
    const snap = await ref.get();
    if (!snap.exists) return;
    job = snap.data() as JobDoc;

    await setStage(ref, 'fetching');
    const video = await acquireVideo(job.canonicalUrl, job.provider);
    if (!video) {
      await failJob(ref, 'FETCH_FAILED');
      await markCacheFailed(db, job);
      return;
    }

    await setStage(ref, 'watching');
    let analysis: GeminiAnalysis;
    try {
      analysis = await analyzeForFilms(video);
    } catch (err) {
      // Every Gemini model was unavailable. If we captured a caption, degrade to
      // caption-mined candidates (TMDB grounding filters junk) rather than fail.
      const cands = video.caption ? captionCandidates(video.caption) : [];
      if (!cands.length) throw err;
      console.warn('[extraction] gemini unavailable — caption fallback,', cands.length, 'candidate(s)');
      analysis = { isFilmContent: true, suggestedListName: null, films: cands };
    }

    await setStage(ref, 'matching');
    // Ground the films + capture the clip's poster frame concurrently.
    const [films, videoThumbnail] = await Promise.all([
      groundFilms(analysis.films),
      captureThumbnail(job, video),
    ]);

    await finishJob(db, ref, job, films, analysis.suggestedListName, 'gemini', videoThumbnail);
    await sendExtractionCompletionPush(db, ref, jobId, job.uid, films.length);
  } catch (err) {
    console.error('[extraction] real pipeline failed for', jobId, err);
    await failJob(ref, classifyError(err));
    if (job) await markCacheFailed(db, job);
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

/** Dice-coefficient + substring title match. Lenient enough for "the dark knight"
 *  vs "dark knight", strict enough to reject TMDB's popular-but-unrelated top hit
 *  (which it returns for almost any query) — so grounded hallucinations get dropped. */
function titleSimilar(a: string, b: string): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ba = titleBigrams(na);
  const bb = titleBigrams(nb);
  if (!ba.size || !bb.size) return false;
  let inter = 0;
  for (const g of ba) if (bb.has(g)) inter++;
  return (2 * inter) / (ba.size + bb.size) >= 0.55;
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

async function groundOne(c: RawFilmCandidate): Promise<ExtractionFilm | null> {
  try {
    const path = c.mediaType === 'tv' ? 'tv' : 'movie';
    const yearParam = c.year ? `&${path === 'tv' ? 'first_air_date_year' : 'year'}=${c.year}` : '';
    const url = `https://api.themoviedb.org/3/search/${path}?query=${encodeURIComponent(c.title)}${yearParam}&include_adult=false&language=en-US&page=1`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${tmdbToken()}` } });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      results?: Array<{ id: number; title?: string; name?: string; release_date?: string; first_air_date?: string; poster_path?: string | null }>;
    };
    const results = j.results || [];
    if (!results.length) return null;
    // Year match is strong corroboration — trust it. Otherwise only accept TMDB's
    // top hit if its title actually resembles the candidate (TMDB returns a popular
    // result for almost any string, so this rejects grounded hallucinations).
    const byYear = c.year
      ? results.find((r) => (r.release_date || r.first_air_date || '').startsWith(c.year!))
      : null;
    const best = byYear || (titleSimilar(c.title, results[0].title || results[0].name || '') ? results[0] : null);
    if (!best) return null;
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
