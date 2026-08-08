/**
 * Sentry must not report from a local dev session.
 *
 * WHY THIS IS A TEST AND NOT JUST A COMMENT. Build 9 exists because error
 * reporting had been INERT on device for eight builds: `instrumentation-client`
 * is DSN-gated and the DSN lived only in Vercel, so `Sentry.init` never ran in
 * the natively-built bundle. Putting the DSN into `.env.local` fixed that and
 * quietly created the opposite problem — every `npm run dev` since has been
 * posting to the production issue stream as `environment: development`. It went
 * unnoticed until a hydration warning from a throwaway fixture route, on one
 * laptop, arrived as a "New Issue" email.
 *
 * Both directions are cheap to reintroduce and neither fails loudly: an
 * over-tight gate silently stops reporting, an over-loose one silently floods.
 * This is a static source scan (same posture as suite 55) because the configs
 * are module-level side effects that cannot be imported and asserted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client = readFileSync('instrumentation-client.ts', 'utf8');
const server = readFileSync('instrumentation.ts', 'utf8');

test('the browser init is gated on BOTH a DSN and not-development', () => {
  assert.match(client, /NEXT_PUBLIC_SENTRY_DSN/, 'still DSN-gated');
  assert.match(
    client,
    /NODE_ENV\s*!==\s*'development'/,
    'a local dev session must not report into the production issue stream',
  );
});

test('the server init is gated too — gating only the browser leaves route errors flowing', () => {
  assert.match(server, /SENTRY_DSN/, 'still DSN-gated');
  assert.match(
    server,
    /NODE_ENV\s*===\s*'development'/,
    '`npm run dev` runs instrumentation.ts as well',
  );
});

test('both halves keep a deliberate opt-in escape hatch', () => {
  // Excluding dev outright would make "is my error handling actually working?"
  // unanswerable locally — the precise question build 9 was created to answer.
  assert.match(client, /NEXT_PUBLIC_SENTRY_DEV/, 'client opt-in exists');
  assert.match(server, /SENTRY_DEV/, 'server opt-in exists');
});

test('the gate is on NODE_ENV, so a native build still reports', () => {
  // `build:static` sets NODE_ENV=production (see package.json), which is the
  // whole reason this gate is safe: the device bundle is unaffected. Gating on
  // something like a missing VERCEL_ENV instead would have silenced native,
  // recreating the exact bug build 9 shipped to fix.
  const pkg = readFileSync('package.json', 'utf8');
  assert.match(pkg, /"build:static":\s*"[^"]*NODE_ENV=production/, 'the native build is production');
});
