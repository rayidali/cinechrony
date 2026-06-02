import { Suspense } from 'react';
import ClientPage from './client';

// Phase A PR #17: SPA-shell wrapper. Returns a single placeholder so
// Next produces one static HTML shell; the SPA router rehydrates with
// the real `tmdbId` from the URL at runtime. The hosting layer (Capacitor
// WebView / Cloudflare Pages _redirects) maps any `/movie/*/comments`
// URL to that shell.
export async function generateStaticParams() {
  return [{ tmdbId: '_' }];
}

export default function Page() {
  return <Suspense><ClientPage /></Suspense>;
}
