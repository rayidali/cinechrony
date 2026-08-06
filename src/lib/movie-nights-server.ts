/**
 * Movie Night — domain server logic (MOVIE-NIGHT-PLAN.md § S1 server core).
 *
 * Pure server-side module (no `'use server'`). Each function takes an
 * already-verified caller uid; the route wrapper does the auth check. Errors
 * are thrown as the shared `ApiError` classes (`api-handler.ts`) — same
 * posture as `extraction-server.ts`, not the per-domain typed-Error classes
 * `invites-server.ts`/`lists-server.ts` use.
 *
 * Collection `/movie_nights/{id}` — server-only (`firestore.rules` denies all
 * client access). Doc shape mirrors the plan's § Data model exactly:
 *
 *   hostUid, listId|null, listOwnerId|null, listName|null (denorm)
 *   film { tmdbId, mediaType, title, year, posterUrl|null, runtime|null }
 *   scheduledFor (Timestamp) · previousScheduledFor|null · tzOffsetMinutes
 *   reminderPreset '2h'|'morning'|'showtime'
 *   status 'proposed'|'cancelled'|'completed'|'didnt_happen'
 *   inviteeUids[] (incl host, ≤10) · invitees{uid→{username,displayName,photoURL}}
 *   rsvps{uid→{answer,respondedAt}} · guestRsvps{guestId→{name,answer,respondedAt}}
 *   shareCode · reminderSentAt|null · morningAfterSentAt|null
 *   completion{attendeeUids[],completedAt}|null · createdAt · updatedAt
 *
 * `tzOffsetMinutes` convention: minutes to ADD to a UTC instant to get the
 * creator's local time (e.g. UTC+2 → 120 — matches `-new Date().getTimezoneOffset()`
 * on the client). `formatNightDate`/`formatNightTime` apply it manually so no
 * Intl timezone database is needed on the server.
 *
 * Lifecycle correctness (today/soon/now/awaiting-morning-after) is DERIVED
 * from `scheduledFor` at read time — S1 exposes `status` + `scheduledFor` and
 * leaves that derivation to the client (S3+) / the S2 ticker, matching the
 * plan's self-heal-on-read posture (like `getExtraction`).
 */

import { randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { BadRequestError, ForbiddenError, NotFoundError, RateLimitedError } from '@/lib/api-handler';
import { checkRateLimit } from '@/lib/rate-limit';
import { createTtlCache, cached } from '@/lib/server-cache';
import { getFollowingIds } from '@/lib/follows-server';
import { isBlockedBetween, getBlockSet } from '@/lib/blocks-server';
import { recordWatchEntry, logWatch } from '@/lib/watches-server';
import { deployOrigin } from '@/lib/share-meta';
import {
  createMovieNightInviteNotification,
  createMovieNightRsvpNotification,
  createMovieNightTimeChangedNotification,
  createMovieNightCancelledNotification,
  createMovieNightMorningAfterNotification,
  createMovieNightReminderNotification,
  type MovieNightNotificationCtx,
} from '@/lib/notifications-server';
import type {
  MovieNightCounts,
  MovieNightFilm,
  MovieNightPinView,
  MovieNightPublicView,
  MovieNightView,
  MovieNightVisibility,
  ReminderPreset,
  ReminderTiming,
  RsvpAnswer,
} from '@/lib/movie-night-types';

const NIGHTS = 'movie_nights';

/** Owner + 9 collaborators — mirrors `MAX_LIST_MEMBERS` (lists-server.ts). */
export const MAX_PEOPLE = 10;
/** Guest (no-account) RSVP rows — bounded, S2 territory but reserved now so
 *  the doc shape never needs to change when guest participation ships. */
export const MAX_GUEST_RSVPS = 20;
export const GUEST_NAME_MAX = 30;

// ── Doc shape (server-internal — never returned raw to the client) ─────────

type InviteeProfile = { username: string | null; displayName: string | null; photoURL: string | null };
type RsvpEntry = { answer: RsvpAnswer; respondedAt: FirebaseFirestore.Timestamp | null };
type GuestRsvpEntry = { name: string; answer: RsvpAnswer; respondedAt: FirebaseFirestore.Timestamp | null };

type NightDoc = {
  hostUid: string;
  listId: string | null;
  listOwnerId: string | null;
  listName: string | null;
  film: MovieNightFilm;
  scheduledFor: FirebaseFirestore.Timestamp;
  previousScheduledFor: FirebaseFirestore.Timestamp | null;
  tzOffsetMinutes: number;
  reminderPreset: ReminderPreset;
  status: 'proposed' | 'cancelled' | 'completed' | 'didnt_happen';
  /** Optional because every doc written before this field existed has none —
   *  read as `'public'` (see `MovieNightVisibility`'s doc comment). Every
   *  NEW doc always writes one explicitly (`createMovieNight` never leaves
   *  it undefined). */
  visibility?: MovieNightVisibility;
  /** "the day is set, the showtime isn't" — see `MovieNightTimeTbd`.
   *  `scheduledFor` is still a real instant (anchored to `TBD_ANCHOR_HOUR`
   *  local), so every query/index/ticker below is untouched by this flag; it
   *  only changes what gets RENDERED and when the reminder fires. Optional
   *  because every doc written before the field existed has none — read as
   *  `false`, never backfilled. */
  timeTbd?: boolean;
  inviteeUids: string[];
  invitees: Record<string, InviteeProfile>;
  rsvps: Record<string, RsvpEntry>;
  guestRsvps: Record<string, GuestRsvpEntry>;
  shareCode: string;
  /** F4 create idempotency — a client-minted key so a retry after a 500
   *  can't duplicate the night. Optional: absent on any night created
   *  before this field existed. */
  clientKey: string | null;
  reminderSentAt: FirebaseFirestore.Timestamp | null;
  morningAfterSentAt: FirebaseFirestore.Timestamp | null;
  completion: { attendeeUids: string[]; completedAt: FirebaseFirestore.Timestamp } | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

// ── Formatting helpers (exported for reuse — the ticker/S2 needs them too) ─

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** 'fri 24.07' in the night's local time. Applies `tzOffsetMinutes` to the
 *  UTC epoch manually — no Intl timezone database needed. */
export function formatNightDate(iso: string, tzOffsetMinutes: number): string {
  const local = new Date(new Date(iso).getTime() + tzOffsetMinutes * 60_000);
  const weekday = WEEKDAYS[local.getUTCDay()];
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  return `${weekday} ${dd}.${mm}`;
}

/** '8:00 pm' (12h, lowercase) in the night's local time. */
export function formatNightTime(iso: string, tzOffsetMinutes: number): string {
  const local = new Date(new Date(iso).getTime() + tzOffsetMinutes * 60_000);
  const minutes = local.getUTCMinutes();
  let hours = local.getUTCHours();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

/** Kept in lockstep with `TBD_TIME_LABEL` in `movie-night-format.ts` — this
 *  module deliberately re-declares its formatters rather than importing the
 *  client one (see the header), so the wording is duplicated the same way the
 *  date/time formatters above already are. Suite 53 asserts they match. */
export const TBD_TIME_LABEL = 'time tbd';

/** The showtime label to put in a notification / calendar entry — the real
 *  time, or the tbd placeholder. Every server-side `timeLabel` goes through
 *  this so no push can announce the 8pm anchor as a decided showtime. */
export function nightTimeLabel(iso: string, tzOffsetMinutes: number, timeTbd?: boolean): string {
  return timeTbd ? TBD_TIME_LABEL : formatNightTime(iso, tzOffsetMinutes);
}

// ── Small validators ────────────────────────────────────────────────────

function clampTzOffset(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(-840, Math.min(840, Math.round(n)));
}

/**
 * Whether `instant` lands on a local calendar day EARLIER than today's, both
 * read through the night's own `tzOffsetMinutes` (same convention as
 * `isNightToday` further down — there is no separate "server timezone" here).
 *
 * This is the past-check for a tbd night. A tbd night carries an 8pm anchor it
 * never chose, so the normal `instant <= now` rule would refuse "tonight, time
 * tbd" from 8pm onwards — rejecting a plan that is not only legal but the most
 * likely one someone makes at that hour. The day is the only thing the host
 * actually decided, so the day is the only thing worth validating.
 */
function isLocalDayBeforeToday(instant: Date, tzOffsetMinutes: number, now: Date): boolean {
  const startOfLocalDay = (d: Date): number => {
    const local = new Date(d.getTime() + tzOffsetMinutes * 60_000);
    return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  };
  return startOfLocalDay(instant) < startOfLocalDay(now);
}

function isReminderPreset(v: unknown): v is ReminderPreset {
  return v === '2h' || v === 'morning' || v === 'showtime';
}

function isRsvpAnswer(v: unknown): v is RsvpAnswer {
  return v === 'in' || v === 'maybe' || v === 'out';
}

/** Strict visibility validation, shared by create + the update patch:
 *  `'private'` stores `'private'`, ANYTHING else (missing, `'public'`
 *  explicitly, garbage like `'friends'` or `123`) stores `'public'` —
 *  public is always the safe fallback, never a rejected request. */
function validateVisibility(v: unknown): MovieNightVisibility {
  return v === 'private' ? 'private' : 'public';
}

function generateShareCode(): string {
  return randomBytes(16).toString('base64url');
}

/** A film title rides into the .ics `SUMMARY` unescaped-by-us (icsEscapeText
 *  handles the RFC 5545 chars) and into notification previews — hostile
 *  input by default. Mirrors `sanitizeGuestName`'s approach: strip C0/C1
 *  control chars (incl. `\r`/`\n`/tabs), collapse whitespace, trim, clamp. */
export const FILM_TITLE_MAX = 200;

function sanitizeFilmTitle(raw: string): string {
  const noControl = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
  const collapsed = noControl.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, FILM_TITLE_MAX);
}

function validateFilm(raw: unknown): MovieNightFilm {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof f.tmdbId !== 'number' || !Number.isFinite(f.tmdbId)) {
    throw new BadRequestError('film.tmdbId is required.');
  }
  if (f.mediaType !== 'movie' && f.mediaType !== 'tv') {
    throw new BadRequestError('film.mediaType must be "movie" or "tv".');
  }
  if (typeof f.title !== 'string' || !f.title.trim()) {
    throw new BadRequestError('film.title is required.');
  }
  const title = sanitizeFilmTitle(f.title);
  if (!title) throw new BadRequestError('film.title is required.');
  return {
    tmdbId: f.tmdbId,
    mediaType: f.mediaType,
    title,
    year: typeof f.year === 'string' ? f.year : '',
    posterUrl: typeof f.posterUrl === 'string' && f.posterUrl ? f.posterUrl : null,
    runtime: typeof f.runtime === 'number' && Number.isFinite(f.runtime) ? f.runtime : null,
  };
}

/** F4 create idempotency — shape-check only (8-64 chars, url-safe-ish). An
 *  invalid/absent key just means "no idempotency for this request", never
 *  an error — the feature is purely additive. */
function isValidClientKey(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 8 && v.length <= 64;
}

// ── DTO mapping ──────────────────────────────────────────────────────────

function tsToIso(t: FirebaseFirestore.Timestamp | null | undefined): string | null {
  return t ? t.toDate().toISOString() : null;
}

/**
 * @param viewerBlockSet F6(b) — the caller's block set (both directions,
 *   from `getBlockSet`). When a CO-INVITEE (never the host — a host↔caller
 *   block hides the whole night before any caller reaches this function; see
 *   the callers below) is in it, that row is filtered out of the returned
 *   `invitees[]`. Counts are always computed from the FULL unfiltered list
 *   first, so the tally never lies about who's actually coming. The host's
 *   OWN view is never filtered (omit or ignore `viewerBlockSet` when
 *   `callerUid === d.hostUid`) — a host still manages every invitee they
 *   invited, blocked or not.
 */
function nightToView(id: string, d: NightDoc, callerUid: string, viewerBlockSet?: Set<string>): MovieNightView {
  const isHost = d.hostUid === callerUid;
  const isInvitee = d.inviteeUids.includes(callerUid);
  const rsvps = d.rsvps || {};

  const allInvitees = (d.inviteeUids || []).map((uid) => {
    const denorm = d.invitees?.[uid];
    const rsvp = rsvps[uid];
    return {
      uid,
      username: denorm?.username ?? null,
      displayName: denorm?.displayName ?? null,
      photoURL: denorm?.photoURL ?? null,
      isHost: uid === d.hostUid,
      answer: rsvp?.answer ?? null,
      respondedAt: tsToIso(rsvp?.respondedAt),
    };
  });

  const invitees = (!viewerBlockSet || isHost)
    ? allInvitees
    : allInvitees.filter((inv) => inv.uid === callerUid || inv.isHost || !viewerBlockSet.has(inv.uid));

  const guestRsvps = Object.entries(d.guestRsvps || {}).map(([guestId, g]) => ({
    guestId,
    name: g.name,
    answer: g.answer,
    respondedAt: tsToIso(g.respondedAt),
  }));

  const counts: MovieNightCounts = { going: 0, maybe: 0, out: 0, waiting: 0 };
  for (const inv of allInvitees) {
    if (inv.answer === 'in') counts.going++;
    else if (inv.answer === 'maybe') counts.maybe++;
    else if (inv.answer === 'out') counts.out++;
    else counts.waiting++;
  }
  for (const g of guestRsvps) {
    if (g.answer === 'in') counts.going++;
    else if (g.answer === 'maybe') counts.maybe++;
    else if (g.answer === 'out') counts.out++;
  }

  return {
    id,
    hostUid: d.hostUid,
    listId: d.listId ?? null,
    listOwnerId: d.listOwnerId ?? null,
    listName: d.listName ?? null,
    film: d.film,
    scheduledFor: d.scheduledFor.toDate().toISOString(),
    previousScheduledFor: tsToIso(d.previousScheduledFor),
    tzOffsetMinutes: d.tzOffsetMinutes ?? 0,
    reminderPreset: d.reminderPreset ?? '2h',
    // Same legacy contract as `visibility` below: absent means the night was
    // written before the field existed, which means it has a real showtime.
    timeTbd: d.timeTbd === true,
    status: d.status,
    // A legacy doc (written before this field existed) has no `visibility`
    // at all — read as 'public', never backfilled.
    visibility: d.visibility === 'private' ? 'private' : 'public',
    invitees,
    guestRsvps,
    shareCode: isHost || isInvitee ? d.shareCode : null,
    completion: d.completion
      ? { attendeeUids: d.completion.attendeeUids, completedAt: tsToIso(d.completion.completedAt) ?? new Date().toISOString() }
      : null,
    viewer: { isHost, isInvitee, answer: rsvps[callerUid]?.answer ?? null },
    counts,
  };
}

/** The redacted `getListMovieNight` shape for a caller who's neither the
 *  night's host nor an invitee — see F5's `MovieNightPinView`. */
function nightToPinView(id: string, d: NightDoc): MovieNightPinView {
  const counts: MovieNightCounts = { going: 0, maybe: 0, out: 0, waiting: 0 };
  for (const uid of d.inviteeUids || []) {
    const answer = d.rsvps?.[uid]?.answer;
    if (answer === 'in') counts.going++;
    else if (answer === 'maybe') counts.maybe++;
    else if (answer === 'out') counts.out++;
    else counts.waiting++;
  }
  for (const g of Object.values(d.guestRsvps || {})) {
    if (g.answer === 'in') counts.going++;
    else if (g.answer === 'maybe') counts.maybe++;
    else if (g.answer === 'out') counts.out++;
  }
  return {
    id,
    film: d.film,
    scheduledFor: d.scheduledFor.toDate().toISOString(),
    tzOffsetMinutes: d.tzOffsetMinutes ?? 0,
    timeTbd: d.timeTbd === true,
    status: d.status,
    counts,
  };
}

// ── Caches (server-TTL, write-invalidated — the quota-first rule) ─────────

/** getUpcomingMovieNights — per-uid, since the view itself is caller-specific
 *  (shareCode/viewer are gated on the caller). */
const upcomingCache = createTtlCache<MovieNightView[]>({ ttlMs: 60_000 });
function invalidateUpcoming(uids: string[]): void {
  for (const uid of uids) upcomingCache.delete(uid);
}

/** getListMovieNight — keyed per list (the RAW doc, not the per-caller view —
 *  the permission gate runs on every call regardless of cache state). */
const listNightCache = createTtlCache<{ id: string; data: NightDoc } | null>({ ttlMs: 60_000 });
function invalidateListNight(listOwnerId: string | null, listId: string | null): void {
  if (!listOwnerId || !listId) return;
  listNightCache.delete(`${listOwnerId}:${listId}`);
}

// ── Notification fan-out ────────────────────────────────────────────────

/** Notify every invitee EXCEPT `actorUid` with the same lifecycle context —
 *  shared by create (host → all invitees) / reschedule / cancel. F4 —
 *  the WHOLE body is wrapped: a notification failure (even the actor-
 *  profile read itself) must never throw back into a caller that already
 *  committed the parent mutation — best-effort, logged, swallowed. */
async function fanOutToOtherInvitees(
  db: FirebaseFirestore.Firestore,
  nightId: string,
  data: Pick<NightDoc, 'film' | 'tzOffsetMinutes' | 'inviteeUids' | 'timeTbd'>,
  actorUid: string,
  scheduledForOverride: FirebaseFirestore.Timestamp,
  send: (db: FirebaseFirestore.Firestore, recipientId: string, ctx: MovieNightNotificationCtx) => Promise<void>,
): Promise<void> {
  try {
    const actorDoc = await db.collection('users').doc(actorUid).get();
    const actor = actorDoc.data() || {};
    const iso = scheduledForOverride.toDate().toISOString();
    const ctx: MovieNightNotificationCtx = {
      nightId,
      movieTitle: data.film.title,
      dateLabel: formatNightDate(iso, data.tzOffsetMinutes),
      timeLabel: nightTimeLabel(iso, data.tzOffsetMinutes, data.timeTbd),
      timeTbd: data.timeTbd === true,
      fromUserId: actorUid,
      fromUsername: actor.username ?? null,
      fromDisplayName: actor.displayName ?? null,
      fromPhotoUrl: actor.photoURL ?? null,
    };
    await Promise.all(
      data.inviteeUids
        .filter((uid) => uid !== actorUid)
        .map((uid) => send(db, uid, ctx).catch((err) => console.error('[movie-nights] notify failed:', err))),
    );
  } catch (err) {
    console.error('[movie-nights] fan-out failed:', err);
  }
}

// ── createMovieNight ────────────────────────────────────────────────────

export type CreateMovieNightInput = {
  film?: unknown;
  scheduledFor?: unknown;
  tzOffsetMinutes?: unknown;
  reminderPreset?: unknown;
  inviteeUids?: unknown;
  listId?: unknown;
  listOwnerId?: unknown;
  /** F4 create idempotency — a client-minted key (8-64 chars) sent with a
   *  create request. A retry carrying the SAME key returns the already-
   *  created night instead of planning a second one. */
  clientKey?: unknown;
  /** Host-controlled privacy — strictly validated (see `validateVisibility`).
   *  Missing/garbage always falls back to `'public'`, matching every night
   *  created before this field existed. */
  visibility?: unknown;
  /** "the day is set, the showtime isn't". Strict: only the literal boolean
   *  `true` counts, so a missing key, a `'true'` string, or anything else
   *  yields a normal night with a real showtime — the safe default, since a
   *  night wrongly marked tbd would hide a showtime the host DID pick. */
  timeTbd?: unknown;
};

/**
 * Plan a movie night. Every invitee must be EITHER a member of the given
 * list OR followed by the host — like a blocked pair (either direction),
 * an ineligible invitee is silently DROPPED rather than failing the whole
 * request (mirrors `resolveTaggedUsers` in posts-server.ts). The host is
 * always in `inviteeUids` and auto-RSVPs 'in'.
 */
export async function createMovieNight(hostUid: string, input: CreateMovieNightInput): Promise<MovieNightView> {
  const db = getDb();

  // F4 — create idempotency. `hostUid == AND clientKey ==` is an
  // equality-only query the automatic single-field indexes satisfy via a
  // merge join — no composite index to deploy. A retry after a dropped
  // response (e.g. a 500 whose write actually committed) returns the SAME
  // night instead of planning a duplicate.
  const clientKey = isValidClientKey(input.clientKey) ? input.clientKey : null;
  if (clientKey) {
    const dupe = await db.collection(NIGHTS)
      .where('hostUid', '==', hostUid)
      .where('clientKey', '==', clientKey)
      .limit(1)
      .get();
    if (!dupe.empty) {
      const doc = dupe.docs[0];
      const blockSet = await getBlockSet(db, hostUid);
      return nightToView(doc.id, doc.data() as NightDoc, hostUid, blockSet);
    }
  }

  // The rate-limit budget is spent HERE rather than in the route wrapper (the
  // pattern everywhere else), and the position is the point: it sits after
  // the idempotency check above, so a retry that returns an existing night
  // costs nothing. It also sits before validation, so a malformed body still
  // costs — a script firing garbage is exactly what this is for, and it is
  // the caller's job to send a valid request.
  //
  // Burst first, then daily: a human who hits the burst has a wait measured
  // in seconds, and only a sustained run reaches the one measured in hours.
  const burst = await checkRateLimit(hostUid, 'movieNightCreate');
  if (!burst.ok) throw new RateLimitedError(burst.error);
  const daily = await checkRateLimit(hostUid, 'movieNightCreateDaily');
  if (!daily.ok) throw new RateLimitedError(daily.error);

  const film = validateFilm(input.film);

  if (typeof input.scheduledFor !== 'string' || !input.scheduledFor) {
    throw new BadRequestError('scheduledFor is required.');
  }
  const scheduledForDate = new Date(input.scheduledFor);
  if (Number.isNaN(scheduledForDate.getTime())) throw new BadRequestError('scheduledFor must be a valid date.');

  const tzOffsetMinutes = clampTzOffset(input.tzOffsetMinutes);
  const timeTbd = input.timeTbd === true;
  // A tbd night is validated at DAY resolution — the anchor hour it carries
  // isn't a decision anyone made, so it isn't a decision worth refusing on.
  // See `isLocalDayBeforeToday`.
  const scheduledInPast = timeTbd
    ? isLocalDayBeforeToday(scheduledForDate, tzOffsetMinutes, new Date())
    : scheduledForDate.getTime() <= Date.now();
  if (scheduledInPast) {
    throw new BadRequestError('movie night must be scheduled in the future.');
  }

  const reminderPreset: ReminderPreset = isReminderPreset(input.reminderPreset) ? input.reminderPreset : '2h';
  const visibility = validateVisibility(input.visibility);

  let listName: string | null = null;
  let listCollaboratorIds: string[] = [];
  const listId = typeof input.listId === 'string' && input.listId ? input.listId : null;
  const listOwnerId = typeof input.listOwnerId === 'string' && input.listOwnerId ? input.listOwnerId : null;
  if (listId && listOwnerId) {
    const listSnap = await db.collection('users').doc(listOwnerId).collection('lists').doc(listId).get();
    if (!listSnap.exists) throw new NotFoundError('List not found.');
    const listData = listSnap.data() || {};
    listCollaboratorIds = Array.isArray(listData.collaboratorIds) ? listData.collaboratorIds : [];
    const isOwner = hostUid === listOwnerId;
    const isCollab = listCollaboratorIds.includes(hostUid);
    if (!isOwner && !isCollab) throw new ForbiddenError('Only list members can plan a movie night for this list.');
    listName = listData.name || null;
  }

  const rawInvitees = Array.isArray(input.inviteeUids) ? input.inviteeUids : [];
  const candidateInvitees = [...new Set(rawInvitees)]
    .filter((uid): uid is string => typeof uid === 'string' && uid.length > 0 && uid !== hostUid)
    .slice(0, MAX_PEOPLE - 1);

  const listMemberSet = new Set<string>(listOwnerId ? [listOwnerId, ...listCollaboratorIds] : []);
  const followingIds = candidateInvitees.length
    ? new Set(await getFollowingIds(hostUid, 2000))
    : new Set<string>();

  // Every invitee must be reachable (list member OR followed) AND not
  // blocked either direction. Both failure modes are silently DROPPED —
  // an ineligible pick never fails the whole night.
  const validInvitees: string[] = [];
  for (const uid of candidateInvitees) {
    if (!listMemberSet.has(uid) && !followingIds.has(uid)) continue;
    if (await isBlockedBetween(db, hostUid, uid)) continue;
    validInvitees.push(uid);
  }

  const inviteeUids = [hostUid, ...validInvitees];

  // Denormalize host + invitee profiles in one batch read.
  const profileDocs = await db.getAll(...inviteeUids.map((uid) => db.collection('users').doc(uid)));
  const invitees: Record<string, InviteeProfile> = {};
  for (const doc of profileDocs) {
    if (!doc.exists) continue;
    const d = doc.data() || {};
    invitees[doc.id] = { username: d.username ?? null, displayName: d.displayName ?? null, photoURL: d.photoURL ?? null };
  }

  const shareCode = generateShareCode();
  const scheduledForTs = Timestamp.fromDate(scheduledForDate);
  const nightRef = db.collection(NIGHTS).doc();

  await nightRef.set({
    hostUid,
    listId,
    listOwnerId,
    listName,
    film,
    scheduledFor: scheduledForTs,
    previousScheduledFor: null,
    tzOffsetMinutes,
    reminderPreset,
    timeTbd,
    status: 'proposed',
    visibility,
    inviteeUids,
    invitees,
    // The host is automatically in.
    rsvps: { [hostUid]: { answer: 'in', respondedAt: FieldValue.serverTimestamp() } },
    guestRsvps: {},
    shareCode,
    clientKey,
    reminderSentAt: null,
    morningAfterSentAt: null,
    completion: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  invalidateUpcoming(inviteeUids);
  invalidateListNight(listOwnerId, listId);

  // Best-effort notification fan-out to every non-host invitee.
  await fanOutToOtherInvitees(
    db, nightRef.id, { film, tzOffsetMinutes, inviteeUids, timeTbd }, hostUid, scheduledForTs,
    createMovieNightInviteNotification,
  );

  const fresh = await nightRef.get();
  return nightToView(nightRef.id, fresh.data() as NightDoc, hostUid);
}

// ── getMovieNight ────────────────────────────────────────────────────────

/** F6(a) — a host↔caller block (either direction) hides the night entirely:
 *  `NotFoundError`, not `ForbiddenError` — no existence oracle for a blocked
 *  relationship. A plain stranger (never invited at all) still gets the
 *  pre-existing 403 below; only an invited-but-now-blocked caller gets 404. */
export async function getMovieNight(callerUid: string, id: string): Promise<MovieNightView> {
  const db = getDb();
  const snap = await db.collection(NIGHTS).doc(id).get();
  if (!snap.exists) throw new NotFoundError('Movie night not found.');
  const data = snap.data() as NightDoc;
  const isHost = data.hostUid === callerUid;
  const isInvitee = data.inviteeUids.includes(callerUid);
  if (!isHost && !isInvitee) throw new ForbiddenError();
  const blockSet = await getBlockSet(db, callerUid);
  if (blockSet.has(data.hostUid)) throw new NotFoundError('Movie night not found.');
  return nightToView(id, data, callerUid, blockSet);
}

// ── getUpcomingMovieNights ───────────────────────────────────────────────

/**
 * The caller's upcoming (or just-passed, awaiting an outcome) proposed
 * nights — host or invitee, soonest first, capped 10. The `-36h` floor lets
 * last night's unresolved night still surface for the morning-after prompt.
 * Needs a composite index (`inviteeUids` array-contains, `status` ==,
 * `scheduledFor` ASC) — see `firestore.indexes.json`; the Firestore emulator
 * does not enforce composite indexes, so tests can call this directly.
 */
export async function getUpcomingMovieNights(callerUid: string): Promise<MovieNightView[]> {
  return cached(upcomingCache, callerUid, async () => {
    const db = getDb();
    const cutoff = Timestamp.fromMillis(Date.now() - 36 * 60 * 60 * 1000);
    const snap = await db
      .collection(NIGHTS)
      .where('inviteeUids', 'array-contains', callerUid)
      .where('status', '==', 'proposed')
      .where('scheduledFor', '>=', cutoff)
      .orderBy('scheduledFor', 'asc')
      .limit(10)
      .get();
    // F6(a) — a night hosted by someone blocked either direction with the
    // caller is excluded entirely (one getBlockSet call for the whole page).
    const blockSet = await getBlockSet(db, callerUid);
    return snap.docs
      .filter((d) => !blockSet.has((d.data() as NightDoc).hostUid))
      .map((d) => nightToView(d.id, d.data() as NightDoc, callerUid, blockSet));
  });
}

// ── getListMovieNight (the pinned-card read) ────────────────────────────

/**
 * The soonest 'proposed' night pinned to a list, or null. Same privacy gate
 * as `getListPreview`: public lists are open, private lists require the
 * caller be the owner or a collaborator. Needs a composite index (`listId`
 * ==, `status` ==, `scheduledFor` ASC).
 *
 * F5 — the route stays PUBLIC (anonymous public-list viewers may see the
 * pin), but the payload is gated on IDENTITY, not just list access: a
 * caller who is neither the night's host nor an invitee gets the redacted
 * `MovieNightPinView` (no invitee uids, no guest names, no shareCode, no
 * hostUid) — only the host/invitees get the full `MovieNightView`.
 */
export async function getListMovieNight(
  callerUid: string | null,
  listOwnerId: string,
  listId: string,
): Promise<MovieNightView | MovieNightPinView | null> {
  const db = getDb();
  const listSnap = await db.collection('users').doc(listOwnerId).collection('lists').doc(listId).get();
  if (!listSnap.exists) return null;
  const listData = listSnap.data() || {};
  const isPublic = listData.isPublic === true;
  const collaboratorIds: string[] = Array.isArray(listData.collaboratorIds) ? listData.collaboratorIds : [];
  const allowed = isPublic || (callerUid != null && (callerUid === listOwnerId || collaboratorIds.includes(callerUid)));
  if (!allowed) return null;

  const raw = await cached(listNightCache, `${listOwnerId}:${listId}`, async () => {
    const snap = await db
      .collection(NIGHTS)
      .where('listId', '==', listId)
      .where('status', '==', 'proposed')
      .orderBy('scheduledFor', 'asc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, data: doc.data() as NightDoc };
  });
  if (!raw) return null;

  // F6(a) — a night hosted by someone blocked either direction is excluded
  // for that caller entirely (no existence oracle). An anonymous caller has
  // no block set at all.
  const blockSet = callerUid ? await getBlockSet(db, callerUid) : new Set<string>();
  if (blockSet.has(raw.data.hostUid)) return null;

  const isHost = callerUid != null && raw.data.hostUid === callerUid;
  const isInvitee = callerUid != null && raw.data.inviteeUids.includes(callerUid);
  if (!isHost && !isInvitee) {
    // Host-set privacy: a PRIVATE night is invisible to anyone who isn't the
    // host or an invitee — same `null` as no night existing at all (no
    // existence oracle), which also covers an anonymous caller on a public
    // list. Only a PUBLIC night reaches the redacted pin view below.
    //
    // Deliberate tradeoff: `listNightCache` (above) holds only the SOONEST
    // 'proposed' night per list. If that soonest night is private, a LATER
    // public night on the same list is hidden from non-invitees too — this
    // function only ever looks at the one soonest doc. Acceptable: in
    // practice a list has one active night at a time, and this never hides
    // anything from the host/invitees of either night.
    if (raw.data.visibility === 'private') return null;
    return nightToPinView(raw.id, raw.data);
  }
  return nightToView(raw.id, raw.data, callerUid ?? '', blockSet);
}

// ── rsvpMovieNight ───────────────────────────────────────────────────────

/** Any invitee (host included) sets their RSVP answer. Notifies the host
 *  (skipped when the host RSVPs to their own night). F6(a) — a host↔caller
 *  block (either direction) 404s instead of updating (no existence oracle):
 *  the caller's own block set is fetched ONCE, before the transaction, and
 *  reused both for the in-transaction guard and the returned view. */
export async function rsvpMovieNight(callerUid: string, id: string, rawAnswer: unknown): Promise<MovieNightView> {
  if (!isRsvpAnswer(rawAnswer)) throw new BadRequestError('answer must be "in", "maybe", or "out".');
  const answer = rawAnswer;

  const db = getDb();
  const ref = db.collection(NIGHTS).doc(id);
  const blockSet = await getBlockSet(db, callerUid);

  type TxOk = { kind: 'ok'; data: NightDoc };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: 'err' as const, error: new NotFoundError('Movie night not found.') };
    const data = snap.data() as NightDoc;
    if (!data.inviteeUids.includes(callerUid)) return { kind: 'err' as const, error: new ForbiddenError() };
    if (blockSet.has(data.hostUid)) return { kind: 'err' as const, error: new NotFoundError('Movie night not found.') };
    tx.update(ref, {
      [`rsvps.${callerUid}`]: { answer, respondedAt: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'ok' as const, data };
  });
  if (result.kind === 'err') throw result.error;

  invalidateUpcoming(result.data.inviteeUids);
  invalidateListNight(result.data.listOwnerId, result.data.listId);

  if (result.data.hostUid !== callerUid) {
    try {
      const callerDoc = await db.collection('users').doc(callerUid).get();
      const caller = callerDoc.data() || {};
      const iso = result.data.scheduledFor.toDate().toISOString();
      await createMovieNightRsvpNotification(db, result.data.hostUid, {
        nightId: id,
        movieTitle: result.data.film.title,
        dateLabel: formatNightDate(iso, result.data.tzOffsetMinutes),
        timeLabel: nightTimeLabel(iso, result.data.tzOffsetMinutes, result.data.timeTbd),
        timeTbd: result.data.timeTbd === true,
        fromUserId: callerUid,
        fromUsername: caller.username ?? null,
        fromDisplayName: caller.displayName ?? null,
        fromPhotoUrl: caller.photoURL ?? null,
        answer,
      });
    } catch (err) {
      console.error('[rsvpMovieNight] notify failed:', err);
    }
  }

  const fresh = await ref.get();
  return nightToView(id, fresh.data() as NightDoc, callerUid, blockSet);
}

// ── updateMovieNight — reschedule / cancel / didnt_happen ───────────────

export async function updateMovieNight(callerUid: string, id: string, rawPatch: unknown): Promise<MovieNightView> {
  const patch = (rawPatch && typeof rawPatch === 'object' ? rawPatch : {}) as Record<string, unknown>;
  const db = getDb();
  const ref = db.collection(NIGHTS).doc(id);

  if (patch.action === 'reschedule') {
    if (typeof patch.scheduledFor !== 'string' || !patch.scheduledFor) {
      throw new BadRequestError('scheduledFor is required.');
    }
    const scheduledForDate = new Date(patch.scheduledFor);
    if (Number.isNaN(scheduledForDate.getTime())) throw new BadRequestError('scheduledFor must be a valid date.');

    // Unlike `visibility` below, `timeTbd` is NOT an optional patch key: it
    // describes the very thing this action replaces. A reschedule body always
    // carries a concrete `scheduledFor`, so an absent flag means "this is a
    // real showtime" — which is exactly how a tbd night gets its time pinned
    // down later, through the flow the host already knows. Defaulting it to
    // the stored value instead would make "set the time" impossible without a
    // second, redundant edit surface.
    const timeTbd = patch.timeTbd === true;
    // A non-tbd night's past-check is timezone-independent (an instant is
    // past or it isn't), so it runs here. The tbd one is a LOCAL-DAY
    // comparison and a reschedule body never carries `tzOffsetMinutes` — the
    // night's stored offset is authoritative — so that check runs inside the
    // transaction below, where the doc is in hand.
    if (!timeTbd && scheduledForDate.getTime() <= Date.now()) {
      throw new BadRequestError('movie night must be scheduled in the future.');
    }
    const scheduledForTs = Timestamp.fromDate(scheduledForDate);

    // Host-controlled privacy rides the same "edit" action as a reschedule
    // rather than a new endpoint — `reschedule` is the only host-editable
    // action, so any other mutable field (this one included) flows through
    // it. Only touched when the caller actually SENT the key: a plain
    // reschedule body (no `visibility`) must never silently flip an existing
    // private night back to public. Same strict validation as create.
    const visibility: MovieNightVisibility | undefined =
      patch.visibility !== undefined ? validateVisibility(patch.visibility) : undefined;

    type TxOk = { kind: 'ok'; data: NightDoc };
    type TxErr = { kind: 'err'; error: Error };
    const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { kind: 'err' as const, error: new NotFoundError('Movie night not found.') };
      const data = snap.data() as NightDoc;
      if (data.hostUid !== callerUid) return { kind: 'err' as const, error: new ForbiddenError('Only the host can reschedule.') };
      // F3 — a completed/cancelled/didnt_happen night is a closed chapter;
      // reschedule must guard `status === 'proposed'` exactly like
      // didnt_happen already does below.
      if (data.status !== 'proposed') {
        return { kind: 'err' as const, error: new BadRequestError('This movie night cannot be rescheduled.') };
      }
      // The tbd day-check, run here because it needs the night's STORED
      // timezone offset (see the note above the non-tbd check).
      if (timeTbd && isLocalDayBeforeToday(scheduledForDate, data.tzOffsetMinutes ?? 0, new Date())) {
        return { kind: 'err' as const, error: new BadRequestError('movie night must be scheduled in the future.') };
      }
      const nightUpdate: {
        previousScheduledFor: FirebaseFirestore.Timestamp;
        scheduledFor: FirebaseFirestore.Timestamp;
        timeTbd: boolean;
        status: 'proposed';
        reminderSentAt: null;
        morningAfterSentAt: null;
        updatedAt: FirebaseFirestore.FieldValue;
        visibility?: MovieNightVisibility;
      } = {
        previousScheduledFor: data.scheduledFor,
        scheduledFor: scheduledForTs,
        timeTbd,
        status: 'proposed',
        reminderSentAt: null,
        morningAfterSentAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (visibility !== undefined) nightUpdate.visibility = visibility;
      tx.update(ref, nightUpdate);
      return { kind: 'ok' as const, data };
    });
    if (result.kind === 'err') throw result.error;

    // Same cache invalidation as every other mutation in this function —
    // a visibility flip changes what `getListMovieNight` returns to a
    // non-invitee just as much as a status/time change does, so the pin
    // cache (keyed per list) must be dropped here too, not just on reschedule.
    invalidateUpcoming(result.data.inviteeUids);
    invalidateListNight(result.data.listOwnerId, result.data.listId);
    await fanOutToOtherInvitees(
      // `timeTbd` is the NEW value, not `result.data`'s pre-update one — the
      // "moved to …" push has to describe the night people are about to have.
      db, id, { film: result.data.film, tzOffsetMinutes: result.data.tzOffsetMinutes, inviteeUids: result.data.inviteeUids, timeTbd },
      callerUid, scheduledForTs, createMovieNightTimeChangedNotification,
    );

    const fresh = await ref.get();
    return nightToView(id, fresh.data() as NightDoc, callerUid, await getBlockSet(db, callerUid));
  }

  if (patch.action === 'cancel') {
    type TxOk = { kind: 'ok'; data: NightDoc };
    type TxErr = { kind: 'err'; error: Error };
    const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { kind: 'err' as const, error: new NotFoundError('Movie night not found.') };
      const data = snap.data() as NightDoc;
      if (data.hostUid !== callerUid) return { kind: 'err' as const, error: new ForbiddenError('Only the host can cancel.') };
      // F3 — same guard: cancelling an already-completed/cancelled/
      // didnt_happen night makes no sense.
      if (data.status !== 'proposed') {
        return { kind: 'err' as const, error: new BadRequestError('This movie night cannot be cancelled.') };
      }
      tx.update(ref, { status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
      return { kind: 'ok' as const, data };
    });
    if (result.kind === 'err') throw result.error;

    invalidateUpcoming(result.data.inviteeUids);
    invalidateListNight(result.data.listOwnerId, result.data.listId);
    await fanOutToOtherInvitees(
      db, id, { film: result.data.film, tzOffsetMinutes: result.data.tzOffsetMinutes, inviteeUids: result.data.inviteeUids, timeTbd: result.data.timeTbd },
      callerUid, result.data.scheduledFor, createMovieNightCancelledNotification,
    );

    const fresh = await ref.get();
    return nightToView(id, fresh.data() as NightDoc, callerUid, await getBlockSet(db, callerUid));
  }

  if (patch.action === 'didnt_happen') {
    type TxOk = { kind: 'ok'; data: NightDoc };
    type TxErr = { kind: 'err'; error: Error };
    const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { kind: 'err' as const, error: new NotFoundError('Movie night not found.') };
      const data = snap.data() as NightDoc;
      if (!data.inviteeUids.includes(callerUid)) return { kind: 'err' as const, error: new ForbiddenError() };
      if (data.status !== 'proposed') {
        return { kind: 'err' as const, error: new BadRequestError('This movie night is not awaiting an outcome.') };
      }
      if (data.scheduledFor.toMillis() > Date.now()) {
        return { kind: 'err' as const, error: new BadRequestError('This movie night has not happened yet.') };
      }
      tx.update(ref, { status: 'didnt_happen', updatedAt: FieldValue.serverTimestamp() });
      return { kind: 'ok' as const, data };
    });
    if (result.kind === 'err') throw result.error;

    invalidateUpcoming(result.data.inviteeUids);
    invalidateListNight(result.data.listOwnerId, result.data.listId);

    const fresh = await ref.get();
    return nightToView(id, fresh.data() as NightDoc, callerUid, await getBlockSet(db, callerUid));
  }

  throw new BadRequestError('Unknown action.');
}

