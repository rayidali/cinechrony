// Interaction harness — the pre-build gate for the sheet/modal class of
// bugs (single-tap transitions, stuck body locks, orphaned drawers).
// Every click is a REAL coordinate click (hit-tested like a finger), never
// a synthetic dispatchEvent, so pointer-events/overlay bugs cannot hide.
// Drives the local dev server (port 9002 → prod API) as the demo account
// (DEMO_ACCOUNT_PASSWORD from .env.local — no secrets in this file).
// RUN BEFORE EVERY NATIVE BUILD: npm run dev, then
//   node scripts/interaction-harness.mjs
// Needs puppeteer-core (npm i --no-save puppeteer-core) + system Chrome.
// 2026-07-25: born from the owner's device-bug sweep — the class it guards
// shipped to TestFlight because nothing clicked through the flows first.
// 2026-07-26: the demo account's movie-night create quota (production
// Firestore) can exhaust mid-run since every propose click here is a real
// create. A 429 on that call now halts as a distinct BLOCKED outcome (exit
// code 3, see EXIT below), instead of cascading into what would otherwise
// look like ordinary step FAILUREs. Never "fix" a BLOCKED run by touching
// rate_limits/* in production; the counter resets itself. (Confirmed working
// in the wild the same day — a run that ran out mid-session exited 3, not 1.)
// 2026-07-27: that cap went 10/day -> 6/min + 40/day, so repeated local runs
// are no longer the standing hazard they were; a BLOCKED exit now much more
// likely means back-to-back runs than a spent day.
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';

const ORIGIN = 'http://localhost:9002';
const EMAIL = 'demo@cinechrony.com';
const PASSWORD = readFileSync('.env.local', 'utf8').match(/^DEMO_ACCOUNT_PASSWORD=(.+)$/m)?.[1];

// Exit codes. A gate that can't tell "the app is broken" apart from "I
// couldn't even run" is a gate people learn to distrust, so every halt
// reason gets its own code. CONFIG predates this file's blocked-condition
// work; BLOCKED is new (see "BLOCKED-condition detection" further down).
const EXIT = { OK: 0, FAIL: 1, CONFIG: 2, BLOCKED: 3 };
if (!PASSWORD) { console.error('no DEMO_ACCOUNT_PASSWORD in .env.local'); process.exit(EXIT.CONFIG); }

// Movie-night creation budget.
// This harness drives PRODUCTION Firebase (the dev server has no emulator),
// so every real "propose it" click below spends one unit of the demo
// account's server-side movieNightCreate allowance: a fixed-window counter
// at rate_limits/{uid}_movieNightCreate, checked in
// src/app/api/v1/movie-nights/route.ts via src/lib/rate-limit.ts. There is
// no cheap existing surface that reports remaining quota for this account
// (unlike scan extraction's GET /api/v1/me/scan-quota); adding one would
// mean a new admin/credentialed call, which this harness deliberately does
// not do. So the cost below is a stated constant, not a live reading.
const MOVIE_NIGHT_DAILY_LIMIT = 40; // mirrors RATE_LIMITS.movieNightCreateDaily.limit
const MOVIE_NIGHT_CREATES_THIS_RUN = 1; // the one 'propose it' click, below.
  // Scenario B (movie-card entry, further down) deliberately stops at
  // 'cancel' in the create sheet and never proposes, so it re-tests the
  // film-prefill entry point without spending a second creation.
console.log(
  `budget: this run creates ${MOVIE_NIGHT_CREATES_THIS_RUN} movie night against the demo account's ${MOVIE_NIGHT_DAILY_LIMIT}/day movieNightCreate cap. ` +
  `if that cap is already spent, the create call 429s and this gate reports BLOCKED (exit ${EXIT.BLOCKED}) instead of step failures.`
);

// BLOCKED-condition detection.
// BLOCKED is a third outcome, distinct from PASS/FAIL: the gate could not
// reach a verdict because something OUTSIDE the app stopped it (a spent
// quota, a rate limit, a 5xx) rather than a UI interaction actually
// misbehaving. `blocked` is set once, by the response interceptor installed
// right after `page` exists (below); `BlockedError` carries it out of
// whatever await was in flight and is caught ONCE at the top level instead
// of flowing through `step()` as an ordinary FAIL. It is never resolved by
// mutating anything, including the production rate_limits doc; the counter
// resets itself and that is the only correct fix.
class BlockedError extends Error {
  constructor(info) { super(`blocked: ${info.kind} (${info.method} ${info.path} -> ${info.status})`); this.info = info; }
}
let blocked = null; // set by the page.on('response') interceptor below; first cause wins
let lastClickTrace = [];
let upcomingResponses = 0; // count of /movie-nights/upcoming responses seen (see below)

