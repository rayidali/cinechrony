/**
 * Phase C.1c — Gemini video analysis (the WATCH stage).
 *
 * Sends the acquired video to Gemini and gets back a structured list of every
 * film/TV show referenced — by spoken audio, on-screen text, the caption, OR
 * recognizable footage. REST only (no SDK dep).
 *
 *   YouTube  → `fileData.fileUri` (Gemini ingests the URL directly; no download)
 *   TikTok/IG→ inline base64 video (small clips; falls back to caption-only text
 *              extraction when the file is too big or absent)
 *
 * Output is forced to JSON via `responseSchema`. Candidates are NOT yet grounded
 * to TMDB — that's `groundFilms` in extraction-server (match-or-drop).
 */

import type { AcquiredVideo } from '@/lib/video-acquire-server';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.5-flash';
/** Rolling aliases Google re-points at the current generation — appended to
 *  EVERY chain (env-pinned or default) so a retired model id can degrade a
 *  scan's latency but never kill the pipeline outright. (The 2026-07 outage:
 *  the whole 2.x chain died at once — 2.5-flash/2.0-flash refusing traffic,
 *  2.5-flash-lite 404 "no longer available to new users".) */
const LAST_RESORT_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
const INLINE_VIDEO_MAX_BYTES = 18 * 1024 * 1024; // keep the request under Gemini's ~20MB inline cap
const VIDEO_FETCH_TIMEOUT_MS = 20_000;
const IMAGE_FETCH_TIMEOUT_MS = 12_000;
const INLINE_IMAGE_MAX_BYTES = 4 * 1024 * 1024; // per slide
const INLINE_IMAGES_TOTAL_BYTES = 16 * 1024 * 1024; // whole slideshow budget

/** A candidate film straight from Gemini — pre-TMDB-grounding. */
export type RawFilmCandidate = {
  title: string;
  year: string | null;
  mediaType: 'movie' | 'tv';
  confidence: number;
  evidence: { channel: string; quote: string; timestampSec: number | null } | null;
  /** ISO 639-1 guess at the film's original language ("hi", "ko", …) — lets
   *  TMDB grounding disambiguate same-title/same-year films across cinemas
   *  (the "Party (1984, hi)" vs "Bachelor Party (1984, en)" class of miss). */
  originalLanguage: string | null;
  /** Native-script or original-release title when it differs from `title`. */
  originalTitle: string | null;
};

export type GeminiAnalysis = {
  isFilmContent: boolean;
  suggestedListName: string | null;
  films: RawFilmCandidate[];
  /** Which model actually answered + whether it saw footage, slides, or the
   *  caption only — persisted (analyzedBy) so a bad extraction is diagnosable
   *  from its doc. */
  model?: string;
  mode?: 'video' | 'images' | 'caption-only';
};

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