// ── completeMovieNight — "we watched it" (the north-star write) ─────────

export type CompleteMovieNightInput = {
  attendeeUids?: unknown;
  rating?: unknown;
  note?: unknown;
};

/**
 * "We watched it": logs a watch (`recordWatchEntry`, watchedAt = the
 * night's `scheduledFor`) for every attendee, and — only for the CALLER —
 * upserts a rating/review when provided (reusing `logWatch`'s exact
 * rating+note path, the same one the "how was it?" sheet uses, rather than
 * duplicating it). Idempotent: a re-call on an already-`completed` night
 * skips the attendee fan-out + notifications and just re-applies the
 * caller's own rating path (so returning later to add a rating still works).
 *
 * F2 — every watch written here is stamped `movieNightId: id`
 * (`recordWatchEntry`/`logWatch` in `watches-server.ts`), so a SECOND
 * attendee rating the night later (their own `complete` call landing after
 * the night is already `completed` — the 'already' path below) updates
 * their existing watch in place instead of creating a phantom rewatch.
 *
 * F8 — `attendeeUids` is filtered to invitees whose CURRENT rsvp answer is
 * 'in' or 'maybe'; the caller is always allowed regardless of their own
 * answer. An invitee who never said they were coming (or said 'out') never
 * gets a watch logged on their behalf just because someone else typed
 * their uid into the request body.
 */
