/**
 * Audit test harness — Phase 0 (AUDIT.md)
 *
 * Provides an emulator-backed environment for the security/integrity regression
 * tests written in later phases. Everything here talks to the Firebase Local
 * Emulator Suite ONLY — it never touches a real Firebase project.
 *
 * Safety model:
 *  - Project id is `demo-cinechrony`. Firebase treats `demo-*` project ids as
 *    offline-only; the SDKs refuse to reach production for them.
 *  - `firebase emulators:exec` injects FIRESTORE_EMULATOR_HOST and
 *    FIREBASE_AUTH_EMULATOR_HOST into our env, so admin + client SDK calls are
 *    routed to localhost.
 *  - `getFirebaseAdminApp()` (src/firebase/admin.ts) hard-requires
 *    FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY and calls cert(). With the
 *    emulator host set the credential is never used to sign anything, but cert()
 *    still needs a syntactically valid PEM — so we generate a throwaway RSA key
 *    in-process. It is not a secret and never leaves this process.
 */

import { generateKeyPairSync } from 'node:crypto';
import { initializeApp as initAdminApp, getApps as getAdminApps, cert } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { initializeApp as initClientApp, getApps as getClientApps } from 'firebase/app';
import {
  getAuth as getClientAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';

export const PROJECT_ID = 'demo-cinechrony';

const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';

let envReady = false;

/**
 * Sets the env vars the app code (src/firebase/admin.ts) expects, BEFORE any
 * server-action module is imported. Idempotent.
 */
export function setupTestEnv(): void {
  if (envReady) return;

  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.GCLOUD_PROJECT = PROJECT_ID;

  if (!process.env.FIREBASE_PRIVATE_KEY) {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    // Stored with literal \n the way the app expects (admin.ts un-escapes it).
    process.env.FIREBASE_PRIVATE_KEY = (privateKey as string).replace(/\n/g, '\\n');
  }
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  process.env.FIREBASE_CLIENT_EMAIL = `test@${PROJECT_ID}.iam.gserviceaccount.com`;

  envReady = true;
}

function adminApp() {
  setupTestEnv();
  if (!getAdminApps().length) {
    initAdminApp({
      projectId: PROJECT_ID,
      credential: cert({
        projectId: PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
        privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getAdminApps()[0];
}

/** Admin Firestore (bypasses rules — same privilege server actions have). */
export function adminDb() {
  return getAdminFirestore(adminApp());
}

/** Admin Auth — used to verify emulator-issued ID tokens. */
export function adminAuth() {
  return getAdminAuth(adminApp());
}

function clientAuth() {
  setupTestEnv();
  if (!getClientApps().length) {
    initClientApp({ apiKey: 'demo-api-key', projectId: PROJECT_ID });
  }
  const auth = getClientAuth();
  // connectAuthEmulator is idempotent-ish but throws if called twice with
  // different config; guard via a flag on the auth object.
  const a = auth as unknown as { _auditEmulatorConnected?: boolean };
  if (!a._auditEmulatorConnected) {
    connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
    a._auditEmulatorConnected = true;
  }
  return auth;
}

export type TestUser = {
  uid: string;
  email: string;
  password: string;
  /** Fresh ID token, verifiable by adminAuth().verifyIdToken(). */
  getIdToken: () => Promise<string>;
};

let userSeq = 0;

/** Creates a brand-new auth user in the emulator and returns helpers. */
export async function createTestUser(label = 'user'): Promise<TestUser> {
  const auth = clientAuth();
  const email = `${label}-${Date.now()}-${userSeq++}@example.com`;
  const password = 'Test123!pw';
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  return {
    uid,
    email,
    password,
    getIdToken: async () => {
      const c = await signInWithEmailAndPassword(auth, email, password);
      return c.user.getIdToken(true);
    },
  };
}

/** Wipes all Firestore data in the emulator. Call between tests. */
export async function clearFirestore(): Promise<void> {
  const res = await fetch(
    `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error(`clearFirestore failed: ${res.status} ${await res.text()}`);
}

/** Wipes all Auth users in the emulator. Call between tests. */
export async function clearAuth(): Promise<void> {
  const res = await fetch(
    `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error(`clearAuth failed: ${res.status} ${await res.text()}`);
}

/**
 * Invokes a server action AS a given test user — injects that user's real
 * Firebase ID token as the first argument, matching the AUDIT.md Phase 1
 * convention `action(idToken, ...rest)`.
 *
 * This is the whole point of the harness: a test calls
 * `callActionAs(userA, updateBio, 'hacked')`, the action verifies userA's
 * token server-side and can only ever act as userA — there is no userId
 * parameter left to forge. Exploit tests also call actions with a raw bogus
 * token (see callActionWithRawToken) to assert rejection.
 *
 * Note: FormData-based actions (addMovieToList, uploadAvatar, etc.) don't take
 * idToken as a positional arg — their batch wires the token into the FormData.
 * Use callActionWithRawToken / direct calls for those.
 */
export async function callActionAs<T>(
  user: TestUser,
  action: (...args: any[]) => Promise<T>,
  ...args: any[]
): Promise<T> {
  const idToken = await user.getIdToken();
  return action(idToken, ...args);
}

/** Calls an action with a caller-controlled first arg (e.g. a forged/empty
 *  token) — used by exploit tests to assert Unauthorized. */
export async function callActionWithRawToken<T>(
  rawFirstArg: unknown,
  action: (...args: any[]) => Promise<T>,
  ...args: any[]
): Promise<T> {
  return action(rawFirstArg as any, ...args);
}
