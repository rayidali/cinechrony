/**
 * Seeded poster/cover gradient — Phase 0.7 / v3 (`ios-kit.jsx::POSTER_G`).
 *
 * A deterministic filmic gradient stand-in for a missing cover/backdrop, so a
 * coverless list or a not-yet-loaded still still reads as imagery (not a grey
 * placeholder). Same palette as the design package.
 */
const POSTER_G: [string, string][] = [
  ['#c8543c', '#5a1f17'],
  ['#3a3a85', '#1b1b46'],
  ['#2f6b4a', '#143324'],
  ['#5c4a37', '#2b2218'],
  ['#7a3360', '#3e1731'],
  ['#3e6275', '#1a2c36'],
  ['#8a5a2b', '#3d2510'],
  ['#4a3a72', '#1f163d'],
];

export function seededGradient(seed: string | undefined, angle = 150): string {
  const s = seed || 'x';
  const i = (s.charCodeAt(0) + s.length * 3) % POSTER_G.length;
  const [a, b] = POSTER_G[i];
  return `linear-gradient(${angle}deg, ${a}, ${b})`;
}
