/**
 * timeAgo — the app-wide compact relative-time formatter for feed-style
 * surfaces (posts, activities, reviews, comments). Pure Date math, no deps.
 *
 * "now" (<60s) · "Nm" (<60min) · "Nh" (<24h) · "Nd" (<7d) · "Nw" (<~5w) ·
 * else a short date: "Mar 3" (same year) or "Mar 3, 2024" (older).
 */
export function timeAgo(input: Date | string | number): string {
  const d = input instanceof Date ? input : new Date(input);
  const ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms) || Number.isNaN(d.getTime())) return '';

  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'now';

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;

  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;

  const week = Math.floor(day / 7);
  if (week < 5) return `${week}w`;

  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}