const BLOCKED_MESSAGES = {
  movie_night_quota: () => [
    `The demo account has used its daily movie-night-create allowance (${MOVIE_NIGHT_DAILY_LIMIT}/day).`,
    "This is not an app defect. It's the server-side movieNightCreate rate",
    "limit (src/lib/rate-limit.ts) doing exactly what it's designed to do.",
    "The counter resets on its own, 24h after this account's first creation",
    "in the current window.",
    "",
    "Next step: wait for it to reset, or point this harness at a different",
    "account.",
    "",
    "Do NOT delete or reset the production rate_limits/{uid}_movieNightCreate",
    "document to work around this. That is a live production mutation this",
    "harness must never make. It happened once before and it was wrong.",
  ],
  rate_limited_other: (info) => [
    `${info.method} ${info.path} came back 429 (rate limited). A budget or`,
    "abuse guard on the server rejected the call. Not a UI interaction bug.",
    "",
    "This is not an app defect. Wait for that limiter's window to roll over,",
    "or run this gate against a different account. Do not mutate any",
    "production Firestore document to work around it.",
  ],
  server_error: (info) => [
    `${info.method} ${info.path} came back HTTP ${info.status}. A server`,
    "error, not a UI interaction assertion this harness made.",
    "",
    "This harness's evidence can't tell you whether that 5xx is a real",
    "backend bug or infra flakiness, so check the dev server's own logs.",
    "Either way it is not one of this gate's step failures, and nothing here",
    "should be worked around by mutating production state.",
  ],
};

function printBlockedBanner(info, stepsCompleted) {
  const body = (BLOCKED_MESSAGES[info.kind] || BLOCKED_MESSAGES.rate_limited_other)(info);
  console.log('');
  console.log('='.repeat(70));
  console.log('GATE BLOCKED: the app was not exercised to a verdict');
  console.log('='.repeat(70));
  for (const line of body) console.log(line);
  console.log('');
  console.log(`signal: ${info.method} ${info.path} -> HTTP ${info.status}${info.source ? ` (${info.source})` : ''}`);
  console.log(`${stepsCompleted} step(s) had already run before the block (see the log above; those lines are real). No pass/fail summary follows; this run did not reach a verdict.`);
  console.log(`exit code ${EXIT.BLOCKED} = BLOCKED, distinct from ${EXIT.FAIL} = a real assertion FAIL.`);
  console.log('='.repeat(70));
}

const results = [];
const step = (name, ok, detail = '') => {
  // Never record or print a step downstream of a block. That cascade of
  // ordinary-looking FAILs is the exact failure mode this file exists to
  // prevent: the interceptor already knows the HTTP truth, so step() defers
  // to it before adding its own, possibly-misleading, verdict.
  if (blocked) throw new BlockedError(blocked);
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-first-run', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// Watches every /api/v1/* response for the whole page lifetime (installed
// before any navigation, so it is live for login, pre-clean, and the real
// create call). A 429 on the movie-nights create endpoint is the specific,
// expected block this harness was built to survive (the demo account's
// 10/day movieNightCreate cap). A 429 anywhere else, or a 5xx anywhere, is
// treated the same way: environment or quota trouble, not a UI bug. First
// cause wins; only the first reason the run cannot reach a verdict matters.
// Deliberately narrow: other 4xx codes (400/401/403/404/409) are left to
// surface as ordinary step failures, because in this app's error taxonomy
// (src/lib/api-handler.ts) they are semantic/permission outcomes, not
// quota or transport ones, so treating them as BLOCKED would risk hiding a
// real bug behind this banner.
page.on('response', (r) => {
  if (blocked) return;
  try {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/v1/')) return;
    const method = r.request().method();
    const status = r.status();
    let kind = null;
    if (status === 429) {
      kind = (method === 'POST' && u.pathname === '/api/v1/movie-nights') ? 'movie_night_quota' : 'rate_limited_other';
    } else if (status >= 500) {
      kind = 'server_error';
    }
    if (kind) blocked = { kind, method, path: u.pathname, status, url: r.url() };

    // The morning-after prompt ("did movie night happen?") is mounted by
    // movie-night-provider.tsx's boot check: ONE fetch of
    // /api/v1/movie-nights/upcoming per uid per page load, whose result decides
    // whether a past un-answered night pops a sheet over whatever screen you
    // are on. Its arrival therefore has a precise cause, not a guessable delay
    // — polling for the text is a race you lose whenever auth restore is slow.
    // Record the response so a step can wait for the DECISION to have been made.
    if (u.pathname === '/api/v1/movie-nights/upcoming') upcomingResponses += 1;
  } catch { /* never let the interceptor itself take down the run */ }
});

const rawSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleep = async (ms) => { await rawSleep(ms); if (blocked) throw new BlockedError(blocked); };

/**
 * Wait until the morning-after boot check has RESOLVED, then clear its sheet if
 * it opened one. Returns 'none' | 'cleared' | 'stuck' | 'timeout'.
 *
 * The provider fetches /api/v1/movie-nights/upcoming exactly once per uid per
 * page load and only then decides whether to mount the sheet. So the correct
 * wait is "that response has landed and React has painted", not "N milliseconds
 * ought to be enough" — which is what three earlier attempts got wrong: the
 * sheet mounted mid-attempt, after every poll had already concluded it wasn't
 * coming, and then silently ate every tap on the page underneath.
 *
 * Call AFTER a navigation, passing the response count captured BEFORE it.
 */
const morningAfterUp = () => hasText(/did movie night happen/i);

/** Dismiss the sheet if it is up right now. Cheap; safe to call repeatedly. */
const dismissMorningAfter = async () => {
  if (!(await morningAfterUp())) return false;
  await clickText(/not now/i);
  await sleep(1500);
  return true;
};

const settleMorningAfter = async (baseline, timeoutMs = 25000) => {
  // `/movie-nights/upcoming` is fetched by SEVERAL components, so "one more
  // response than before the navigation" does not mean the PROVIDER's boot
  // check specifically has run — that one waits on Firebase auth restoring from
  // IndexedDB and can land many seconds later. Counting the first response was
  // exactly wrong, and it is why this reported "no past night" while the sheet
  // was about to mount. So: watch for the sheet across the whole window, and
  // treat quiet only at the end as genuine absence.
  const deadline = Date.now() + timeoutMs;
  let sawResponse = upcomingResponses > baseline;
  while (Date.now() < deadline) {
    if (await dismissMorningAfter()) return 'cleared';
    if (upcomingResponses > baseline) sawResponse = true;
    await rawSleep(400);
  }
  if (await morningAfterUp()) return 'stuck';
  return sawResponse ? 'none' : 'timeout';
};

// REAL single tap: find the element, then page.mouse.click at its center.
// Coordinate clicks go through hit-testing (pointer-events, overlay stacking)
// exactly like a finger — synthetic dispatchEvent would bypass the very bug
// class this harness exists to catch.
let shotN = 0;
// mkdir first: `snap` swallows its own errors, so without this the failure
// diagnostics print a screenshot path that was never written — a gate lying
// about its own evidence, which is the one thing this file must not do.
mkdirSync('/tmp/harness', { recursive: true });
const snap = async (tag) => page.screenshot({ path: `/tmp/harness/${String(++shotN).padStart(2, '0')}-${tag}.png` }).catch(() => {});
// Returns EVERY tappable candidate (last-to-first, hit-tested), not just the
// first. Most callers want `[0]`; `clickTextUntil` needs the rest as fallbacks.
const findClickPoints = async (re, { inDrawer = false } = {}) => {
  return page.evaluate(({ src, inDrawer }) => {
    const rx = new RegExp(src, 'i');
    const scope = inDrawer ? '[data-vaul-drawer] ' : '';
    // Same normalisation as hasText: source newlines and wrapped headings
    // otherwise break multi-word matchers for no visible reason.
    const norm = (n) => (n.textContent || '').replace(/\s+/g, ' ').trim();
    const nodes = [...document.querySelectorAll(`${scope}button, ${scope}[role="button"], ${scope}a, ${scope}div, ${scope}span, ${scope}p`)]
      .filter((n) => rx.test(norm(n)) && norm(n).length < 60)
      .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight; });
    // walk candidates from last to first, but ONLY accept one whose center
    // would truly receive the tap (elementFromPoint hit-test) — occluded or
    // offscreen-peeking matches (e.g. a closed drawer's header) are skipped.
    const out = [];
    const seen = new Set();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const el = nodes[i].closest('button, [role="button"], a') || nodes[i];
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2; const y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && (el.contains(hit) || hit.contains(el))) out.push({ x, y });
    }
    return out;
  }, { src: re.source, inDrawer });
};

