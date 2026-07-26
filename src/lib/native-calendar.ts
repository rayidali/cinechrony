'use client';

/**
 * Native "add to calendar" bridge (iOS) — replaces the old `window.open` of
 * an https `.ics` URL, which iOS misreads as a CalDAV SUBSCRIPTION feed
 * ("Add Subscription Calendar", read-only) instead of adding a one-time
 * event (device-confirmed bug). The fix presents the real native
 * `EKEventEditViewController` sheet.
 *
 * Native-only (iOS): backed by a tiny local Capacitor plugin —
 * `ios/App/App/CalendarBridgePlugin.swift`, registered from
 * `ios/App/App/AppViewController.swift`'s `capacitorDidLoad()` (NOT through
 * `capacitor.config.json`'s auto-generated `packageClassList` — this plugin
 * has no npm package to discover, so it's registered as a plugin INSTANCE,
 * same pattern as SharedAuthPlugin / LiveActivityPlugin).
 *
 * No-op (returns `false`) on web / PWA and on Android — callers should keep
 * (or fall back to) the existing `.ics` download/share path there.
 *
 * Never throws.
 */

import { registerPlugin, Capacitor } from '@capacitor/core';

export interface AddEventNativeOptions {
  title: string;
  startMs: number;
  endMs: number;
  notes?: string;
  url?: string;
}

interface CalendarBridgePlugin {
  addEvent(options: AddEventNativeOptions): Promise<{ saved: boolean }>;
}

// Bare `registerPlugin` call, same as every other Capacitor plugin's JS
// surface — safe/inert on web, no native package to load.
const CalendarBridge = registerPlugin<CalendarBridgePlugin>('CalendarBridge');

function isIOSNative(): boolean {
  return (
    typeof window !== 'undefined' &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'ios'
  );
}

/** Whether the native add-event sheet is available (iOS native runtime).
 *  Callers branch on this BEFORE calling `addEventNative`, because that
 *  function returns `false` for both "not available" and "user cancelled" —
 *  and only the first should fall back to the `.ics` path. */
export function canAddEventNative(): boolean {
  return isIOSNative();
}

/**
 * Present the native "add to calendar" sheet prefilled with the given event.
 * Resolves `true` only if the user actually saved the event (cancel, or a
 * denied calendar permission on iOS < 17, both resolve `false` rather than
 * throwing — there's nothing actionable for the caller to do differently).
 */
export async function addEventNative(opts: AddEventNativeOptions): Promise<boolean> {
  if (!isIOSNative()) return false;

  try {
    const { saved } = await CalendarBridge.addEvent(opts);
    return !!saved;
  } catch (err) {
    console.warn('[native-calendar] addEvent failed:', err);
    return false;
  }
}
