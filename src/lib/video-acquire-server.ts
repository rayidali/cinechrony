/**
 * Phase C.1b — media acquisition (the ACQUIRE stage of the extraction pipeline).
 *
 * Per-provider Apify adapters (each platform downloads + outputs differently):
 *   - youtube   → NO download; Gemini ingests the URL directly (`fileData`).
 *   - instagram → easyapi/instagram-reels-downloader (handles IG's login-walls;
 *                 generic yt-dlp actors get an "empty media response" on IG).
 *                 Output: { result: { medias: [{ url }], title (caption) } }.
 *                 Reels yield ONE video media; CAROUSELS yield several IMAGE
 *                 medias — both are first-class here.
 *   - tiktok    → the configured multi-platform actor (APIFY_ACTOR_ID, e.g.
 *                 wilcode/all-social-media-video-downloader). Defensive parser.
 *                 TikTok PHOTO posts (slideshows) come back as image lists in
 *                 one of several shapes — all handled.
 *
 * A share resolves to ONE of three kinds: a youtube link, a downloadable
 * video, or an IMAGE SET (carousel/slideshow — where a huge share of film
 * recommendations actually live). Videos win when both are present.
 *
 * COST: actors default to huge timeouts (~53 min) + some carry a monthly rental —
 * every run is hard-capped (120s / 1024MB) via the SYNC dataset endpoint. Returns
 * `null` (caller degrades to "couldn't fetch — try a screenshot") when the actor
 * isn't configured or no media comes back. The actor's success/exit code is
 * unreliable (it can exit 0 with no media), so we key off "did we get media".
 */

import type { ExtractionProvider } from '@/lib/extraction-types';

export type AcquiredVideo =
  | { kind: 'youtube'; youtubeUrl: string; caption: string | null }
  | { kind: 'media'; videoUrl: string; caption: string | null; thumbnailUrl: string | null; raw: unknown }
  | { kind: 'images'; imageUrls: string[]; caption: string | null; thumbnailUrl: string | null; raw: unknown };

const ACQUIRE_TIMEOUT_SECS = 120;
const ACQUIRE_MEMORY_MB = 1024;
const ACQUIRE_MAX_ATTEMPTS = 3; // these downloaders are flaky; each retry rotates the proxy
const ACQUIRE_RETRY_DELAY_MS = 1200; // brief gap between attempts so the proxy/rate-limit cools
/** Slides beyond this add tokens, latency, and no recall — carousels cap at 20
 *  platform-side anyway and film lists rarely pass 10 slides. */
const MAX_IMAGES = 10;

type Parsed = { videoUrl: string | null; imageUrls: string[]; caption: string | null; thumbnailUrl: string | null };
type ActorAdapter = {
  // Resolved at CALL time (not module load) — robust to env that arrives after
  // import (e.g. a script that dotenv-loads after importing this module).
  actorId: () => string | undefined;
  buildInput: (url: string) => unknown;
  parse: (item: Record<string, unknown>) => Parsed;
};

const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

/** Is this URL/entry a VIDEO? (extension, path segment, or an explicit type field) */
function looksLikeVideoUrl(u: string): boolean {
  return /\.mp4(\?|$)|\.m3u8(\?|$)|\/video\/|mime_type=video|video_mp4/i.test(u);
}
/** Is this URL an IMAGE? (extension or the platforms' image-CDN fingerprints) */
function looksLikeImageUrl(u: string): boolean {
  return /\.(jpe?g|png|webp|heic)(\?|$)|photomode|image_url|\/photos?\//i.test(u);
}

/** Classify one media entry from an actor's output as video / image / unknown,
 *  using an explicit `type` field when present, else the URL's own shape. */
function classifyMediaEntry(entry: Record<string, unknown>): { url: string; kind: 'video' | 'image' } | null {
  const url = [entry.url, entry.link, entry.src].find(isHttp);
  if (!url) return null;
  const type = String(entry.type ?? entry.mediaType ?? entry.kind ?? '').toLowerCase();
  if (type.includes('video')) return { url, kind: 'video' };
  if (type.includes('image') || type.includes('photo') || type.includes('picture')) return { url, kind: 'image' };
  if (looksLikeVideoUrl(url)) return { url, kind: 'video' };
  if (looksLikeImageUrl(url)) return { url, kind: 'image' };
  return null; // ambiguous — skip rather than feed Gemini a mystery blob
}

/** Instagram — easyapi/instagram-reels-downloader. Reels: one video media.
 *  Carousels: several image medias. Both live at result.medias[]. */
