/**
 * Movie Night — client+server-safe types (MOVIE-NIGHT-PLAN.md).
 *
 * Pure type declarations only — no runtime, no admin SDK — so both the
 * `/api/v1/movie-nights/*` route handlers AND the client UI (S3+) can import
 * them. Mirrors the `extraction-types.ts` split: the server module
 * (`movie-nights-server.ts`) owns the Firestore doc shape; this file owns the
 * wire shape returned to the client.
 */

export type MovieNightStatus = 'proposed' | 'cancelled' | 'completed' | 'didnt_happen';

export type RsvpAnswer = 'in' | 'maybe' | 'out';

/** Where a reminder's ACTUAL send landed relative to the showtime it is about
 *  — set by the S2 ticker (`reminderTiming`), consumed by the notification
 *  copy (`createMovieNightReminderNotification`).
 *
 *  It lives here rather than in either of those modules purely to keep them
 *  acyclic: `movie-nights-server` already imports the notification builders,
 *  so the type they share cannot live in `notifications-server` without the
 *  edge pointing both ways. `null` wherever it appears means a tbd night,
 *  which has no showtime to be early or late for. */
export type ReminderTiming = 'ahead' | 'soon' | 'started';

/** Host-controlled visibility of a movie night pinned to a list. `'public'`
 *  is the same behavior every night had before this field existed — visible
 *  (redacted, via `MovieNightPinView`) to anyone who can see the list,
 *  including anonymous visitors of a public list. `'private'` restricts
 *  `getListMovieNight` to the host + invitees only — a non-invited caller
 *  gets `null`, same as no night existing at all. A legacy doc (written
 *  before this field existed) has no `visibility` at all; that absence is
 *  read as `'public'` at read time — never backfilled. */
export type MovieNightVisibility = 'public' | 'private';

export type ReminderPreset = '2h' | 'morning' | 'showtime';

/**
 * A night whose DAY is locked but whose showtime isn't decided yet ("time
 * tbd"). The host still gets a real plan out the door — invites fan out, RSVPs
 * work, it shows up everywhere a night shows up — and pins the exact hour down
 * later through the normal reschedule flow, which clears the flag.
 *
 * `scheduledFor` is ALWAYS a real instant, tbd or not: every Firestore index,
 * ordering, ticker window and calendar export is built on it, and making it
 * nullable would touch all of them. A tbd night is anchored to
 * `TBD_ANCHOR_HOUR` local (see `movie-night-format.ts`) on the chosen day — a
 * plausible movie-night hour that sorts correctly within its day. This flag is
 * what tells every surface not to RENDER that anchor as if it were a decision
 * someone made.
 *
 * Absent on every night written before the field existed; read as `false` and
 * never backfilled (same contract as `MovieNightVisibility`).
 */
export type MovieNightTimeTbd = boolean;

/** The one film a movie night is about. */
export type MovieNightFilm = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  posterUrl: string | null;
  runtime: number | null;
};

export type MovieNightInviteeView = {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  isHost: boolean;
  answer: RsvpAnswer | null;
  respondedAt: string | null; // ISO
};

export type MovieNightGuestRsvpView = {
  guestId: string;
  name: string;
  answer: RsvpAnswer;
  respondedAt: string | null; // ISO
};

export type MovieNightCounts = {
  /** Guests count toward going/maybe/out alongside uid invitees. */
  going: number;
  maybe: number;
  out: number;
  waiting: number;
};

/** The authed API wire shape — `GET/POST/PATCH /api/v1/movie-nights*`. */
export type MovieNightView = {
  id: string;
  hostUid: string;
  listId: string | null;
  listOwnerId: string | null;
  listName: string | null;
  film: MovieNightFilm;
  scheduledFor: string; // ISO
  previousScheduledFor: string | null; // ISO, set after a reschedule
  tzOffsetMinutes: number;
  reminderPreset: ReminderPreset;
  /** True when the host locked the DAY but not the showtime — render
   *  'time tbd' rather than `scheduledFor`'s anchor hour. See
   *  `MovieNightTimeTbd`. */
  timeTbd: MovieNightTimeTbd;
  status: MovieNightStatus;
  /** Host-set; hosts/invitees need it to render the current state + edit it.
   *  Never present on `MovieNightPinView` — the redacted pin only ever
   *  renders for a public night in the first place, so a pin-view reader has
   *  no use for this field. */
  visibility: MovieNightVisibility;
  invitees: MovieNightInviteeView[];
  guestRsvps: MovieNightGuestRsvpView[];
  /** Only present for the host or an invitee — never leaked to a stranger. */
  shareCode: string | null;
  completion: { attendeeUids: string[]; completedAt: string } | null;
  viewer: { isHost: boolean; isInvitee: boolean; answer: RsvpAnswer | null };
  counts: MovieNightCounts;
};

/** The redacted shape `getListMovieNight` returns to a caller who is
 *  NEITHER the night's host nor an invitee (e.g. an anonymous or unrelated
 *  visitor of a PUBLIC list's pin) — never a uid, an invitee, a guest name,
 *  or the share code. Just enough for the compact card ("N going" + the
 *  film + time). Route stays public — a public list's pin is visible to
 *  anyone, just not the who's-coming detail. */
export type MovieNightPinView = {
  id: string;
  film: MovieNightFilm;
  scheduledFor: string; // ISO
  tzOffsetMinutes: number;
  /** Not a privacy concern (the pin already shows the date) and the card
   *  would otherwise print the 8pm anchor as a real showtime. */
  timeTbd: MovieNightTimeTbd;
  status: MovieNightStatus;
  counts: MovieNightCounts;
};

/** What the compact `MovieNightCard` actually reads — satisfied by BOTH the
 *  full `MovieNightView` (host/invitee) and the redacted `MovieNightPinView`
 *  (everyone else), so one card component tolerates either wire shape. */
export type MovieNightCardData = {
  id: string;
  film: MovieNightFilm;
  scheduledFor: string; // ISO
  tzOffsetMinutes: number;
  /** Optional here (unlike the two wire shapes that both always send it) so a
   *  hand-built card payload in a test or a future surface doesn't have to
   *  care — absent reads as "there is a real showtime", the old behaviour. */
  timeTbd?: MovieNightTimeTbd;
  counts: MovieNightCounts;
  completion?: { attendeeUids: string[]; completedAt: string } | null;
  previousScheduledFor?: string | null; // ISO
};

/** The public guest-page shape — `GET /api/v1/movie-nights/shared/[code]` (S2).
 *  Deliberately thin: never exposes list contents, invitee identities beyond
 *  a display name, or the share code itself. */
export type MovieNightPublicView = {
  film: MovieNightFilm;
  scheduledFor: string; // ISO
  tzOffsetMinutes: number;
  timeTbd: MovieNightTimeTbd;
  status: MovieNightStatus;
  hostName: string;
  hostUsername: string | null;
  hostPhotoURL: string | null;
  /** The list this night is pinned to, if any — framing only, never the list itself. */
  listName: string | null;
  going: Array<{ name: string; photoURL: string | null }>;
  counts: MovieNightCounts;
};
