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
const DEFAULT_MODEL = 'gemini-2.5-flash';
const INLINE_VIDEO_MAX_BYTES = 18 * 1024 * 1024; // keep the request under Gemini's ~20MB inline cap
const VIDEO_FETCH_TIMEOUT_MS = 20_000;

/** A candidate film straight from Gemini — pre-TMDB-grounding. */
export type RawFilmCandidate = {
  title: string;
  year: string | null;
  mediaType: 'movie' | 'tv';
  confidence: number;
  evidence: { channel: string; quote: string; timestampSec: number | null } | null;
};

export type GeminiAnalysis = {
  isFilmContent: boolean;
  suggestedListName: string | null;
  films: RawFilmCandidate[];
};

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

const PROMPT = `You are watching a short social video (a TikTok, Reel, or YouTube Short) to find
the movies and TV shows it actually references.

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
  - Set confidence HONESTLY: ~0.9+ only when the title is explicitly named (audio) or
    shown as text (on-screen/caption); use 0.4-0.7 when it rests on footage/poster
    recognition alone. A wrong guess at high confidence is worse than omitting it.

For each title give: the title, the release year if determinable (else null),
mediaType ("movie" or "tv"), a confidence 0-1, and evidence (which channel it came
from — "audio" | "on-screen" | "caption" | "footage" — a short quote, and the
timestamp in seconds if visible, else null).

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

/** Build the video part — YouTube URL, inline bytes, or none (caption-only). */
async function buildVideoPart(video: AcquiredVideo): Promise<GeminiPart | null> {
  if (video.kind === 'youtube') {
    return { fileData: { fileUri: video.youtubeUrl } };
  }
  // media: try to inline the bytes (small clips only).
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), VIDEO_FETCH_TIMEOUT_MS);
    const res = await fetch(video.videoUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > INLINE_VIDEO_MAX_BYTES) return null; // too big to inline → caption-only
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > INLINE_VIDEO_MAX_BYTES) return null;
    const mime = res.headers.get('content-type')?.split(';')[0] || 'video/mp4';
    return { inlineData: { mimeType: mime.startsWith('video/') ? mime : 'video/mp4', data: buf.toString('base64') } };
  } catch {
    return null; // network/timeout → caption-only
  }
}

/** Analyse the acquired video. Throws if Gemini isn't configured or the call fails hard. */
export async function analyzeForFilms(video: AcquiredVideo): Promise<GeminiAnalysis> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');

  const videoPart = await buildVideoPart(video);
  const caption = video.caption ? `\n\nThe video's caption is: """${video.caption}"""` : '';
  const parts: GeminiPart[] = [];
  if (videoPart) parts.push(videoPart);
  parts.push({ text: PROMPT + caption });

  // No video AND no caption → nothing to analyse.
  if (!videoPart && !video.caption) {
    return { isFilmContent: false, suggestedListName: null, films: [] };
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
  const models = modelChain();
  let lastErr = 'Gemini unavailable';
  for (const model of models) {
    for (let attempt = 0; attempt < GEMINI_ATTEMPTS_PER_MODEL; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: reqBody,
        });
      } catch (e) {
        lastErr = `Gemini network (${model}): ${String((e as Error)?.message || e)}`;
        await sleep(900 * (attempt + 1));
        continue;
      }
      if (res.ok) {
        const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        return parseAnalysis(text);
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

/** The model fallback chain: primary first, then distinct-capacity fallbacks.
 *  Override via GEMINI_MODEL (primary) + GEMINI_MODEL_FALLBACKS (csv). */
function modelChain(): string[] {
  const primary = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const fallbacks = (process.env.GEMINI_MODEL_FALLBACKS || 'gemini-2.0-flash,gemini-2.5-flash-lite')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [primary, ...fallbacks.filter((m) => m && m !== primary)];
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
      return {
        title,
        year: /^\d{4}$/.test(yearStr) ? yearStr : null,
        mediaType,
        confidence: typeof f.confidence === 'number' ? Math.max(0, Math.min(1, f.confidence)) : 0.5,
        evidence: quote || ts != null ? { channel, quote, timestampSec: ts } : { channel, quote: '', timestampSec: ts },
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