export async function completeMovieNight(
  callerUid: string,
  id: string,
  input: CompleteMovieNightInput,
): Promise<MovieNightView> {
  const db = getDb();
  const ref = db.collection(NIGHTS).doc(id);

  type TxResult =
    | { kind: 'notfound' }
    | { kind: 'forbidden' }
    | { kind: 'too_soon' }
    | { kind: 'bad_status' }
    | { kind: 'bad_attendees' }
    | { kind: 'already'; data: NightDoc }
    | { kind: 'fresh'; data: NightDoc; attendeeUids: string[] };

  const result: TxResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: 'notfound' };
    const data = snap.data() as NightDoc;
    if (!data.inviteeUids.includes(callerUid)) return { kind: 'forbidden' };
    if (data.status === 'completed') return { kind: 'already', data };
    if (data.status !== 'proposed') return { kind: 'bad_status' };
    if (data.scheduledFor.toMillis() > Date.now()) return { kind: 'too_soon' };

    const rawAttendees = Array.isArray(input.attendeeUids) ? input.attendeeUids : [];
    const attendeeUids = [...new Set(rawAttendees)].filter((uid): uid is string => {
      if (typeof uid !== 'string' || !data.inviteeUids.includes(uid)) return false;
      if (uid === callerUid) return true; // the caller always attends their own completion
      const answer = data.rsvps?.[uid]?.answer;
      return answer === 'in' || answer === 'maybe';
    });
    if (!attendeeUids.includes(callerUid)) return { kind: 'bad_attendees' };

    tx.update(ref, {
      status: 'completed',
      completion: { attendeeUids, completedAt: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'fresh', data, attendeeUids };
  });

  if (result.kind === 'notfound') throw new NotFoundError('Movie night not found.');
  if (result.kind === 'forbidden') throw new ForbiddenError();
  if (result.kind === 'too_soon') throw new BadRequestError('This movie night has not happened yet.');
  if (result.kind === 'bad_status') throw new BadRequestError('This movie night cannot be completed.');
  if (result.kind === 'bad_attendees') throw new BadRequestError('attendeeUids must be invitees and include you.');

  const data = result.data;
  const watchedAtIso = data.scheduledFor.toDate().toISOString();
  const rating = typeof input.rating === 'number' ? input.rating : null;
  const note = typeof input.note === 'string' ? input.note : null;

  if (result.kind === 'fresh') {
    // Watch entries for every OTHER attendee (the caller's own is applied
    // below, possibly carrying a rating — routed through logWatch instead so
    // it isn't double-logged). Stamped with the night's id so a later solo
    // `complete` call from one of them (F2) updates THIS watch in place.
    await Promise.all(
      result.attendeeUids
        .filter((uid) => uid !== callerUid)
        .map((uid) =>
          recordWatchEntry(uid, {
            tmdbId: data.film.tmdbId,
            mediaType: data.film.mediaType,
            movieTitle: data.film.title,
            moviePosterUrl: data.film.posterUrl,
            watchedAt: watchedAtIso,
            movieNightId: id,
          }).catch((err) => console.error('[completeMovieNight] watch entry failed:', err)),
        ),
    );

    invalidateUpcoming(data.inviteeUids);
    invalidateListNight(data.listOwnerId, data.listId);

    // Nudge the other attendees to rate it too — best-effort.
    try {
      const callerDoc = await db.collection('users').doc(callerUid).get();
      const caller = callerDoc.data() || {};
      const ctx: MovieNightNotificationCtx = {
        nightId: id,
        movieTitle: data.film.title,
        dateLabel: formatNightDate(watchedAtIso, data.tzOffsetMinutes),
        timeLabel: nightTimeLabel(watchedAtIso, data.tzOffsetMinutes, data.timeTbd),
        timeTbd: data.timeTbd === true,
        fromUserId: callerUid,
        fromUsername: caller.username ?? null,
        fromDisplayName: caller.displayName ?? null,
        fromPhotoUrl: caller.photoURL ?? null,
      };
      await Promise.all(
        result.attendeeUids
          .filter((uid) => uid !== callerUid)
          .map((uid) =>
            createMovieNightMorningAfterNotification(db, uid, ctx).catch((err) =>
              console.error('[completeMovieNight] notify failed:', err)),
          ),
      );
    } catch (err) {
      console.error('[completeMovieNight] morning-after notify failed:', err);
    }
  }

  // The caller's own watch/rating path — applies on BOTH a fresh completion
  // and a later re-entry (e.g. rating it after the fact). F2 — stamped with
  // the same movieNightId, so a fan-out watch already sitting there (e.g.
  // another attendee completed first) gets updated in place instead of
  // duplicated.
  if (rating != null || note) {
    await logWatch(callerUid, {
      tmdbId: data.film.tmdbId,
      mediaType: data.film.mediaType,
      movieTitle: data.film.title,
      moviePosterUrl: data.film.posterUrl,
      rating,
      note,
      watchedAt: watchedAtIso,
      movieNightId: id,
    });
  } else {
    await recordWatchEntry(callerUid, {
      tmdbId: data.film.tmdbId,
      mediaType: data.film.mediaType,
      movieTitle: data.film.title,
      moviePosterUrl: data.film.posterUrl,
      watchedAt: watchedAtIso,
      movieNightId: id,
    });
  }

  const fresh = await ref.get();
  return nightToView(id, fresh.data() as NightDoc, callerUid, await getBlockSet(db, callerUid));
}

