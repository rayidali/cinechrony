/**
 * `POST /api/v1/extractions` — start (or cache-resolve) a film-extraction job
 * for a shared video URL. Auth required; rate-limited (5/min burst, 50/day).
 *
 *   Body: `{ url: string }`  (a TikTok / Instagram / YouTube link)
 *   → `{ jobId, status: 'processing' | 'done' }`
 *
 * On a cache miss the pipeline runs AFTER the response (see extraction-server);
 * the client polls `GET /api/v1/extractions/[jobId]`. Unsupported/malformed URL
 * → 400. Phase C.1a (pipeline stubbed — fixture films, no keys needed).
 */

import { apiRoute, optionsHandler, RateLimitedError } from '@/lib/api-handler';
import { createExtraction } from '@/lib/extraction-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req, { auth }) => {
  const burst = await checkRateLimit(auth.uid, 'extraction');
  if (!burst.ok) throw new RateLimitedError(burst.error);
  const daily = await checkRateLimit(auth.uid, 'extractionDaily');
  if (!daily.ok) throw new RateLimitedError(daily.error);

  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  const url = typeof body.url === 'string' ? body.url : '';
  return createExtraction(auth.uid, url);
});

export const OPTIONS = optionsHandler;
