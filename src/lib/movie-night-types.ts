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

export type ReminderPreset = '2h' | 'morning' | 'showtime';

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
  status: MovieNightStatus;
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
  status: MovieNightStatus;
  hostName: string;
  hostUsername: string | null;
  hostPhotoURL: string | null;
  /** The list this night is pinned to, if any — framing only, never the list itself. */
  listName: string | null;
  going: Array<{ name: string; photoURL: string | null }>;
  counts: MovieNightCounts;
};
