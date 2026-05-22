import { cn } from '@/lib/utils';

/**
 * IMDb wordmark — the official gold badge.
 *
 * Used wherever an IMDb rating is shown so the number reads unambiguously as
 * an IMDb score (not a user rating). Inline SVG — no asset request, scales
 * crisply. Size it with `className` height; width follows the 2:1 viewBox.
 */
export function ImdbLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 32"
      className={cn('h-3.5 w-auto', className)}
      role="img"
      aria-label="IMDb"
    >
      <rect width="64" height="32" rx="5" fill="#F5C518" />
      <text
        x="32"
        y="23"
        textAnchor="middle"
        fill="#000000"
        fontSize="18"
        fontWeight="700"
        fontFamily="Arial, Helvetica, sans-serif"
      >
        IMDb
      </text>
    </svg>
  );
}
