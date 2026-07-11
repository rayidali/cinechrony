'use client';

import { useEffect } from 'react';
import { useRouter } from '@/lib/native-nav';

/**
 * Renders nothing. On native runtimes (Capacitor iOS/Android), listens for
 * `appUrlOpen` events from `@capacitor/app` and routes the user to the right
 * in-app screen. Also drains the Share Extension's durable App Group queue.
 *
 * Two jobs:
 *  1. DEEP LINKS — Universal Links (`https://cinechrony.com/invite/…`), the
 *     custom scheme (`cinechrony://extract?url=…` from the Share Extension), and
 *     push-notification taps all arrive as `appUrlOpen`. We strip to the in-app
 *     path and use the router so navigation feels native (no WebView reload).
 *  2. SHARE INTAKE REDUNDANCY — the Share Extension always writes the shared URL
 *     to a shared App Group queue BEFORE trying to open the app. If that open
 *     ever fails (iOS can decline it), the share is NOT lost: on launch and on
 *     every resume we drain the queue and route into `/extract`. Deduped against
 *     the deep-link path so a share is handled exactly once.
 *
 * Web is a no-op.
 */

const APP_GROUP = 'group.com.cinechrony.shared';
const PENDING_KEY = 'cc_pending_shares';
const HANDLED_TS_KEY = 'cc_share_handled_ts';

export function DeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.() !== true) return;

    let removeUrlListener: (() => void) | undefined;
    let removeResumeListener: (() => void) | undefined;

    (async () => {
      try {
        const { App } = await import('@capacitor/app');

        // Cold-start deep link (fired before this mounted).
        const launch = await App.getLaunchUrl();
        if (launch?.url) routeFromUrl(launch.url, router);

        const urlHandle = await App.addListener('appUrlOpen', (event) => {
          if (event?.url) routeFromUrl(event.url, router);
        });
        removeUrlListener = () => void urlHandle.remove();

        // Redundancy: drain any shares the extension stashed (now + on every resume).
        void drainPendingShares(router);
        const resumeHandle = await App.addListener('resume', () => { void drainPendingShares(router); });
        removeResumeListener = () => void resumeHandle.remove();
      } catch (err) {
        console.error('[deep-link] setup failed:', err);
      }
    })();

    return () => {
      removeUrlListener?.();
      removeResumeListener?.();
    };
  }, [router]);

  return null;
}

function markShareHandled(tsSeconds?: number) {
  try {
    const ts = tsSeconds ?? Date.now() / 1000;
    const prev = Number(localStorage.getItem(HANDLED_TS_KEY) || '0');
    if (ts > prev) localStorage.setItem(HANDLED_TS_KEY, String(ts));
  } catch {
    /* ignore */
  }
}

/**
 * Drain the Share Extension's App Group queue. Reads via @capacitor/preferences
 * configured against the App Group; routes the newest unhandled share into
 * `/extract`; clears the queue. No-ops cleanly if the App Group isn't configured
 * (the deep-link path still works), so it can never strand the user.
 */
async function drainPendingShares(router: ReturnType<typeof useRouter>): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.configure({ group: APP_GROUP });
    const { value } = await Preferences.get({ key: PENDING_KEY });
    if (!value) return;

    let queue: { url?: string; ts?: number }[] = [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) queue = parsed;
    } catch {
      // corrupt payload — clear it so it can't wedge the intake.
      await Preferences.set({ key: PENDING_KEY, value: '[]' });
      return;
    }

    // We've consumed the queue — clear it regardless of what we route.
    await Preferences.set({ key: PENDING_KEY, value: '[]' });

    const handledTs = Number(localStorage.getItem(HANDLED_TS_KEY) || '0');
    const fresh = queue.filter(
      (s) => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url) && (s.ts || 0) > handledTs,
    );
    if (!fresh.length) return;

    const latest = fresh.reduce((a, b) => ((a.ts || 0) > (b.ts || 0) ? a : b));
    markShareHandled(latest.ts);
    router.push(`/extract?url=${encodeURIComponent(latest.url as string)}`);
  } catch {
    // @capacitor/preferences absent or App Group not set up — primary deep link covers it.
  }
}

/**
 * Pull the path + query off an incoming deep link and route it. Handles:
 *   - https://cinechrony.com/invite/ABC123          (Universal Link)
 *   - cinechrony://extract?url=<encoded video url>   (Share Extension)
 *   - https://cinechrony.com/extract?url=<encoded>   (web share)
 *   - capacitor://localhost/…                        (our own WebView — ignore)
 * Unrecognised links are dropped so a stray callback can't yank the user away.
 */
function routeFromUrl(rawUrl: string, router: ReturnType<typeof useRouter>): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    console.warn('[deep-link] malformed URL ignored:', rawUrl);
    return;
  }

  // Our own WebView origin round-tripping a tap we already handled — skip.
  if (url.protocol === 'capacitor:' || url.host === 'localhost') return;

  // Share Extension → the extractor. Custom scheme makes "extract" the HOST;
  // a Universal Link makes it the first path segment.
  if (url.host === 'extract' || url.pathname.startsWith('/extract')) {
    const shared = url.searchParams.get('url');
    if (shared && /^https?:\/\//.test(shared)) {
      markShareHandled(); // so the App Group drain doesn't re-fire this one
      router.push(`/extract?url=${encodeURIComponent(shared)}`);
    } else {
      router.push('/extract');
    }
    return;
  }

  const supportedPrefixes = ['/invite/', '/post/', '/movie/', '/profile/', '/lists/'];
  const path = url.pathname + url.search;
  if (supportedPrefixes.some((p) => path.startsWith(p))) {
    router.push(path);
  } else {
    console.info('[deep-link] unrecognised path, ignoring:', path);
  }
}
