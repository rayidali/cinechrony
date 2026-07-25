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
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const ORIGIN = 'http://localhost:9002';
const EMAIL = 'demo@cinechrony.com';
const PASSWORD = readFileSync('.env.local', 'utf8').match(/^DEMO_ACCOUNT_PASSWORD=(.+)$/m)?.[1];
if (!PASSWORD) { console.error('no DEMO_ACCOUNT_PASSWORD in .env.local'); process.exit(2); }

const results = [];
const step = (name, ok, detail = '') => {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // date + time (open the when expander if needed, then pick)
  await clickText(/pick a time|^time$|^8:00\s*pm$/, { inDrawer: true });
  await sleep(800);
  await clickText(/^8:00\s*pm$/, { inDrawer: true });
  await sleep(500);
  // confirm/done the expander if it has one, else it closes on select
  await clickText(/^done$|^set$|^confirm$/, { inDrawer: true });
  await sleep(800);

  // propose — ONE click
  await snap('before-propose');
  const netLog = [];
  page.on('response', (r) => { if (r.url().includes('/api/v1/movie-nights')) netLog.push(`${r.request().method()} ${r.url().split('/api')[1]} -> ${r.status()}`); });
  const proposed = await clickText(/propose it/, { inDrawer: true });
  step('propose clicked', proposed);
  await page.waitForFunction(() => /your night.s\s+proposed/i.test(document.body.innerText), { timeout: 20000 })
    .then(() => step('confirm overlay shown', true))
    .catch(() => step('confirm overlay shown', false));
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
  await bodyClean('see-the-night');

  // host cancel — first click opens confirm, first click on confirm acts
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
  step('harness crashed', false, e.message);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
