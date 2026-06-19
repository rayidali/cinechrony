/**
 * Letterboxd USERNAME import — the scrape engine (Phase 0.7 fast-follow).
 *
 * A user types their public Letterboxd username and we scrape their library.
 * This module ONLY produces the normalized rows; the existing
 * `importLetterboxdMovies` (letterboxd-server.ts) does the TMDB matching +
 * Firestore writes UNCHANGED.
 *
 *   scrapeLetterboxdLibrary(username)  → LetterboxdData   (pure, no DB)
 *   importLetterboxdFromUsername(uid)  → scrape + import  (lazy-loads the
 *                                        DB importer so the pure path stays
 *                                        firebase-free and unit-testable)
 *
 * Drives Apify's ready-made `apify/cheerio-scraper` actor (no custom actor to
 * publish) over RESIDENTIAL proxies + browser-like TLS — what clears
 * Letterboxd's Cloudflare. The page-parsing logic is OURS (the pageFunction).
 *
 * FULL PARITY with the ZIP export — six data types, all live-validated
 * (2026-06): watched + ratings (li.griditem · data-item-name="Title (Year)" ·
 * span.rating.rated-N), watchlist, favourites (profile #favourites), REVIEWS
 * (article.production-viewing · .js-review-body), and custom LISTS (the
 * /{user}/lists/ index → each /{user}/list/{slug}/ page). The reviews path is
 * more aggressively rate-limited (some residential IPs 403 it), so the run
 * uses high retries + rotation; it lands within a retry or two.
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

type ScrapedRow = {
  kind: 'film' | 'watchlist' | 'favorite' | 'review' | 'list-meta' | 'list-film';
  name?: string;
  year?: string;
  slug?: string;
  rating?: number | null; // 0.5–5 stars, films only
  review?: string;
  listSlug?: string;
  listName?: string;
  listDescription?: string;
};

/**
 * The actor pageFunction — runs INSIDE apify/cheerio-scraper. Handles every
 * page type (films · watchlist · reviews · lists index · list page · profile),
 * returns an array of ScrapedRow, and enqueues remaining pages itself (reads
 * the max page number off page 1, since Letterboxd windows the pagination).
 * Kept as a string because cheerio-scraper takes it as input.
 */
