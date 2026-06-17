/**
 * Review verdict buckets (F12) — the loved / liked / fine / nope language of the
 * reviews wall. Pure (server computes the distribution; client renders badges +
 * bars), so it lives in lib, not a component.
 *
 * Thresholds (10-point scale): loved ≥ 8 · liked ≥ 7 · fine ≥ 5.5 · nope < 5.5.
 * A review with no rating is a "note" (verdict = null → the NOTE chip).
 */

export const VERDICTS = ['loved', 'liked', 'fine', 'nope'] as const;
export type Verdict = (typeof VERDICTS)[number];

export function verdictForRating(rating: number | null | undefined): Verdict | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  if (rating >= 8) return 'loved';
  if (rating >= 7) return 'liked';
  if (rating >= 5.5) return 'fine';
  return 'nope';
}

/** Label + accent colour per verdict. Colours are theme-independent and legible
 *  on both the cream and dark card surfaces (the score badge + the distribution
 *  bars both key off these). */
export const VERDICT_META: Record<Verdict, { label: string; color: string }> = {
  loved: { label: 'loved it', color: '#3f8f5a' }, // green
  liked: { label: 'liked it', color: '#d9a82e' }, // bright amber
  fine: { label: 'it was fine', color: '#a8801f' }, // darker gold
  nope: { label: 'not for me', color: '#df6147' }, // coral
};

/** The colour to tint a score badge / number for a given rating. Falls back to
 *  the muted token when unrated. */
export function scoreColor(rating: number | null | undefined): string {
  const v = verdictForRating(rating);
  return v ? VERDICT_META[v].color : 'var(--muted-foreground)';
}
