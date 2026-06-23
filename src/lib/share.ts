/**
 * Canonical share URLs.
 *
 * `window.location.origin` is WRONG to share from the native app — there it's
 * the Capacitor WebView origin (`capacitor://localhost` / a localhost host),
 * which produces a dead link. We resolve a real public https origin so a shared
 * link both opens on the web and triggers the Universal Link into the app.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_APP_URL          — explicit canonical site URL, if set
 *   2. NEXT_PUBLIC_API_BASE_URL     — the Vercel origin the Capacitor build
 *                                     already targets for the API (== prod web)
 *   3. Vercel preview → production  — share the prod domain, not the preview
 *   4. window.location.origin       — plain web fallback
 */
export function shareOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  if (
    typeof window !== 'undefined' &&
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview' &&
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
  ) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  return typeof window !== 'undefined' ? window.location.origin : '';
}

/** Public, shareable URL for a profile (also a Universal Link into the app). */
export function profileShareUrl(username: string): string {
  return `${shareOrigin()}/profile/${username}`;
}
