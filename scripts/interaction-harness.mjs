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
// 2026-07-26: the demo account's movieNightCreate quota (10/day, production
// Firestore) can exhaust mid-run since every propose click here is a real
// create. A 429 on that call now halts as a distinct BLOCKED outcome (exit
// code 3, see EXIT below), instead of cascading into what would otherwise
// look like ordinary step FAILUREs. Never "fix" a BLOCKED run by touching
// rate_limits/* in production; the counter resets itself.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

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
const MOVIE_NIGHT_DAILY_LIMIT = 10; // mirrors RATE_LIMITS.movieNightCreate.limit
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
  } catch { /* never let the interceptor itself take down the run */ }
});

const rawSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleep = async (ms) => { await rawSleep(ms); if (blocked) throw new BlockedError(blocked); };

// REAL single tap: find the element, then page.mouse.click at its center.
// Coordinate clicks go through hit-testing (pointer-events, overlay stacking)
// exactly like a finger — synthetic dispatchEvent would bypass the very bug
// class this harness exists to catch.
let shotN = 0;
const snap = async (tag) => page.screenshot({ path: `/tmp/harness/${String(++shotN).padStart(2, '0')}-${tag}.png` }).catch(() => {});
const clickText = async (re, { inDrawer = false } = {}) => {
  const pt = await page.evaluate(({ src, inDrawer }) => {
    const rx = new RegExp(src, 'i');
    const scope = inDrawer ? '[data-vaul-drawer] ' : '';
    const nodes = [...document.querySelectorAll(`${scope}button, ${scope}[role="button"], ${scope}a, ${scope}div, ${scope}span, ${scope}p`)]
      .filter((n) => rx.test((n.textContent || '').trim()) && (n.textContent || '').trim().length < 60)
      .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight; });
    // walk candidates from last to first, but ONLY accept one whose center
    // would truly receive the tap (elementFromPoint hit-test) — occluded or
    // offscreen-peeking matches (e.g. a closed drawer's header) are skipped.
    for (let i = nodes.length - 1; i >= 0; i--) {
      const el = nodes[i].closest('button, [role="button"], a') || nodes[i];
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2; const y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && (el.contains(hit) || hit.contains(el))) return { x, y };
    }
    return null;
  }, { src: re.source, inDrawer });
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  return true;
};

const hasText = (re) =>
  page.evaluate((src) => new RegExp(src, 'i').test(document.body.innerText), re.source);

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
  await page.goto(`${ORIGIN}/lists`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  await clickText(/movie night/);
  await page.waitForFunction(() => /\/lists\/.+/.test(location.pathname), { timeout: 20000 });
  await sleep(2500);
  step('open list', true);

  // PRE-CLEAN: if a leftover pinned night exists, open + cancel it so the
  // create flow starts from a clean list every run.
  for (let guard = 0; guard < 3; guard++) {
    const hadPin = await hasText(/PINNED · MOVIE NIGHT/);
    if (!hadPin) break;
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('div,button')].find((n) => /going|no answers? yet|nobody/i.test(n.textContent || '') && /pm|am/i.test(n.textContent || '') && n.getBoundingClientRect().height > 40 && n.getBoundingClientRect().height < 160);
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
  await clickText(/^8:00\s*pm$/, { inDrawer: true });
  await sleep(500);
  // confirm/done the expander if it has one, else it closes on select
  await clickText(/^done$|^set$|^confirm$/, { inDrawer: true });
  await sleep(800);

  // propose: ONE click, and this run's one movieNightCreate spend
  // (MOVIE_NIGHT_CREATES_THIS_RUN, logged at startup above).
  await snap('before-propose');
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
  await clickText(/^cancel$/);
  const tapThroughShown = await page.waitForFunction(
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
  await clickText(/^cancel$/);
  const cancelModal = await page.waitForFunction(
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
