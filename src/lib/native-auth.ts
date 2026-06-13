'use client';

/**
 * Unified social sign-in. Works in both the web browser and inside the
 * Capacitor WebView on iOS/Android.
 *
 * Why this file exists:
 *   - In a browser, `signInWithPopup(auth, GoogleAuthProvider)` works.
 *   - Inside a WKWebView (iOS Capacitor), popups are blocked by the
 *     platform and OAuth redirects bounce the user out to Safari and
 *     fail to come back. Capacitor's Firebase Authentication plugin
 *     calls the *native* sign-in dialog instead — same provider, totally
 *     different code path.
 *
 * The trick: we keep using the Firebase Web SDK for everything else
 * (Firestore, auth state, real-time subscriptions). Only the actual
 * *sign-in dialog* changes. After the native plugin returns a credential,
 * we hand it to the Web SDK via `signInWithCredential` so `auth.currentUser`
 * lights up the same way it would after a web popup.
 *
 * Apple Sign-In is iOS-only here. Web Apple sign-in requires an Apple
 * Developer Service ID + return URL config that we don't have yet for
 * v1; the button is hidden on the web. The App Store *requires* Apple
 * Sign-In on iOS apps that offer Google sign-in, so the iOS button is
 * the load-bearing one.
 */

import type { Auth, User, UserCredential } from 'firebase/auth';
import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  signInWithPopup,
} from 'firebase/auth';

// Cancellation is a normal outcome (user closed the sheet). We surface it
// as a sentinel rather than an exception so the UI can ignore it silently.
export class AuthCancelledError extends Error {
  constructor() {
    super('Sign-in was cancelled.');
    this.name = 'AuthCancelledError';
  }
}

function isCancellation(err: unknown): boolean {
  if (!err) return false;
  const message = (err as { message?: string }).message ?? '';
  const code = (err as { code?: string }).code ?? '';
  return (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === '12501' ||
    /cancel|closed|dismiss/i.test(message)
  );
}

/**
 * Are we running inside the Capacitor WebView (iOS/Android), as opposed
 * to a normal browser tab? Used to decide which sign-in flow to call AND
 * to decide which UI buttons to show.
 *
 * Capacitor isn't available during SSR; this check returns false in
 * Node and on first render before the JS bundle hydrates. Treat it as
 * "definitely native" only after hydration.
 */
export function isNativeRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // Lazy import via globalThis to avoid pulling Capacitor into the
    // server bundle. The plugin attaches `Capacitor` to window.
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/**
 * Returns true if we should show a "Sign in with Apple" button. iOS native
 * only — App Store rule. Web Apple sign-in is deferred to a later phase.
 */
export function shouldShowAppleButton(): boolean {
  return isNativeRuntime();
}

// ─── Google ──────────────────────────────────────────────────────────────

async function signInGoogleNative(auth: Auth): Promise<User> {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;
  if (!idToken) {
    throw new Error('Google sign-in did not return an ID token.');
  }
  const credential = GoogleAuthProvider.credential(idToken);
  const { user }: UserCredential = await signInWithCredential(auth, credential);
  return user;
}

async function signInGoogleWeb(auth: Auth): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const { user } = await signInWithPopup(auth, provider);
  return user;
}

export async function signInWithGoogle(auth: Auth): Promise<User> {
  try {
    return isNativeRuntime() ? await signInGoogleNative(auth) : await signInGoogleWeb(auth);
  } catch (err) {
    if (isCancellation(err)) throw new AuthCancelledError();
    throw err;
  }
}

// ─── Apple ───────────────────────────────────────────────────────────────

async function signInAppleNative(auth: Auth): Promise<User> {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  const result = await FirebaseAuthentication.signInWithApple();

  const idToken = result.credential?.idToken;
  // The nonce is required so Apple's identity token can't be replayed
  // against another Firebase user. The plugin generates one and Firebase
  // verifies it server-side.
  const rawNonce = result.credential?.nonce;
  if (!idToken) {
    throw new Error('Apple sign-in did not return an ID token.');
  }

  const provider = new OAuthProvider('apple.com');
  const credential = provider.credential({ idToken, rawNonce });
  const { user } = await signInWithCredential(auth, credential);

  // Apple only returns the user's display name on the *first* sign-in.
  // The plugin composes it into `result.user.displayName` when present.
  // Patch the Firebase user so the Firestore profile gets a real name
  // (otherwise `me/ensure` falls back to "@<random>").
  const appleDisplayName = result.user?.displayName?.trim();
  if (appleDisplayName && !user.displayName) {
    const { updateProfile } = await import('firebase/auth');
    await updateProfile(user, { displayName: appleDisplayName });
  }

  return user;
}

export async function signInWithApple(auth: Auth): Promise<User> {
  if (!isNativeRuntime()) {
    throw new Error('Apple sign-in is only available in the iOS app for now.');
  }
  try {
    return await signInAppleNative(auth);
  } catch (err) {
    if (isCancellation(err)) throw new AuthCancelledError();
    throw err;
  }
}
