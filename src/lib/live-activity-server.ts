/**
 * Live Activities — direct APNs delivery for the lock-screen scan tracker
 * (LIVE-ACTIVITY-PLAN.md). FCM cannot start a Live Activity and routes
 * `liveactivity` pushes to production APNs only (dev builds live in the
 * sandbox), so this module talks to APNs itself over HTTP/2 with an ES256
 * provider-token JWT minted from the same .p8 key the owner uploaded to
 * Firebase — supplied here via env, NEVER committed:
 *
 *   APNS_KEY_ID       — the 10-char key id (from the AuthKey_XXXXXXXXXX.p8 name)
 *   APNS_PRIVATE_KEY  — the .p8 PEM contents (\n-escaped is fine)
 *   APPLE_TEAM_ID     — defaults to GBR6GTFYCL
 *   APNS_BUNDLE_ID    — defaults to com.cinechrony.app
 *   LIVE_ACTIVITY_ENABLED=0 — kill switch (feature is on iff the key vars exist)
 *
 * Environment routing: an Xcode-installed build registers SANDBOX tokens,
 * TestFlight/App Store builds PRODUCTION ones — and the server can't tell
 * which it's holding. Every send therefore walks [hint, other] and treats
 * `BadDeviceToken` as "wrong environment, try the other host"; the caller
 * persists the env that worked (on the token doc / job doc) so later sends
 * go straight to the right host. Delivery is at-most-once by design — every
 * push carries the FULL content-state, so a dropped or duplicated send can
 * never corrupt the card (the DDIA idempotent-message rule).
 *
 * Nothing in here throws to a caller's happy path: the tracker is garnish on
 * the pipeline, never a failure mode of it.
 */

import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { connect as http2Connect } from 'node:http2';
import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { BadRequestError } from '@/lib/api-handler';

// ── Types ─────────────────────────────────────────────────────────────────

export type LaEnv = 'production' | 'sandbox';

/** The FULL card state, sent whole with every push. MUST match the Swift
 *  `ScanActivityAttributes.ContentState` (ios/App/Shared/ScanActivityAttributes.swift)
 *  key-for-key — ActivityKit decodes it with Codable and a missing
 *  non-optional key silently kills the update. */
export type LaContentState = {
  /** 1 fetching · 2 watching · 3 matching · 4 terminal — monotonic. */
  stage: number;
  /** The headline on the card: "watching it", "2 films found". */
  label: string;
  /** Optional second line: "Party (1984) · imdb 7.4". */
  detail: string | null;
  state: 'working' | 'done' | 'zero' | 'failed';
};

export type LaSendResult = {
  ok: boolean;
  env?: LaEnv;
  unregistered?: boolean;
  /** APNs rejection reason / failure class — carried into the job doc's
   *  liveActivity.trace so a dead card names its own cause. */
  reason?: string;
};

export type LaStartToken = {
  token: string;
  env: LaEnv | null;
  ref: FirebaseFirestore.DocumentReference;
};

// ── Config ────────────────────────────────────────────────────────────────

const bundleId = () => process.env.APNS_BUNDLE_ID || 'com.cinechrony.app';
const teamId = () => process.env.APPLE_TEAM_ID || 'GBR6GTFYCL';
const keyId = () => process.env.APNS_KEY_ID || '';
const privateKeyPem = () => (process.env.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n');

/** Push-to-start tokens older than this are treated as gone (the app
 *  re-uploads on every launch, so a live device is always fresh). */
const TOKEN_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const APNS_TIMEOUT_MS = 5_000;

export function isLiveActivityConfigured(): boolean {
  if (process.env.LIVE_ACTIVITY_ENABLED === '0') return false;
  return Boolean(keyId() && privateKeyPem());
}

// ── Provider-token JWT (ES256, cached ~45 min; Apple wants 20–60) ─────────

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let jwtCache: { token: string; issuedAt: number } | null = null;

function apnsJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  if (jwtCache && now - jwtCache.issuedAt < 45 * 60) return jwtCache.token;
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId() }));
  const claims = b64url(JSON.stringify({ iss: teamId(), iat: now }));
  const data = `${header}.${claims}`;
  const signature = cryptoSign('sha256', Buffer.from(data), {
    key: createPrivateKey(privateKeyPem()),
    dsaEncoding: 'ieee-p1363', // ES256 wants raw r||s, not DER
  });
  jwtCache = { token: `${data}.${b64url(signature)}`, issuedAt: now };
  return jwtCache.token;
}

