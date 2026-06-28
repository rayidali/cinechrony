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
import { acquireVideo } from '@/lib/video-acquire-server';
import { analyzeForFilms, isGeminiConfigured, type RawFilmCandidate } from '@/lib/gemini-server';
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

// ── The pipeline ─────────────────────────────────────────────────────────────

/**
 * Use the REAL pipeline only when Gemini is configured AND we're not in the test
 * emulator. Tests + any environment without a key fall back to fixtures, so the
 * audit suite stays green and the feature degrades cleanly until keys are set.
 */
function useRealPipeline(): boolean {
  return isGeminiConfigured() && !process.env.FIRESTORE_EMULATOR_HOST;
}

export async function runExtractionPipeline(jobId: string): Promise<void> {
  return useRealPipeline() ? runRealPipeline(jobId) : runStubPipeline(jobId);
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
): Promise<void> {
  const isFilmContent = films.length > 0;
  await db.collection(CACHE).doc(job.urlHash).set({
    canonicalUrl: job.canonicalUrl,
    provider: job.provider,
    films,
    suggestedListName: films.length ? suggestedListName : null,
    isFilmContent,
    analyzedBy,
    createdAt: FieldValue.serverTimestamp(),
  });
  await ref.update({
    status: 'done',
    stage: 'done',
    films,
    suggestedListName: films.length ? suggestedListName : null,
    isFilmContent,
    errorCode: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
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

/** REAL pipeline: Apify acquire → Gemini watch → TMDB ground (match-or-drop). */
async function runRealPipeline(jobId: string): Promise<void> {
  const db = getDb();
  const ref = db.collection(JOBS).doc(jobId);
  try {
    const snap = await ref.get();
    if (!snap.exists) return;
    const job = snap.data() as JobDoc;

    await setStage(ref, 'fetching');
    const video = await acquireVideo(job.canonicalUrl, job.provider);
    if (!video) {
      await failJob(ref, 'FETCH_FAILED');
      return;
    }

    await setStage(ref, 'watching');
    const analysis = await analyzeForFilms(video);

    await setStage(ref, 'matching');
    const films = await groundFilms(analysis.films);

    await finishJob(db, ref, job, films, analysis.suggestedListName, 'gemini');
  } catch (err) {
    console.error('[extraction] real pipeline failed for', jobId, err);
    await failJob(ref, classifyError(err));
  }
}

// ── TMDB grounding (every candidate must match TMDB or it's dropped) ──────────

// Read at call time (not module load) — robust to env that arrives after import.
const tmdbToken = () => process.env.TMDB_ACCESS_TOKEN || process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN || '';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';

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
  // De-dup candidates before searching (Gemini sometimes repeats a title).
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
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
    const best =
      (c.year ? results.find((r) => (r.release_date || r.first_air_date || '').startsWith(c.year!)) : null) ||
      results[0];
    const date = best.release_date || best.first_air_date || '';
    return {
      tmdbId: best.id,
      title: best.title || best.name || c.title,
      year: date ? date.slice(0, 4) : c.year,
      mediaType: c.mediaType,
      posterUrl: best.poster_path ? `${TMDB_IMG}${best.poster_path}` : null,
      confidence: c.confidence,
      evidence: normalizeEvidence(c.evidence),
    };
  } catch {
    return null;
  }
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
