/**
 * Letterboxd USERNAME import — the scrape engine (Phase 0.7 fast-follow).
 *
 * Instead of the ZIP-export flow, a user types their public Letterboxd
 * username and we scrape their library. This module ONLY produces the
 * normalized rows; the existing `importLetterboxdMovies` (letterboxd-server.ts)
 * does the TMDB matching + Firestore writes UNCHANGED.
 *
 *   scrapeLetterboxdLibrary(username)  → LetterboxdData   (pure, no DB)
 *   importLetterboxdFromUsername(uid)  → scrape + import  (lazy-loads the
 *                                        DB importer so the pure path stays
 *                                        firebase-free and unit-testable)
 *
 * HOW THE SCRAPE RUNS: we drive Apify's ready-made `apify/cheerio-scraper`
 * actor (no custom actor to publish). It fetches the public pages through
 * Apify RESIDENTIAL proxies + browser-like TLS (got-scraping under the hood),
 * which is what gets past Letterboxd's Cloudflare WAF. The page-parsing logic
 * is OURS — passed to the actor as `pageFunction`.
 *
 * v1 SCOPE: watched + ratings + watchlist + favorites. Reviews are PHASE 2 —
 * the `/{user}/films/reviews/` path returns 403 to a plain request and likely
 * needs a browser actor; don't let it block the confirmed 90%.
 *
 * Verified against live HTML (2026-06): `/films/` + `/watchlist/` return 200;
 * each poster carries the slug (`data-target-link` / `data-item-slug`), the
 * title (`data-item-name="Title (Year)"` when present, else `img[alt]`), and
 * the viewer's rating as `span.rating.rated-N` (N = 0–10, i.e. N/2 stars);
 * pagination is `.paginate-pages a`.
 */

import type { LetterboxdData } from './letterboxd-server';

const APIFY_ACTOR = 'apify~cheerio-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';

export class LetterboxdUsernameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LetterboxdUsernameError';
  }
}

/** A flat row emitted by the actor's pageFunction (one per poster). */
type ScrapedRow = {
  kind: 'film' | 'watchlist' | 'favorite';
  name: string;
  year: string;
  slug: string;
  rating: number | null; // 0.5–5 stars (Letterboxd scale), or null if unrated
};

/**
 * The actor pageFunction — runs INSIDE apify/cheerio-scraper (Cheerio context).
 * Returns an array of ScrapedRow; the actor pushes each element as its own
 * dataset item. Kept as a string because cheerio-scraper takes it as input.
 *
 * Defensive by design: Letterboxd's grid markup is mid-migration, so we try
 * several attribute/selector fallbacks and skip anything we can't identify
 * (a film with no resolvable title) rather than emit garbage.
 */
export const LETTERBOXD_PAGE_FUNCTION = `async function pageFunction(context) {
  const { $, request } = context;
  const url = request.url || '';
  const rows = [];

  const isWatchlist = url.includes('/watchlist/');
  // profile root: letterboxd.com/<user>/ or /<user> with nothing after
  const isProfile = /letterboxd\\.com\\/[^/]+\\/?($|\\?)/.test(url) &&
    !url.includes('/films') && !isWatchlist;

  const parseNameYear = (raw) => {
    if (!raw) return { name: '', year: '' };
    const m = String(raw).match(/^(.*)\\s+\\((\\d{4})\\)\\s*$/);
    return m ? { name: m[1].trim(), year: m[2] } : { name: String(raw).trim(), year: '' };
  };

  const extractFromContainer = (el, kind) => {
    const $el = $(el);
    const poster = $el.find('[data-item-slug],[data-film-slug],[data-target-link]').first();
    const node = poster.length ? poster : $el;

    // slug
    let slug = node.attr('data-item-slug') || node.attr('data-film-slug') || '';
    if (!slug) {
      const link = node.attr('data-target-link') || $el.find('a[href*="/film/"]').attr('href') || '';
      const lm = link.match(/\\/film\\/([^/]+)\\//);
      if (lm) slug = lm[1];
    }

    // name + year — prefer data-item-name "Title (Year)", else img alt, else slug
    let { name, year } = parseNameYear(node.attr('data-item-name') || node.attr('data-film-name'));
    if (!name) name = ($el.find('img[alt]').attr('alt') || '').trim();
    if (!year && slug) {
      const sm = slug.match(/-(\\d{4})$/);
      if (sm) year = sm[1];
    }
    if (!name) return null;

    // rating (films pages only; watchlist has none) — class "rated-N", N is 0–10
    let rating = null;
    if (kind === 'film') {
      const cls = $el.find('span.rating').attr('class') || '';
      const rm = cls.match(/rated-(\\d+)/);
      if (rm) rating = parseInt(rm[1], 10) / 2;
    }
    return { kind, name, year, slug, rating };
  };

  if (isProfile) {
    // favourites (British spelling) — up to 4–5 posters on the profile
    $('#favourites .poster-container, section.favourites .poster-container, .favourites-list .poster-container').each(function () {
      const r = extractFromContainer(this, 'favorite');
      if (r) rows.push(r);
    });
    return rows;
  }

  const kind = isWatchlist ? 'watchlist' : 'film';
  $('li.poster-container, .poster-container').each(function () {
    const r = extractFromContainer(this, kind);
    if (r) rows.push(r);
  });
  return rows;
}`;