const findClickPoint = async (re, opts = {}) => (await findClickPoints(re, opts))[0] || null;

/**
 * Click candidates matching `re` until `predicate()` becomes true.
 *
 * WHY: `clickText` takes the first hit-testable match and assumes it did
 * something. On a screen where two different things carry the same words that
 * is a coin flip — e.g. `/movie night/` matches BOTH the list tile and a
 * leftover night's card, so a stale night made "open list" click the wrong
 * element and hang for 20s on a navigation that was never going to happen. The
 * old failure text was "harness crashed", which says nothing about which of the
 * two it hit. Verifying the OUTCOME rather than the tap removes the ambiguity.
 */
const clickTextUntil = async (re, predicate, opts = {}, settleMs = 2500) => {
  lastClickTrace = [];
  // Always start from the top. The sweep below scrolls, and without this a
  // second call resumes wherever the first left off — so a target near the top
  // of the page is permanently out of view and reads as "not on this page".
  await page.evaluate(() => window.scrollTo(0, 0));
  await rawSleep(300);
  if (opts.beforeEach) await opts.beforeEach();
  // Candidates are viewport-filtered (an offscreen match can't be tapped), so a
  // target pushed below the fold — by a leftover night's pin, a taller header,
  // any content above it — looks identical to "not on this page". Sweep the
  // page instead of concluding absence from one screenful.
  for (let screen = 0; screen < 5; screen++) {
    const points = await findClickPoints(re, opts);
    for (const pt of points) {
      await page.mouse.click(pt.x, pt.y);
      await sleep(settleMs);
      // Trace what the tap actually did. "clicked and nothing happened" and
      // "clicked the wrong thing" are different bugs with the same symptom.
      lastClickTrace.push(`(${Math.round(pt.x)},${Math.round(pt.y)}) -> ${await page.evaluate(() => location.pathname + location.search)}`);
      if (await predicate()) return true;
    }
    const moved = await page.evaluate(() => {
      const before = window.scrollY;
      window.scrollBy(0, Math.round(window.innerHeight * 0.8));
      return window.scrollY !== before;
    });
    if (!moved) break; // bottom of the page — genuinely not here
    await sleep(600);
  }
  return false;
};

const clickText = async (re, opts = {}) => {
  const pt = await findClickPoint(re, opts);
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  return true;
};

