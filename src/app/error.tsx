'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Per-page error boundary. Catches an uncaught render error in the page subtree
 * WITHOUT tearing down the root layout (theme, providers, and the tab bar stay
 * mounted), so recovery feels in-app rather than a hard crash. The root
 * `global-error.tsx` is the fallback for the rarer case where the layout itself
 * throws. Uses the app's design tokens so it's on-theme in light and dark.
 */
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error); // no-op until the DSN is set
    console.error('[page-error] uncaught render error:', error);
  }, [error]);
  return (
    <div className="min-h-[70dvh] flex items-center justify-center px-6 text-center">
      <div className="max-w-[340px]">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl">
          🍿
        </div>
        <h1 className="font-headline text-[22px] font-bold lowercase tracking-tight text-foreground">
          this page hit a snag
        </h1>
        <p className="mt-2 font-body text-[15px] leading-relaxed text-muted-foreground">
          give it another try — nothing was lost.
        </p>
        <button
          onClick={() => reset()}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-primary px-7 font-headline text-sm font-semibold lowercase text-primary-foreground shadow-fab active:scale-95"
        >
          try again
        </button>
      </div>
    </div>
  );
}
