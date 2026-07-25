import { Suspense } from 'react';
import type { Metadata } from 'next';
import ClientPage from './client';
import { deployOrigin, ogImageUrl, pageMetadata, defaultShareMetadata } from '@/lib/share-meta';
import { formatNightDate, formatNightTime } from '@/lib/movie-night-format';
import type { MovieNightPublicView } from '@/lib/movie-night-types';

// Phase A PR #17: SPA-shell wrapper. See `/lists/[listId]/page.tsx`.
export async function generateStaticParams() {
  return [{ code: '_' }];
}

/**
 * OG / Twitter card for a shared movie-night link (MOVIE-NIGHT-PLAN.md § S5).
 * Runs server-side on the Vercel SSR deploy (crawlers hit that, never the
 * static bundle) — a plain HTTP call to the SAME public route the client page
 * fetches (`GET /api/v1/movie-nights/shared/[code]`), not a direct server-lib
 * import: this keeps the "never leak a uid / list contents" shaping in ONE
 * place (the route + `getMovieNightByCode`), so the crawler-facing card can
 * never drift from what a guest browser actually sees. The `_` static-shell
 * param, a fetch failure/404, and a cancelled night all fall back to the
 * brand default.
 */
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  if (!code || code === '_') return defaultShareMetadata();
  try {
    const origin = deployOrigin();
    if (!origin) return defaultShareMetadata();
    const res = await fetch(`${origin}/api/v1/movie-nights/shared/${encodeURIComponent(code)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return defaultShareMetadata();
    const envelope = (await res.json()) as { ok: boolean; data?: MovieNightPublicView };
    if (!envelope.ok || !envelope.data) return defaultShareMetadata();
    const night = envelope.data;
    if (night.status === 'cancelled') return defaultShareMetadata();

    const dateLabel = formatNightDate(night.scheduledFor, night.tzOffsetMinutes);
    const timeLabel = formatNightTime(night.scheduledFor, night.tzOffsetMinutes);
    const title = `movie night: ${night.film.title} · ${dateLabel}`;
    const description = `${night.hostName} wants to watch ${night.film.title} with you. rsvp on cinechrony — no account needed.`;
    const image = ogImageUrl({
      t: 'night',
      ti: night.film.title,
      sub: `${dateLabel} · ${timeLabel}`,
      img: night.film.posterUrl,
      u: night.hostUsername || null,
      eb: 'movie night',
    });
    return pageMetadata({ title, description, path: `/n/${code}`, image });
  } catch {
    return defaultShareMetadata();
  }
}

export default function Page() {
  return <Suspense><ClientPage /></Suspense>;
}
