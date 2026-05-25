'use client';

import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase() {
  if (getApps().length) {
    return getSdks(getApp());
  }

  // This function is now robust for both client and server environments.
  // It checks for NEXT_PUBLIC_ variables (for client-side) and falls back to
  // non-prefixed variables (common for server-side build environments like Render).
  const firebaseConfig: FirebaseOptions = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
  };

  // This will throw if the variables are not set, which is good for debugging
  if (!firebaseConfig.projectId) {
    throw new Error('Firebase Project ID is not set. Check your environment variables.');
  }

  const firebaseApp = initializeApp(firebaseConfig);
  return getSdks(firebaseApp);
}


/**
 * Resolve a Firestore instance, opting into the persistent IndexedDB local
 * cache the first time we see this app. Persistence means every read goes
 * through IndexedDB before hitting the network: re-mounts of `useCollection`
 * (every tab switch in this app) serve the previous snapshot synchronously
 * from disk while the live subscription warms up.
 *
 * `initializeFirestore` must be called BEFORE any `getFirestore`. On the
 * second call (e.g., HMR, or a second `initializeFirebase` invocation) it
 * throws — we catch and fall back to the already-configured instance.
 *
 * The multi-tab manager lets two PWA windows share the same IndexedDB
 * cache safely without one tab clobbering the other's writes.
 *
 * IndexedDB is unavailable in Safari Private Browsing — persistence falls
 * back to in-memory automatically, with no behaviour change for callers.
 */
function resolveFirestore(firebaseApp: FirebaseApp): Firestore {
  try {
    return initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    // Already initialized — return the existing instance.
    return getFirestore(firebaseApp);
  }
}

export function getSdks(firebaseApp: FirebaseApp) {
  return {
    firebaseApp,
    auth: getAuth(firebaseApp),
    firestore: resolveFirestore(firebaseApp),
    storage: getStorage(firebaseApp),
  };
}

export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';