'use client';

/**
 * SharedAuth — bridges the signed-in Firebase user's refreshable credential
 * into the iOS SHARED keychain (access group `GBR6GTFYCL.com.cinechrony.app`,
 * the sibling of the App Group `group.com.cinechrony.shared`) so the Share
 * Extension can call `/api/v1/*` on its own, WITHOUT opening the app — this is
 * what powers the Corner-app-style in-place drawer
 * (`PHASE-C-SHARE-EXTENSION.md`): tap share → scan right there over
 * Instagram/TikTok → save → done, the app never opens in the happy path.
 *
 * Native-only (iOS): backed by a tiny local Capacitor plugin —
 * `ios/App/App/SharedAuthPlugin.swift`, registered from
 * `ios/App/App/AppViewController.swift`'s `capacitorDidLoad()` (NOT through
 * `capacitor.config.json`'s auto-generated `packageClassList` — this plugin
 * has no npm package to discover, so it's registered as a plugin INSTANCE).
 * No-ops on web and on Android (no share-extension doorway there yet).
 *
 * Wired from the ONE central auth observer in `src/firebase/provider.tsx`:
 * signed in → `syncSharedAuth(user)`; signed out → `clearSharedAuth()`.
 *
 * Never throws — a keychain hiccup must never break sign-in/out.
 */

import { registerPlugin, Capacitor } from '@capacitor/core';
import type { User } from 'firebase/auth';

interface SharedAuthPlugin {
  set(options: { refreshToken: string; apiKey: string; uid: string }): Promise<void>;
  clear(): Promise<void>;
}

// Bare `registerPlugin` call, same as every other Capacitor plugin's JS surface
// (e.g. `@capacitor/preferences`) — safe/inert on web, no native package to load.
const SharedAuth = registerPlugin<SharedAuthPlugin>('SharedAuth');

function isIOSNative(): boolean {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

/** Same env var `initializeFirebase()` (`src/firebase/index.ts`, DO-NOT-MODIFY)
 *  reads for the web SDK's `apiKey` — resolved independently here so this
 *  module never has to touch that function. */
function firebaseWebApiKey(): string | undefined {
  return process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;
}

/**
 * Write the caller's refreshable credential into the shared keychain.
 * `user.refreshToken` is the Firebase Web SDK's long-lived refresh token — the
 * extension exchanges it for a fresh ID token itself
 * (`securetoken.googleapis.com`) each time it needs one, and writes back any
 * ROTATED refresh token it gets, so this app-side sync doesn't need to run on
 * every token refresh — only on sign-in / app boot with an existing session.
 */
export async function syncSharedAuth(user: User | null | undefined): Promise<void> {
  if (!user || !isIOSNative()) return;
  const apiKey = firebaseWebApiKey();
  if (!apiKey) {
    console.warn('[shared-auth] no Firebase apiKey configured — skipping keychain sync.');
    return;
  }

  try {
    await SharedAuth.set({ refreshToken: user.refreshToken, apiKey, uid: user.uid });
  } catch (err) {
    console.error('[shared-auth] failed to sync credential to keychain:', err);
  }
}

/** Clear the shared credential on sign-out, so the extension shows its
 *  "sign in to cinechrony first" state instead of authenticating as a stale user. */
export async function clearSharedAuth(): Promise<void> {
  if (!isIOSNative()) return;
  try {
    await SharedAuth.clear();
  } catch (err) {
    console.error('[shared-auth] failed to clear keychain credential:', err);
  }
}
