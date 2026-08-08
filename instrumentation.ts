// Sentry server init — runs on the Vercel Node runtime (the /api/v1/* routes).
// No-op in the static export (no server) and until SENTRY_DSN is set.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  // Development is excluded for the same reason as the client half — see the
  // comment in `instrumentation-client.ts`. `npm run dev` runs this too, so
  // gating only the browser would still leave route errors flowing from a
  // laptop into the production issue stream. Opt in with SENTRY_DEV=1.
  if (process.env.NODE_ENV === 'development' && process.env.SENTRY_DEV !== '1') return;
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      environment:
        process.env.SENTRY_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV,
    });
  }
}

// Captures errors thrown from Server Components / route rendering (no-op if
// Sentry isn't initialized).
export const onRequestError = Sentry.captureRequestError;
