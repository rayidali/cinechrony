import { publicApiRoute, optionsHandler, clientIp } from '@/lib/api-handler';
import { checkIpRateLimit } from '@/lib/rate-limit';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdminApp } from '@/firebase/admin';
import { isEmailConfigured, sendPasswordResetEmail } from '@/lib/email-server';

/**
 * POST /api/v1/auth/forgot-password { email }
 *
 * Sends a BRANDED password-reset email via Resend. The secure reset link is
 * minted by the Firebase Admin SDK (`generatePasswordResetLink`), so the token /
 * `confirmPasswordReset` security is unchanged — only the delivery + design move
 * to Resend. The link points at `/reset-password` (Firebase Console → Auth →
 * Templates → custom action URL).
 *
 * Non-disclosure (AUDIT 2.10): ALWAYS returns generic success — never reveals
 * whether an account exists. Returns `{ method: 'firebase' }` only to signal the
 * client to fall back to Firebase's own email when Resend isn't configured.
 */
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

// Per-email throttle (per serverless instance) so the endpoint can't be used to
// spam someone's inbox. Silently swallows repeats inside the window.
const THROTTLE_MS = 60_000;
const lastSent = new Map<string, number>();

export const POST = publicApiRoute(
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = String(body?.email || '').trim().toLowerCase();

    if (!EMAIL_RE.test(email)) return { method: 'resend' }; // generic success
    // Per-IP cap (in-memory) on top of the per-email throttle below — a single
    // source can't spam reset emails to many different addresses. Over the cap
    // we return the SAME generic-success shape (no 429): a 429 would make the
    // client fall back to Firebase's own email and defeat the limit.
    if (!checkIpRateLimit(clientIp(req), 'forgotPassword', { limit: 5, windowMs: 15 * 60_000 })) {
      return { method: 'resend' };
    }
    if (!isEmailConfigured()) return { method: 'firebase' }; // client falls back

    const now = Date.now();
    if (now - (lastSent.get(email) || 0) < THROTTLE_MS) return { method: 'resend' };
    lastSent.set(email, now);

    try {
      const link = await getAuth(getFirebaseAdminApp()).generatePasswordResetLink(email);
      await sendPasswordResetEmail(email, link);
    } catch {
      // user-not-found / disabled / etc. — swallow for non-disclosure.
    }
    return { method: 'resend' };
  },
  { softFallback: { method: 'firebase' } },
);

export const OPTIONS = optionsHandler;