// ═════════════════════════════════════════════════════════════════════════
// S2 — the ticker (reminder + morning-after check-in)
// ═════════════════════════════════════════════════════════════════════════
//
// Invoked every 10 minutes by `.github/workflows/movie-nights-tick.yml` via
// `POST /api/v1/admin/movie-nights-tick` (adminRoute). Owns PUSHES only —
// lifecycle status is never mutated here (MOVIE-NIGHT-PLAN.md § locked
// decision 3): the user always drives `complete`/`didnt_happen` themselves.
//
// Every send is a transactional claim on `reminderSentAt`/`morningAfterSentAt`
// so two overlapping ticks (a slow run + the next scheduled one, or two
// concurrent `tickMovieNights` calls in a test) can never double-send: the
// non-transactional query that SELECTS candidates can race and return the
// same doc to both callers, but the per-doc `runTransaction` re-reads the
// claim field and only one commit wins — Firestore auto-retries the loser,
// which then sees the field already set and backs off.

const TICK_BATCH_CAP = 50;

/**
 * ⚠ THE DELIVERY WINDOW IS SIZED AGAINST THE TICK GAP, NOT THE CRON STRING.
 *
 * `.github/workflows/movie-nights-tick.yml` asks for a tick every 10 minutes
 * and does not get one: measured 2026-08-06 over the preceding 12 days, GitHub
 * ran 177 of the ~1790 requested, with consecutive gaps of 49 / 92 / 217
 * minutes (min / median / max). A reminder whose ENTIRE window falls inside one
 * of those gaps is never sent and never retried — the claim is one-shot. Two
 * prod nights were lost exactly that way before anyone noticed:
 *
 *   zNyWnTuk  05.08  preset '2h'        135min window, 0 ticks inside it
 *   nFZpy6d2  27.07  preset 'showtime'   15min window, 0 ticks inside it
 *
 * So the window is widened, and deliberately widened MOSTLY ON THE EARLY SIDE:
 * a reminder that arrives an hour early still tells the truth ("at 8pm
 * tonight"), while one that arrives an hour late does not. `reminderTiming`
 * below keeps the copy honest at whichever end it actually lands on.
 *
 * Resulting widths, against that 217-minute worst-case gap:
 *   '2h'                [-4h,  +90m]  330min  ✔ covered
 *   'showtime'          [-2h,  +90m]  210min  ~ covered to the median, not the tail
 *   'morning' / tbd     [9am,  +90m]   hours  ✔ covered, and takes NO early lead
 *                                             (it would only mean a 7am push)
 *
 * Do not shrink these back toward the cron's nominal cadence without first
 * re-measuring the real gap — that number is a property of GitHub's scheduler,
 * not of this repo.
 */
