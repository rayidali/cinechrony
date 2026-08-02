/**
 * Hedged model race (`src/lib/gemini-server.ts` → `hedgedRace`) — the policy
 * that decides how long a slow Gemini model gets before a second one is raced
 * beside it.
 *
 * WHY THIS EXISTS (measured, 2026-08-02, 52 fresh prod scans). The chain used
 * to be walked strictly serially: 2 attempts per model, each with a 110s hard
 * abort, so a model that HUNG rather than errored could burn ~223s before the
 * next model was even tried. In prod, 17% of fresh scans fell through to a
 * fallback and took a p50 of **145s against the primary's 26s**. Those users
 * were not waiting on analysis; they were waiting on a model that was never
 * going to answer.
 *
 * This sits in the path of EVERY scan, so its failure modes are asserted
 * directly rather than trusted: settle exactly once, abort the losers, promote
 * on failure without waiting out the hedge delay, reject only when the whole
 * chain has failed, and never fan out past the concurrency ceiling.
 *
 * Pure async policy, no emulator and no network — the racer takes the worker as
 * a parameter, so these are deterministic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FatalGeminiError, hedgedRace } from '@/lib/gemini-server';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MODELS = ['primary', 'second', 'third', 'fourth'];

test('the primary wins alone when it answers inside the hedge delay', async () => {
  const started: string[] = [];
  const out = await hedgedRace(
    MODELS,
    async (m) => {
      started.push(m);
      await sleep(5);
      return m;
    },
    60, // hedge delay far longer than the work
  );
  assert.equal(out, 'primary');
  assert.deepEqual(started, ['primary'], 'a fast primary must not spawn a hedge — that is the cost guarantee');
});

test('a slow primary gets a hedge raced beside it, and the faster answer wins', async () => {
  const started: string[] = [];
  const out = await hedgedRace(
    MODELS,
    async (m) => {
      started.push(m);
      if (m === 'primary') await sleep(400); // the hung-model case
      else await sleep(5);
      return m;
    },
    20,
  );
  assert.equal(out, 'second', 'the hedge should win rather than the run waiting out the primary');
  assert.ok(started.includes('primary') && started.includes('second'));
});

test('a losing model is aborted once someone else has won', async () => {
  let primaryAborted = false;
  const out = await hedgedRace(
    MODELS,
    async (m, signal) => {
      if (m === 'primary') {
        signal.addEventListener('abort', () => { primaryAborted = true; });
        await sleep(400);
        return m;
      }
      await sleep(5);
      return m;
    },
    20,
  );
  assert.equal(out, 'second');
  await sleep(10);
  assert.ok(primaryAborted, 'the slow loser must be cancelled, not left running against the function budget');
});

test('a failing model promotes the next one immediately, without waiting out the hedge delay', async () => {
  const at: Record<string, number> = {};
  const t0 = Date.now();
  const out = await hedgedRace(
    MODELS,
    async (m) => {
      at[m] = Date.now() - t0;
      if (m === 'primary') throw new Error('503 overloaded');
      await sleep(5);
      return m;
    },
    5_000, // enormous: if promotion waited on this, the test would time out
  );
  assert.equal(out, 'second');
  assert.ok(at.second < 1_000, `second should start on the failure, not the timer (started at ${at.second}ms)`);
});

test('rejects only once the whole chain has failed, surfacing the last reason', async () => {
  await assert.rejects(
    hedgedRace(
      ['a', 'b'],
      async (m) => { throw new Error(`no capacity (${m})`); },
      5,
    ),
    /no capacity/,
  );
});

test('a fatal error abandons the race instead of burning the rest of the chain', async () => {
  const started: string[] = [];
  await assert.rejects(
    hedgedRace(
      MODELS,
      async (m) => {
        started.push(m);
        throw new FatalGeminiError('401 bad key');
      },
      5,
    ),
    /bad key/,
  );
  assert.deepEqual(started, ['primary'], 'a bad key fails identically everywhere — racing more models is pure waste');
});

test('never exceeds the concurrency ceiling, however slow every model is', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await hedgedRace(
    ['a', 'b', 'c', 'd', 'e', 'f'],
    async (m) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(m === 'f' ? 5 : 300);
      inFlight--;
      return m;
    },
    10,
  ).catch(() => 'rejected');
  assert.ok(peak <= 3, `fan-out must stay bounded (peaked at ${peak})`);
  assert.ok(out !== 'rejected');
});

test('an empty chain rejects rather than hanging forever', async () => {
  await assert.rejects(hedgedRace([], async (m) => m, 5), /empty model chain/);
});
