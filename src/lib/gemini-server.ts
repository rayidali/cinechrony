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

const PROMPT = `You are watching a short social video (e.g. a TikTok, Reel, or YouTube Short).
Identify EVERY movie or TV show referenced by ANY channel: spoken audio, text shown
on screen, the caption, or recognizable footage/posters. Be thorough — these videos
are often silent text-overlay countdowns or montages.

For each title give: the title, the release year if determinable (else null),
mediaType ("movie" or "tv"), a confidence 0-1, and evidence (which channel it came
from — "audio" | "on-screen" | "caption" | "footage" — a short quote, and the
timestamp in seconds if visible, else null).

If the video is a curated list (e.g. "top 5 crime films"), suggest a short LOWERCASE
list name. If the video references no films/TV at all, return films: [] and
isFilmContent: false. Do NOT invent titles you aren't reasonably sure about.`;

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
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

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
  // Gemini Flash gets transient 503 "high demand" / 429 spikes — retry with
  // backoff before giving up. Other 4xx (bad key, bad request) fail fast.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: reqBody,
    });
    if (res.ok) break;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) + 800));
  }
  if (!res || !res.ok) {
    throw new Error(`Gemini ${res?.status ?? '?'}: ${res ? (await res.text()).slice(0, 300) : 'no response'}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return parseAnalysis(text);
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