const REMINDER_EARLY_LEAD_MS = 2 * 3600_000;
const REMINDER_GRACE_MS = 90 * 60_000;

// Coupled on purpose: the query selects on `scheduledFor`, so a night whose
// showtime has already passed is only reachable while it stays inside this
// lookback. Widening the grace without widening the lookback would leave the
// extra grace unreachable — the reminder would still be dropped, and the
// constant would read as if it weren't.
const REMINDER_WINDOW_BEFORE_MS = REMINDER_GRACE_MS;
const REMINDER_WINDOW_AFTER_MS = 26 * 3600_000;

const MORNING_AFTER_WINDOW_BEFORE_MS = 3 * 24 * 3600_000;
const MORNING_AFTER_WINDOW_AFTER_MS = 2 * 3600_000;

/**
 * A specific local wall-clock time (`hour`:`minute`, optionally `dayOffset`
 * days later) on the local calendar date of `instant`, converted back to a
 * real UTC instant. Mirrors `formatNightDate`/`formatNightTime`'s manual
 * `tzOffsetMinutes` arithmetic — no Intl timezone database needed server-side.
 */
function localClockTime(
  instant: Date,
  tzOffsetMinutes: number,
  hour: number,
  minute: number,
  dayOffset = 0,
): Date {
  const local = new Date(instant.getTime() + tzOffsetMinutes * 60_000);
  const localTargetMs = Date.UTC(
    local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset, hour, minute, 0, 0,
  );
  return new Date(localTargetMs - tzOffsetMinutes * 60_000);
}

/**
 * The instant a reminder should fire, per its preset.
 *
 * A tbd night overrides the preset to morning-of: "2 hours before" and "at
 * showtime" are both defined relative to a showtime nobody has picked, so
 * honouring them would fire the reminder off the 8pm anchor and quietly
 * present a made-up time as real. Morning-of is the only preset that stays
 * true when the hour is unknown ("tonight's the night, time still tbd").
 *
 * The stored `reminderPreset` is deliberately NOT rewritten when a night goes
 * tbd — this is a read-time override, so the host's actual choice comes back
 * intact the moment they pin a real showtime down.
 */
function reminderFireTime(
  scheduledFor: Date, tzOffsetMinutes: number, preset: ReminderPreset, timeTbd?: boolean,
): Date {
  if (timeTbd) return localClockTime(scheduledFor, tzOffsetMinutes, 9, 0);
  if (preset === 'showtime') return scheduledFor;
  if (preset === 'morning') return localClockTime(scheduledFor, tzOffsetMinutes, 9, 0);
  return new Date(scheduledFor.getTime() - 2 * 3600_000); // '2h' (also the default)
}

/**
 * How the reminder's ACTUAL send moment relates to the showtime it describes.
 *
 * The window above is wide enough that a reminder can legitimately land hours
 * early or up to 90 minutes late, so the copy can no longer assume "soon" —
 * "movie night starts soon / grab your snacks" is simply false when the film
 * began an hour ago, and that lie is what a wider window would otherwise buy.
 *
 * Pure duration arithmetic, no timezone: unlike the client-only `nightPhase`
 * (movie-night-format.ts), which reads the *browser's* local calendar, this
 * only ever compares two instants, so it is safe on a server that has no
 * meaningful local timezone of its own.
 */
const REMINDER_SOON_MS = 3 * 3600_000;

export function reminderTiming(scheduledFor: Date, now: Date): ReminderTiming {
  const until = scheduledFor.getTime() - now.getTime();
  if (until <= 0) return 'started';
  return until <= REMINDER_SOON_MS ? 'soon' : 'ahead';
}

/** 10:00 am local on the calendar day AFTER `scheduledFor`. */
function morningAfterFireTime(scheduledFor: Date, tzOffsetMinutes: number): Date {
  return localClockTime(scheduledFor, tzOffsetMinutes, 10, 0, 1);
}

/** Whether `scheduledFor` falls on the SAME local calendar date as `now`,
 *  both read through the night's own `tzOffsetMinutes` (there is no separate
 *  "server timezone" concept here — see the module header). */
function isNightToday(scheduledFor: Date, tzOffsetMinutes: number, now: Date): boolean {
  const localSched = new Date(scheduledFor.getTime() + tzOffsetMinutes * 60_000);
  const localNow = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  return (
    localSched.getUTCFullYear() === localNow.getUTCFullYear() &&
    localSched.getUTCMonth() === localNow.getUTCMonth() &&
    localSched.getUTCDate() === localNow.getUTCDate()
  );
}

/** Claims + sends the reminder for ONE night, if it's due. Returns whether a
 *  send happened. Never throws — the caller wraps per-doc for the sweep's
 *  poison-pill isolation. */
async function tickOneReminder(db: FirebaseFirestore.Firestore, id: string, now: Date): Promise<boolean> {
  const ref = db.collection(NIGHTS).doc(id);

  type ClaimResult = { claimed: false } | { claimed: true; data: NightDoc };
  const result: ClaimResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { claimed: false };
    const data = snap.data() as NightDoc;
    if (data.status !== 'proposed' || data.reminderSentAt != null) return { claimed: false };

    const scheduledFor = data.scheduledFor.toDate();
    const tzOffsetMinutes = data.tzOffsetMinutes ?? 0;
    const fireTime = reminderFireTime(scheduledFor, tzOffsetMinutes, data.reminderPreset ?? '2h', data.timeTbd);
    // Send from a lead BEFORE the preset's fire time rather than exactly at it:
    // the tick may not run again for hours, so "a bit early" is the only
    // alternative to "never" (see REMINDER_EARLY_LEAD_MS).
    //
    // But only where the lead actually pays. A SHOWTIME-anchored preset ('2h',
    // 'showtime') is the one with a window too narrow to survive the tick gap.
    // A MORNING-anchored one ('morning', and every tbd night, which overrides
    // to morning-of) already runs from 9am to showtime — hours wide, never the
    // thing that got dropped. Leading those earlier buys no reliability and
    // costs a 7am push, which is strictly worse than the problem being solved.
    const morningAnchored = data.timeTbd === true || (data.reminderPreset ?? '2h') === 'morning';
    const sendFrom = fireTime.getTime() - (morningAnchored ? 0 : REMINDER_EARLY_LEAD_MS);
    const sendUntil = scheduledFor.getTime() + REMINDER_GRACE_MS;
    // Pre-existing edge, unchanged and called out rather than silently papered
    // over: 'morning' on an after-midnight showtime puts 9am AFTER the film, so
    // the window is empty and no reminder is possible. Rare enough to leave to
    // a deliberate decision rather than fold into a latency fix.
    if (now.getTime() < sendFrom || now.getTime() > sendUntil) return { claimed: false };

    tx.update(ref, { reminderSentAt: FieldValue.serverTimestamp() });
    return { claimed: true, data };
  });

  if (!result.claimed) return false;

  const data = result.data;
  const scheduledFor = data.scheduledFor.toDate();
  const iso = scheduledFor.toISOString();
  const tzOffsetMinutes = data.tzOffsetMinutes ?? 0;
  const hostProfile = data.invitees?.[data.hostUid];

  const ctx = {
    nightId: id,
    movieTitle: data.film.title,
    dateLabel: formatNightDate(iso, tzOffsetMinutes),
    timeLabel: nightTimeLabel(iso, tzOffsetMinutes, data.timeTbd),
    timeTbd: data.timeTbd === true,
    // System push, not an actor's action — the empty-string sentinel never
    // equals a real recipient uid, so the creator's self-notify guard never
    // excludes the host from their own reminder (unlike invite/cancel/etc,
    // where the host performing the action legitimately shouldn't self-notify).
    fromUserId: '',
    fromUsername: null,
    fromDisplayName: null,
    fromPhotoUrl: hostProfile?.photoURL ?? null,
    isTonight: isNightToday(scheduledFor, tzOffsetMinutes, now),
    // A tbd night has no showtime to be early or late FOR, so it carries no
    // timing at all. Encoding that as `null` — rather than computing it off the
    // 8pm anchor and trusting the copy to ignore it — keeps "the anchor is
    // never reasoned about" true in the DATA, not merely in whichever branch
    // happens to read it today.
    timing: data.timeTbd ? null : reminderTiming(scheduledFor, now),
  };

  const recipients = (data.inviteeUids || []).filter((uid) => data.rsvps?.[uid]?.answer !== 'out');
  await Promise.all(
    recipients.map((uid) =>
      createMovieNightReminderNotification(db, uid, ctx).catch((err) =>
        console.error(`[movie-nights][tick] reminder notify failed for night ${id} → ${uid}:`, err),
      ),
    ),
  );

  return true;
}

