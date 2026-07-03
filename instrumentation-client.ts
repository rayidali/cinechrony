// Sentry client init (browser PWA + the Capacitor WKWebView run this same
// bundle). Next.js 15.3+ auto-loads `instrumentation-client.ts` on the client.
//
// Entirely DSN-gated: with NEXT_PUBLIC_SENTRY_DSN unset, Sentry.init never runs
// and every capture becomes a no-op — so this is free until you paste the DSN
// into .env.local (local) + Vercel (prod) + the build:static env (native).
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
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
