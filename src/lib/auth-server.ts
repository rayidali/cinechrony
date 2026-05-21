/**
 * Server-side caller authentication. (AUDIT.md Phase 1.0.1)
 *
 * The root vulnerability the audit found: every server action accepts a
 * client-supplied `userId` and trusts it. The Firebase Admin SDK bypasses
 * Firestore rules, so nothing verifies the caller is who they claim.
 *
 * `verifyCaller` cryptographically verifies a Firebase ID token (signed by
 * Google; checked locally against cached public keys — no network round-trip,
 * scales statelessly) and returns the *verified* uid. Callers must use that
 * uid as the identity and ignore any client-passed userId argument.
 *
 * Returns a result object rather than throwing, to match the existing
 * `{ error }` / `{ success }` convention used throughout actions.ts:
 *
 *   const auth = await verifyCaller(idToken);
 *   if ('error' in auth) return auth;            // 401-equivalent
 *   const uid = auth.uid;                        // trusted identity
 *
 * NOTE: intentionally does NOT `import 'server-only'` — the audit test harness
 * imports actions (and therefore this) directly under tsx/node:test. It is only
 * ever reachable from server actions in production regardless.
 */

import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdminApp } from '@/firebase/admin';

export type VerifiedCaller = { uid: string };
export type AuthResult = VerifiedCaller | { error: string };

const UNAUTHORIZED = { error: 'Unauthorized' } as const;

/**
 * Verifies a Firebase ID token and returns the verified uid.
 *
 * @param idToken  The client's Firebase ID token (from user.getIdToken()).
 * @param opts.checkRevoked  When true, additionally checks the token has not
 *   been revoked / the user disabled. This makes a call to the Firebase Auth
 *   backend, so reserve it for high-stakes actions (e.g. account deletion).
 *   Default false → fully local verification.
 */
export async function verifyCaller(
  idToken: unknown,
  opts: { checkRevoked?: boolean } = {}
): Promise<AuthResult> {
  if (typeof idToken !== 'string' || idToken.length === 0) {
    return UNAUTHORIZED;
  }

  try {
    const decoded = await getAuth(getFirebaseAdminApp()).verifyIdToken(
      idToken,
      opts.checkRevoked === true
    );
    if (!decoded?.uid) return UNAUTHORIZED;
    return { uid: decoded.uid };
  } catch {
    // Expired, malformed, wrong-project, or revoked token.
    return UNAUTHORIZED;
  }
}

/** Type guard so call sites read cleanly. */
export function isAuthError(r: AuthResult): r is { error: string } {
  return 'error' in r;
}
