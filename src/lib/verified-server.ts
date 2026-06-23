/**
 * verified-server — the "official / verified account" system.
 *
 * Source of truth: `users/{uid}.verified === true` (single-field equality →
 * Firestore auto-indexes it, no manual index). The set of verified accounts is
 * tiny and changes rarely, so we read it ONCE per TTL and the client caches it
 * globally for O(1) `isVerified(uid)` lookups (no per-author fetch on a feed).
 *
 * Granting is admin-only (Admin SDK, which bypasses rules) — see
 * `scripts/grant-verified.ts`. We also set a custom claim (`verified` + `admin`)
 * so the same account can later gate privileged actions server-side; the BADGE
 * itself depends only on the Firestore flag, so it shows without a token refresh.
 */
import { getDb } from '@/firebase/admin';
import { getAuth } from 'firebase-admin/auth';

const TTL_MS = 5 * 60 * 1000;
let cache: { uids: string[]; at: number } | null = null;

/** All verified account uids (cached). */
export async function getVerifiedUids(nowMs: number): Promise<string[]> {
  if (cache && nowMs - cache.at < TTL_MS) return cache.uids;
  const snap = await getDb().collection('users').where('verified', '==', true).select().get();
  const uids = snap.docs.map((d) => d.id);
  cache = { uids, at: nowMs };
  return uids;
}

/** Resolve a uid from a @handle (case-insensitive). */
export async function resolveUidByUsername(username: string): Promise<string | null> {
  const norm = username.toLowerCase().replace(/^@/, '').trim();
  const db = getDb();
  let snap = await db.collection('users').where('usernameLower', '==', norm).limit(1).get();
  if (snap.empty) snap = await db.collection('users').where('username', '==', norm).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

/** Grant/revoke verified (+ admin custom claim). Admin SDK only. */
export async function setVerified(uid: string, verified: boolean, nowMs: number): Promise<void> {
  const db = getDb();
  await db.collection('users').doc(uid).set({ verified, updatedAt: new Date(nowMs) }, { merge: true });
  const auth = getAuth();
  const existing = (await auth.getUser(uid)).customClaims || {};
  await auth.setCustomUserClaims(uid, { ...existing, verified, admin: verified });
  cache = null; // invalidate the verified-set cache
}
