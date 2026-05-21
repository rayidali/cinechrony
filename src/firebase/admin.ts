import { initializeApp, getApp, getApps, App, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Gets the Firebase Admin SDK App instance.
 * Initializes it if it's not already initialized.
 * This is a server-side utility.
 *
 * Required environment variables:
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_CLIENT_EMAIL
 * - FIREBASE_PRIVATE_KEY (the private key from the service account JSON)
 * - FIREBASE_STORAGE_BUCKET (optional, defaults to {projectId}.appspot.com)
 */
export function getFirebaseAdminApp(): App {
  if (getApps().length) {
    return getApp();
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin SDK credentials missing. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY environment variables.'
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    storageBucket,
  });
}

/**
 * Admin Firestore instance. (AUDIT.md 5.1)
 * The weekly-digest cron route imported this but it never existed — a latent
 * runtime crash hidden by ignoreBuildErrors. Now a real shared export.
 *
 * AUDIT.md 5.11: applies `ignoreUndefinedProperties: true` exactly once on
 * the singleton. Firestore Admin otherwise rejects any `undefined` field
 * value at write time — the bug class 2.2 caught (raw `posterHint` on an
 * older TMDB result hard-failed adds for real users). With this on, a stray
 * undefined is silently dropped instead of crashing the whole write. The
 * codebase already uses `|| null` everywhere it cares; this is a safety
 * net for everything it forgot.
 *
 * Must be called before the first read/write — and exactly once — or
 * Firestore throws "settings() has already been called". The module-level
 * flag guards both.
 */
let _firestoreSettingsApplied = false;
export function getDb() {
  const db = getFirestore(getFirebaseAdminApp());
  if (!_firestoreSettingsApplied) {
    // Set the flag FIRST so a throw below doesn't make every call retry.
    _firestoreSettingsApplied = true;
    try {
      db.settings({ ignoreUndefinedProperties: true });
    } catch {
      // Firestore throws if settings() is called after the instance has
      // already been used. In production getDb() is the first thing to touch
      // Firestore, so this succeeds. The only case it throws is a test
      // harness that seeded data before the first getDb() call — harmless to
      // ignore (tests seed well-formed data; ignoreUndefinedProperties is a
      // production safety net, not a test requirement).
    }
  }
  return db;
}