const PROMPT = `You are analysing a short social post (a TikTok, Reel, YouTube Short, OR an
image carousel/slideshow of photo slides) to find the movies and TV shows it
actually references. Slides often carry the titles as styled text over stills —
read every slide's text carefully.

PRECISION OVER QUANTITY. Only include a title when you have CLEAR evidence for it:
  - its name is spoken in the audio, or
  - its title is shown as text on screen, or
  - its title appears in the caption, or
  - you recognize it unmistakably from its poster or a well-known scene.

Hard rules:
  - Do NOT guess from ambiguous footage. If you are not reasonably sure, leave it out.
  - Do NOT split ONE film into several entries. The same movie shown across multiple
    scenes/shots is ONE title, listed once.
  - Each distinct title appears at most ONCE.
  - Do NOT include films that appear only as a comparison, reference point, or hook
    ("it reminds me of Casablanca", "if you liked X…", a classic flashed briefly to
    set up the real subject). Include ONLY the films the video is actually
    recommending, discussing, or showcasing.
  - Set confidence HONESTLY: ~0.9+ only when the title is explicitly named (audio) or
    shown as text (on-screen/caption); use 0.4-0.7 when it rests on footage/poster
    recognition alone. A wrong guess at high confidence is worse than omitting it.

For each title give: the title, the release year if determinable (else null),
mediaType ("movie" or "tv"), a confidence 0-1, evidence (which channel it came
from — "audio" | "on-screen" | "caption" | "footage" — a short quote, and the
timestamp in seconds if visible, else null), the film's original language as an
ISO 639-1 code if you know it (e.g. "hi" for a Hindi film, "en", "ko" — else null),
and its original-release title if that differs from the common title (else null).
The language matters: it is how we tell apart same-name films from different
countries, so state it whenever you recognize the film's cinema of origin.

If the video is a curated list (e.g. "top 5 crime films"), suggest a short LOWERCASE
list name and include every DISTINCT film it lists. If the video references no
films/TV at all, return films: [] and isFilmContent: false.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    isFilmContent: { type: 'boolean' },
    suggestedListName: { type: 'string' },
    films: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          year: { type: 'string' },
          mediaType: { type: 'string', enum: ['movie', 'tv'] },
          confidence: { type: 'number' },
          evidenceChannel: { type: 'string', enum: ['audio', 'on-screen', 'caption', 'footage', 'other'] },
          evidenceQuote: { type: 'string' },
          evidenceTimestampSec: { type: 'number' },
          originalLanguage: { type: 'string' },
          originalTitle: { type: 'string' },
        },
        required: ['title', 'mediaType', 'confidence'],
      },
    },
  },
  required: ['isFilmContent', 'films'],
} as const;

type GeminiPart =
  | { text: string }
  | { fileData: { fileUri: string; mimeType?: string } }
  | { inlineData: { mimeType: string; data: string } };

/** Build the media parts — YouTube URL, inline video bytes, inline image
 *  slides, or none (caption-only). */
async function buildMediaParts(video: AcquiredVideo): Promise<GeminiPart[]> {
  if (video.kind === 'youtube') {
    return [{ fileData: { fileUri: video.youtubeUrl } }];
  }
  if (video.kind === 'images') {
    return buildImageParts(video.imageUrls);
  }
  // media: try to inline the bytes (small clips only).
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), VIDEO_FETCH_TIMEOUT_MS);
    const res = await fetch(video.videoUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const len = Number(res.headers.get('content-length') || 0);
    if (len > INLINE_VIDEO_MAX_BYTES) return []; // too big to inline → caption-only
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > INLINE_VIDEO_MAX_BYTES) return [];
    const mime = res.headers.get('content-type')?.split(';')[0] || 'video/mp4';
    return [{ inlineData: { mimeType: mime.startsWith('video/') ? mime : 'video/mp4', data: buf.toString('base64') } }];
  } catch {
    return []; // network/timeout → caption-only
  }
}

/** Fetch the carousel's slides concurrently and inline what fits the budget.
 *  Slide order is preserved (lists number their picks); a slide that fails to
 *  download is simply skipped — partial slides beat no slides. */
async function buildImageParts(imageUrls: string[]): Promise<GeminiPart[]> {
  const fetched = await Promise.all(imageUrls.map(async (url) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), IMAGE_FETCH_TIMEOUT_MS);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > INLINE_IMAGE_MAX_BYTES) return null;
      const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
      return { mime: mime.startsWith('image/') ? mime : 'image/jpeg', buf };
    } catch {
      return null;
    }
  }));

  const parts: GeminiPart[] = [];
  let total = 0;
  for (const img of fetched) {
    if (!img) continue;
    if (total + img.buf.byteLength > INLINE_IMAGES_TOTAL_BYTES) break;
    total += img.buf.byteLength;
    parts.push({ inlineData: { mimeType: img.mime, data: img.buf.toString('base64') } });
  }
  return parts;
}

/** Analyse the acquired media. Throws if Gemini isn't configured or the call
 *  fails hard. `modelOverride` replaces the whole fallback chain with one
 *  model — the confidence-escalation retry (extraction-server) uses it to
 *  re-run a weak result on the pro tier, best-effort. */
export async function analyzeForFilms(
  video: AcquiredVideo,
  modelOverride?: string,
): Promise<GeminiAnalysis> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');

  const mediaParts = await buildMediaParts(video);
  const caption = video.caption ? `\n\nThe post's caption is: """${video.caption}"""` : '';
  // Degraded mode: no footage/slides could be attached (download failed / too
  // big), so the model reads only the caption. Guessing "films that fit the
  // description" from prose produces confident garbage — forbid it explicitly.
  const captionOnlyNote = !mediaParts.length && video.kind !== 'youtube'
    ? '\n\nIMPORTANT: the media itself could NOT be attached — you are reading ONLY its caption. Include ONLY films the caption EXPLICITLY names. Do not infer films from descriptions, plot summaries, or vibes.'
    : '';
  const slideNote = video.kind === 'images' && mediaParts.length
    ? `\n\nThis post is an IMAGE CAROUSEL/SLIDESHOW — the ${mediaParts.length} image(s) attached are its slides, in order.`
    : '';
  const parts: GeminiPart[] = [...mediaParts, { text: PROMPT + slideNote + captionOnlyNote + caption }];
  const mode: GeminiAnalysis['mode'] =
    mediaParts.length ? (video.kind === 'images' ? 'images' : 'video') : 'caption-only';

  // No media AND no caption → nothing to analyse.
  if (!mediaParts.length && !video.caption) {
    return { isFilmContent: false, suggestedListName: null, films: [], mode };
  }

  const reqBody = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  });

  // REDUNDANCY: Gemini Flash gets transient 503 "high demand" / 429 spikes. Each
  // model sits on its OWN capacity pool, so when the primary is swamped a
  // fallback model usually answers immediately. We try each model in the chain
  // with a couple of backed-off retries; a non-retryable 4xx (bad key/request)
  // aborts the whole thing (no other model will fix it).
  const models = modelOverride ? [modelOverride] : modelChain();
  let lastErr = 'Gemini unavailable';
  for (const model of models) {
    for (let attempt = 0; attempt < GEMINI_ATTEMPTS_PER_MODEL; attempt++) {
      let res: Response;
      try {
        // Hard per-request timeout: a hung upstream must degrade to the next
        // model/attempt, never wedge the pipeline against the function limit.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), GEMINI_REQUEST_TIMEOUT_MS);
        res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: reqBody,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
      } catch (e) {
        lastErr = `Gemini network (${model}): ${String((e as Error)?.message || e)}`;
        await sleep(900 * (attempt + 1));
        continue;
      }
      if (res.ok) {
        const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        return { ...parseAnalysis(text), model, mode };
      }
      lastErr = `Gemini ${res.status} (${model}): ${(await res.text()).slice(0, 200)}`;
      if (res.status === 401 || res.status === 403) throw new Error(lastErr); // bad key — no model helps
      if (res.status === 429 || res.status >= 500) { await sleep(1200 * (attempt + 1) + 600); continue; } // retry same model
      break; // other 4xx (e.g. 404 model-not-found) — fall straight to the next model
    }
    console.warn(`[gemini] ${model} exhausted (overloaded), falling back to next model`);
  }
  throw new Error(lastErr);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GEMINI_ATTEMPTS_PER_MODEL = 2;
