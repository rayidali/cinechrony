// Sentry client init (browser PWA + the Capacitor WKWebView run this same
// bundle). Next.js 15.3+ auto-loads `instrumentation-client.ts` on the client.
//
// Entirely DSN-gated: with NEXT_PUBLIC_SENTRY_DSN unset, Sentry.init never runs
// and every capture becomes a no-op — so this is free until you paste the DSN
// into .env.local (local) + Vercel (prod) + the build:static env (native).
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Development is EXCLUDED (2026-08-08). Build 9 put the DSN into `.env.local`
// — correctly, to fix error reporting being inert on device — and the
// unnoticed side effect was that every local `npm run dev` has been posting to
// the owner's Sentry as `environment: development` ever since. The issue that
// exposed it was a hydration warning from a throwaway fixture route that never
// left one machine.
//
// A monitoring channel that fills with local noise is a channel you learn to
// scroll past, which is the same mechanism as every other signal-honesty
// finding in this repo: the alert still fires, it just stops meaning anything.
// Set NEXT_PUBLIC_SENTRY_DEV=1 to opt a dev session back in deliberately.
//
// The native build is unaffected either way: `build:static` runs with
// NODE_ENV=production, so a device build still reports.
const devOptIn = process.env.NEXT_PUBLIC_SENTRY_DEV === '1';
const enabled = !!dsn && (process.env.NODE_ENV !== 'development' || devOptIn);

if (enabled) {
  Sentry.init({
    dsn,
    // Low trace sample — enough to spot slow transactions without cost. Bump if
    // you want more performance visibility.
    tracesSampleRate: 0.1,
    // Session Replay is off by default (bandwidth/privacy); flip on later if wanted.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENV ||
      process.env.NEXT_PUBLIC_VERCEL_ENV ||
      process.env.NODE_ENV,
    // Tag the platform so web-PWA vs native-WebView errors are filterable.
    initialScope: {
      tags: {
        runtime_surface:
          typeof (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
            ?.isNativePlatform === 'function' &&
          (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor!.isNativePlatform!()
            ? 'capacitor'
            : 'web',
      },
    },
  });
}

// Instruments client-side navigations for the App Router (no-op if uninitialized).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
