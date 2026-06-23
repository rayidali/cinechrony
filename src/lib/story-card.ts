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

/**
 * Cache-buster for the rendered cards. The renderer sets `Cache-Control` (CDN
 * ~1 day, browser ~1 hour) keyed on the URL, so identical params would keep
 * serving a STALE render after a design change. Every card URL carries `v` —
 * BUMP THIS whenever the card design changes (logo, layout, colours…) so every
 * cache key changes and the share sheet, native share, and OG link previews all
 * re-render fresh.
 *   v1 → original (hand-drawn clapper mark)
 *   v2 → real cinechrony popcorn logo
 *   v3 → "post" card variant
 *   v4 → post card shows real media hero (was a lone play button)
 */
export const CARD_VERSION = '4';

export type StoryCardKind = 'review' | 'watched' | 'list' | 'post';

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
    }
  | {
      // "shared a post" — recreates the feed post as a card.
      kind: 'post';
      user: string;
      avatar?: string | null;
      caption?: string | null; // the post text (raw, not quote-wrapped)
      timeAgo?: string | null; // "5h ago"
      likes?: number;
      comments?: number;
      media?: string | null; // first media: image url, or a video's thumbnail
      isVideo?: boolean; // overlay a play badge on the media hero
      // optional tagged film
      title?: string | null;
      director?: string | null;
      year?: string | null;
      rating?: number | null;
      poster?: string | null;
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
  // post-only
  caption: string | null;
  timeAgo: string | null;
  likes: number;
  comments: number;
  media: string | null;
  isVideo: boolean;
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
  q.set('v', CARD_VERSION); // cache-buster — applies to every branch incl. list
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
  if (p.kind === 'post') {
    if (p.title) q.set('ti', truncate(p.title, MAX_TITLE));
    if (p.director) q.set('di', truncate(p.director, 40));
    if (p.year) q.set('yr', String(p.year));
    if (p.rating != null) q.set('ra', String(p.rating));
    if (p.poster) q.set('po', p.poster);
    if (p.caption) q.set('cap', truncate(p.caption, 180));
    if (p.timeAgo) q.set('tm', truncate(p.timeAgo, 20));
    if (p.likes) q.set('lk', String(Math.max(0, Math.floor(p.likes))));
    if (p.comments) q.set('cm', String(Math.max(0, Math.floor(p.comments))));
    if (p.media) q.set('mi', p.media);
    if (p.isVideo) q.set('vd', '1');
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
  const kind: StoryCardKind =
    rawKind === 'list' || rawKind === 'review' || rawKind === 'watched' || rawKind === 'post' ? rawKind : 'watched';
  const ratingRaw = q.get('ra');
  const rating = ratingRaw != null && ratingRaw !== '' ? Number(ratingRaw) : null;
  const verbExplicit = q.get('vb');
  const verb =
    verbExplicit ||
    (kind === 'list' ? 'a list' : kind === 'post' ? 'shared a post' : kind === 'review' ? (q.get('q') ? 'just reviewed' : 'just rated') : 'just watched');
  const intOf = (key: string) => Math.max(0, Math.floor(Number(q.get(key) || 0)) || 0);
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
    count: intOf('ct'),
    caption: q.get('cap') || null,
    timeAgo: q.get('tm') || null,
    likes: intOf('lk'),
    comments: intOf('cm'),
    media: q.get('mi') || null,
    isVideo: q.get('vd') === '1',
  };
}

/** Flavor verdict label from a rating (the "a masterpiece" line on the post card). */
export function verdictFlavor(rating: number | null | undefined): string | null {
  if (rating == null || Number.isNaN(rating)) return null;
  if (rating >= 8.5) return 'a masterpiece';
  if (rating >= 7.5) return 'loved it';
  if (rating >= 6.5) return 'liked it';
  if (rating >= 5) return 'it was fine';
  return 'not for me';
}
