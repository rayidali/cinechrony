'use client';

import posthog from 'posthog-js';

/**
 * Product analytics — a thin, safe wrapper over posthog-js.
 *
 * Entirely gated on NEXT_PUBLIC_POSTHOG_KEY: with it unset, PostHog never
 * initializes and every call here is a no-op, so this is free until you add the
 * key. Every function is wrapped in try/catch — analytics must NEVER break the
 * app. Complements Sentry (errors); PostHog is behaviour (funnels, retention).
 *
 * We deliberately keep a MINIMAL, named event taxonomy (LAUNCH.md D.0.5) so the
 * App Store privacy label stays honest — no PII in event props, identify by uid
 * only. Autocapture (clicks) is on for out-of-the-box funnels; session replay is
 * OFF by default (flip it on in the PostHog project settings when you want it).
 */

const ENABLED = typeof window !== 'undefined' && !!process.env.NEXT_PUBLIC_POSTHOG_KEY;

/** The full analytics taxonomy — the only custom events we emit. */
export const AnalyticsEvent = {
  AppOpened: 'app_opened',
  SignupCompleted: 'signup_completed',
  MovieAdded: 'movie_added',
  ListCreated: 'list_created',
  ExtractionStarted: 'extraction_started',
  ExtractionSucceeded: 'extraction_succeeded',
  ExtractionSaved: 'extraction_saved',
  MovieNightCreated: 'movie_night_created',
  MovieNightRsvp: 'movie_night_rsvp',
  MovieNightCompleted: 'movie_night_completed',
  MovieNightMissed: 'movie_night_missed',
  MovieMarkedWatched: 'movie_marked_watched',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

export function track(event: AnalyticsEventName, props?: Record<string, unknown>): void {
  if (!ENABLED) return;
  try {
    posthog.capture(event, props);
  } catch {
    /* never let analytics throw into product code */
  }
}

/** Tie subsequent events to a user (by uid — NO email/PII). Call on login/boot. */
export function identifyUser(uid: string, props?: Record<string, unknown>): void {
  if (!ENABLED) return;
  try {
    posthog.identify(uid, props);
  } catch {
    /* noop */
  }
}

/** Clear the identity on logout so the next user isn't merged into this one. */
export function resetAnalytics(): void {
  if (!ENABLED) return;
  try {
    posthog.reset();
  } catch {
    /* noop */
  }
}