/** Validate + normalize a Letterboxd handle (URL-safety + actor-input safety). */
export function normalizeUsername(raw: string): string {
  const u = (raw || '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,40}$/.test(u)) {
    throw new LetterboxdUsernameError('Invalid Letterboxd username.');
  }
  return u;
}

/** Build the cheerio-scraper actor input for one user's library. */
export function buildCheerioInput(username: string, maxRequests = 200) {
  const u = normalizeUsername(username);
  return {
    startUrls: [
      { url: `https://letterboxd.com/${u}/films/` },
      { url: `https://letterboxd.com/${u}/watchlist/` },
      { url: `https://letterboxd.com/${u}/` },
    ],
    // auto-follow pagination only (constrained by globs), via the page links
    linkSelector: '.paginate-pages a',
    globs: [
      { glob: `https://letterboxd.com/${u}/films/page/*` },
      { glob: `https://letterboxd.com/${u}/watchlist/page/*` },
    ],
    pageFunction: LETTERBOXD_PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    maxConcurrency: 8,
    maxRequestsPerCrawl: maxRequests,
    // small politeness so we stay well under Letterboxd's rate limits
    maxRequestRetries: 3,
  };
}

/**
 * Run cheerio-scraper synchronously and return the dataset items. Uses the
 * run-sync-get-dataset-items endpoint (waits up to ~300s) — fine for the test
 * harness and small/medium libraries. PRODUCTION (heavy users) should switch
 * to async run + webhook to dodge the caller's request timeout; the input,
 * pageFunction, and mapping are identical either way.
 */
async function runCheerioScraperSync(input: unknown, token: string): Promise<ScrapedRow[]> {
  const res = await fetch(
    `${APIFY_BASE}/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apify run failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const items = (await res.json()) as unknown;
  // pageFunction returns arrays → actor flattens to one item per row, but guard
  // against either shape.
  const flat: ScrapedRow[] = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (Array.isArray(it)) flat.push(...(it as ScrapedRow[]));
    else if (it && typeof it === 'object' && 'kind' in it) flat.push(it as ScrapedRow);
  }
  return flat;
}

export type ScrapeSummary = {
  username: string;
  watched: number;
  ratings: number;
  watchlist: number;
  favorites: number;
  missingYear: number; // films we couldn't resolve a year for (matched by title only)
};

/**
 * Scrape a public Letterboxd library into the canonical `LetterboxdData`
 * shape. PURE — no Firestore, no auth — so it's safe to dry-run/test.
 */
export async function scrapeLetterboxdLibrary(
  username: string,
  opts: { token: string; maxRequests?: number },
): Promise<{ data: LetterboxdData; summary: ScrapeSummary }> {
  const u = normalizeUsername(username);
  if (!opts.token) throw new LetterboxdUsernameError('Missing Apify token.');

  const rows = await runCheerioScraperSync(buildCheerioInput(u, opts.maxRequests), opts.token);

  // Dedupe films by slug (keep the first, which carries the rating if present).
  const filmsBySlug = new Map<string, ScrapedRow>();
  const watchlist: ScrapedRow[] = [];
  const favorites: ScrapedRow[] = [];
  for (const r of rows) {
    if (!r || !r.name) continue;
    if (r.kind === 'watchlist') watchlist.push(r);
    else if (r.kind === 'favorite') favorites.push(r);
    else {
      const key = r.slug || `${r.name}_${r.year}`;
      const existing = filmsBySlug.get(key);
      if (!existing || (existing.rating == null && r.rating != null)) filmsBySlug.set(key, r);
    }
  }

  const films = [...filmsBySlug.values()];
  const toRow = (r: ScrapedRow) => ({ Name: r.name, Year: r.year });

  const data: LetterboxdData = {
    watched: films.map(toRow),
    // ratings carry the 0.5–5 star value; importLetterboxdMovies does ×2.
    ratings: films
      .filter((r) => r.rating != null)
      .map((r) => ({ Name: r.name, Year: r.year, Rating: String(r.rating) })),
    watchlist: watchlist.map(toRow),
    reviews: [], // phase 2
    favorites: favorites.slice(0, 5).map(toRow),
    lists: [], // phase 2
  };

  const summary: ScrapeSummary = {
    username: u,
    watched: data.watched.length,
    ratings: data.ratings.length,
    watchlist: data.watchlist.length,
    favorites: data.favorites.length,
    missingYear: films.filter((r) => !r.year).length,
  };

  return { data, summary };
}

/**
 * Full path: scrape a username then import into the caller's account, reusing
 * the existing TMDB-match + write pipeline. Lazy-imports the DB module so the
 * pure scrape path above never pulls in firebase-admin.
 */
export async function importLetterboxdFromUsername(
  callerUid: string,
  username: string,
  opts: { token: string; maxRequests?: number },
) {
  const { data, summary } = await scrapeLetterboxdLibrary(username, opts);
  const { importLetterboxdMovies } = await import('./letterboxd-server');
  const result = await importLetterboxdMovies(callerUid, data, {
    importWatched: true,
    importRatings: true,
    importWatchlist: true,
    importReviews: false, // phase 2
    importLists: false, // phase 2
  });
  return { summary, ...result };
}