export const LETTERBOXD_PAGE_FUNCTION = `async function pageFunction(context) {
  const { $, request, enqueueLinks } = context;
  const url = request.url || '';
  const rows = [];

  const parseNameYear = (raw) => {
    if (!raw) return { name: '', year: '' };
    const m = String(raw).match(/^(.*)\\s+\\((\\d{4})\\)\\s*$/);
    return m ? { name: m[1].trim(), year: m[2] } : { name: String(raw).trim(), year: '' };
  };
  const posterOf = ($el) => {
    const p = $el.find('[data-item-slug],[data-film-slug],[data-target-link],[data-item-link]').first();
    return p.length ? p : $el;
  };
  const nameYearSlug = (node, $el) => {
    let slug = node.attr('data-item-slug') || node.attr('data-film-slug') || '';
    if (!slug) {
      const link = node.attr('data-item-link') || node.attr('data-target-link') || $el.find('a[href*="/film/"]').attr('href') || '';
      const lm = link.match(/\\/film\\/([^\\/]+)\\//);
      if (lm) slug = lm[1];
    }
    const ny = parseNameYear(node.attr('data-item-name') || node.attr('data-film-name'));
    let name = ny.name, year = ny.year;
    if (!name) name = ($el.find('img[alt]').attr('alt') || '').trim();
    if (!year && slug) { const sm = slug.match(/-(\\d{4})$/); if (sm) year = sm[1]; }
    return { name: name, year: year, slug: slug };
  };
  const enqueuePages = async () => {
    if (url.indexOf('/page/') > -1) return;
    let maxPage = 1;
    $('.paginate-pages a').each(function () {
      const href = $(this).attr('href') || '';
      const mm = href.match(/\\/page\\/(\\d+)\\//);
      if (mm) { const n = parseInt(mm[1], 10); if (n > maxPage) maxPage = n; }
    });
    if (maxPage > 1 && typeof enqueueLinks === 'function') {
      const base = url.endsWith('/') ? url : url + '/';
      const u = [];
      for (let p = 2; p <= maxPage; p++) u.push(base + 'page/' + p + '/');
      await enqueueLinks({ urls: u });
    }
  };

  const isReviews = url.indexOf('/reviews/') > -1 && url.indexOf('/film/') < 0;
  const isWatchlist = url.indexOf('/watchlist/') > -1;
  const isListsIndex = url.indexOf('/lists/') > -1;
  const isListPage = !isListsIndex && url.indexOf('/list/') > -1;
  const isFilms = !isReviews && url.indexOf('/films/') > -1;
  const isProfile = !isReviews && !isWatchlist && !isFilms && !isListsIndex && !isListPage;

  // ── reviews ──
  if (isReviews) {
    $('article.production-viewing, article[data-object-name="review"], .js-production-viewing').each(function () {
      const $el = $(this);
      const text = ($el.find('.js-review-body, .body-text').first().text() || '').trim();
      if (!text) return;
      const info = nameYearSlug(posterOf($el), $el);
      if (info.name) rows.push({ kind: 'review', name: info.name, year: info.year, slug: info.slug, review: text });
    });
    await enqueuePages();
    return rows;
  }

  // ── lists index: enqueue each owned list page ──
  if (isListsIndex) {
    const seen = {};
    const urls = [];
    $('a[href*="/list/"]').each(function () {
      const href = $(this).attr('href') || '';
      const m = href.match(/^(\\/[^\\/]+\\/list\\/[^\\/]+\\/)$/);
      if (m && !seen[m[1]]) { seen[m[1]] = 1; urls.push('https://letterboxd.com' + m[1]); }
    });
    if (urls.length && typeof enqueueLinks === 'function') await enqueueLinks({ urls: urls });
    return rows;
  }

  // ── a single custom list page ──
  if (isListPage) {
    const sm = url.match(/\\/list\\/([^\\/]+)\\//);
    const listSlug = sm ? sm[1] : url;
    const title = ($('title').first().text() || '').split(/\\s*,\\s*a list of films by/i)[0].replace(/[\\u200e\\u200f\\u202a-\\u202e]/g, '').trim();
    const desc = ($('.list-description, .body-text').first().text() || '').trim();
    rows.push({ kind: 'list-meta', listSlug: listSlug, listName: title, listDescription: desc });
    $('[data-item-slug]').each(function () {
      const $el = $(this);
      const info = nameYearSlug($el, $el);
      if (info.name) rows.push({ kind: 'list-film', listSlug: listSlug, name: info.name, year: info.year, slug: info.slug });
    });
    await enqueuePages();
    return rows;
  }

  // ── profile favourites ──
  if (isProfile) {
    $('#favourites li.griditem, section.favourites li.griditem, .favourites-list li.griditem, #favourites .poster-container, section.favourites .poster-container').each(function () {
      const $el = $(this);
      const info = nameYearSlug(posterOf($el), $el);
      if (info.name) rows.push({ kind: 'favorite', name: info.name, year: info.year, slug: info.slug });
    });
    return rows;
  }

  // ── films / watchlist grid ──
  const kind = isWatchlist ? 'watchlist' : 'film';
  $('li.griditem, li.poster-container').each(function () {
    const $el = $(this);
    const info = nameYearSlug(posterOf($el), $el);
    if (!info.name) return;
    let rating = null;
    if (kind === 'film') {
      const cls = $el.find('span.rating').attr('class') || '';
      const rm = cls.match(/rated-(\\d+)/);
      if (rm) rating = parseInt(rm[1], 10) / 2;
    }
    rows.push({ kind: kind, name: info.name, year: info.year, slug: info.slug, rating: rating });
  });
  await enqueuePages();
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

/** Build the cheerio-scraper actor input for one user's full library. */
export function buildCheerioInput(username: string, maxRequests = 500) {
  const u = normalizeUsername(username);
  return {
    startUrls: [
      { url: `https://letterboxd.com/${u}/films/` },
      { url: `https://letterboxd.com/${u}/watchlist/` },
      { url: `https://letterboxd.com/${u}/films/reviews/` },
      { url: `https://letterboxd.com/${u}/lists/` },
      { url: `https://letterboxd.com/${u}/` },
    ],
    // Pagination + per-list crawling are enqueued inside the pageFunction.
    pageFunction: LETTERBOXD_PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    // A FRESH residential IP per request: the reviews path 403s a chunk of IPs,
    // so each retry must hop to a new one. (Mildly worse for deep films
    // pagination on huge libraries — but that's the ZIP-fallback case anyway,
    // and reviews reliability matters more.)
    proxyRotation: 'PER_REQUEST',
    sessionPoolOptions: { maxPoolSize: 300 },
    maxConcurrency: 6,
    maxRequestsPerCrawl: maxRequests,
    maxRequestRetries: 12,
  };
}