const GEMINI_REQUEST_TIMEOUT_MS = 110_000;

/** The model fallback chain: primary first, then distinct-capacity fallbacks,
 *  then the rolling-alias last resorts (always, deduped). Override via
 *  GEMINI_MODEL (primary) + GEMINI_MODEL_FALLBACKS (csv). */
function modelChain(): string[] {
  const primary = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const fallbacks = (process.env.GEMINI_MODEL_FALLBACKS || 'gemini-3-flash-preview,gemini-3.1-flash-lite')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks, ...LAST_RESORT_MODELS])];
}

function parseAnalysis(text: string): GeminiAnalysis {
  let raw: {
    isFilmContent?: boolean;
    suggestedListName?: string;
    films?: Array<Record<string, unknown>>;
  };
  try {
    raw = JSON.parse(text);
  } catch {
    return { isFilmContent: false, suggestedListName: null, films: [] };
  }
  const films: RawFilmCandidate[] = (raw.films ?? [])
    .map((f) => {
      const title = typeof f.title === 'string' ? f.title.trim() : '';
      if (!title) return null;
      const mediaType = f.mediaType === 'tv' ? 'tv' : 'movie';
      const yearStr = typeof f.year === 'string' ? f.year.trim() : '';
      const channel = typeof f.evidenceChannel === 'string' ? f.evidenceChannel : 'other';
      const quote = typeof f.evidenceQuote === 'string' ? f.evidenceQuote : '';
      const ts = typeof f.evidenceTimestampSec === 'number' ? f.evidenceTimestampSec : null;
      const lang = typeof f.originalLanguage === 'string' ? f.originalLanguage.trim().toLowerCase() : '';
      const origTitle = typeof f.originalTitle === 'string' ? f.originalTitle.trim() : '';
      return {
        title,
        year: /^\d{4}$/.test(yearStr) ? yearStr : null,
        mediaType,
        confidence: typeof f.confidence === 'number' ? Math.max(0, Math.min(1, f.confidence)) : 0.5,
        evidence: quote || ts != null ? { channel, quote, timestampSec: ts } : { channel, quote: '', timestampSec: ts },
        originalLanguage: /^[a-z]{2}$/.test(lang) ? lang : null,
        originalTitle: origTitle && origTitle.toLowerCase() !== title.toLowerCase() ? origTitle : null,
      } as RawFilmCandidate;
    })
    .filter((f): f is RawFilmCandidate => f !== null);

  return {
    isFilmContent: raw.isFilmContent ?? films.length > 0,
    suggestedListName: typeof raw.suggestedListName === 'string' && raw.suggestedListName.trim()
      ? raw.suggestedListName.trim().toLowerCase().slice(0, 60)
      : null,
    films,
  };
}

