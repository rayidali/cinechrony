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

export const VIBES: Vibe[] = [
  { id: 'time-loop', label: 'time loop', keyword: 'time loop' },
  { id: 'slow-burn', label: 'slow burn', keyword: 'slow burn' },
  { id: 'found-family', label: 'found family', keyword: 'found family' },
  { id: 'one-location', label: 'one location', keyword: 'single location' },
  { id: 'needle-drops', label: 'needle drops', keyword: 'music' },
  { id: 'quietly-devastating', label: 'quietly devastating', keyword: 'melancholy' },
  { id: 'single-take', label: 'single take', keyword: 'one shot' },
  { id: 'ensemble-chaos', label: 'ensemble chaos', keyword: 'ensemble cast' },
  { id: 'unreliable-narrator', label: 'unreliable narrator', keyword: 'unreliable narrator' },
];

export function getVibe(id: string): Vibe | undefined {
  return VIBES.find((v) => v.id === id);
}
