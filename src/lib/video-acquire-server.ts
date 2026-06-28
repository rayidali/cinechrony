/**
 * Phase C.1b — video acquisition (the ACQUIRE stage of the extraction pipeline).
 *
 * - YouTube: NO download. Gemini ingests a YouTube URL directly (`fileData`), so
 *   we just hand the URL through — cheapest + most reliable path.
 * - TikTok / Instagram: run the configured Apify actor (a multi-platform video
 *   downloader) to get a direct video URL + caption.
 *
 * COST: the actor's default timeout is ~53 min and it carries a monthly rental —
 * we cap every run hard (120s / 1024MB) and call the SYNC dataset endpoint so a
 * single quick download can't run away. Returns `null` (caller degrades) when
 * `APIFY_TOKEN`/`APIFY_ACTOR_ID` are unset or no video URL is found.
 *
 * The actor's exact OUTPUT field names aren't in its public schema, so the parser
 * is defensive (tries the common shapes) and logs the raw keys on a miss — the
 * first real run pins them down without guesswork.
 */

import type { ExtractionProvider } from '@/lib/extraction-types';

export type AcquiredVideo =
  | { kind: 'youtube'; youtubeUrl: string; caption: string | null }
  | { kind: 'media'; videoUrl: string; caption: string | null; raw: unknown };

const ACQUIRE_TIMEOUT_SECS = 120;
const ACQUIRE_MEMORY_MB = 1024;

/** Defensive: pull a direct video URL out of an unknown actor output item. */
function pickVideoUrl(item: Record<string, unknown>): string | null {
  const direct = ['videoUrl', 'video_url', 'downloadUrl', 'download_url', 'url', 'video', 'downloadLink', 'hd', 'sd', 'mp4'];
  for (const k of direct) {
    const v = item[k];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  }
  // Nested collections: medias[]/formats[]/links[]/downloads[] → {url|link|...}
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

/** Defensive: pull a caption/title out of an unknown actor output item. */
function pickCaption(item: Record<string, unknown>): string | null {
  for (const k of ['caption', 'title', 'text', 'description', 'desc', 'name']) {
    const v = item[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 2000);
  }
  return null;
}

export async function acquireVideo(
  canonicalUrl: string,
  provider: ExtractionProvider,
): Promise<AcquiredVideo | null> {
  // YouTube → hand the URL straight to Gemini; no Apify run at all.
  if (provider === 'youtube') {
    return { kind: 'youtube', youtubeUrl: canonicalUrl, caption: null };
  }

  const token = process.env.APIFY_TOKEN;
  const actor = process.env.APIFY_ACTOR_ID;
  if (!token || !actor) return null; // not configured → caller degrades

  // run-sync-get-dataset-items: run the actor + get its dataset in one call,
  // hard-capped on time + memory (the actor's own default is ~53 min).
  const params = new URLSearchParams({
    token,
    timeout: String(ACQUIRE_TIMEOUT_SECS),
    memory: String(ACQUIRE_MEMORY_MB),
  });
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?${params.toString()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: canonicalUrl,
        proxySettings: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Apify acquire failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as unknown;
  const items = Array.isArray(json) ? json : [json];
  const item = (items[0] ?? {}) as Record<string, unknown>;

  const videoUrl = pickVideoUrl(item);
  if (!videoUrl) {
    // First real run will hit this if our field guesses are off — the keys log
    // tells us exactly what to map (then we tighten pickVideoUrl).
    console.warn('[acquire] no video URL in actor output. item keys:', Object.keys(item));
    return null;
  }
  return { kind: 'media', videoUrl, caption: pickCaption(item), raw: item };
}