const HASHTAG_BLOCKLIST = new Set([
  'fyp', 'foryou', 'foryoupage', 'viral', 'trending', 'movie', 'movies', 'film', 'films',
  'edit', 'edits', 'cinema', 'netflix', 'reels', 'reel', 'tiktok', 'shorts', 'explore',
  'recommended', 'watch', 'cinematography', 'moviescene', 'movieclip', 'scene', 'trailer',
  'actor', 'actress', 'hollywood', 'bollywood', 'views', 'like', 'share', 'comment', 'follow',
]);

/**
 * Last-resort redundancy: when EVERY Gemini model is down, mine the caption for
 * explicit film candidates. TMDB grounding (match-or-drop) filters anything that
 * isn't a real title, so this stays conservative. Returns [] when nothing clearly
 * film-like is present.
 */
export function captionCandidates(caption: string): RawFilmCandidate[] {
  if (!caption) return [];
  const out: RawFilmCandidate[] = [];
  const seen = new Set<string>();
  const add = (title: string, year: string | null) => {
    const t = title.trim().replace(/\s+/g, ' ');
    if (t.length < 2 || t.length > 60) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      title: t, year, mediaType: 'movie', confidence: 0.4,
      evidence: { channel: 'caption', quote: caption.slice(0, 140), timestampSec: null },
      originalLanguage: null, originalTitle: null,
    });
  };
  // "Title (2014)" — the strongest textual signal.
  const re = /([A-Za-z0-9][\w':,!&.\- ]{1,58}?)\s*\(((?:19|20)\d{2})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(caption)) && out.length < 8) add(m[1], m[2]);
  // Title-like hashtags (#TheNamesake → "The Namesake"), minus common junk tags.
  for (const tag of caption.match(/#[A-Za-z][A-Za-z0-9]{2,40}/g) || []) {
    if (out.length >= 8) break;
    const rawTag = tag.slice(1);
    if (HASHTAG_BLOCKLIST.has(rawTag.toLowerCase())) continue;
    const words = rawTag.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
    if (words.split(' ').length >= 2) add(words, null);
  }
  return out;
}
