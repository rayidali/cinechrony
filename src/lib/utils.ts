import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Rating color system - single source of truth for all rating displays.
 * Uses 7 color buckets for a smooth gradient from red (bad) to emerald (excellent).
 * All colors work in both light and dark mode with proper contrast.
 */
export type RatingColors = {
  /** Background class for badges, fills (e.g., bg-red-500) */
  bg: string;
  /** Text color class (e.g., text-red-500) */
  text: string;
  /** Text color for use ON the background (always readable) */
  textOnBg: string;
  /** Fill class for SVG icons */
  fill: string;
};

/**
 * Get rating colors for a given rating value.
 * @param rating - Rating value 1-10, or null/undefined
 * @returns Object with bg, text, textOnBg, and fill classes
 */
export function getRatingColors(rating: number | null | undefined): RatingColors {
  // Handle null/undefined with neutral gray
  if (rating === null || rating === undefined) {
    return {
      bg: 'bg-gray-400 dark:bg-gray-600',
      text: 'text-gray-500 dark:text-gray-400',
      textOnBg: 'text-white dark:text-gray-100',
      fill: 'fill-gray-500 dark:fill-gray-400',
    };
  }

  // 7 color buckets for smooth gradient: 1-10 rating scale
  // 9.0+ : Emerald (exceptional)
  // 8.0+ : Green (great)
  // 7.0+ : Lime (good)
  // 6.0+ : Yellow (decent)
  // 5.0+ : Amber (average)
  // 4.0+ : Orange (below average)
  // <4.0 : Red (poor)

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
  // Below 4.0 - red
  return {
    bg: 'bg-red-500 dark:bg-red-600',
    text: 'text-red-600 dark:text-red-400',
    textOnBg: 'text-white',
    fill: 'fill-red-600 dark:fill-red-400',
  };
}

// Legacy helpers for backwards compatibility - use getRatingColors() for new code
export function getRatingTextColor(rating: number): string {
  return getRatingColors(rating).text;
}

export function getRatingBgColor(rating: number): string {
  return getRatingColors(rating).bg;
}
