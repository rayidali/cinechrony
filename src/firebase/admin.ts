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
 */
export function getDb() {
  return getFirestore(getFirebaseAdminApp());
}
