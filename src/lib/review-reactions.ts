/**
 * Review reactions (F14) — the five icon reactions on the reviews wall.
 *
 * Pure data (no React), so both the server (validation + counting) and the
 * client (chips + the long-press reaction bar) import it. The lucide icon for
 * each type is mapped client-side in `<ReactionIcon>`.
 *
 * One reaction per user per review (IG-style): the `reactions` map on a review
 * doc is `{ [uid]: ReactionType }`; counts + the viewer's own reaction are
 * derived server-side and sent to the client (the raw uid→type map is never
 * shipped).
 */

export const REACTION_TYPES = ['heart', 'flame', 'droplet', 'grin', 'sparkle'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export function isReactionType(v: unknown): v is ReactionType {
  return typeof v === 'string' && (REACTION_TYPES as readonly string[]).includes(v);
}

/** Per-reaction accent colour — theme-independent (reactions read the same on
 *  the paper + projection-room themes, like the design). */
export const REACTION_META: Record<ReactionType, { color: string; label: string }> = {
  heart: { color: '#e0654b', label: 'love' }, // coral
  flame: { color: '#d99a2b', label: 'fire' }, // amber
  droplet: { color: '#3b82d6', label: 'tears' }, // blue
  grin: { color: '#3a9d5d', label: 'laugh' }, // green
  sparkle: { color: '#7c5ce0', label: 'magic' }, // violet
};

export type ReactionCounts = Partial<Record<ReactionType, number>>;