async function tickReminders(db: FirebaseFirestore.Firestore, now: Date): Promise<number> {
  const windowStart = Timestamp.fromMillis(now.getTime() - REMINDER_WINDOW_BEFORE_MS);
  const windowEnd = Timestamp.fromMillis(now.getTime() + REMINDER_WINDOW_AFTER_MS);

  let snap: FirebaseFirestore.QuerySnapshot;
  try {
    snap = await db
      .collection(NIGHTS)
      .where('status', '==', 'proposed')
      .where('reminderSentAt', '==', null)
      .where('scheduledFor', '>=', windowStart)
      .where('scheduledFor', '<=', windowEnd)
      .limit(TICK_BATCH_CAP)
      .get();
  } catch (err) {
    console.error('[movie-nights][tick] reminder query failed:', err);
    return 0;
  }

  let sent = 0;
  for (const doc of snap.docs) {
    try {
      if (await tickOneReminder(db, doc.id, now)) sent++;
    } catch (err) {
      console.error(`[movie-nights][tick] reminder failed for night ${doc.id}:`, err);
    }
  }
  console.log(`[movie-nights][tick] reminders scanned=${snap.docs.length} sent=${sent}`);
  return sent;
}

/** Claims + sends the morning-after check-in for ONE night, if it's due.
 *  Returns whether a send happened. Never throws (per-doc isolation). */
async function tickOneMorningAfter(db: FirebaseFirestore.Firestore, id: string, now: Date): Promise<boolean> {
  const ref = db.collection(NIGHTS).doc(id);

  type ClaimResult = { claimed: false } | { claimed: true; data: NightDoc };
  const result: ClaimResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { claimed: false };
    const data = snap.data() as NightDoc;
    if (data.status !== 'proposed' || data.morningAfterSentAt != null) return { claimed: false };

    const scheduledFor = data.scheduledFor.toDate();
    const tzOffsetMinutes = data.tzOffsetMinutes ?? 0;
    const fireTime = morningAfterFireTime(scheduledFor, tzOffsetMinutes);
    if (now.getTime() < fireTime.getTime()) return { claimed: false };

    tx.update(ref, { morningAfterSentAt: FieldValue.serverTimestamp() });
    return { claimed: true, data };
  });

  if (!result.claimed) return false;

  const data = result.data;
  const scheduledFor = data.scheduledFor.toDate();
  const iso = scheduledFor.toISOString();
  const tzOffsetMinutes = data.tzOffsetMinutes ?? 0;

  // in/maybe invitees + the host regardless of their own answer.
  const recipients = new Set<string>();
  for (const uid of data.inviteeUids || []) {
    const answer = data.rsvps?.[uid]?.answer;
    if (answer === 'in' || answer === 'maybe') recipients.add(uid);
  }
  recipients.add(data.hostUid);

  const ctx = {
    nightId: id,
    movieTitle: data.film.title,
    dateLabel: formatNightDate(iso, tzOffsetMinutes),
    timeLabel: nightTimeLabel(iso, tzOffsetMinutes, data.timeTbd),
    timeTbd: data.timeTbd === true,
    fromUserId: '', // system sentinel — see tickOneReminder
    fromUsername: null,
    fromDisplayName: null,
    fromPhotoUrl: null,
    flavor: 'prompt' as const,
  };

  await Promise.all(
    [...recipients].map((uid) =>
      createMovieNightMorningAfterNotification(db, uid, ctx).catch((err) =>
        console.error(`[movie-nights][tick] morning-after notify failed for night ${id} → ${uid}:`, err),
      ),
    ),
  );

  return true;
}

async function tickMorningAfters(db: FirebaseFirestore.Firestore, now: Date): Promise<number> {
  const windowStart = Timestamp.fromMillis(now.getTime() - MORNING_AFTER_WINDOW_BEFORE_MS);
  const windowEnd = Timestamp.fromMillis(now.getTime() - MORNING_AFTER_WINDOW_AFTER_MS);

  let snap: FirebaseFirestore.QuerySnapshot;
  try {
    snap = await db
      .collection(NIGHTS)
      .where('status', '==', 'proposed')
      .where('morningAfterSentAt', '==', null)
      .where('scheduledFor', '>=', windowStart)
      .where('scheduledFor', '<=', windowEnd)
      .limit(TICK_BATCH_CAP)
      .get();
  } catch (err) {
    console.error('[movie-nights][tick] morning-after query failed:', err);
    return 0;
  }

  let sent = 0;
  for (const doc of snap.docs) {
    try {
      if (await tickOneMorningAfter(db, doc.id, now)) sent++;
    } catch (err) {
      console.error(`[movie-nights][tick] morning-after failed for night ${doc.id}:`, err);
    }
  }
  console.log(`[movie-nights][tick] morning-afters scanned=${snap.docs.length} sent=${sent}`);
  return sent;
}

/**
 * The S2 ticker's single entry point — sweeps due reminders + morning-after
 * check-ins and sends the ones that have crossed their fire time. `now` is
 * injectable for tests; production always calls it bare (real wall clock).
 * Both sweeps are independent (disjoint claim fields, disjoint queries) so
 * they run concurrently; each is internally fault-isolated per doc.
 */
export async function tickMovieNights(
  now: Date = new Date(),
): Promise<{ remindersSent: number; morningAftersSent: number }> {
  const db = getDb();
  const [remindersSent, morningAftersSent] = await Promise.all([
    tickReminders(db, now),
    tickMorningAfters(db, now),
  ]);
  return { remindersSent, morningAftersSent };
}

// ═════════════════════════════════════════════════════════════════════════
// S2 — guest participation (capability-link model, no Firebase anon auth)
// ═════════════════════════════════════════════════════════════════════════
//
// The share-code page (`/n/[code]`, S5) is entirely PUBLIC — no Bearer token,
// reachable by anyone with the link. `MovieNightPublicView` is deliberately
// thin (see movie-night-types.ts): never a uid, never list contents, never
// the share code itself. Every function here re-validates the code's SHAPE
// before touching Firestore, so a spray of short/garbage codes 404s without
// spending a query (on top of the route layer's per-IP rate limit).

const SHARE_CODE_MIN_LEN = 16;
const SHARE_CODE_MAX_LEN = 64;
const SHARE_CODE_RE = /^[A-Za-z0-9_-]+$/;

function assertShareCodeShape(code: unknown): string {
  if (
    typeof code !== 'string' ||
    code.length < SHARE_CODE_MIN_LEN ||
    code.length > SHARE_CODE_MAX_LEN ||
    !SHARE_CODE_RE.test(code)
  ) {
    // The SAME NotFoundError a real-but-unknown code gets — a malformed code
    // must not distinguish "exists" from "doesn't", and this check runs
    // BEFORE any Firestore read.
    throw new NotFoundError('Movie night not found.');
  }
  return code;
}

function nightToPublicView(data: NightDoc): MovieNightPublicView {
  const going: Array<{ name: string; photoURL: string | null }> = [];
  const counts: MovieNightCounts = { going: 0, maybe: 0, out: 0, waiting: 0 };

  for (const uid of data.inviteeUids || []) {
    const answer = data.rsvps?.[uid]?.answer;
    const profile = data.invitees?.[uid];
    if (answer === 'in') {
      going.push({ name: profile?.displayName || profile?.username || 'a friend', photoURL: profile?.photoURL ?? null });
      counts.going++;
    } else if (answer === 'maybe') counts.maybe++;
    else if (answer === 'out') counts.out++;
    else counts.waiting++;
  }
  for (const g of Object.values(data.guestRsvps || {})) {
    if (g.answer === 'in') {
      going.push({ name: g.name, photoURL: null });
      counts.going++;
    } else if (g.answer === 'maybe') counts.maybe++;
    else if (g.answer === 'out') counts.out++;
  }

  const hostProfile = data.invitees?.[data.hostUid];
  return {
    film: data.film,
    scheduledFor: data.scheduledFor.toDate().toISOString(),
    tzOffsetMinutes: data.tzOffsetMinutes ?? 0,
    timeTbd: data.timeTbd === true,
    status: data.status,
    hostName: hostProfile?.displayName || hostProfile?.username || 'the host',
    hostUsername: hostProfile?.username ?? null,
    hostPhotoURL: hostProfile?.photoURL ?? null,
    listName: data.listName ?? null,
    going,
    counts,
  };
}

