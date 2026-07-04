'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import posthog from 'posthog-js';
import { useUser } from '@/firebase';
import { track, identifyUser, resetAnalytics, AnalyticsEvent } from '@/lib/analytics';

/**
 * Initializes PostHog once and keeps identity + pageviews in sync. Mounted once
 * in the root layout (inside FirebaseClientProvider so it can read auth). A
 * complete no-op until NEXT_PUBLIC_POSTHOG_KEY is set, so it's free to ship.
 *
 * Runs in both the web PWA and the Capacitor WebView (posthog-js is plain JS +
 * fetch to the api host; PostHog accepts events from any origin, incl.
 * capacitor://localhost).
 */
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

export function PostHogProvider() {
  const { user, isUserLoading } = useUser();
  const pathname = usePathname();
  const initedRef = useRef(false);
  const identifiedRef = useRef<string | null>(null);

  // One-time init.
  useEffect(() => {
    if (!KEY || initedRef.current) return;
    initedRef.current = true;
    posthog.init(KEY, {
      api_host: HOST,
      // Only create person profiles for logged-in users (cheaper + privacy).
      person_profiles: 'identified_only',
      // We fire $pageview ourselves on route change (App Router doesn't emit
      // navigations posthog-js can see automatically).
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: true,
      // Session replay OFF by default — enable in the PostHog project settings
      // when you want it (it's the heavier privacy surface).
      disable_session_recording: true,
    });
    track(AnalyticsEvent.AppOpened);
  }, []);

  // Pageview on every route change.
  useEffect(() => {
    if (!KEY || !initedRef.current) return;
    posthog.capture('$pageview', { $current_url: pathname });
  }, [pathname]);

  // Identify on login (by uid, no PII); reset on logout.
  useEffect(() => {
    if (!KEY || isUserLoading) return;
    if (user?.uid) {
      if (identifiedRef.current !== user.uid) {
        identifiedRef.current = user.uid;
        identifyUser(user.uid, user.displayName ? { name_set: true } : undefined);
      }
    } else if (identifiedRef.current) {
      identifiedRef.current = null;
      resetAnalytics();
    }
  }, [user?.uid, isUserLoading, user?.displayName]);

  return null;
}