/**
 * Polls until `re` is actually CLICKABLE (present, on screen, and passing the
 * same elementFromPoint hit-test a real tap would), then clicks it.
 *
 * Why this exists: a Vaul sheet animates in from the bottom, so for a few
 * hundred ms after it opens its footer sits BELOW the viewport — present in
 * the DOM, invisible to a hit-test. `clickText` correctly refuses to click a
 * point that wouldn't receive the tap and returns false; a caller that treats
 * that as "the button is broken" turns a timing condition into a bug report.
 * That is exactly how the tap-through audit came to claim the modal guard had
 * failed when the sheet was simply still sliding up.
 *
 * Returns false only if the affordance never became clickable within the
 * window — a genuinely reportable fact, and a different one from "clicking it
 * did nothing".
 */
const clickTextWhenReady = async (re, opts = {}, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pt = await findClickPoint(re, opts);
    if (pt) { await page.mouse.click(pt.x, pt.y); return true; }
    if (Date.now() >= deadline) return false;
    await rawSleep(150);
  }
};

// Whitespace-NORMALISED. `innerText` reflects rendering, so a heading that
// wraps ("did movie night / happen?") arrives with a newline in the middle and
// /did movie night happen/ silently fails to match — the phrase is on screen,
// the check says absent. That cost four rounds of debugging a morning-after
// sheet that was visible in every screenshot: the gate wasn't wrong about the
// page, it was asking the question wrong. Any multi-word matcher here is a
// candidate for the same trap, so normalise once, centrally.
const hasText = (re) =>
  page.evaluate((src) => new RegExp(src, 'i').test((document.body.innerText || '').replace(/\s+/g, ' ')), re.source);

/**
 * Waits until at most ONE Vaul drawer is mounted.
 *
 * Why this exists: the create flow force-closes its expanders on propose, but
 * Vaul keeps a closing drawer in the DOM through its exit animation. For a few
 * hundred ms after "see the night" there are TWO `[data-vaul-drawer]` nodes,
 * and the DateTimeSheet's header has a button reading exactly "cancel" — the
 * same text the detail sheet's cancel-the-night affordance has. A text click
 * in that window can land on the wrong sheet, after which the confirm never
 * opens and the tap-through audit reports the modal guard as BROKEN.
 *
 * That is the gate lying about a timing condition, which is the failure mode
 * this whole file exists to stop doing (see the 07-26 "blocked vs broken"
 * findings). So: wait for the settled state. Returns false on timeout so the
 * caller can report "sheets never settled" as its own distinct fact rather
 * than silently proceeding into an ambiguous click.
 */
const waitForSettledDrawers = async (timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await page.evaluate(() => document.querySelectorAll('[data-vaul-drawer]').length <= 1)) return true;
    if (Date.now() >= deadline) return false;
    await rawSleep(150);
  }
};

// Polls for `re` in the page text, the same contract as page.waitForFunction
// (resolves false on a plain timeout), but bails the instant the response
// interceptor above sets `blocked`, so a 429 is caught within one poll tick
// instead of waiting out the full timeout and only then logging what would
// otherwise read as an ordinary step FAIL.
const waitForTextOrBlocked = async (re, timeoutMs, interval = 200) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (blocked) throw new BlockedError(blocked);
    if (await hasText(re)) return true;
    await rawSleep(interval);
  }
  if (blocked) throw new BlockedError(blocked);
  return false;
};

// body-lock audit: body must be interactive unless a vaul drawer is open
const bodyClean = async (label) => {
  const s = await page.evaluate(() => {
    const anyDrawerOpen = !!document.querySelector('[data-vaul-drawer][data-state="open"], [vaul-drawer][vaul-drawer-visible="true"]');
    const b = document.body.style;
    return { anyDrawerOpen, pe: b.pointerEvents || '', pos: b.position || '', ov: b.overflow || '' };
  });
  const locked = s.pe === 'none' || s.pos === 'fixed';
  step(`body clean after ${label}`, s.anyDrawerOpen || !locked, JSON.stringify(s));
};

