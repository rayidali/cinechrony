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

export type ShareLinkResult = 'shared' | 'copied' | 'dismissed';

const isCancelledShare = (err: unknown) =>
  err instanceof Error && (/cancel|dismiss/i.test(err.message) || err.name === 'AbortError');

/**
 * Share a plain text+link (no rendered image) via the OS share sheet — e.g. a
 * movie-night invite (`night-detail-sheet.tsx` header icon, `ShareNightRow` on
 * a completed night). Mirrors `story-share.ts`'s `sendToFriend` native path
 * (`@capacitor/share`) but skips the PNG render since there's nothing to
 * render here; falls back to `navigator.share`, then the clipboard, on web —
 * same fallback chain as `card-overflow-menu.tsx` / `profile/page.tsx`.
 */
export async function shareLink(opts: { title: string; text: string; url: string }): Promise<ShareLinkResult> {
  let isNative = false;
  try {
    const { Capacitor } = await import('@capacitor/core');
    isNative = Capacitor.isNativePlatform();
  } catch {
    isNative = false;
  }

  if (isNative) {
    const { Share } = await import('@capacitor/share');
    try {
      await Share.share({ title: opts.title, text: opts.text, url: opts.url, dialogTitle: opts.title });
      return 'shared';
    } catch (err) {
      if (isCancelledShare(err)) return 'dismissed';
      throw err;
    }
  }

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: opts.title, text: opts.text, url: opts.url });
      return 'shared';
    } catch (err) {
      if (isCancelledShare(err)) return 'dismissed';
      // fall through to the clipboard
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(`${opts.text} ${opts.url}`);
    return 'copied';
  }
  return 'dismissed';
}
