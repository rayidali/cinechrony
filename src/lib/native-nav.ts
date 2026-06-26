'use client';

/**
 * Native-export navigation shim.
 *
 * THE PROBLEM. The app ships as a Next.js static export (`output: 'export'`)
 * wrapped by Capacitor. Dynamic routes (`/lists/[listId]`, `/profile/[username]`,
 * …) are exported as a SINGLE placeholder shell — `generateStaticParams` returns
 * `[{ listId: '_' }]`, so only `out/lists/_/index.html` exists, not a file per id.
 * On the web (Vercel) the dynamic route is served by the deployment, so
 * `router.push('/lists/<realId>')` works. Inside the native WKWebView there is no
 * server: Next's client router fetches the RSC payload `/lists/<realId>/index.txt`,
 * gets a 404, falls back to a hard navigation, and WKWebView can't find the file
 * → "WebView failed provisional navigation: index.txt couldn't be opened" → the
 * detail screen breaks.
 *
 * THE FIX (this file). On native we navigate to the placeholder shell that
 * actually exists (`/lists/_`) and carry the real segment values in the query
 * string. The shell's client component reads its ids via `useParams()` (overridden
 * below) which resolves a `'_'` path segment back from the query. Web is a no-op:
 * `toNativeHref` returns the href unchanged and `useParams` behaves exactly like
 * Next's, so the only behavioural change is inside the native shell.
 *
 * USAGE. Client files swap their import source:
 *   - `import { useRouter, useParams } from 'next/navigation'`  →  `'@/lib/native-nav'`
 *   - `import Link from 'next/link'`  →  `import { Link } from '@/lib/native-nav'`
 * Nothing else changes — `router.push(...)`, `<Link href=...>` and `params.x`
 * keep their existing call shapes.
 */

import { useMemo, forwardRef, createElement, type ComponentProps } from 'react';
import {
  useRouter as useNextRouter,
  useParams as useNextParams,
  useSearchParams as useNextSearchParams,
} from 'next/navigation';
import NextLink from 'next/link';
import { Capacitor } from '@capacitor/core';

// Most-specific paths first (settings before [listId]; the nested
// profile/.../lists/... before the bare profile route).
const DYNAMIC_ROUTES: { re: RegExp; shell: string; keys: string[] }[] = [
  { re: /^\/lists\/([^/?#]+)\/settings(?=$|[?#])/, shell: '/lists/_/settings', keys: ['listId'] },
  { re: /^\/lists\/([^/?#]+)(?=$|[?#])/, shell: '/lists/_', keys: ['listId'] },
  { re: /^\/profile\/([^/?#]+)\/lists\/([^/?#]+)(?=$|[?#])/, shell: '/profile/_/lists/_', keys: ['username', 'listId'] },
  { re: /^\/profile\/([^/?#]+)(?=$|[?#])/, shell: '/profile/_', keys: ['username'] },
  { re: /^\/post\/([^/?#]+)(?=$|[?#])/, shell: '/post/_', keys: ['postId'] },
  { re: /^\/movie\/([^/?#]+)\/comments(?=$|[?#])/, shell: '/movie/_/comments', keys: ['tmdbId'] },
  { re: /^\/invite\/([^/?#]+)(?=$|[?#])/, shell: '/invite/_', keys: ['code'] },
];

/** Rewrite a real dynamic path to its export shell + query (native only). */
export function toNativeHref(href: string): string {
  if (!href || !href.startsWith('/') || !Capacitor.isNativePlatform()) return href;

  const hashIdx = href.indexOf('#');
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : '';
  const noHash = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const qIdx = noHash.indexOf('?');
  const path = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
  const queryStr = qIdx >= 0 ? noHash.slice(qIdx + 1) : '';

  for (const r of DYNAMIC_ROUTES) {
    const m = path.match(r.re);
    if (!m) continue;
    const q = new URLSearchParams(queryStr);
    r.keys.forEach((k, i) => q.set(k, m[i + 1]));
    const qs = q.toString();
    return `${r.shell}${qs ? `?${qs}` : ''}${hash}`;
  }
  return href;
}

/** Drop-in for next/navigation's useRouter — auto-rewrites dynamic hrefs on native. */
export function useRouter() {
  const router = useNextRouter();
  return useMemo(
    () => ({
      ...router,
      push: (href: string, opts?: Parameters<typeof router.push>[1]) => router.push(toNativeHref(href), opts),
      replace: (href: string, opts?: Parameters<typeof router.replace>[1]) => router.replace(toNativeHref(href), opts),
      prefetch: (href: string, opts?: Parameters<typeof router.prefetch>[1]) => router.prefetch(toNativeHref(href), opts),
    }),
    [router],
  );
}

/**
 * Drop-in for next/navigation's useParams — resolves a `'_'` placeholder segment
 * back from the query string (native shells). Identical to Next's on web.
 */
export function useParams<T extends Record<string, string | string[]> = Record<string, string>>(): T {
  const params = useNextParams();
  const search = useNextSearchParams();
  return useMemo(() => {
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(params ?? {})) {
      const val = Array.isArray(v) ? v[0] : v;
      out[k] = val === '_' ? (search?.get(k) ?? (val as string)) : (val as string);
    }
    return out as T;
  }, [params, search]);
}

export { useNextSearchParams as useSearchParams };

/** Drop-in for next/link — rewrites string hrefs to the export shell on native. */
export const Link = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(
  function Link({ href, ...rest }, ref) {
    const resolved = typeof href === 'string' ? toNativeHref(href) : href;
    return createElement(NextLink, { ...rest, href: resolved, ref });
  },
);
