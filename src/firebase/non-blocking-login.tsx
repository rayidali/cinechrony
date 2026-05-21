'use client';
import {
  Auth,
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';

/** Initiate anonymous sign-in. This is a non-blocking call. */
export function initiateAnonymousSignIn(authInstance: Auth): Promise<void> {
  // AUDIT.md 5.1: .then(()=>undefined) keeps the Promise<void> contract honest
  // (the resolved UserCredential is intentionally discarded). Behavior is
  // unchanged: success → resolves void, error → logged and swallowed.
  return signInAnonymously(authInstance)
    .then(() => undefined)
    .catch((error) => {
      // Errors will be caught by the onAuthStateChanged listener's error callback
      // or globally if not handled. We can log here for debugging if needed,
      // but the UI should react to onAuthStateChanged.
      console.error("Anonymous sign-in initiation failed:", error);
    });
}

/** Initiate email/password sign-up. This is a non-blocking call. */
export function initiateEmailSignUp(authInstance: Auth, email: string, password: string): Promise<void> {
  return createUserWithEmailAndPassword(authInstance, email, password)
    .then(() => undefined)
    .catch((error) => {
      console.error("Email sign-up initiation failed:", error);
      throw error; // Re-throw to be caught by the caller
    });
}

/** Initiate email/password sign-in. This is a non-blocking call. */
export function initiateEmailSignIn(authInstance: Auth, email: string, password: string): Promise<void> {
  return signInWithEmailAndPassword(authInstance, email, password)
    .then(() => undefined)
    .catch((error) => {
      console.error("Email sign-in initiation failed:", error);
      throw error; // Re-throw to be caught by the caller
    });
}
