'use client';

import { useEffect } from 'react';
import { registerPlugin, Capacitor } from '@capacitor/core';
import { isOverlayMounted } from '@/lib/overlay-markers';

/**
 * BackSwipeGuard — suspends WebKit's back-forward swipe while a drawer is open.
 *
 * WHY. Build 12 enabled `allowsBackForwardNavigationGestures`, restoring the
 * real iOS back gesture the app had as a PWA and lost in the Capacitor wrap.
 * That was right, but it dropped a guard the JS gesture it replaced had always
 * enforced: `native-transitions.tsx` refused to start a swipe whenever a
 * covering fixed overlay sat over the page.
 *
 * WebKit's gesture doesn't know Vaul drawers exist. It will pop the route out
 * from under an open sheet, and Vaul's scroll-lock restore — `body { position:
 * fixed; top: -<scrollY>px }`, undone in an unmount cleanup — never runs. The
 * result is a page whose content has scrolled out of view with only the
 * `position: fixed` chrome (bottom nav, FAB) still on screen. It does not
 * throw, so nothing reaches Sentry; it is a layout bug wearing a crash's
 * clothes.
 *
 * Prevention over cure. `body-style-watchdog.tsx` is the cure and stays exactly
 * as it was; this stops the state being reachable by a native swipe in the
 * first place. Both read the SAME selector (`overlay-markers.ts`) so they can
 * never disagree about what "open" means.
 *
 * Web is a no-op — there is no plugin, and Safari owns its own gesture.
 */

interface WebViewGesturePlugin {
  setBackSwipeEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
}

const WebViewGesture = registerPlugin<WebViewGesturePlugin>('WebViewGesture');

export function BackSwipeGuard() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Last value we successfully pushed native-side. Starts null so the first
    // evaluation always sends, rather than assuming the WebView's default.
    let applied: boolean | null = null;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const enabled = !isOverlayMounted();
      if (enabled === applied) return; // don't cross the bridge to say nothing
      applied = enabled;
      WebViewGesture.setBackSwipeEnabled({ enabled }).catch(() => {
        // Clear the memo so the next evaluation retries rather than believing
        // a state we never actually reached.
        applied = null;
      });
    };

    // The observer watches the whole body subtree, which in this app churns
    // constantly. Coalesce to one evaluation per frame so a busy render can't
    // turn into a burst of bridge calls.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    apply();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // A drawer announces its close through `data-state` before it unmounts,
      // and `role` covers the portaled dialogs that never carry a vaul marker.
      attributeFilter: ['data-vaul-drawer', 'data-vaul-overlay', 'data-state', 'role'],
    });

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      // Never leave the gesture suspended because this unmounted at a bad
      // moment — a missing back gesture is a regression the user feels at once.
      WebViewGesture.setBackSwipeEnabled({ enabled: true }).catch(() => {});
    };
  }, []);

  return null;
}