const instagramAdapter: ActorAdapter = {
  actorId: () => process.env.APIFY_ACTOR_INSTAGRAM || 'easyapi~instagram-reels-downloader',
  buildInput: (url) => ({ links: [url], proxyConfiguration: { useApifyProxy: true } }),
  parse: (item) => {
    const r = (item.result ?? item) as Record<string, unknown>;
    const medias = Array.isArray(r.medias) ? (r.medias as Record<string, unknown>[]) : [];
    let videoUrl: string | null = null;
    const imageUrls: string[] = [];
    let mediaThumb: string | null = null;
    for (const m of medias) {
      const classified = classifyMediaEntry(m);
      if (!classified) continue;
      if (classified.kind === 'video' && !videoUrl) {
        videoUrl = classified.url;
        if (!mediaThumb) mediaThumb = pickThumbnail(m);
      } else if (classified.kind === 'image' && imageUrls.length < MAX_IMAGES) {
        imageUrls.push(classified.url);
      }
    }
    const caption = typeof r.title === 'string' ? r.title.slice(0, 2000) : null;
    return { videoUrl, imageUrls, caption, thumbnailUrl: mediaThumb || imageUrls[0] || pickThumbnail(r) };
  },
};

/** TikTok / multi-platform — the configured actor. Defensive (unknown shape).
 *  TikTok photo posts surface images under several shapes across actors:
 *  `images[]` (strings or {url}), `imagePost.images[].imageURL.urlList[]`
 *  (the raw TikTok API), or image-typed `medias[]` entries. */
const defaultAdapter: ActorAdapter = {
  actorId: () => process.env.APIFY_ACTOR_ID,
  buildInput: (url) => ({ url, proxySettings: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] } }),
  parse: (item) => {
    const imageUrls = pickImageUrls(item);
    return {
      videoUrl: pickVideoUrl(item),
      imageUrls,
      caption: pickCaption(item),
      thumbnailUrl: pickThumbnail(item) || imageUrls[0] || null,
    };
  },
};

/** Defensive thumbnail/cover image pick (unknown actor output shape). */
function pickThumbnail(item: Record<string, unknown>): string | null {
  const keys = ['thumbnail', 'thumbnailUrl', 'thumbnail_url', 'cover', 'coverUrl', 'cover_url', 'displayUrl', 'display_url', 'image', 'imageUrl', 'poster', 'thumb', 'thumbUrl', 'previewImage'];
  for (const k of keys) {
    const v = item[k];
    if (typeof v === 'string' && /^https?:\/\//.test(v) && /\.(jpe?g|png|webp)|image|cdn|scontent/i.test(v)) return v;
  }
  // One level into a nested result object (some actors wrap output in `result`).
  const nested = item.result;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    for (const k of keys) {
      const v = (nested as Record<string, unknown>)[k];
      if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
    }
  }
  return null;
}

function adapterFor(provider: ExtractionProvider): ActorAdapter {
  return provider === 'instagram' ? instagramAdapter : defaultAdapter;
}

/** Defensive video-URL pick for the multi-platform actor (unknown output shape). */
function pickVideoUrl(item: Record<string, unknown>): string | null {
  const direct = ['videoUrl', 'video_url', 'downloadUrl', 'download_url', 'video', 'downloadLink', 'hd', 'sd', 'mp4', 'url'];
  for (const k of direct) {
    const v = item[k];
    if (typeof v === 'string' && /^https?:\/\//.test(v) && /\.mp4|\/v\/|video|cdn/i.test(v) && !looksLikeImageUrl(v)) return v;
  }
  for (const listKey of ['medias', 'formats', 'links', 'downloads', 'videos', 'data']) {
    const arr = item[listKey];
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        if (entry && typeof entry === 'object') {
          const u = pickVideoUrl(entry as Record<string, unknown>);
          if (u) return u;
        }
      }
    }
  }
  return null;
}

/** Defensive image-set pick — every shape TikTok photo posts (and other image
 *  posts) have been observed to arrive in. Ordered, deduped, capped. */
