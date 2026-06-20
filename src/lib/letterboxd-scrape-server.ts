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

const CHEERIO_ACTOR = 'apify~cheerio-scraper';
const BROWSER_ACTOR = 'apify~web-scraper';
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

/**
 * REVIEWS pageFunction — runs INSIDE apify/web-scraper (a real Chromium with
 * injected jQuery), so it executes Letterboxd's Cloudflare JS challenge instead
 * of relying on the IP lottery that made cheerio's review capture flaky. Parses
 * the same review entries (article.production-viewing → .js-review-body) and
 * enqueues the remaining review pages.
 */
export const REVIEWS_BROWSER_PAGE_FUNCTION = `async function pageFunction(context) {
  const { request, jQuery, enqueueRequest, log } = context;
  const $ = jQuery;
  const url = request.url || '';
  const rows = [];
  const parseNY = (raw) => {
    const m = String(raw || '').match(/^(.*)\\s+\\((\\d{4})\\)\\s*$/);
    return m ? { name: m[1].trim(), year: m[2] } : { name: String(raw || '').trim(), year: '' };
  };
  $('article.production-viewing, article[data-object-name="review"], .js-production-viewing').each(function () {
    const $el = $(this);
    const text = ($el.find('.js-review-body, .body-text').first().text() || '').trim();
    if (!text) return;
    const poster = $el.find('[data-item-slug],[data-item-link],[data-target-link]').first();
    const node = poster.length ? poster : $el;
    const ny = parseNY(node.attr('data-item-name') || node.attr('data-film-name'));
    if (!ny.name) return;
    rows.push({ kind: 'review', name: ny.name, year: ny.year, slug: node.attr('data-item-slug') || '', review: text });
  });
  if (url.indexOf('/page/') < 0 && typeof enqueueRequest === 'function') {
    let maxPage = 1;
    $('.paginate-pages a').each(function () {
      const h = $(this).attr('href') || '';
      const mm = h.match(/\\/page\\/(\\d+)\\//);
      if (mm) { const n = parseInt(mm[1], 10); if (n > maxPage) maxPage = n; }
    });
    const base = url.endsWith('/') ? url : url + '/';
    for (let p = 2; p <= maxPage; p++) { await enqueueRequest({ url: base + 'page/' + p + '/' }); }
  }
  if (log && rows.length === 0) log.info('no reviews parsed on ' + url);
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

/** cheerio-scraper input for films + watchlist + lists + favourites (reviews
 *  go through the browser actor below). */
export function buildCheerioInput(username: string, maxRequests = 500) {
  const u = normalizeUsername(username);
  return {
    startUrls: [
      { url: `https://letterboxd.com/${u}/films/` },
      { url: `https://letterboxd.com/${u}/watchlist/` },
      { url: `https://letterboxd.com/${u}/lists/` },
      { url: `https://letterboxd.com/${u}/` },
    ],
    // Pagination + per-list crawling are enqueued inside the pageFunction.
    pageFunction: LETTERBOXD_PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    proxyRotation: 'RECOMMENDED',
    sessionPoolOptions: { maxPoolSize: 200 },
    maxConcurrency: 4,
    maxRequestsPerCrawl: maxRequests,
    maxRequestRetries: 8,
  };
}

/** web-scraper (real browser) input for the REVIEWS crawl — the JS-executing
 *  actor reliably clears Cloudflare where cheerio's IP-lottery wobbled. */
export function buildWebScraperReviewsInput(username: string, maxRequests = 120) {
  const u = normalizeUsername(username);
  return {
    startUrls: [{ url: `https://letterboxd.com/${u}/films/reviews/` }],
    pageFunction: REVIEWS_BROWSER_PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    injectJQuery: true,
    // Gentle concurrency + many retries so no review page drops mid-run (a
    // dropped page = ~12 lost reviews). One clean run then captures all of them.
    maxConcurrency: 2,
    maxRequestRetries: 10,
    maxRequestsPerCrawl: maxRequests,
    pageLoadTimeoutSecs: 60,
  };
}

/**
 * Run cheerio-scraper ASYNCHRONOUSLY: start the run, poll until it finishes,
 * then fetch the dataset. No 300s cap (unlike run-sync). In PRODUCTION the
 * route starts the run + registers a webhook instead of polling — same start
 * call, same dataset fetch.
 */
async function runActor(actorSlug: string, input: unknown, token: string, pollMs = 540_000): Promise<ScrapedRow[]> {
  const t = encodeURIComponent(token);
  const startRes = await fetch(`${APIFY_BASE}/acts/${actorSlug}/runs?token=${t}`, {
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

/**
 * Reviews are the one flaky surface: a single browser run usually gets them
 * all, but a review page occasionally drops mid-run (-12 reviews). Run it a few
 * times and keep the best; stop early once two runs AGREE on the top count —
 * that agreement is our "we got them all" signal (no separate oracle needed).
 */
async function runReviewsBest(username: string, token: string, maxAttempts = 3): Promise<ScrapedRow[]> {
  let best: ScrapedRow[] = [];
  let topCount = -1;
  let topSeen = 0;
  for (let i = 0; i < maxAttempts; i++) {
    const rows = await runActor(BROWSER_ACTOR, buildWebScraperReviewsInput(username), token).catch(() => []);
    if (rows.length > best.length) best = rows;
    if (rows.length === topCount) topSeen++;
    else if (rows.length > topCount) { topCount = rows.length; topSeen = 1; }
    if (topSeen >= 2 && topCount > 0) break; // two runs agree on the max → complete
  }
  return best;
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
  opts: { token: string; maxRequests?: number; skipReviews?: boolean },
): Promise<{ data: LetterboxdData; summary: ScrapeSummary }> {
  const u = normalizeUsername(username);
  if (!opts.token) throw new LetterboxdUsernameError('Missing Apify token.');

  // Two runs in parallel: cheerio for the bulk (films/watchlist/lists/favs),
  // a real-browser actor for reviews (reliably clears Cloudflare). Reviews are
  // best-effort — if that run fails, the rest of the import still lands.
  //
  // `skipReviews` drops the browser-actor run entirely. That actor is the slow
  // part (up to 3 sequential Chromium passes clearing Cloudflare — minutes), so
  // the ONBOARDING import skips it to fit inside a serverless function's time
  // budget. The cheerio run (films/ratings/watchlist/lists/favourites) is fast
  // and parallel. Reviews can still be back-filled later via the ZIP importer.
  const [cheerioRes, reviewRes] = await Promise.allSettled([
    runActor(CHEERIO_ACTOR, buildCheerioInput(u, opts.maxRequests), opts.token),
    opts.skipReviews ? Promise.resolve([] as ScrapedRow[]) : runReviewsBest(u, opts.token),
  ]);
  if (cheerioRes.status === 'rejected') throw cheerioRes.reason;
  const rows = [
    ...cheerioRes.value,
    ...(reviewRes.status === 'fulfilled' ? reviewRes.value : []),
  ];
  if (reviewRes.status === 'rejected') {
    console.error('[letterboxd-scrape] reviews run failed:', reviewRes.reason?.message || reviewRes.reason);
  }

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
  opts: { token: string; maxRequests?: number; skipReviews?: boolean },
) {
  const { data, summary } = await scrapeLetterboxdLibrary(username, opts);
  const { importLetterboxdMovies } = await import('./letterboxd-server');
  const result = await importLetterboxdMovies(callerUid, data, {
    importWatched: true,
    importRatings: true,
    importWatchlist: true,
    importReviews: !opts.skipReviews,
    importLists: true,
  });
  return { summary, ...result };
}
