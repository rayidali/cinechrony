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
import type {
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

  // Cache hit → create a job that's already done (copies the cached result).
  const cacheSnap = await db.collection(CACHE).doc(urlHash).get();
  if (cacheSnap.exists) {
    const c = cacheSnap.data() as {
      films?: ExtractionFilm[];
      suggestedListName?: string | null;
      isFilmContent?: boolean;
      createdAt?: FirebaseFirestore.Timestamp;
    };
    const fresh =
      !c.createdAt || Date.now() - c.createdAt.toMillis() < CACHE_TTL_MS;
    if (fresh) {
      const ref = db.collection(JOBS).doc();
      await ref.set({
        uid,
        sourceUrl: rawUrl,
        canonicalUrl,
        urlHash,
        provider,
        status: 'done',
        stage: 'done',
        films: c.films ?? [],
        suggestedListName: c.suggestedListName ?? null,
        isFilmContent: c.isFilmContent ?? (c.films?.length ?? 0) > 0,
        fromCache: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { jobId: ref.id, status: 'done' };
    }
  }

  // Miss → create a processing job, then run the pipeline after the response.
  const ref = db.collection(JOBS).doc();
  await ref.set({
    uid,
    sourceUrl: rawUrl,
    canonicalUrl,
    urlHash,
    provider,
    status: 'processing',
    stage: 'queued',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const kick = () =>
    runExtractionPipeline(ref.id).catch((err) => {
      console.error('[extraction] pipeline crashed for', ref.id, err);
    });
  try {
    // On Vercel this keeps the (slow, real) pipeline alive after the response.
    after(kick);
  } catch {
    // No request scope. Against the emulator (tests) we DON'T spawn detached
    // work — tests drive the pipeline explicitly; a write-storm here
    // destabilizes the suite. In a real runtime this is a last-resort net.
    if (!process.env.FIRESTORE_EMULATOR_HOST) void kick();
  }

  return { jobId: ref.id, status: 'processing' };
}

/** Read a job. 404 if missing, 403 if it isn't the caller's. */
export async function getExtraction(uid: string, jobId: string): Promise<ExtractionJobView> {
  const snap = await getDb().collection(JOBS).doc(jobId).get();
  if (!snap.exists) throw new NotFoundError('Extraction not found.');
  const d = snap.data() as JobDoc;
  if (d.uid !== uid) throw new ForbiddenError();
  return toView(jobId, d);
}

// ── The pipeline (STUBBED in C.1a) ───────────────────────────────────────────

/**
 * STUB: returns fixture films so the rest of the feature can be built/tested
 * without keys. C.1b/c replace the body with the real Apify → Gemini → TMDB
 * pipeline, driving `stage` through fetching → watching → matching → done and
 * writing the same `extraction_cache` shape.
 */
export async function runExtractionPipeline(jobId: string): Promise<void> {
  const db = getDb();
  const ref = db.collection(JOBS).doc(jobId);
  try {
    const snap = await ref.get();
    if (!snap.exists) return;
    const job = snap.data() as JobDoc;

    // Walk the stages so the narrated UI has something to show.
    await ref.update({ stage: 'fetching', updatedAt: FieldValue.serverTimestamp() });
    await ref.update({ stage: 'watching', updatedAt: FieldValue.serverTimestamp() });
    await ref.update({ stage: 'matching', updatedAt: FieldValue.serverTimestamp() });

    const films = FIXTURE_FILMS;
    const suggestedListName = 'crime classics';
    const isFilmContent = films.length > 0;

    // Persist results to the shared cache (no uid — results only).
    await db.collection(CACHE).doc(job.urlHash).set({
      canonicalUrl: job.canonicalUrl,
      provider: job.provider,
      films,
      suggestedListName,
      isFilmContent,
      analyzedBy: 'stub',
      createdAt: FieldValue.serverTimestamp(),
    });

    await ref.update({
      status: 'done',
      stage: 'done',
      films,
      suggestedListName,
      isFilmContent,
      errorCode: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[extraction] stub pipeline failed for', jobId, err);
    await ref.update({
      status: 'failed',
      stage: 'failed',
      errorCode: 'INTERNAL',
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
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
