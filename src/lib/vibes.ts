/**
 * "Browse by vibe" — curated discovery keywords for the search screen.
 *
 * Each vibe maps a lowercase editorial label to a TMDB keyword search term.
 * The server (`discoverByVibe` in `tmdb-server.ts`) resolves the term to a
 * TMDB keyword id at runtime and runs `/discover`; if nothing resolves it
 * falls back to a plain movie search on the term, so a vibe never renders
 * empty-by-design. Resolving at runtime (instead of hardcoding keyword ids)
 * keeps this self-correcting — TMDB owns the id, we only steer the term.
 *
 * Pure data — NO server imports — so the client renders the chips from the
 * same source of truth the server discovers against.
 */
export type Vibe = {
  id: string;
  /** Lowercase display label (the chip text). */
  label: string;
  /** TMDB keyword search term — may differ from the label to improve hit rate. */
  keyword: string;
};

// Each `keyword` is verified against TMDB to resolve to a well-populated
// keyword id (so the chip returns recognizable films, not obscure ones). The
// design's `one location` / `single take` / `ensemble chaos` chips were dropped
// — they map to near-empty TMDB keywords — and replaced with `neo-noir` /
// `nonlinear` / `whodunit`, which each return 20 recognizable films. To change
// a chip, just edit the label/keyword here (and re-verify the keyword resolves).
export const VIBES: Vibe[] = [
  { id: 'time-loop', label: 'time loop', keyword: 'time loop' },
  { id: 'slow-burn', label: 'slow burn', keyword: 'slow burn' },
  { id: 'found-family', label: 'found family', keyword: 'found family' },
  { id: 'neo-noir', label: 'neo-noir', keyword: 'neo-noir' },
  { id: 'needle-drops', label: 'needle drops', keyword: 'music' },
  { id: 'quietly-devastating', label: 'quietly devastating', keyword: 'melancholy' },
  { id: 'nonlinear', label: 'nonlinear', keyword: 'nonlinear timeline' },
  { id: 'whodunit', label: 'whodunit', keyword: 'whodunit' },
  { id: 'unreliable-narrator', label: 'unreliable narrator', keyword: 'unreliable narrator' },
];

export function getVibe(id: string): Vibe | undefined {
  return VIBES.find((v) => v.id === id);
}