// ── Transport (HTTP/2, one short-lived connection per send) ───────────────

type ApnsTransport = (
  env: LaEnv,
  deviceToken: string,
  headers: Record<string, string>,
  body: string,
) => Promise<{ status: number; body: string }>;

function realTransport(
  env: LaEnv,
  deviceToken: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const host = env === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    const client = http2Connect(host);
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error('apns timeout')), APNS_TIMEOUT_MS);
    client.on('error', fail);

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'content-type': 'application/json',
      ...headers,
    });
    let status = 0;
    let data = '';
    req.setEncoding('utf8');
    req.on('response', (h) => { status = Number(h[':status'] ?? 0); });
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.close();
      resolve({ status, body: data });
    });
    req.on('error', fail);
    req.end(body);
  });
}

/** Test seam: swap the network out entirely (the override also skips JWT
 *  minting, so tests never need a real .p8). */
let transportOverride: ApnsTransport | null = null;
export function __setLiveActivityTransportForTests(fn: ApnsTransport | null): void {
  transportOverride = fn;
}

function parseReason(body: string): string {
  try {
    return String((JSON.parse(body) as { reason?: string }).reason ?? '');
  } catch {
    return '';
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send one `liveactivity` push, walking environments until one accepts the
 * token. `BadDeviceToken` = wrong APNs environment for this token → try the
 * other host. 410/Unregistered = the token is dead forever → report it so
 * the caller can prune. Start/end sends (the ones that matter) get one
 * retry on transient 5xx/network; stage updates are disposable — the next
 * full-state push repairs a missed one. Never throws.
 */
async function apnsSend(
  kind: 'start' | 'update' | 'end',
  deviceToken: string,
  aps: Record<string, unknown>,
  envHint: LaEnv | null,
): Promise<LaSendResult> {
  const baseHeaders: Record<string, string> = {
    'apns-topic': `${bundleId()}.push-type.liveactivity`,
    'apns-push-type': 'liveactivity',
    'apns-priority': '10',
    'apns-expiration': String(Math.floor(Date.now() / 1000) + 600),
  };
  const body = JSON.stringify({ aps });
  const order: LaEnv[] = envHint
    ? [envHint, envHint === 'production' ? 'sandbox' : 'production']
    : ['production', 'sandbox'];
  const attemptsPerEnv = kind === 'update' ? 1 : 2;

  let lastReason = 'send_failed';
  for (const env of order) {
    let wrongEnvironment = false;
    for (let attempt = 0; attempt < attemptsPerEnv; attempt++) {
      try {
        const transport = transportOverride ?? realTransport;
        const headers = transportOverride
          ? baseHeaders
          : { ...baseHeaders, authorization: `bearer ${apnsJwt()}` };
        const res = await transport(env, deviceToken, headers, body);
        if (res.status === 200) return { ok: true, env };
        const reason = parseReason(res.body) || `http_${res.status}`;
        lastReason = reason;
        if (res.status === 410 || reason === 'Unregistered' || reason === 'ExpiredToken') {
          return { ok: false, unregistered: true, reason };
        }
        if (reason === 'BadDeviceToken') { wrongEnvironment = true; break; }
        if (res.status >= 500 && attempt < attemptsPerEnv - 1) { await delay(400); continue; }
        console.warn('[live-activity] apns rejected', kind, env, res.status, reason);
        return { ok: false, reason };
      } catch (err) {
        lastReason = 'transport';
        if (attempt < attemptsPerEnv - 1) { await delay(400); continue; }
        console.warn('[live-activity] apns transport failed', kind, env, err);
        return { ok: false, reason: 'transport' };
      }
    }
    if (!wrongEnvironment) return { ok: false, reason: lastReason };
    // BadDeviceToken → this token lives in the OTHER APNs environment.
  }
  return { ok: false, reason: lastReason };
}

// ── Payloads ──────────────────────────────────────────────────────────────

const nowSec = () => Math.floor(Date.now() / 1000);

/** Push-to-start (iOS 17.2+): the server births the activity on the lock
 *  screen — the share extension legally can't (`Activity.request` is
 *  app-only), and the hero flow never opens the app. */
export function sendLiveActivityStart(
  deviceToken: string,
  envHint: LaEnv | null,
  jobId: string,
  contentState: LaContentState,
): Promise<LaSendResult> {
  return apnsSend('start', deviceToken, {
    timestamp: nowSec(),
    event: 'start',
    'content-state': contentState,
    'attributes-type': 'ScanActivityAttributes',
    attributes: { jobId },
    alert: { title: 'cinechrony', body: 'scanning your reel' },
    'stale-date': nowSec() + 300,
  }, envHint);
}

export function sendLiveActivityUpdate(
  updateToken: string,
  envHint: LaEnv | null,
  contentState: LaContentState,
): Promise<LaSendResult> {
  return apnsSend('update', updateToken, {
    timestamp: nowSec(),
    event: 'update',
    'content-state': contentState,
    'stale-date': nowSec() + 300,
  }, envHint);
}

/** Terminal update. The card stays on the lock screen (dismissal-date; iOS
 *  caps the linger at ~4h) so the result survives the moment of delivery. */
export function sendLiveActivityEnd(
  updateToken: string,
  envHint: LaEnv | null,
  contentState: LaContentState,
): Promise<LaSendResult> {
  return apnsSend('end', updateToken, {
    timestamp: nowSec(),
    event: 'end',
    'content-state': contentState,
    'dismissal-date': nowSec() + 4 * 60 * 60,
  }, envHint);
}

// ── Push-to-start token registry (users/{uid}/laTokens/{deviceId}) ────────
// A LEASE, not a fact: tokens rotate; last-write-wins per device; stale docs
// are ignored and pruned. Server-only (no firestore.rules match → deny).

const TOKEN_RE = /^[0-9a-f]{32,512}$/i;
const DEVICE_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export async function registerLiveActivityToken(
  uid: string,
  deviceId: unknown,
  token: unknown,
): Promise<{ saved: boolean }> {
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
    throw new BadRequestError('Invalid deviceId.');
  }
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
    throw new BadRequestError('Invalid token.');
  }
  const db = getDb();
  const laTokens = db.collection('users').doc(uid).collection('laTokens');
  await laTokens.doc(deviceId).set({
    token,
    platform: 'ios',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  // Hygiene: keep only the newest few device leases — reinstalls mint fresh
  // deviceIds and abandoned docs would otherwise accumulate forever.
  try {
    const all = await laTokens.orderBy('updatedAt', 'desc').get();
    await Promise.all(all.docs.slice(3).map((d) => d.ref.delete()));
  } catch { /* best-effort */ }
  return { saved: true };
}

/** The freshest push-to-start token for a user (v1: newest device only), or
 *  null when the feature is unconfigured / the app never registered one. */
export async function getLiveActivityStartToken(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<LaStartToken | null> {
  if (!isLiveActivityConfigured()) return null;
  try {
    const snap = await db.collection('users').doc(uid).collection('laTokens')
      .orderBy('updatedAt', 'desc').limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const data = doc.data() as { token?: string; env?: LaEnv; updatedAt?: FirebaseFirestore.Timestamp };
    if (typeof data.token !== 'string' || !data.token) return null;
    const age = Date.now() - (data.updatedAt?.toMillis ? data.updatedAt.toMillis() : 0);
    if (age > TOKEN_STALE_MS) {
      doc.ref.delete().catch(() => {});
      return null;
    }
    return { token: data.token, env: data.env ?? null, ref: doc.ref };
  } catch (err) {
    console.warn('[live-activity] token lookup failed for', uid, err);
    return null;
  }
}

/** Read-repair: remember which APNs environment a token actually lives in so
 *  the next send goes straight there. Fire-and-forget. */
export function noteLiveActivityEnv(
  ref: FirebaseFirestore.DocumentReference,
  env: LaEnv,
): void {
  ref.set({ env }, { merge: true }).catch(() => {});
}

/** A start token APNs reports as gone-forever gets pruned. Fire-and-forget. */
export function pruneLiveActivityToken(ref: FirebaseFirestore.DocumentReference): void {
  ref.delete().catch(() => {});
}
