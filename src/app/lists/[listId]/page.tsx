/**
 * Server-component wrapper — Phase A PR #17.
 *
 * Delegates to `./client.tsx` (the actual `'use client'` page). Exists
 * for two reasons:
 *   1. `generateStaticParams` is required by `output: 'export'`, but
 *      can't live in a `'use client'` module. The placeholder array gives
 *      Next.js one HTML shell; the SPA router rehydrates at runtime.
 *   2. The `<Suspense>` boundary lets `useSearchParams()` inside the
 *      client component bail out gracefully during prerender (default
 *      build) instead of erroring out.
 */
import { Suspense } from 'react';
import ClientPage from './client';

export async function generateStaticParams() {
  return [{ listId: '_' }];
}

export default function Page() {
  return (
    <Suspense>
      <ClientPage />
    </Suspense>
  );
}
