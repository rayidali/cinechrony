'use client';

import { useEffect, useState } from 'react';

/**
 * The running build's identity, e.g. `1.0 (8)`.
 *
 * WHY THIS EXISTS. On 2026-07-28 the owner reported a feature missing from a
 * TestFlight build that was verifiably inside the uploaded .xcarchive. Neither
 * side could settle it, because nothing in the app says which build it is: a
 * TestFlight tester taps Update whenever they feel like it, and if the app was
 * running while iOS swapped the binary the live process keeps serving the OLD
 * image until a force-quit. "Is the fix on your phone?" was unanswerable, and
 * it cost two rounds of guessing. One line of text ends that class of argument
 * permanently — and it matters more, not less, once there are real testers who
 * can't be asked to reason about archives.
 *
 * Reads the NATIVE bundle (via @capacitor/app), not a baked-in constant: a
 * constant would be part of the frozen `out/` snapshot and could disagree with
 * the binary wrapping it, which is exactly the confusion this is meant to kill.
 * Renders nothing on web, where the concept doesn't apply — the browser always
 * has the newest deploy.
 */
export function AppVersion({ className }: { className?: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        if (!cancelled) setLabel(`${info.version} (${info.build})`);
      } catch {
        // Plugin missing or web — the line simply doesn't render.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!label) return null;
  return (
    <p className={className ?? 'font-mono text-[11px] text-muted-foreground'}>
      cinechrony {label}
    </p>
  );
}