function pickImageUrls(item: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (u: unknown) => {
    if (isHttp(u) && !looksLikeVideoUrl(u) && out.length < MAX_IMAGES && !out.includes(u)) out.push(u);
  };

  const scan = (node: unknown, depth: number): void => {
    if (!node || depth > 3 || out.length >= MAX_IMAGES) return;
    if (Array.isArray(node)) {
      for (const entry of node) {
        if (typeof entry === 'string') { if (looksLikeImageUrl(entry)) push(entry); }
        else scan(entry, depth + 1);
      }
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    // The raw TikTok API shape: imagePost.images[].imageURL.urlList[0]
    const urlList = (o.imageURL as Record<string, unknown> | undefined)?.urlList;
    if (Array.isArray(urlList)) push(urlList[0]);
    // Typed media entries.
    const classified = classifyMediaEntry(o);
    if (classified?.kind === 'image') push(classified.url);
    // Common image-list keys.
    for (const k of ['images', 'imageLinks', 'image_urls', 'imageUrls', 'photos', 'slides', 'imagePost', 'medias', 'data', 'result']) {
      if (k in o) scan(o[k], depth + 1);
    }
  };

  scan(item, 0);
  return out;
}

function pickCaption(item: Record<string, unknown>): string | null {
  for (const k of ['caption', 'title', 'text', 'description', 'desc']) {
    const v = item[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 2000);
  }
  const nested = item.result;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return pickCaption(nested as Record<string, unknown>);
  }
  return null;
}

export async function acquireVideo(
  canonicalUrl: string,
  provider: ExtractionProvider,
): Promise<AcquiredVideo | null> {
  if (provider === 'youtube') {
    return { kind: 'youtube', youtubeUrl: canonicalUrl, caption: null };
  }

  const token = process.env.APIFY_TOKEN;
  const adapter = adapterFor(provider);
  const actorId = adapter.actorId();
  if (!token || !actorId) return null; // not configured → caller degrades

  const params = new URLSearchParams({
    token,
    timeout: String(ACQUIRE_TIMEOUT_SECS),
    memory: String(ACQUIRE_MEMORY_MB),
  });
  // These downloaders are flaky (proxy/rate-limit lottery — empty on one run,
  // full on the next). A second attempt rotates the proxy and lands most misses.
  // The actor's HTTP/exit status is unreliable, so we judge success purely by
  // "did we get media".
  let lastItem: Record<string, unknown> = {};
  for (let attempt = 0; attempt < ACQUIRE_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, ACQUIRE_RETRY_DELAY_MS));
    const items = await runActorItems(actorId, adapter.buildInput(canonicalUrl), token, params);
    lastItem = (items[0] ?? {}) as Record<string, unknown>;
    const { videoUrl, imageUrls, caption, thumbnailUrl } = adapter.parse(lastItem);
    if (videoUrl) return { kind: 'media', videoUrl, caption, thumbnailUrl, raw: lastItem };
    if (imageUrls.length) return { kind: 'images', imageUrls, caption, thumbnailUrl, raw: lastItem };
  }

  console.warn(`[acquire] no media after ${ACQUIRE_MAX_ATTEMPTS} tries (${provider}). item keys:`, Object.keys(lastItem));
  return null;
}

/** Exported for the parse-contract tests (50-image-acquire-parse) — fixtures
 *  in, classified media out, no network. */
export const __parseForTests = {
  instagram: instagramAdapter.parse,
  multi: defaultAdapter.parse,
};

const APIFY_BASE = 'https://api.apify.com/v2';
const APIFY_TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

/**
 * Start an actor run, poll to terminal, return its dataset items. More reliable
 * than `run-sync-get-dataset-items`, which returns empty for some actors even
 * though the dataset DOES get the item (observed with the multi-platform actor).
 */
async function runActorItems(
  actorId: string,
  input: unknown,
  token: string,
  params: URLSearchParams,
): Promise<Record<string, unknown>[]> {
  const start = await fetch(`${APIFY_BASE}/acts/${actorId}/runs?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!start.ok) {
    // 4xx (e.g. actor-is-not-rented) won't fix on retry — fail fast.
    if (start.status >= 400 && start.status < 500) {
      throw new Error(`Apify run start failed (${start.status}): ${(await start.text()).slice(0, 200)}`);
    }
    return [];
  }
  const run = ((await start.json()) as { data?: { id: string; status: string; defaultDatasetId: string } }).data;
  if (!run) return [];
  let status = run.status;
  let datasetId = run.defaultDatasetId;
  const deadline = Date.now() + (ACQUIRE_TIMEOUT_SECS + 15) * 1000;
  while (!APIFY_TERMINAL.has(status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await fetch(`${APIFY_BASE}/actor-runs/${run.id}?token=${token}`);
    if (!r.ok) continue;
    const d = ((await r.json()) as { data?: { status: string; defaultDatasetId?: string } }).data;
    if (d) { status = d.status; datasetId = d.defaultDatasetId || datasetId; }
  }
  const ds = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${token}`);
  if (!ds.ok) return [];
  const items = (await ds.json()) as unknown;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}
