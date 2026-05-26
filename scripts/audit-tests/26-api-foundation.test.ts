/**
 * Phase A.2.4 — API-route foundation tests.
 *
 * Proves the new HTTP wrapper (`src/lib/api-handler.ts`) does what every
 * subsequent A.3 endpoint will rely on:
 *
 *   1. Bearer-token verification — missing/malformed/invalid → 401
 *      UNAUTHORIZED; a valid emulator-issued token → the route sees the
 *      correct verified uid.
 *   2. The envelope contract — success returns `{ ok: true, data }`; auth
 *      failure returns `{ ok: false, error: { code, message } }`.
 *   3. OPTIONS preflight — returns 204 with CORS headers when the origin
 *      is allowlisted, no CORS headers when it isn't.
 *
 * Wires through `/api/v1/_whoami` — the smallest real route that uses the
 * wrapper. Subsequent endpoint tests use the same `callRoute` helper.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, createTestUser, clearFirestore, clearAuth } from './harness.ts';
import { callRoute } from './lib/route-call.ts';
// Route handler under test. The import path triggers Next.js module resolution
// for `@/` aliases — node + tsconfig-paths via tsx handle this in the runner.
import { GET as whoamiGet, OPTIONS as whoamiOptions } from '@/app/api/v1/_whoami/route';

before(() => {
  setupTestEnv();
});

after(async () => {
  await clearFirestore();
  await clearAuth();
});

test('whoami: missing Authorization → 401 UNAUTHORIZED', async () => {
  const res = await callRoute(whoamiGet, 'GET');
  assert.equal(res.status, 401);
  assert.equal(res.body.ok, false);
  if (res.body.ok === false) {
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  }
});

test('whoami: malformed Authorization header → 401', async () => {
  const res = await callRoute(whoamiGet, 'GET', {
    headers: { Authorization: 'NotBearer abc' },
  });
  assert.equal(res.status, 401);
  if (res.body.ok === false) {
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  }
});

test('whoami: junk bearer token → 401', async () => {
  const res = await callRoute(whoamiGet, 'GET', { token: 'this-is-not-a-real-jwt' });
  assert.equal(res.status, 401);
  if (res.body.ok === false) {
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  }
});

test('whoami: empty bearer token → 401', async () => {
  const res = await callRoute(whoamiGet, 'GET', {
    headers: { Authorization: 'Bearer ' },
  });
  assert.equal(res.status, 401);
});

test('whoami: valid token → 200 with verified uid', async () => {
  const user = await createTestUser('whoami');
  const token = await user.getIdToken();

  const res = await callRoute<{ uid: string }>(whoamiGet, 'GET', { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  if (res.body.ok === true) {
    assert.equal(res.body.data.uid, user.uid, 'route sees the verified caller uid');
  }
});

test('whoami: two users get distinct uids (no token mix-up)', async () => {
  const a = await createTestUser('a');
  const b = await createTestUser('b');
  const [ta, tb] = await Promise.all([a.getIdToken(), b.getIdToken()]);

  const [ra, rb] = await Promise.all([
    callRoute<{ uid: string }>(whoamiGet, 'GET', { token: ta }),
    callRoute<{ uid: string }>(whoamiGet, 'GET', { token: tb }),
  ]);

  assert.equal(ra.body.ok && ra.body.data.uid, a.uid);
  assert.equal(rb.body.ok && rb.body.data.uid, b.uid);
});

test('OPTIONS preflight from allowlisted origin → 204 + CORS headers reflected', async () => {
  const res = await callRoute(whoamiOptions, 'OPTIONS', {
    headers: { Origin: 'capacitor://localhost' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /GET/);
  assert.match(res.headers.get('access-control-allow-headers') ?? '', /Authorization/);
});

test('OPTIONS preflight from non-allowlisted origin → 204 but NO Allow-Origin header', async () => {
  const res = await callRoute(whoamiOptions, 'OPTIONS', {
    headers: { Origin: 'https://evil.example.com' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('envelope: success body is always `{ ok: true, data }`', async () => {
  const user = await createTestUser('envelope');
  const token = await user.getIdToken();
  const res = await callRoute<{ uid: string }>(whoamiGet, 'GET', { token });
  assert.ok(res.body.ok === true);
  if (res.body.ok === true) {
    assert.ok('data' in res.body && typeof res.body.data === 'object');
  }
});

test('envelope: error body is always `{ ok: false, error: { code, message } }`', async () => {
  const res = await callRoute(whoamiGet, 'GET');
  assert.ok(res.body.ok === false);
  if (res.body.ok === false) {
    assert.ok(typeof res.body.error.code === 'string');
    assert.ok(typeof res.body.error.message === 'string');
  }
});
