'use client';

import { useEffect } from 'react';

/**
 * Renders nothing. Runs once on first mount inside a Capacitor runtime
 * to set up:
 *   - Status bar style: dark text on our cream background. Without this
 *     iOS defaults to white text, which is invisible on `#f7f3eb`.
 *   - Splash screen: hide explicitly. The `launchAutoHide: true` config
 *     in capacitor.config.ts gives us a max time-to-hide, but calling
 *     `hide()` here dismisses the splash the instant React mounts.
 *   - Keyboard accessory bar: hidden by default in Capacitor 8 but
 *     reasserted here for safety so it can't reappear after a
 *     configuration change.
 *
 * No-op on the web.
 */
export function NativeShellInit() {
  useEffect(() => {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.() !== true) return;

    let cancelled = false;

    (async () => {
      try {
        const [{ StatusBar, Style }, { SplashScreen }, { Keyboard }] = await Promise.all([
          import('@capacitor/status-bar'),
          import('@capacitor/splash-screen'),
          import('@capacitor/keyboard'),
        ]);
        if (cancelled) return;

        // `Style.Dark` = dark content (dark icons + dark text on the
        // status bar). Counter-intuitively named: it's the style to
        // use when the *background* is light, like our cream paper.
        await StatusBar.setStyle({ style: Style.Dark });
        // iOS only: paint a backdrop behind the status bar. Android
        // accepts this method too; both are no-ops in the web shim.
        await StatusBar.setBackgroundColor?.({ color: '#f7f3eb' }).catch(() => {});

        await SplashScreen.hide().catch(() => {});

        // Hide the iOS keyboard accessory bar (the "Done" toolbar above
        // the keyboard). Looks more native and reclaims ~44pt of room.
        await Keyboard.setAccessoryBarVisible?.({ isVisible: false }).catch(() => {});
      } catch (err) {
        console.error('[native-shell-init] failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
