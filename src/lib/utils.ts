import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Rating color system — design system v2 "3-bucket".
 *
 * v1 used a continuous red→green HSL rainbow. v2 collapses ratings into
 * three legible buckets — easier to scan, less visual noise:
 *   >= 7.5  sage deep  (great)
 *   >= 5.5  amber      (fine)
 *   <  5.5  marker red (rough)
 *
 * Uses inline styles so colors are bulletproof regardless of Tailwind JIT.
 * getRatingStyle() keeps its v1 return shape so existing callers don't break.
 */

export type RatingStyle = {
  /** Inline style for background (use on badge/fill elements) */
  background: React.CSSProperties;
  /** Inline style for text displayed ON the background */
  textOnBg: React.CSSProperties;
  /** Inline style for text/icon that should match the rating color */
  accent: React.CSSProperties;
};

// v2 palette (oklch) — mirrors the --cc-* tokens in globals.css.
const RATING_GOOD = 'oklch(0.52 0.11 150)';     // sage deep
const RATING_MID = 'oklch(0.78 0.13 78)';       // amber
const RATING_BAD = 'oklch(0.6 0.20 27)';        // marker red
const RATING_NEUTRAL = 'oklch(0.46 0.012 60)';  // graphite (no rating)
const INK = 'oklch(0.165 0.012 60)';
// A deeper amber so mid-rating text stays legible on cream paper.
const RATING_MID_ACCENT = 'oklch(0.6 0.13 70)';

type RatingBucket = 'good' | 'mid' | 'bad';

/** Collapse a 1-10 rating into one of three buckets. */
function getRatingBucket(rating: number): RatingBucket {
  if (rating >= 7.5) return 'good';
  if (rating >= 5.5) return 'mid';
  return 'bad';
}

/**
 * Get rating styles for a given rating value.
 * Returns inline CSS styles that work in both light and dark mode.
 *
 * @param rating - Rating value 1-10, or null/undefined
 * @returns Object with background, textOnBg, and accent styles
 */
export function getRatingStyle(rating: number | null | undefined): RatingStyle {
  if (rating === null || rating === undefined) {
    return {
      background: { backgroundColor: RATING_NEUTRAL },
      textOnBg: { color: 'white' },
      accent: { color: RATING_NEUTRAL },
    };
  }

  const bucket = getRatingBucket(rating);
  if (bucket === 'good') {
    return {
      background: { backgroundColor: RATING_GOOD },
      textOnBg: { color: 'white' },
      accent: { color: RATING_GOOD },
    };
  }
  if (bucket === 'mid') {
    return {
      background: { backgroundColor: RATING_MID },
      textOnBg: { color: INK },
      accent: { color: RATING_MID_ACCENT },
    };
  }
  return {
    background: { backgroundColor: RATING_BAD },
    textOnBg: { color: 'white' },
    accent: { color: RATING_BAD },
  };
}

/**
 * Get rating background color as a CSS string.
 * Useful for elements that need just the color value.
 */
export function getRatingBgColorValue(rating: number | null | undefined): string {
  if (rating === null || rating === undefined) return RATING_NEUTRAL;
  const bucket = getRatingBucket(rating);
  return bucket === 'good' ? RATING_GOOD : bucket === 'mid' ? RATING_MID : RATING_BAD;
}

/**
 * Get rating text color as a CSS string.
 * For text/icons that should match the rating color (legible on cream paper).
 */
export function getRatingTextColorValue(rating: number | null | undefined): string {
  if (rating === null || rating === undefined) return RATING_NEUTRAL;
  const bucket = getRatingBucket(rating);
  return bucket === 'good' ? RATING_GOOD : bucket === 'mid' ? RATING_MID_ACCENT : RATING_BAD;
}

// ============================================================================
// Legacy/Tailwind-based helpers (kept for backwards compatibility)
// Prefer getRatingStyle() for new code. These return Tailwind classes and now
// mirror the v2 3-bucket model (sage / amber / marker) instead of a rainbow.
// ============================================================================

export type RatingColors = {
  bg: string;
  text: string;
  textOnBg: string;
  fill: string;
};

export function getRatingColors(rating: number | null | undefined): RatingColors {
  if (rating === null || rating === undefined) {
    return {
      bg: 'bg-muted-foreground',
      text: 'text-muted-foreground',
      textOnBg: 'text-white',
      fill: 'fill-muted-foreground',
    };
  }

  const bucket = getRatingBucket(rating);
  if (bucket === 'good') {
    return {
      bg: 'bg-success',
      text: 'text-success',
      textOnBg: 'text-white',
      fill: 'fill-success',
    };
  }
  if (bucket === 'mid') {
    return {
      bg: 'bg-warning',
      text: 'text-warning',
      textOnBg: 'text-foreground',
      fill: 'fill-warning',
    };
  }
  return {
    bg: 'bg-destructive',
    text: 'text-destructive',
    textOnBg: 'text-white',
    fill: 'fill-destructive',
  };
}

export function getRatingTextColor(rating: number): string {
  return getRatingColors(rating).text;
}

export function getRatingBgColor(rating: number): string {
  return getRatingColors(rating).bg;
}
