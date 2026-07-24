/**
 * Movie Night — CLIENT-safe date/time formatters (MOVIE-NIGHT-PLAN.md § S3b).
 *
 * Mirrors `formatNightDate`/`formatNightTime` in `movie-nights-server.ts`
 * exactly (same `tzOffsetMinutes` convention: minutes to ADD to the UTC
 * instant to get the night's local time — the CREATOR's local time, not the
 * viewer's device, so every viewer sees the same "8:00 pm" regardless of
 * their own timezone). Pure functions, no server imports — safe for any
 * client component (the static export can't reach `firebase/admin`).
 *
 * `nightPhase` is a client-only concept (there's no server equivalent): it
 * derives the card/detail-sheet's time-driven display bucket from the
 * VIEWER's own clock (`now`, defaults to `new Date()`), not the night's
 * timezone — "today"/"soon"/"now" describe when the person looking at the
 * screen is looking, which is the only clock that matters for a UI badge.
 */

const WEEKDAYS_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAYS_FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Applies `tzOffsetMinutes` to the UTC epoch manually (no Intl timezone
 *  database needed) — the resulting Date's UTC getters read as the night's
 *  local wall-clock fields. */
function localFromIso(iso: string, tzOffsetMinutes: number): Date {
  return new Date(new Date(iso).getTime() + tzOffsetMinutes * 60_000);
}

/** 'fri 24.07' — weekday (abbreviated) + dd.mm, in the night's local time. */
export function formatNightDate(iso: string, tzOffsetMinutes: number): string {
  const local = localFromIso(iso, tzOffsetMinutes);
  const weekday = WEEKDAYS_SHORT[local.getUTCDay()];
  return `${weekday} ${pad2(local.getUTCDate())}.${pad2(local.getUTCMonth() + 1)}`;
}

/** '8:00 pm' (12h, lowercase), in the night's local time. */
export function formatNightTime(iso: string, tzOffsetMinutes: number): string {
  const local = localFromIso(iso, tzOffsetMinutes);
  const minutes = local.getUTCMinutes();
  let hours = local.getUTCHours();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${pad2(minutes)} ${ampm}`;
}

/** 'friday' — full weekday name, lowercase, in the night's local time. Used
 *  by the detail sheet's big date/time hero (MN10) and the home feed card's
 *  "friday night" mini-eyebrow (MN15). */
export function formatNightWeekdayFull(iso: string, tzOffsetMinutes: number): string {
  const local = localFromIso(iso, tzOffsetMinutes);
  return WEEKDAYS_FULL[local.getUTCDay()];
}

/** 'fri' — abbreviated weekday only, in the night's local time. Used by the
 *  compact `MovieNightCard`'s mono line (`fri 8:00 pm`). */
export function formatNightWeekdayShort(iso: string, tzOffsetMinutes: number): string {
  const local = localFromIso(iso, tzOffsetMinutes);
  return WEEKDAYS_SHORT[local.getUTCDay()];
}

/** '24.07.26' — dd.mm.yy, no weekday, in the night's local time. Used for a
 *  completed/rescheduled night's short date labels (MovieNightCard `done`/
 *  `moved` variants). */
export function formatNightDateShort(iso: string, tzOffsetMinutes: number): string {
  const local = localFromIso(iso, tzOffsetMinutes);
  const yy = String(local.getUTCFullYear()).slice(-2);
  return `${pad2(local.getUTCDate())}.${pad2(local.getUTCMonth() + 1)}.${yy}`;
}

export type NightPhase = 'upcoming' | 'today' | 'soon' | 'now' | 'past';

/**
 * The viewer-facing time bucket a movie night falls into right now — drives
 * every card/eyebrow variant (MN14/MN15/MN22-24). Priority order matters:
 * `now`/`past` (absolute window) beat `soon` (a 60-minute lead-in) beat
 * `today` (same local calendar day) beat the `upcoming` default.
 *
 *   now     — between the start and start + 3h (the design's `HAPPENING NOW`
 *             / `join` window; matches the 3h `.ics` default duration).
 *   soon    — within 60 minutes before the start (`STARTING SOON`, amber).
 *   today   — falls on the SAME local calendar day as `now`, but not yet in
 *             the `soon` window (`TONIGHT`).
 *   past    — more than 3h after the start (the morning-after territory —
 *             S4 owns what renders here; S3b just stops calling it `now`).
 *   upcoming — everything else (a future day, more than an hour out).
 */
export function nightPhase(scheduledForIso: string, now: Date = new Date()): NightPhase {
  const start = new Date(scheduledForIso).getTime();
  const t = now.getTime();
  const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
  const SIXTY_MIN_MS = 60 * 60 * 1000;

  if (t >= start && t < start + THREE_HOURS_MS) return 'now';
  if (t >= start + THREE_HOURS_MS) return 'past';
  if (t >= start - SIXTY_MIN_MS && t < start) return 'soon';

  const startLocal = new Date(start);
  const sameDay =
    startLocal.getFullYear() === now.getFullYear() &&
    startLocal.getMonth() === now.getMonth() &&
    startLocal.getDate() === now.getDate();
  if (sameDay) return 'today';

  return 'upcoming';
}
