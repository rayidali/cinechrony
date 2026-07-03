'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Root error boundary. Catches an uncaught error thrown from the root layout
 * (or anything that escapes the per-page `error.tsx`). Before this existed, such
 * an error rendered Next's default white screen — which, inside the Capacitor
 * WKWebView, looked like the app had died with no way out. This shows a branded,
 * on-theme recovery screen with a retry, and logs the error (the hook where a
 * Sentry/observability capture goes — see HANDOFF).
 *
 * A global-error boundary MUST render its own <html>/<body> (it replaces the
 * root layout when that layout is what failed).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error); // no-op until the DSN is set
    console.error('[global-error] uncaught app error:', error);
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f7f3e9',
          color: '#1a1a1a',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: '#e8543a',
              margin: '0 auto 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
            }}
          >
            🍿
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.01em' }}>
            something broke
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.5, opacity: 0.7, margin: '0 0 24px' }}>
            that&apos;s on us, not you. give it another try — your lists and films are safe.
          </p>
          <button
            onClick={() => reset()}
            style={{
              appearance: 'none',
              border: 'none',
              background: '#e8543a',
              color: 'white',
              fontSize: 15,
              fontWeight: 600,
              padding: '12px 28px',
              borderRadius: 999,
              cursor: 'pointer',
            }}
          >
            try again
          </button>
        </div>
      </body>
    </html>
  );
}
