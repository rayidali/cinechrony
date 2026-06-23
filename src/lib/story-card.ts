/**
 * story-card — pure helpers + the wire contract for the "share to Instagram
 * story" feature (Phase 0.7.4 → 0.7.6).
 *
 * The 9:16 card is rendered server-side by `/api/v1/share/story` (next/og +
 * Satori). The client already holds the post/review/list data, so it serializes
 * it into query params here — the renderer does NOT read Firestore (quota-safe,
 * and the card is about to be made fully public on Instagram anyway).
 *
 * Three variants, mirroring the design package's screen 06:
 *   • review  — immersive: deep gradient, big rating, serif quote, no poster
 *   • watched — paper:      poster card + floating score badge + quote
 *   • list    — dark:       fanned poster cards + list name + curator pill
 *
 * Everything in this module is pure (no React, no Node, no browser APIs) so it
 * is safe to import from both the route handler and client code.
 */

export type StoryCardKind = 'review' | 'watched' | 'list';

export type StorySharePayload =
  | {
      kind: 'review';
      /** handle WITHOUT the leading @ */
      user: string;
      avatar?: string | null;
      title: string;
      director?: string | null;
      year?: string | null;
      genre?: string | null;
      rating?: number | null;
      quote?: string | null;
      /** eyebrow verb; defaults from rating/quote presence */
      verb?: 'rated' | 'reviewed' | 'watched';
    }
  | {
      kind: 'watched';
      user: string;
      avatar?: string | null;
      title: string;
      director?: string | null;
      year?: string | null;
      rating?: number | null;
      poster?: string | null;
      quote?: string | null;
    }
  | {
      kind: 'list';
      user: string;
      avatar?: string | null;
      name: string;
      count: number;
      posters?: (string | null)[];
    };

/** Normalized, defaulted shape the renderer consumes. */
export type StoryCardModel = {
  kind: StoryCardKind;
  user: string;
  avatar: string | null;
  title: string;
  director: string | null;
  year: string | null;
  genre: string | null;
  rating: number | null;
  quote: string | null;
  verb: string;
  poster: string | null;
  posters: string[];
  count: number;
};

const MAX_QUOTE = 150;
const MAX_TITLE = 60;

export function truncate(s: string, n: number): string {
  const t = (s || '').trim().replace(/\s+/g, ' ');
  if (t.length <= n) return t;
  return t.slice(0, n - 1).trimEnd() + '…';
}

/** Wrap raw review text in smart quotes for the serif pull-quote. */
export function asQuote(s: string | null | undefined): string | null {
  const t = (s || '').trim();
  if (!t) return null;
  const inner = truncate(t.replace(/^["“]|["”]$/g, ''), MAX_QUOTE);
  return `“${inner}”`;
}

/** Compose a mono meta line from the present parts only ("dir. x · 2024 · horror"). */
export function composeMeta(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? '').trim()).filter(Boolean).join('  ·  ');
}

/** Deterministic hash → stable hue/palette pick (so a film always gets its colour). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// Curated deep gradients for the immersive review card — rich, cinematic,
// never muddy. Picked deterministically from the title.
const IMMERSIVE_PALETTE: Array<[string, string]> = [
  ['#2b2a63', '#0a0a12'], // indigo
  ['#3a2150', '#100a16'], // plum
  ['#123a3a', '#080f0f'], // teal
  ['#4a1f2c', '#140a0d'], // wine
  ['#1d3a26', '#080f0a'], // forest
  ['#3a2a16', '#120c07'], // amber-dark
  ['#1f2f4a', '#080c14'], // steel
];

// Saturated placeholder fills for poster-less cards (the design's green
// "past lives" card, the purple/blue/red list fan).
const PLACEHOLDER_PALETTE: string[] = [
  '#2f6f4a', // green
  '#5a2d6b', // purple
  '#2d4f7a', // blue
  '#7a3b2d', // rust
  '#6b5a2d', // ochre
  '#2d6b6b', // teal
  '#7a2d4f', // magenta
];

export function immersiveGradient(seed: string): [string, string] {
  return IMMERSIVE_PALETTE[hash(seed) % IMMERSIVE_PALETTE.length];
}

export function placeholderColor(seed: string): string {
  return PLACEHOLDER_PALETTE[hash(seed) % PLACEHOLDER_PALETTE.length];
}

/** Vivid red→amber→green for the big rating number + score badge. */
export function ratingHex(rating: number | null | undefined): string {
  if (rating == null || Number.isNaN(rating)) return '#9a8f7e';
  const r = Math.max(0, Math.min(10, rating));
  if (r >= 7.5) return '#4fa869'; // green
  if (r >= 6) return '#e0a92f'; // amber
  if (r >= 4.5) return '#d9802f'; // orange
  return '#df6147'; // coral
}

/** Letterboxd-style rating string: "8.9" not "8.90", "9" stays "9". */
export function formatRating(rating: number | null | undefined): string {
  if (rating == null || Number.isNaN(rating)) return '';
  const r = Math.round(rating * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// ── wire (de)serialization ─────────────────────────────────────────────────
// Short keys keep the GET URL well under any length limit.

export function payloadToParams(p: StorySharePayload): URLSearchParams {
  const q = new URLSearchParams();
  q.set('t', p.kind);
  q.set('u', p.user.replace(/^@/, ''));
  if (p.avatar) q.set('av', p.avatar);
  if (p.kind === 'list') {
    q.set('nm', truncate(p.name, MAX_TITLE));
    q.set('ct', String(Math.max(0, Math.floor(p.count || 0))));
    const posters = (p.posters || []).filter(Boolean).slice(0, 3) as string[];
    if (posters.length) q.set('ps', posters.join('|'));
    return q;
  }
  // review | watched
  q.set('ti', truncate(p.title, MAX_TITLE));
  if (p.director) q.set('di', truncate(p.director, 40));
  if (p.year) q.set('yr', String(p.year));
  if (p.rating != null) q.set('ra', String(p.rating));
  const quote = asQuote(p.quote);
  if (quote) q.set('q', quote);
  if (p.kind === 'review') {
    if (p.genre) q.set('ge', truncate(p.genre, 24));
    if (p.verb) q.set('vb', p.verb);
  }
  if (p.kind === 'watched' && p.poster) q.set('po', p.poster);
  return q;
}

export function paramsToModel(q: URLSearchParams): StoryCardModel {
  const rawKind = q.get('t');
  const kind: StoryCardKind = rawKind === 'list' || rawKind === 'review' || rawKind === 'watched' ? rawKind : 'watched';
  const ratingRaw = q.get('ra');
  const rating = ratingRaw != null && ratingRaw !== '' ? Number(ratingRaw) : null;
  const verbExplicit = q.get('vb');
  const verb =
    verbExplicit ||
    (kind === 'list' ? 'a list' : kind === 'review' ? (q.get('q') ? 'just reviewed' : 'just rated') : 'just watched');
  return {
    kind,
    user: truncate(q.get('u') || 'someone', 24),
    avatar: q.get('av') || null,
    title: truncate(q.get('ti') || q.get('nm') || '', MAX_TITLE),
    director: q.get('di') || null,
    year: q.get('yr') || null,
    genre: q.get('ge') || null,
    rating: rating != null && !Number.isNaN(rating) ? rating : null,
    quote: q.get('q') || null,
    verb: kind === 'review' && !verbExplicit && rating == null ? 'just reviewed' : verb,
    poster: q.get('po') || null,
    posters: (q.get('ps') || '').split('|').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    count: Math.max(0, Math.floor(Number(q.get('ct') || 0)) || 0),
  };
}
