/**
 * Phase C.1d — save confirmed extraction films into lists.
 *   - POST requires auth (401); only the owner of a DONE job can save (403)
 *   - createLists makes caller-owned lists; films land in them
 *   - integrity: only films from THIS job's results save (others → not_in_extraction)
 *   - authorization: a forged target at another user's list fails THAT item
 *     (forbidden) while the rest succeed — partial success is first-class
 *   - idempotent: re-saving the same film → deduped:true (no duplicate)
 *
 * The pipeline is stubbed in the emulator, so a done job carries the fixture
 * films (Heat 949 · GoodFellas 769 · Pulp Fiction 680).
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as saveRoute } from '@/app/api/v1/extractions/[jobId]/save/route';
import { createExtraction, runExtractionPipeline } from '@/lib/extraction-server';
import { createList } from '@/lib/lists-server';

let me_: TestUser, other: TestUser, meTok: string, otherTok: string;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  me_ = await createTestUser('me');
  other = await createTestUser('other');
  meTok = await me_.getIdToken();
  otherTok = await other.getIdToken();
});

/** Create a DONE job (fixture films) owned by `uid`. */
async function doneJob(uid: string): Promise<string> {
  const { jobId } = await createExtraction(uid, 'https://www.tiktok.com/@x/video/1');
  await runExtractionPipeline(jobId); // stub → done with fixtures
  return jobId;
}

const HEAT = { tmdbId: 949, mediaType: 'movie' as const };
const GOODFELLAS = { tmdbId: 769, mediaType: 'movie' as const };

test('save requires auth', async () => {
  const jobId = await doneJob(me_.uid);
  const res = await callRoute(saveRoute, 'POST', {
    params: { jobId }, url: `http://test/api/v1/extractions/${jobId}/save`,
    body: { items: [{ ...HEAT, target: { tempId: 'n1' } }], createLists: [{ tempId: 'n1', name: 'crime' }] },
  });
  assert.equal(res.status, 401);
});

test('only the job owner can save (403)', async () => {
  const jobId = await doneJob(me_.uid);
  const res = await callRoute(saveRoute, 'POST', {
    token: otherTok, params: { jobId }, url: `http://test/api/v1/extractions/${jobId}/save`,
    body: { items: [{ ...HEAT, target: { tempId: 'n1' } }], createLists: [{ tempId: 'n1', name: 'crime' }] },
  });
  assert.equal(res.status, 403);
});

test('creates a new list and saves the film into it', async () => {
  const jobId = await doneJob(me_.uid);
  const res = await callRoute<{ results: any[]; createdLists: Record<string, string> }>(saveRoute, 'POST', {
    token: meTok, params: { jobId }, url: `http://test/api/v1/extractions/${jobId}/save`,
    body: { createLists: [{ tempId: 'n1', name: 'crime classics' }], items: [{ ...HEAT, target: { tempId: 'n1' } }] },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  if (!res.body.ok) return;
  const listId = res.body.data.createdLists.n1;
  assert.ok(listId, 'new list created');
  assert.equal(res.body.data.results[0].ok, true);
  // the movie doc exists in the new list, with the source video as socialLink
  const movie = await adminDb().doc(`users/${me_.uid}/lists/${listId}/movies/movie_949`).get();
  assert.ok(movie.exists, 'Heat saved to the new list');
  assert.ok((movie.data()?.socialLink || '').includes('tiktok.com'), 'source video attached as socialLink');
});

test('only films from this job can be saved', async () => {
  const jobId = await doneJob(me_.uid);
  const res = await callRoute<{ results: any[] }>(saveRoute, 'POST', {
    token: meTok, params: { jobId }, url: `http://test/api/v1/extractions/${jobId}/save`,
    body: {
      createLists: [{ tempId: 'n1', name: 'x' }],
      items: [
        { ...HEAT, target: { tempId: 'n1' } },
        { tmdbId: 99999, mediaType: 'movie', target: { tempId: 'n1' } }, // not in the extraction
      ],
    },
  });
  assert.equal(res.body.ok, true);
  if (!res.body.ok) return;
  const byId = Object.fromEntries(res.body.data.results.map((r) => [r.tmdbId, r]));
  assert.equal(byId[949].ok, true);
  assert.equal(byId[99999].ok, false);
  assert.equal(byId[99999].error, 'not_in_extraction');
});

test('a forged target at another user\'s list fails that item; others succeed', async () => {
  const jobId = await doneJob(me_.uid);
  const { listId: othersList } = await createList(other.uid, 'not yours');
  const res = await callRoute<{ results: any[]; createdLists: Record<string, string> }>(saveRoute, 'POST', {
    token: meTok, params: { jobId }, url: `http://test/api/v1/extractions/${jobId}/save`,
    body: {
      createLists: [{ tempId: 'mine', name: 'mine' }],
      items: [
        { ...HEAT, target: { ownerId: other.uid, listId: othersList } }, // forged → forbidden
        { ...GOODFELLAS, target: { tempId: 'mine' } },                    // ok
      ],
    },
  });
  assert.equal(res.body.ok, true);
  if (!res.body.ok) return;
  const byId = Object.fromEntries(res.body.data.results.map((r) => [r.tmdbId, r]));
  assert.equal(byId[949].ok, false);
  assert.equal(byId[949].error, 'forbidden');
  assert.equal(byId[769].ok, true);
  // nothing leaked into the victim's list
  const leaked = await adminDb().doc(`users/${other.uid}/lists/${othersList}/movies/movie_949`).get();
  assert.equal(leaked.exists, false, 'no write to the other user\'s list');
});

test('re-saving the same film is idempotent (deduped)', async () => {
  const jobId = await doneJob(me_.uid);
  const first = await callRoute<{ createdLists: Record<string, string> }>(saveRoute, 'POST', {
    token: meTok, params: { jobId }, url: `http://test/api/v1/extractions/${jobId}/save`,
    body: { createLists: [{ tempId: 'n1', name: 'crime' }], items: [{ ...HEAT, target: { tempId: 'n1' } }] },
  });
  const listId = first.body.ok ? first.body.data.createdLists.n1 : '';
  const second = await callRoute<{ results: any[] }>(saveRoute, 'POST', {
    token: meTok, params: { jobId }, url: `http://test/api/v1/extractions/${jobId}/save`,
    body: { items: [{ ...HEAT, target: { ownerId: me_.uid, listId } }] },
  });
  assert.equal(second.body.ok, true);
  if (!second.body.ok) return;
  assert.equal(second.body.data.results[0].ok, true);
  assert.equal(second.body.data.results[0].deduped, true, 'second save dedupes');
});
