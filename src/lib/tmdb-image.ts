/**
 * TMDB image-size helper (2026-07 perf pass).
 *
 * `next.config.ts` sets `unoptimized: true` (to stay off Vercel's image-
 * optimization quota), so `next/image`'s `sizes`/`srcset` are a no-op — whatever
 * URL we pass is fetched verbatim. Meanwhile the app stored and rendered a
 * single `w500` (750px-tall) poster EVERYWHERE, including 48×72 list chips, so a
 * home boot pulled ~2-3 MB of oversized poster bytes and decoded 750px bitmaps
 * into 48px slots on low-end phones (often the real LCP bottleneck).
 *
 * TMDB serves every size variant from the same CDN path for free, so we keep the
 * canonical `w500` URL in Firestore (detail views want the quality) and downsize
 * at RENDER time to match the display box. Pure string rewrite — works on fresh
 * TMDB URLs and on the `w500` URLs already denormalized onto movie docs; any
 * non-TMDB URL (R2 upload, picsum/data placeholder) passes through untouched.
 */

export type TmdbImageSize =
  | 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original';

const TMDB_PATH_RE = /(image\.tmdb\.org\/t\/p\/)(w\d+|original)(\/)/;

export function tmdbImg<T extends string | null | undefined>(
  url: T,
  size: TmdbImageSize,
): T {
  if (!url) return url;
  return url.replace(TMDB_PATH_RE, `$1${size}$3`) as T;
}
