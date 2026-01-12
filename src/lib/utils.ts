import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Rating color system using HSL interpolation.
 * Maps rating 1-10 to a continuous color gradient from red to green.
 * Uses inline styles to avoid Tailwind dynamic class generation issues.
 */

export type RatingStyle = {
  /** Inline style for background (use on badge/fill elements) */
  background: React.CSSProperties;
  /** Inline style for text displayed ON the background */
  textOnBg: React.CSSProperties;
  /** Inline style for text/icon that should match the rating color */
  accent: React.CSSProperties;
};

/**
 * Get HSL color values for a rating.
 * Rating 1 = red (hue 0), Rating 10 = green (hue 120)
 * Uses a smooth interpolation for continuous color gradient.
 */
function getRatingHSL(rating: number, isDark: boolean = false): { h: number; s: number; l: number } {
  // Clamp rating to 1-10
  const clampedRating = Math.max(1, Math.min(10, rating));

  // Map rating 1-10 to hue 0-120 (red to green)
  // Using a slightly curved mapping for better visual distribution
  const normalizedRating = (clampedRating - 1) / 9; // 0 to 1
  const hue = Math.round(normalizedRating * 120);

  // Saturation: keep vibrant
  const saturation = isDark ? 65 : 70;

  // Lightness: adjust for theme
  // For backgrounds: darker in dark mode
  const lightness = isDark ? 45 : 50;

  return { h: hue, s: saturation, l: lightness };
}

/**
 * Get rating styles for a given rating value.
 * Returns inline CSS styles that work in both light and dark mode.
 *
 * @param rating - Rating value 1-10, or null/undefined
 * @returns Object with background, textOnBg, and accent styles
 */
export function getRatingStyle(rating: number | null | undefined): RatingStyle {
  // Handle null/undefined with neutral gray
  if (rating === null || rating === undefined) {
    return {
      background: { backgroundColor: 'rgb(156 163 175)' }, // gray-400
      textOnBg: { color: 'white' },
      accent: { color: 'rgb(107 114 128)' }, // gray-500
    };
  }

  const { h, s, l } = getRatingHSL(rating);

  // Background color
  const bgColor = `hsl(${h}, ${s}%, ${l}%)`;

  // Text on background - white for most colors, dark for yellow range
  const needsDarkText = h >= 45 && h <= 75 && l >= 45; // Yellow range
  const textOnBgColor = needsDarkText ? `hsl(${h}, ${s}%, 15%)` : 'white';

  // Accent color (for text/icons) - slightly darker/more saturated
  const accentColor = `hsl(${h}, ${s + 10}%, ${l - 5}%)`;

  return {
    background: { backgroundColor: bgColor },
    textOnBg: { color: textOnBgColor },
    accent: { color: accentColor },
  };
}

/**
 * Get rating background color as a CSS string.
 * Useful for elements that need just the color value.
 */
export function getRatingBgColorValue(rating: number | null | undefined): string {
  if (rating === null || rating === undefined) {
    return 'rgb(156 163 175)'; // gray-400
  }
  const { h, s, l } = getRatingHSL(rating);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/**
 * Get rating text color as a CSS string.
 * For text/icons that should match the rating color.
 */
export function getRatingTextColorValue(rating: number | null | undefined): string {
  if (rating === null || rating === undefined) {
    return 'rgb(107 114 128)'; // gray-500
  }
  const { h, s, l } = getRatingHSL(rating);
  return `hsl(${h}, ${s + 10}%, ${l - 5}%)`;
}

// ============================================================================
// Legacy/Tailwind-based helpers (kept for backwards compatibility)
// These use Tailwind classes but may have issues with dynamic class generation
// Prefer getRatingStyle() for new code
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
      bg: 'bg-gray-400 dark:bg-gray-600',
      text: 'text-gray-500 dark:text-gray-400',
      textOnBg: 'text-white dark:text-gray-100',
      fill: 'fill-gray-500 dark:fill-gray-400',
    };
  }

  // Map to discrete buckets for Tailwind classes
  if (rating >= 9.0) {
    return {
      bg: 'bg-emerald-500 dark:bg-emerald-600',
      text: 'text-emerald-600 dark:text-emerald-400',
      textOnBg: 'text-white',
      fill: 'fill-emerald-600 dark:fill-emerald-400',
    };
  }
  if (rating >= 8.0) {
    return {
      bg: 'bg-green-500 dark:bg-green-600',
      text: 'text-green-600 dark:text-green-400',
      textOnBg: 'text-white',
      fill: 'fill-green-600 dark:fill-green-400',
    };
  }
  if (rating >= 7.0) {
    return {
      bg: 'bg-lime-500 dark:bg-lime-600',
      text: 'text-lime-600 dark:text-lime-400',
      textOnBg: 'text-white dark:text-lime-950',
      fill: 'fill-lime-600 dark:fill-lime-400',
    };
  }
  if (rating >= 6.0) {
    return {
      bg: 'bg-yellow-400 dark:bg-yellow-500',
      text: 'text-yellow-600 dark:text-yellow-400',
      textOnBg: 'text-yellow-900 dark:text-yellow-950',
      fill: 'fill-yellow-600 dark:fill-yellow-400',
    };
  }
  if (rating >= 5.0) {
    return {
      bg: 'bg-amber-500 dark:bg-amber-500',
      text: 'text-amber-600 dark:text-amber-400',
      textOnBg: 'text-white dark:text-amber-950',
      fill: 'fill-amber-600 dark:fill-amber-400',
    };
  }
  if (rating >= 4.0) {
    return {
      bg: 'bg-orange-500 dark:bg-orange-600',
      text: 'text-orange-600 dark:text-orange-400',
      textOnBg: 'text-white',
      fill: 'fill-orange-600 dark:fill-orange-400',
    };
  }
  return {
    bg: 'bg-red-500 dark:bg-red-600',
    text: 'text-red-600 dark:text-red-400',
    textOnBg: 'text-white',
    fill: 'fill-red-600 dark:fill-red-400',
  };
}

export function getRatingTextColor(rating: number): string {
  return getRatingColors(rating).text;
}

export function getRatingBgColor(rating: number): string {
  return getRatingColors(rating).bg;
}