/**
 * Run cheerio-scraper ASYNCHRONOUSLY: start the run, poll until it finishes,
 * then fetch the dataset. No 300s cap (unlike run-sync). In PRODUCTION the
 * route starts the run + registers a webhook instead of polling — same start
 * call, same dataset fetch.
 */
async function runCheerioScraper(input: unknown, token: string, pollMs = 540_000): Promise<ScrapedRow[]> {
  const t = encodeURIComponent(token);
  const startRes = await fetch(`${APIFY_BASE}/acts/${APIFY_ACTOR}/runs?token=${t}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const startJson = (await startRes.json()) as { data?: { id: string; defaultDatasetId: string; status: string } };
  if (!startRes.ok || !startJson.data) {
    throw new Error(`Apify run start failed (${startRes.status}): ${JSON.stringify(startJson).slice(0, 300)}`);
  }
  const { id: runId, defaultDatasetId: datasetId } = startJson.data;
  let status = startJson.data.status;

  const terminal = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
  const deadline = Date.now() + pollMs;
  while (!terminal.has(status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const r = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${t}`);
    const j = (await r.json()) as { data?: { status: string } };
    status = j.data?.status ?? status;
  }

  const itemsRes = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${t}&clean=1&format=json&limit=200000`,
  );
  const items = (await itemsRes.json()) as unknown;
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
  reviews: number;
  lists: number;
  missingYear: number;
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

  const rows = await runCheerioScraper(buildCheerioInput(u, opts.maxRequests), opts.token);

  const filmsBySlug = new Map<string, ScrapedRow>();
  const watchlist: ScrapedRow[] = [];
  const favorites: ScrapedRow[] = [];
  const reviewsBySlug = new Map<string, ScrapedRow>();
  const listMeta = new Map<string, { name: string; description: string }>();
  const listFilms = new Map<string, Array<{ Name: string; Year: string }>>();

  for (const r of rows) {
    if (!r) continue;
    if (r.kind === 'watchlist' && r.name) watchlist.push(r);
    else if (r.kind === 'favorite' && r.name) favorites.push(r);
    else if (r.kind === 'review' && r.name && r.review) {
      const key = r.slug || `${r.name}_${r.year}`;
      if (!reviewsBySlug.has(key)) reviewsBySlug.set(key, r);
    } else if (r.kind === 'list-meta' && r.listSlug) {
      listMeta.set(r.listSlug, { name: r.listName || r.listSlug, description: r.listDescription || '' });
    } else if (r.kind === 'list-film' && r.listSlug && r.name) {
      if (!listFilms.has(r.listSlug)) listFilms.set(r.listSlug, []);
      listFilms.get(r.listSlug)!.push({ Name: r.name, Year: r.year || '' });
    } else if (r.kind === 'film' && r.name) {
      const key = r.slug || `${r.name}_${r.year}`;
      const existing = filmsBySlug.get(key);
      if (!existing || (existing.rating == null && r.rating != null)) filmsBySlug.set(key, r);
    }
  }

  const films = [...filmsBySlug.values()];
  const toRow = (r: ScrapedRow) => ({ Name: r.name!, Year: r.year || '' });

  const lists = [...new Set([...listMeta.keys(), ...listFilms.keys()])]
    .map((slug) => ({
      name: listMeta.get(slug)?.name || slug,
      description: listMeta.get(slug)?.description || undefined,
      movies: listFilms.get(slug) || [],
    }))
    .filter((l) => l.movies.length > 0);

  const data: LetterboxdData = {
    watched: films.map(toRow),
    ratings: films
      .filter((r) => r.rating != null)
      .map((r) => ({ Name: r.name!, Year: r.year || '', Rating: String(r.rating) })),
    watchlist: watchlist.map(toRow),
    reviews: [...reviewsBySlug.values()].map((r) => ({ Name: r.name!, Year: r.year || '', Review: r.review })),
    favorites: favorites.slice(0, 5).map(toRow),
    lists,
  };

  const summary: ScrapeSummary = {
    username: u,
    watched: data.watched.length,
    ratings: data.ratings.length,
    watchlist: data.watchlist.length,
    favorites: data.favorites.length,
    reviews: data.reviews.length,
    lists: data.lists.length,
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
    importReviews: true,
    importLists: true,
  });
  return { summary, ...result };
}
