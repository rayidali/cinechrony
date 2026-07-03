'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

/**
 * Renders nothing. Runs inside a Capacitor runtime to set up native chrome:
 *   - Status bar style: FOLLOWS THE APP THEME. Light theme → dark icons on the
 *     cream paper; dark theme → light icons on the near-black surface. (Was
 *     hard-coded to dark icons on cream once at mount, so a dark-mode user got
 *     an illegible dark clock/battery on a black bar for the whole session.)
 *   - Splash screen: hidden explicitly the instant React mounts.
 *   - Keyboard accessory bar: hidden (more native, reclaims ~44pt).
 *
 * No-op on the web.
 */
const isNative = () =>
  (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;

export function NativeShellInit() {
  const { resolvedTheme } = useTheme();

  // One-time chrome that doesn't depend on theme.
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ SplashScreen }, { Keyboard }] = await Promise.all([
          import('@capacitor/splash-screen'),
          import('@capacitor/keyboard'),
        ]);
        if (cancelled) return;
        await SplashScreen.hide().catch(() => {});
        await Keyboard.setAccessoryBarVisible?.({ isVisible: false }).catch(() => {});
      } catch (err) {
        console.error('[native-shell-init] failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Status bar re-styled whenever the resolved theme changes.
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    (async () => {
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        if (cancelled) return;
        const dark = resolvedTheme === 'dark';
        // Style.Light = LIGHT content (white icons) for a dark background;
        // Style.Dark = dark content for a light background. (Counter-intuitive.)
        await StatusBar.setStyle({ style: dark ? Style.Light : Style.Dark }).catch(() => {});
        await StatusBar.setBackgroundColor?.({ color: dark ? '#0a0a0a' : '#f7f3eb' }).catch(() => {});
      } catch {
        /* status-bar plugin unavailable — non-fatal */
      }
    })();
    return () => { cancelled = true; };
  }, [resolvedTheme]);

  return null;
}
