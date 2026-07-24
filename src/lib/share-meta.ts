/**
 * share-meta — server-side helpers for OpenGraph / Twitter card metadata on
 * shareable pages (post · profile · list · movie). Used by each page's
 * `generateMetadata`. Builds absolute URLs (crawlers need them) pointing at the
 * `/api/v1/share/og` 1200×630 renderer.
 *
 * Origin resolution is SERVER-side (no `headers()`, which would break the static
 * export): explicit env → Vercel production project url → current deployment url.
 */
import type { Metadata } from 'next';
import { CARD_VERSION } from '@/lib/story-card';

const SITE_NAME = 'cinechrony';
const SITE_DESC = 'a social movie watchlist for you and your friends.';

/** Absolute origin for OG image + canonical links (prod-canonical when available). */
export function deployOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return '';
}

type OgParams = {
  t: 'post' | 'profile' | 'list' | 'movie' | 'night';
  ti: string; // title
  sub?: string; // subtitle line
  img?: string | null; // poster/avatar url
  u?: string | null; // handle (no @)
  eb?: string; // eyebrow override
  ra?: number | null; // rating (movie)
  round?: boolean; // circular image (profile avatar)
};

export function ogImageUrl(p: OgParams): string {
  const q = new URLSearchParams();
  q.set('v', CARD_VERSION); // cache-buster — bump CARD_VERSION on any design change
  q.set('t', p.t);
  q.set('ti', p.ti.slice(0, 80));
  if (p.sub) q.set('sub', p.sub.slice(0, 90));
  if (p.img) q.set('img', p.img);
  if (p.u) q.set('u', p.u.replace(/^@/, ''));
  if (p.eb) q.set('eb', p.eb);
  if (p.ra != null) q.set('ra', String(p.ra));
  if (p.round) q.set('round', '1');
  return `${deployOrigin()}/api/v1/share/og?${q.toString()}`;
}

/** Compose Metadata with OG + Twitter large-image cards. */
export function pageMetadata(opts: {
  title: string;
  description: string;
  path: string; // e.g. /post/abc
  image: string; // absolute og image url
}): Metadata {
  const url = `${deployOrigin()}${opts.path}`;
  return {
    title: opts.title,
    description: opts.description,
    openGraph: {
      title: opts.title,
      description: opts.description,
      url,
      siteName: SITE_NAME,
      type: 'website',
      images: [{ url: opts.image, width: 1200, height: 630, alt: opts.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: opts.title,
      description: opts.description,
      images: [opts.image],
    },
  };
}

/** Brand fallback when an entity is missing / private / a static-shell param. */
export function defaultShareMetadata(): Metadata {
  const image = ogImageUrl({ t: 'profile', ti: SITE_NAME, sub: SITE_DESC, eb: 'a social movie watchlist' });
  return pageMetadata({
    title: 'cinechrony',
    description: SITE_DESC,
    path: '/',
    image,
  });
}
