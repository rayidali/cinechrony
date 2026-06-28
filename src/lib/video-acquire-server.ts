/**
 * Phase C.1b — video acquisition (the ACQUIRE stage of the extraction pipeline).
 *
 * Per-provider Apify adapters (each platform downloads + outputs differently):
 *   - youtube   → NO download; Gemini ingests the URL directly (`fileData`).
 *   - instagram → easyapi/instagram-reels-downloader (handles IG's login-walls;
 *                 generic yt-dlp actors get an "empty media response" on IG).
 *                 Output: { result: { medias: [{ url }], title (caption) } }.
 *   - tiktok    → the configured multi-platform actor (APIFY_ACTOR_ID, e.g.
 *                 wilcode/all-social-media-video-downloader). Defensive parser.
 *
 * COST: actors default to huge timeouts (~53 min) + some carry a monthly rental —
 * every run is hard-capped (120s / 1024MB) via the SYNC dataset endpoint. Returns
 * `null` (caller degrades to "couldn't fetch — try a screenshot") when the actor
 * isn't configured or no video URL comes back. The actor's success/exit code is
 * unreliable (it can exit 0 with no media), so we key off "did we get a URL".
 */

import type { ExtractionProvider } from '@/lib/extraction-types';

export type AcquiredVideo =
  | { kind: 'youtube'; youtubeUrl: string; caption: string | null }
  | { kind: 'media'; videoUrl: string; caption: string | null; raw: unknown };

const ACQUIRE_TIMEOUT_SECS = 120;
const ACQUIRE_MEMORY_MB = 1024;
const ACQUIRE_MAX_ATTEMPTS = 2; // these downloaders are flaky; a retry rotates the proxy

type Parsed = { videoUrl: string | null; caption: string | null };
type ActorAdapter = {
  actorId: string | undefined;
  buildInput: (url: string) => unknown;
  parse: (item: Record<string, unknown>) => Parsed;
};

/** Instagram — easyapi/instagram-reels-downloader. Video at result.medias[].url. */
const instagramAdapter: ActorAdapter = {
  actorId: process.env.APIFY_ACTOR_INSTAGRAM || 'easyapi~instagram-reels-downloader',
  buildInput: (url) => ({ links: [url], proxyConfiguration: { useApifyProxy: true } }),
  parse: (item) => {
    const r = (item.result ?? item) as Record<string, unknown>;
    const medias = r.medias;
    let videoUrl: string | null = null;
    if (Array.isArray(medias)) {
      for (const m of medias) {
        const u = (m as Record<string, unknown>)?.url;
        if (typeof u === 'string' && /^https?:\/\//.test(u)) { videoUrl = u; break; }
      }
    }
    const caption = typeof r.title === 'string' ? r.title.slice(0, 2000) : null;
    return { videoUrl, caption };
  },
};

/** TikTok / multi-platform — the configured actor. Defensive (unknown shape). */
const defaultAdapter: ActorAdapter = {
  actorId: process.env.APIFY_ACTOR_ID,
  buildInput: (url) => ({ url, proxySettings: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] } }),
  parse: (item) => ({ videoUrl: pickVideoUrl(item), caption: pickCaption(item) }),
};

function adapterFor(provider: ExtractionProvider): ActorAdapter {
  return provider === 'instagram' ? instagramAdapter : defaultAdapter;
}

/** Defensive video-URL pick for the multi-platform actor (unknown output shape). */
function pickVideoUrl(item: Record<string, unknown>): string | null {
  const direct = ['videoUrl', 'video_url', 'downloadUrl', 'download_url', 'video', 'downloadLink', 'hd', 'sd', 'mp4', 'url'];
  for (const k of direct) {
    const v = item[k];
    if (typeof v === 'string' && /^https?:\/\//.test(v) && /\.mp4|\/v\/|video|cdn/i.test(v)) return v;
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

function pickCaption(item: Record<string, unknown>): string | null {
  for (const k of ['caption', 'title', 'text', 'description', 'desc']) {
    const v = item[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 2000);
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
  if (!token || !adapter.actorId) return null; // not configured → caller degrades

  const params = new URLSearchParams({
    token,
    timeout: String(ACQUIRE_TIMEOUT_SECS),
    memory: String(ACQUIRE_MEMORY_MB),
  });
  const endpoint = `https://api.apify.com/v2/acts/${adapter.actorId}/run-sync-get-dataset-items?${params.toString()}`;
  const body = JSON.stringify(adapter.buildInput(canonicalUrl));

  // These downloaders are flaky (proxy/rate-limit lottery — an empty `medias`
  // on one run, full on the next). A second attempt rotates the proxy and lands
  // most of the misses. The actor's HTTP/exit status is unreliable, so we judge
  // success purely by "did we get a video URL".
  let lastItem: Record<string, unknown> = {};
  for (let attempt = 0; attempt < ACQUIRE_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      // 4xx like "actor-is-not-rented" won't fix on retry — fail fast.
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Apify acquire failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      }
      continue; // 5xx → retry
    }
    const json = (await res.json()) as unknown;
    const items = Array.isArray(json) ? json : [json];
    lastItem = (items[0] ?? {}) as Record<string, unknown>;
    const { videoUrl, caption } = adapter.parse(lastItem);
    if (videoUrl) return { kind: 'media', videoUrl, caption, raw: lastItem };
  }

  console.warn(`[acquire] no video URL after ${ACQUIRE_MAX_ATTEMPTS} tries (${provider}). item keys:`, Object.keys(lastItem));
  return null;
}