/** The public, no-auth view of a night by its share code. Never leaks a uid,
 *  list contents, or the code itself.
 *  `visibility` is deliberately NOT checked here — holding the share code IS
 *  the invitation, regardless of the list-pin's `'public'`/`'private'` state;
 *  a private night is just as reachable by its link as a public one always
 *  was. */
export async function getMovieNightByCode(code: unknown): Promise<MovieNightPublicView> {
  const shareCode = assertShareCodeShape(code);
  const db = getDb();
  const snap = await db.collection(NIGHTS).where('shareCode', '==', shareCode).limit(1).get();
  if (snap.empty) throw new NotFoundError('Movie night not found.');
  return nightToPublicView(snap.docs[0].data() as NightDoc);
}

const GUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function assertGuestId(v: unknown): string {
  if (typeof v !== 'string' || !GUEST_ID_RE.test(v)) {
    throw new BadRequestError('guestId must be an 8 to 64 character url-safe id.');
  }
  return v;
}

/** Guest names are rendered on the public share page AND in the host's
 *  notification — hostile input by default. Strips C0/C1 control characters
 *  (incl. newlines/tabs), collapses whitespace, trims, and clamps to
 *  `GUEST_NAME_MAX`. Never rejects on length — clamps instead, so a long
 *  paste doesn't dead-end an anonymous guest's RSVP. */
function sanitizeGuestName(v: unknown): string {
  const raw = typeof v === 'string' ? v : '';
  const noControl = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
  const collapsed = noControl.replace(/\s+/g, ' ').trim();
  if (!collapsed) throw new BadRequestError('name is required.');
  return collapsed.slice(0, GUEST_NAME_MAX);
}

export type GuestRsvpInput = { guestId?: unknown; name?: unknown; answer?: unknown };

/**
 * A no-account guest RSVPs via the share link. `guestId` is a client-minted
 * (cookie-backed, S3+ concern) id — the SAME guestId re-RSVPing always
 * updates its own row, even past `MAX_GUEST_RSVPS` (only a NEW guestId is
 * capped). The doc ref is resolved by a plain query FIRST (Firestore
 * transactions can't query), then the claim + write happen on that ref
 * inside a transaction. The host is notified only on the first answer or a
 * genuine answer CHANGE — never on a repeat identical write.
 */
export async function guestRsvpMovieNight(code: unknown, input: GuestRsvpInput): Promise<MovieNightPublicView> {
  const shareCode = assertShareCodeShape(code);
  const guestId = assertGuestId(input.guestId);
  const name = sanitizeGuestName(input.name);
  if (!isRsvpAnswer(input.answer)) throw new BadRequestError('answer must be "in", "maybe", or "out".');
  const answer = input.answer;

  const db = getDb();
  const findSnap = await db.collection(NIGHTS).where('shareCode', '==', shareCode).limit(1).get();
  if (findSnap.empty) throw new NotFoundError('Movie night not found.');
  const nightId = findSnap.docs[0].id;
  const ref = findSnap.docs[0].ref;

  type TxResult =
    | { kind: 'notfound' }
    | { kind: 'not_open' }
    | { kind: 'full' }
    | { kind: 'ok'; data: NightDoc; changed: boolean };

  const result: TxResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: 'notfound' as const };
    const data = snap.data() as NightDoc;
    if (data.status !== 'proposed') return { kind: 'not_open' as const };

    const existing = data.guestRsvps?.[guestId];
    const existingCount = Object.keys(data.guestRsvps || {}).length;
    if (!existing && existingCount >= MAX_GUEST_RSVPS) return { kind: 'full' as const };

    const changed = !existing || existing.answer !== answer;
    tx.update(ref, {
      [`guestRsvps.${guestId}`]: { name, answer, respondedAt: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'ok' as const, data, changed };
  });

  if (result.kind === 'notfound') throw new NotFoundError('Movie night not found.');
  if (result.kind === 'not_open') throw new BadRequestError('This movie night is no longer open to RSVPs.');
  if (result.kind === 'full') throw new BadRequestError('This movie night has reached its guest limit.');

  invalidateUpcoming(result.data.inviteeUids);
  invalidateListNight(result.data.listOwnerId, result.data.listId);

  if (result.changed) {
    try {
      const iso = result.data.scheduledFor.toDate().toISOString();
      await createMovieNightRsvpNotification(db, result.data.hostUid, {
        nightId,
        movieTitle: result.data.film.title,
        dateLabel: formatNightDate(iso, result.data.tzOffsetMinutes),
        timeLabel: nightTimeLabel(iso, result.data.tzOffsetMinutes, result.data.timeTbd),
        timeTbd: result.data.timeTbd === true,
        fromUserId: '', // system sentinel — no real uid for a guest
        fromUsername: null,
        fromDisplayName: null,
        fromPhotoUrl: null,
        answer,
        guestName: name,
      });
    } catch (err) {
      console.error('[guestRsvpMovieNight] notify failed:', err);
    }
  }

  const fresh = await ref.get();
  return nightToPublicView(fresh.data() as NightDoc);
}

// ─── movieNightIcs — RFC 5545 VCALENDAR, no timezone component needed ─────

/** F7 — every line-break form (`\r\n`, a lone `\r`, a lone `\n`) becomes the
 *  RFC 5545 `\n` escape sequence (two literal characters, backslash + n —
 *  not a real newline), so the output can never contain a bare `\r`: every
 *  `\r` byte in the finished .ics is part of a real CRLF the line-folding
 *  step (`icsFoldLine`) introduces between folded/BEGIN/END lines, never one
 *  smuggled in through a field value (e.g. a hostile title or handle). */
function icsEscapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n');
}

/** RFC 5545 §3.1 line folding: lines over 75 OCTETS get split, continuation
 *  lines start with a single space. Operates on UTF-8 byte length, not char
 *  count, so multi-byte titles fold at the right place. */
function icsFoldLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (current && currentBytes + chBytes > 75) {
      out.push(current);
      current = ' ' + ch;
      currentBytes = 1 + chBytes;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current) out.push(current);
  return out.join('\r\n');
}

function icsDateStampUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** `YYYYMMDD` — a bare DATE value (RFC 5545 §3.3.4) for an all-day event, read
 *  in the night's own local time so the entry lands on the day the host chose
 *  rather than whatever day that instant is in UTC. `dayOffset` builds the
 *  EXCLUSIVE `DTEND` an all-day VEVENT requires (a one-day event ends on the
 *  following date). */
function icsDateOnlyLocal(instant: Date, tzOffsetMinutes: number, dayOffset = 0): string {
  const local = new Date(instant.getTime() + tzOffsetMinutes * 60_000);
  const shifted = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(shifted.getUTCDate())}`;
}

export type MovieNightIcsResult = { filename: string; ics: string };

/**
 * A VCALENDAR/VEVENT for the night — the guest's reminder channel (no
 * account needed) and also used by the in-app "add to calendar" option.
 * Pure UTC (`Z`-suffixed) `DTSTART`/`DTEND` — no VTIMEZONE component needed.
 */
export async function movieNightIcs(code: unknown): Promise<MovieNightIcsResult> {
  const shareCode = assertShareCodeShape(code);
  const db = getDb();
  const snap = await db.collection(NIGHTS).where('shareCode', '==', shareCode).limit(1).get();
  if (snap.empty) throw new NotFoundError('Movie night not found.');
  const doc = snap.docs[0];
  const data = doc.data() as NightDoc;

  const start = data.scheduledFor.toDate();
  const durationMinutes = data.film.runtime ? data.film.runtime + 30 : 180;
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const tzOffsetMinutes = data.tzOffsetMinutes ?? 0;
  const timeTbd = data.timeTbd === true;
  const hostHandle = data.invitees?.[data.hostUid]?.username || 'a cinechrony host';
  const shareUrl = `${deployOrigin()}/n/${shareCode}`;

  // A tbd night becomes an ALL-DAY event rather than a 3-hour block starting
  // at the 8pm anchor. Writing the anchor into someone's calendar would turn a
  // placeholder into an appointment they'd plan the rest of their evening
  // around — the calendar is exactly the surface where a made-up time does the
  // most damage. All-day says what's actually known: this day, this film.
  const timingLines = timeTbd
    ? [
        `DTSTART;VALUE=DATE:${icsDateOnlyLocal(start, tzOffsetMinutes)}`,
        `DTEND;VALUE=DATE:${icsDateOnlyLocal(start, tzOffsetMinutes, 1)}`,
      ]
    : [
        `DTSTART:${icsDateStampUtc(start)}`,
        `DTEND:${icsDateStampUtc(end)}`,
      ];
  const description = timeTbd
    ? `showtime still tbd. hosted by @${hostHandle} on cinechrony`
    : `hosted by @${hostHandle} on cinechrony`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//cinechrony//movie night//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${doc.id}@cinechrony.com`,
    `DTSTAMP:${icsDateStampUtc(new Date())}`,
    ...timingLines,
    `SUMMARY:${icsEscapeText(`movie night: ${data.film.title}`)}`,
    `DESCRIPTION:${icsEscapeText(description)}`,
    `URL:${shareUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(icsFoldLine);

  const ics = lines.join('\r\n') + '\r\n';
  const safeTitle = data.film.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '').slice(0, 40) || 'movie-night';
  return { filename: `${safeTitle}.ics`, ics };
}
