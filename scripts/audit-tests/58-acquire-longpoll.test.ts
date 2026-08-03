/**
 * The Apify transport contract in `acquireVideo` — how long we wait to be told
 * the download is ready.
 *
 * WHY THIS EXISTS (measured, 2026-08-03). Per-stage timings showed the acquire
 * stage costing a FLAT 7.0s on every scan — and a constant is never a network
 * fetch. It decomposed into ~5.0s of real actor work plus ~1.8s of us not
 * looking: the poll loop slept a blind 3s BEFORE its first status check, so a
 * run that finished at 5.0s wasn't noticed until 6.0s. `waitForFinish` makes
 * Apify hold the connection and answer the instant the run is terminal.
 *
 * Two things are asserted because both failed quietly rather than loudly:
 *   - the START call asks for the long poll, and an already-terminal run costs
 *     ZERO extra status round-trips (the performance contract — dropping the
 *     param reintroduces the stall with every test still green);
 *   - an erroring status endpoint cannot hot-loop. The old loop was safe only
 *     because it slept 3s at the top; removing that sleep without adding a
 *     backoff would spin against Apify as fast as the network allows.
 *
 * `fetch` is stubbed, so there is no network and no actor spend.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { acquireVideo } from '@/lib/video-acquire-server';

const realFetch = globalThis.fetch;
const VIDEO = 'https://scontent.cdninstagram.com/v/t50/reel.mp4';

afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: string; method: string };

/** Stubs the three Apify endpoints the acquire path touches. `runStatus`
 *  decides what the status endpoint reports; `statusFails` makes it 500. */
function stubApify(opts: { startStatus: string; statusSequence?: string[]; statusFails?: number }) {
  const calls: Call[] = [];
  let statusHits = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

    if (url.includes('/acts/') && url.includes('/runs')) {
      return json({ data: { id: 'run_1', status: opts.startStatus, defaultDatasetId: 'ds_1' } });
    }
    if (url.includes('/actor-runs/')) {
      statusHits += 1;
      if (opts.statusFails && statusHits <= opts.statusFails) {
        return new Response('upstream boom', { status: 500 });
      }
      const next = opts.statusSequence?.[statusHits - 1] ?? 'SUCCEEDED';
      return json({ data: { status: next, defaultDatasetId: 'ds_1' } });
    }
    if (url.includes('/datasets/')) {
      return json([{ result: { medias: [{ url: VIDEO }], title: 'a caption' } }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  return { calls, statusCalls: () => calls.filter((c) => c.url.includes('/actor-runs/')) };
}

test('the run-start call asks Apify to hold the connection until the run finishes', async () => {
  process.env.APIFY_TOKEN = 'tok';
  process.env.APIFY_ACTOR_INSTAGRAM = 'easyapi~instagram-reels-downloader';
  const { calls } = stubApify({ startStatus: 'SUCCEEDED' });

  const got = await acquireVideo('https://www.instagram.com/reel/ABC/', 'instagram');

  assert.equal(got?.kind, 'media');
  const start = calls.find((c) => c.method === 'POST');
  assert.ok(start, 'expected a run-start POST');
  assert.match(
    start.url,
    /waitForFinish=\d+/,
    'the start call must long-poll — without it every scan pays the poll-granularity stall again',
  );
});

test('a run already terminal at start costs zero extra status round-trips', async () => {
  process.env.APIFY_TOKEN = 'tok';
  process.env.APIFY_ACTOR_INSTAGRAM = 'easyapi~instagram-reels-downloader';
  const { statusCalls } = stubApify({ startStatus: 'SUCCEEDED' });

  await acquireVideo('https://www.instagram.com/reel/ABC/', 'instagram');

  assert.equal(statusCalls().length, 0, 'the long poll already answered — polling again is the old 3s stall');
});

test('a run still going at start is followed with the long poll, not a blind sleep', async () => {
  process.env.APIFY_TOKEN = 'tok';
  process.env.APIFY_ACTOR_INSTAGRAM = 'easyapi~instagram-reels-downloader';
  const { statusCalls } = stubApify({ startStatus: 'RUNNING', statusSequence: ['SUCCEEDED'] });

  const got = await acquireVideo('https://www.instagram.com/reel/ABC/', 'instagram');

  assert.equal(got?.kind, 'media');
  const followUps = statusCalls();
  assert.equal(followUps.length, 1, 'one long-polling follow-up should settle it');
  assert.match(followUps[0].url, /waitForFinish=\d+/, 'the follow-up must long-poll too');
});

test('an erroring status endpoint backs off instead of spinning', async () => {
  process.env.APIFY_TOKEN = 'tok';
  process.env.APIFY_ACTOR_INSTAGRAM = 'easyapi~instagram-reels-downloader';
  // Three 500s, then success. With no backoff these would be issued back to
  // back as fast as the event loop allows; the loop has no sleep of its own.
  const { statusCalls } = stubApify({ startStatus: 'RUNNING', statusFails: 3 });

  const t0 = Date.now();
  const got = await acquireVideo('https://www.instagram.com/reel/ABC/', 'instagram');
  const elapsed = Date.now() - t0;

  assert.equal(got?.kind, 'media');
  assert.equal(statusCalls().length, 4, 'three failures then the success');
  assert.ok(
    elapsed >= 2_500,
    `three failed polls must be spaced, not spun (took ${elapsed}ms — a hot loop would finish in single-digit ms)`,
  );
});