try {
  // login
  await page.goto(`${ORIGIN}/login`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 });
  await page.type('input[autocomplete="username"]', EMAIL);
  await page.type('input[autocomplete="current-password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname.startsWith('/home'), { timeout: 60000 });
  step('login', true);
  await sleep(3000);
  await clickText(/^skip$/); // first-run tour if present
  await sleep(800);

  // lists → movie night list
  const upcomingBefore = upcomingResponses;
  await page.goto(`${ORIGIN}/lists`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);

  // A night that has since passed pops the MORNING-AFTER prompt ("did movie
  // night happen?") over whatever screen you land on, and it correctly swallows
  // every tap underneath. That is the product working; it is also a modal the
  // gate has to clear before it can touch anything. Left unhandled it looks
  // exactly like "the list tile isn't clickable" — the tiles render, they just
  // never receive the tap — which is a full class of misdiagnosis away from the
  // truth. Dismiss it, and SAY that we did.
  // POLLED, not sampled once: the prompt is driven by a fetch that resolves a
  // beat after the page paints, so a single check right after navigation reads
  // "no prompt" and then the sheet appears underneath the very next click.
  const ma = await settleMorningAfter(upcomingBefore);
  step('morning-after prompt settled', ma !== 'stuck' && ma !== 'timeout',
    ma === 'none' ? 'no past night awaiting an answer'
    : ma === 'cleared' ? 'a past night popped the "how was it?" sheet; dismissed it to reach the page underneath'
    : ma === 'stuck' ? 'the sheet would not dismiss — every step below would be tapping through an overlay'
    : 'the boot check never fetched /movie-nights/upcoming; cannot know whether a sheet is coming');

  // "movie night" is both the LIST's name and the words on any leftover night's
  // card, so clicking the first match is a coin flip — verify we actually
  // landed on a list detail route, and fall through to the next candidate if not.
  const onListDetail = () => page.evaluate(() => /\/lists\/.+/.test(location.pathname));
  // beforeEach re-dismisses: the sheet can still mount late, and once it is up
  // it swallows every tap underneath — which is indistinguishable from a tile
  // that doesn't work unless we clear it first.
  const opened = await clickTextUntil(/movie night/, onListDetail, { beforeEach: dismissMorningAfter });
  step('open list', opened, opened ? '' : 'no candidate matching /movie night/ navigated to a list detail route');
  // Halt rather than let ~38 downstream steps fail against a page we never
  // reached — that cascade is what makes a gate unreadable. Dump what the page
  // ACTUALLY shows first: "couldn't click it" and "it isn't rendered" and
  // "you're signed out" all look the same from a failed click.
  if (!opened) {
    const diag = await page.evaluate(() => ({
      url: location.pathname + location.search,
      matches: [...document.querySelectorAll('button,[role="button"],a,div,span,p')]
        .filter((n) => /movie night/i.test((n.textContent || '').trim()) && (n.textContent || '').trim().length < 60)
        .slice(0, 6)
        .map((n) => {
          const r = n.getBoundingClientRect();
          return `<${n.tagName.toLowerCase()}> "${(n.textContent || '').trim().slice(0, 40)}" @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
        }),
      bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    }));
    console.log('  page:', diag.url);
    console.log('  /movie night/ matches:', diag.matches.length ? diag.matches : '(none)');
    console.log('  body:', diag.bodyText);
    // WHAT is actually at the tile's centre? "the tile is there but something
    // else receives the tap" and "the tile isn't there" look identical from a
    // failed click; elementFromPoint distinguishes them outright.
    const occl = await page.evaluate(() => {
      const tile = [...document.querySelectorAll('div,button,a')]
        .find((n) => /^movie night\s*\d* films?$/i.test((n.textContent || '').trim()));
      if (!tile) return 'no tile element matched';
      const r = tile.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const path = [];
      for (let el = hit; el && path.length < 5; el = el.parentElement) {
        path.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 3).join('.') : ''}`);
      }
      return `tile @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} | elementFromPoint -> ${path.join(' < ')}`;
    });
    console.log('  hit-test:', occl);
    console.log('  click trace:', lastClickTrace.length ? lastClickTrace : '(no candidate was ever clicked)');
    await snap('open-list-failed');
    console.log('  screenshot: /tmp/harness/*-open-list-failed.png');
    throw new Error('could not open the movie-night list; every step below it would be meaningless');
  }
  await sleep(1500);

  // PRE-CLEAN: if a leftover pinned night exists, open + cancel it so the
  // create flow starts from a clean list every run.
  for (let guard = 0; guard < 3; guard++) {
    const hadPin = await hasText(/PINNED · MOVIE NIGHT/);
    if (!hadPin) break;
    await page.evaluate(() => {
      // The time fragment is `8:00 pm` for a normal night and `time tbd` for a
      // "decide later" one (shipped 07-27). Matching only am/pm meant a leftover
      // TBD night was never cleaned up, so every subsequent run started dirty and
      // the create flow diverged into a reschedule — which is how this gate ended
      // up failing 22/27 on an untouched checkout. A cleanup that silently skips
      // is worse than no cleanup: it reports success while leaving the mess.
      const el = [...document.querySelectorAll('div,button')].find((n) => /going|no answers? yet|nobody/i.test(n.textContent || '') && /\bpm\b|\bam\b|tbd/i.test(n.textContent || '') && n.getBoundingClientRect().height > 40 && n.getBoundingClientRect().height < 160);
      if (el) { const r = el.getBoundingClientRect(); window.__pt = { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
    });
    const pt = await page.evaluate(() => window.__pt || null);
    if (!pt) break;
    await page.mouse.click(pt.x, pt.y);
    await sleep(2500);
    await clickText(/^cancel$/, { inDrawer: true });
    await sleep(1200);
    await clickText(/cancel the night/);
    await sleep(3000);
    await page.evaluate(() => { window.__pt = null; });
  }

  // The pre-clean above used to fail SILENTLY: if it couldn't identify or cancel
  // a leftover pin it just broke out of the loop and let the run continue, and
  // every downstream step then failed for a reason that had nothing to do with
  // the app. Report the precondition explicitly, so "the list was dirty" can
  // never again be read as "the create flow is broken".
  const startsClean = !(await hasText(/PINNED · MOVIE NIGHT/));
  step('pre-clean: list starts with no leftover night', startsClean,
    startsClean ? '' : 'a previous run left a night that this run could not cancel — every step below is unreliable');

  // plan a night (film-first from the list header row)
  const planned = await clickText(/plan one|plan a movie night/);
  step('plan entry visible', planned);
  await sleep(1500);

  // film-first: the picker should be open or openable; pick the first film
  const filmPt = () => page.evaluate(() => {
    const imgs = [...document.querySelectorAll('[data-vaul-drawer] img, [role="dialog"] img')].filter((i) => /tmdb/.test(i.src));
    if (!imgs.length) return null;
    const r = imgs[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  let pt1 = await filmPt();
  if (pt1) await page.mouse.click(pt1.x, pt1.y);
  let pickedFilm = !!pt1;
  if (!pickedFilm) {
    // maybe the sheet opened without auto-picker (pre-fix): tap the film slot then pick
    await clickText(/pick a film|change/);
    await sleep(1200);
    const pt2 = await filmPt();
    if (pt2) await page.mouse.click(pt2.x, pt2.y);
    pickedFilm = !!pt2;
  }
  step('film picked', pickedFilm);
  await snap('film-picked');
  await sleep(1200);

  // visibility — set the night PRIVATE from the create sheet's own "who can
  // see it" segmented control, then verify the choice round-trips onto the
  // detail sheet after propose (asserted further down, post-propose).
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('[data-vaul-drawer] span, [data-vaul-drawer] div')]
      .find((n) => /^who can see it$/i.test((n.textContent || '').trim()));
    label?.scrollIntoView({ block: 'center' });
  });
  await sleep(400);
  const setPrivate = await clickText(/^private$/, { inDrawer: true });
  step('visibility: private tapped in create sheet', setPrivate);
  await sleep(400);
  step('visibility: private caption shown in create sheet', await hasText(/only the people invited/));

  // date + time (open the when expander if needed, then pick)
  await clickText(/pick a time|^time$|^8:00\s*pm$/, { inDrawer: true });
  await sleep(800);

  // PIN THE DATE TO TOMORROW. The create sheet defaults `selectedDate` to
  // TODAY (create-night-sheet.tsx:1037) and the showtime chips are fixed clock
  // times — so every run after 8pm local was proposing a night that had
  // already happened. The app refuses that correctly (`isPast` → the CTA goes
  // disabled and puts "that night's already come and gone" on screen), so the
  // propose click landed on a dead button, no request was ever made, and five
  // steps failed in a row describing everything except the reason.
  //
  // This gate had no business depending on what time it was run. `weekDays` is
  // `Array.from({length: 7}, (_, i) => addDays(today, i))`, so index 1 is
  // always today+1, and day-of-month is unique across any 7-day window.
  const tomorrow = new Date(Date.now() + 86_400_000);
  const dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][tomorrow.getDay()];
  const datePinned = await clickText(new RegExp(`^${dow}\\s*${tomorrow.getDate()}$`), { inDrawer: true });
  step(`date: pinned to tomorrow (${dow} ${tomorrow.getDate()}), so the run can't depend on the clock`, datePinned);
  await sleep(400);

  // "decide later" (timeTbd) — the day is set, the showtime isn't. The
  // invariant worth guarding is MUTUAL EXCLUSION: tbd and a real showtime are
  // two ways of settling the same thing, and a stale one left live behind the
  // other is how a night ends up storing an 8pm anchor while showing "time
  // tbd" (or the reverse). So: tap tbd, confirm it takes and explains itself,
  // then tap a real time and confirm tbd releases — which also leaves the
  // rest of this run on the normal timed path it has always tested.
  const tbdTapped = await clickText(/^decide later$/, { inDrawer: true });
  step('tbd: "decide later" chip tapped', tbdTapped);
  await sleep(400);
  step('tbd: caption explains what invitees will see', await hasText(/everyone sees time tbd/i));

  await clickText(/^8:00\s*pm$/, { inDrawer: true });
  await sleep(500);
  step(
    'tbd: picking a real showtime releases "decide later"',
    !(await hasText(/everyone sees time tbd/i)),
  );
  // confirm/done the expander if it has one, else it closes on select
  await clickText(/^done$|^set$|^confirm$/, { inDrawer: true });
  await sleep(800);

  // propose: ONE click, and this run's one movieNightCreate spend
  // (MOVIE_NIGHT_CREATES_THIS_RUN, logged at startup above).
  await snap('before-propose');

  // Read the CTA before trusting a click on it. A disabled button accepts the
  // tap silently and sends nothing, so "the confirm overlay never appeared" is
  // the LAST thing that went wrong, not the first — and on its own it points
  // at the confirm overlay, which was fine all along. The app states its
  // refusal in plain language on screen; surface that instead of a conclusion.
  const ctaState = await page.evaluate(() => {
    const norm = (n) => (n.textContent || '').replace(/\s+/g, ' ').trim();
    const btn = [...document.querySelectorAll('[data-vaul-drawer] button')].find((b) => /propose it/i.test(norm(b)));
    const body = document.body.innerText.replace(/\s+/g, ' ');
    return {
      found: !!btn,
      disabled: btn ? btn.disabled : null,
      refusal: /already come and gone/i.test(body)
        ? "app is refusing the date: \"that night's already come and gone\""
        : /pick a film/i.test(body)
          ? 'app is refusing: no film selected'
          : null,
    };
  });
  step(
    'propose CTA is live before we click it',
    ctaState.found && ctaState.disabled === false,
    ctaState.refusal || JSON.stringify(ctaState),
  );

  const netLog = [];
  page.on('response', (r) => { if (r.url().includes('/api/v1/movie-nights')) netLog.push(`${r.request().method()} ${r.url().split('/api')[1]} -> ${r.status()}`); });
  const proposed = await clickText(/propose it/, { inDrawer: true });
  step('propose clicked', proposed);
  const confirmShown = await waitForTextOrBlocked(/your night.s\s+proposed/, 20000);
  if (!confirmShown && !blocked) {
    // Secondary signal: the create sheet's own inline error line. The
    // response interceptor above is the primary signal and would already
    // have thrown by now if it had fired; this only catches the case where
    // that network event was somehow missed but the app still surfaced a
    // rate-limit message in the DOM.
    const rateLimitTextShown = await hasText(/too fast|slow down and try again/);
    if (rateLimitTextShown) {
      blocked = { kind: 'movie_night_quota', method: 'POST', path: '/api/v1/movie-nights', status: 429, url: `${ORIGIN}/api/v1/movie-nights`, source: 'dom-text-fallback' };
      throw new BlockedError(blocked);
    }
  }
  step('confirm overlay shown', confirmShown);
  await snap('after-propose');
  console.log('  net:', netLog.join(' | ') || 'no movie-nights calls seen');

  // THE regression: 'see the night' must work on the FIRST click
  await snap('confirm-overlay');
  const nightGets = [];
  page.on('response', async (r) => {
    if (/\/api\/v1\/movie-nights\/[A-Za-z0-9]+$/.test(r.url()) && r.request().method() === 'GET') {
      try { const j = await r.json(); nightGets.push({ id: r.url().split('/').pop(), status: j.data?.status, isHost: j.data?.viewer?.isHost }); } catch {}
    }
  });
  await clickText(/see the night/);
  const detailVisible = await page.waitForFunction(
    () => /who.s in|add to calendar/i.test(document.body.innerText),
    { timeout: 12000 },
  ).then(() => true).catch(() => false);
  const overlayGone = !(await hasText(/your night.s\s+proposed/));
  step('single-click see-the-night: overlay gone', overlayGone);
  step('single-click see-the-night: detail visible', detailVisible);
  const domReport = await page.evaluate(() => ({
    hasEditBtn: document.body.innerText.includes('edit time & details'),
    hasCalendar: document.body.innerText.includes('add to calendar'),
    hasCancelledBox: document.body.innerText.includes('was cancelled'),
    drawerCount: document.querySelectorAll('[data-vaul-drawer]').length,
    drawers: [...document.querySelectorAll('[data-vaul-drawer]')].map((d) => ({
      state: d.getAttribute('data-state'),
      text: (d.innerText || '').replace(/\s+/g, ' ').slice(0, 70),
    })),
  }));
  console.log('  night GETs:', JSON.stringify(nightGets), 'dom:', JSON.stringify(domReport));
  // visibility round-trip: the night was set PRIVATE during create — the
  // detail sheet's calm mono indicator must show it, unprompted, on this
  // same first open (no refetch/navigation involved).
  step('visibility: private indicator shown on detail sheet after round trip', await hasText(/only the people invited/));
  await bodyClean('see-the-night');

  // TAP-THROUGH AUDIT — the class fix regression (portal-over-open-drawer):
  // a body-portaled confirm must swallow every background press (its own
  // dim AND buttons), never leak the pointerdown up to Radix's document-
  // level DismissableLayer, which would otherwise read it as "outside" the
  // drawer and silently dismiss the sheet underneath. Real coordinate
  // clicks, hit-tested via elementFromPoint exactly like the rest of this
  // harness — never a synthetic dispatchEvent.
  await snap('tap-through-before');
  // Two separate readiness conditions, each reported as itself rather than
  // being allowed to masquerade as a guard failure: (1) a still-closing
  // create-flow sheet also has a button reading exactly "cancel", so wait for
  // the sheets to settle before a text click can be ambiguous; (2) the detail
  // sheet's footer is below the viewport while it slides up, so wait for the
  // cancel affordance to actually be hit-testable.
  step('tap-through: create sheets settled before opening the confirm', await waitForSettledDrawers());
  const cancelReady = await clickTextWhenReady(/^cancel$/);
  step('tap-through: cancel affordance reachable on the detail sheet', cancelReady);
  const tapThroughShown = cancelReady && await page.waitForFunction(
    () => /cancel movie night\?/i.test(document.body.innerText),
    { timeout: 8000 },
  ).then(() => true).catch(() => false);
  step('tap-through: confirm modal shown', tapThroughShown);

  if (tapThroughShown) {
    await snap('tap-through-confirm-open');

    // The confirm only sits visually on top — it doesn't reflow anything —
    // so real rects can be read straight off the still-mounted, now-covered
    // detail-sheet elements underneath it.
    const editBtnPt = await page.evaluate(() => {
      const rx = /edit time & details/i;
      const nodes = [...document.querySelectorAll('button, [role="button"], div, span, p')]
        .filter((n) => rx.test((n.textContent || '').trim()) && (n.textContent || '').trim().length < 60);
      if (!nodes.length) return null;
      const el = nodes[nodes.length - 1].closest('button, [role="button"]') || nodes[nodes.length - 1];
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const midAwayPt = await page.evaluate(() => {
      const card = document.querySelector('[data-cc-modal-guard]')?.firstElementChild;
      const r = card?.getBoundingClientRect();
      const x = innerWidth / 2;
      if (!r) return { x, y: innerHeight / 2 };
      // a y clearly outside the card's own box, still inside the viewport
      const y = r.top > 100 ? Math.max(8, r.top - 30) : Math.min(innerHeight - 8, r.bottom + 30);
      return { x, y };
    });
    const bgPoints = [
      ['top header area', { x: 195, y: 50 }],
      ['mid-screen away from the confirm card', midAwayPt],
      ["the edit time & details button's position", editBtnPt],
    ];

    for (const [label, pt] of bgPoints) {
      if (!pt) { step(`tap-through: found point for ${label}`, false); continue; }
      await page.mouse.click(pt.x, pt.y);
      await sleep(400);
      const confirmStillVisible = await hasText(/cancel movie night\?/);
      const detailStillOpen = await page.evaluate(
        () => !!document.querySelector('[data-vaul-drawer][data-state="open"]'),
      );
      const hitInsideGuard = await page.evaluate(
        ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-cc-modal-guard]'),
        pt,
      );
      step(`tap-through: confirm survives click on ${label}`, confirmStillVisible);
      step(`tap-through: detail sheet stays open after ${label}`, detailStillOpen);
      step(`tap-through: elementFromPoint(${label}) lands inside the guard`, hitInsideGuard);
    }

    await clickText(/keep it/);
    await sleep(1000);
    const tapThroughConfirmClosed = !(await hasText(/cancel movie night\?/));
    const tapThroughDetailOpen = await hasText(/who.s in|add to calendar/);
    step('tap-through: keep it closes the confirm', tapThroughConfirmClosed);
    step('tap-through: detail sheet still open after keep it', tapThroughDetailOpen);
    await bodyClean('tap-through keep-it');
    await snap('tap-through-after-keep-it');
  }

  // host cancel — first click opens confirm, first click on confirm acts
  // (this is the ACTUAL cleanup for the night the tap-through audit just
  // exercised: it clicked "keep it", not "cancel the night", so the night is
  // still open and this existing block cancels it for real.)
  await snap('detail-before-cancel');
  // Same readiness rule as the tap-through opener above — this click has
  // simply had more elapsed time on its side historically, not more safety.
  const realCancelReady = await clickTextWhenReady(/^cancel$/);
  step('cancel affordance reachable on the detail sheet', realCancelReady);
  const cancelModal = realCancelReady && await page.waitForFunction(
    () => /cancel movie night\?/i.test(document.body.innerText),
    { timeout: 8000 },
  ).then(() => true).catch(() => false);
  step('single-click cancel: confirm modal shown', cancelModal);
  await snap('cancel-modal');
  await clickText(/cancel the night/);
  await sleep(3000);
  const modalGone = !(await hasText(/cancel movie night\?/));
  step('single-click cancel-the-night: modal gone', modalGone);
  await bodyClean('cancel');

  // stale-pin regression: without navigating, the pinned card for THIS night
  // must be gone (or the whole pin area consistent: no TONIGHT card + one-liner together)
  await sleep(2000);
  const pinState = await page.evaluate(() => ({
    hasPin: /PINNED · MOVIE NIGHT/i.test(document.body.innerText),
    hasEmptyLiner: /no movie night yet/i.test(document.body.innerText),
  }));
  step('pin and empty-liner mutually exclusive', !(pinState.hasPin && pinState.hasEmptyLiner), JSON.stringify(pinState));

  // SCENARIO B — owner-reported: entering from a MOVIE CARD must carry that
  // film into the create sheet (no film picker, no 'pick a film' state).
  const cellPt = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('main img, img')].filter((i) => {
      const r = i.getBoundingClientRect();
      return /tmdb/.test(i.src) && r.top > 250 && r.width > 60;
    });
    if (!imgs.length) return null;
    const r = imgs[imgs.length - 1].getBoundingClientRect(); // last poster = the grid, never the pin card
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  step('movie card found', !!cellPt);
  if (cellPt) {
    await page.mouse.click(cellPt.x, cellPt.y);
    await sleep(3000); // drawer opens + details load
    const rowTapped = await clickText(/plan a movie night/, { inDrawer: true });
    step('drawer plan row tapped', rowTapped);
    await sleep(1800);
    await snap('drawer-entry-create-sheet');
    const createVisible = await hasText(/date night/);
    const pickerLeaked = await page.evaluate(() => {
      const t = document.body.innerText;
      const searchInput = [...document.querySelectorAll('[data-vaul-drawer] input')].some((i) => /search/i.test(i.placeholder || ''));
      return /pick a film to propose it/i.test(t) || searchInput;
    });
    step('film carried from movie card (no picker)', createVisible && !pickerLeaked);
    await clickText(/^cancel$/, { inDrawer: true }); // tidy up
    await sleep(1000);
    await bodyClean('drawer-entry cleanup');
  }
} catch (e) {
  if (e instanceof BlockedError) {
    blocked = e.info;
  } else if (!blocked) {
    step('harness crashed', false, e.message);
  }
  // else: a block was flagged concurrently with an unrelated exception;
  // `blocked` is already set and will drive the banner below.
} finally {
  await browser.close();
}

if (blocked) {
  printBlockedBanner(blocked, results.length);
  process.exit(EXIT.BLOCKED);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? EXIT.FAIL : EXIT.OK);
