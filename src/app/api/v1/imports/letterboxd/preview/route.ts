/**
 * `POST /api/v1/imports/letterboxd/preview` — the cheap "found" lookup for the
 * onboarding letterboxd step (Phase 0.7 Wave 7).
 *
 * A best-effort, Apify-FREE confirmation that a public Letterboxd profile
 * exists, plus its film/list counts when we can read them. Letterboxd sits
 * behind Cloudflare, so a plain server fetch may be challenged (403/503/timeout)
 * — in that case we return an OPTIMISTIC, unverified "ready" state and let the
 * post-signup Apify run (`/scrape-import`) be the real source of truth. We never
 * spend an Apify run here. Public (no auth needed — the account doesn't exist
 * yet at this onboarding step).
 */

import {
  publicApiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import { normalizeUsername, LetterboxdUsernameError } from '@/lib/letterboxd-scrape-server';

export const dynamic = 'force-dynamic';

type Preview = {
  username: string;
  /** false ONLY when we positively confirmed a 404. Optimistic-true otherwise. */
  found: boolean;
  /** true when we actually reached Letterboxd (vs. a soft, Cloudflare-blocked guess). */
  verified: boolean;
  displayName: string | null;
  films: number | null;
  lists: number | null;
};

function parseStat(html: string, label: string): number | null {
  // <span class="value">2,431</span> <span class="definition">Films</span>
  const re = new RegExp(`value"[^>]*>([\\d,]+)<\\/span>\\s*<span[^>]*class="definition"[^>]*>${label}`, 'i');
  const m = html.match(re);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

export const POST = publicApiRoute<Record<string, string>, Preview>(async (req) => {
  let body: { username?: unknown };
  try {
    body = (await req.json()) as { username?: unknown };
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  const raw = typeof body.username === 'string' ? body.username : '';

  let u: string;
  try {
    u = normalizeUsername(raw);
  } catch (e) {
    if (e instanceof LetterboxdUsernameError) throw new BadRequestError(e.message);
    throw e;
  }

  const soft: Preview = {
    username: u,
    found: true,
    verified: false,
    displayName: null,
    films: null,
    lists: null,
  };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://letterboxd.com/${u}/`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ctrl.signal,
    }).catch(() => null);
    clearTimeout(timer);

    if (!res) return soft;
    if (res.status === 404) {
      return { username: u, found: false, verified: true, displayName: null, films: null, lists: null };
    }
    if (!res.ok) return soft; // Cloudflare/blocked — stay optimistic, defer to the real run.

    const html = await res.text();
    const films = parseStat(html, 'Films');
    const lists = parseStat(html, 'Lists');
    const nameMatch =
      html.match(/<meta property="og:title" content="([^"]+?)['’]s?\s*(?:profile|films)?"/i) ||
      html.match(/<meta property="og:title" content="([^"]+?)"/i);
    const displayName = nameMatch ? nameMatch[1].replace(/&#x27;|&#x2019;/g, "'").trim() : null;

    return { username: u, found: true, verified: true, displayName, films, lists };
  } catch {
    return soft;
  }
});

export const OPTIONS = optionsHandler;
