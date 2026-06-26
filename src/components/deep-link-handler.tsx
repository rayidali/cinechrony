'use client';

import { useEffect } from 'react';
import { useRouter } from '@/lib/native-nav';

/**
 * Renders nothing. On native runtimes (Capacitor iOS/Android), listens
 * for `appUrlOpen` events from `@capacitor/app` and routes the user to
 * the right in-app screen.
 *
 * Why this exists:
 *   When a friend taps `https://cinechrony.vercel.app/invite/ABC123` in
 *   Messages, iOS Universal Links handoff fires `appUrlOpen` with the
 *   FULL https URL. We don't want to load that URL in the WebView —
 *   the bundled `out/` has the same routes at `capacitor://localhost/
 *   invite/ABC123`. We strip the host and use the router so the
 *   navigation feels native (no WebView reload, no flicker).
 *
 *   Push notification taps also funnel through here: when the user taps
 *   a notification, our APNs payload's `click_action` (or the `data`
 *   field's deep-link) is delivered via the same `appUrlOpen` event.
 *
 * Web is a no-op — links open the corresponding page directly.
 */
export function DeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.() !== true) return;

    let removeListener: (() => void) | undefined;

    (async () => {
      try {
        const { App } = await import('@capacitor/app');

        // The user may have launched via a deep link — in that case the
        // event already fired before this component mounted. Capacitor's
        // `getLaunchUrl()` exposes that initial URL once.
        const launch = await App.getLaunchUrl();
        if (launch?.url) {
          routeFromUrl(launch.url, router);
        }

        const handle = await App.addListener('appUrlOpen', (event) => {
          if (event?.url) routeFromUrl(event.url, router);
        });
        removeListener = () => {
          void handle.remove();
        };
      } catch (err) {
        console.error('[deep-link] setup failed:', err);
      }
    })();

    return () => {
      removeListener?.();
    };
  }, [router]);

  return null;
}

/**
 * Pull the path + query off the incoming URL and hand it to the router.
 * The URL might be:
 *   - https://cinechrony.vercel.app/invite/ABC123 (Universal Link)
 *   - cinechrony://invite/ABC123 (custom scheme — if we ever register one)
 *   - capacitor://localhost/invite/ABC123 (WebView origin — ignore)
 *
 * Anything we don't recognise is silently dropped so a stray callback
 * doesn't accidentally yank the user out of what they're doing.
 */
function routeFromUrl(rawUrl: string, router: ReturnType<typeof useRouter>): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    console.warn('[deep-link] malformed URL ignored:', rawUrl);
    return;
  }

  // Anything originating from our own WebView origin means the OS is
  // round-tripping a tap we already handled — skip it.
  if (url.protocol === 'capacitor:' || url.host === 'localhost') return;

  // We support paths that the React app already knows about. Anything
  // outside this whitelist falls back to the home screen rather than
  // crashing the router with a non-existent route.
  const supportedPrefixes = ['/invite/', '/post/', '/movie/', '/profile/', '/lists/'];
  const path = url.pathname + url.search;
  const recognized = supportedPrefixes.some((p) => path.startsWith(p));

  if (recognized) {
    router.push(path);
  } else {
    console.info('[deep-link] unrecognised path, ignoring:', path);
  }
}
