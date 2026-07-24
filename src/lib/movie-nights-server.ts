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
import { BadRequestError, ForbiddenError, NotFoundError } from '@/lib/api-handler';
import { createTtlCache, cached } from '@/lib/server-cache';
import { getFollowingIds } from '@/lib/follows-server';
import { isBlockedBetween } from '@/lib/blocks-server';
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
  MovieNightPublicView,
  MovieNightView,
  ReminderPreset,
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
  inviteeUids: string[];
  invitees: Record<string, InviteeProfile>;
  rsvps: Record<string, RsvpEntry>;
  guestRsvps: Record<string, GuestRsvpEntry>;
  shareCode: string;
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

// ── Small validators ────────────────────────────────────────────────────

function clampTzOffset(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(-840, Math.min(840, Math.round(n)));
}

function isReminderPreset(v: unknown): v is ReminderPreset {
  return v === '2h' || v === 'morning' || v === 'showtime';
}

function isRsvpAnswer(v: unknown): v is RsvpAnswer {
  return v === 'in' || v === 'maybe' || v === 'out';
}

function generateShareCode(): string {
  return randomBytes(16).toString('base64url');
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
  return {
    tmdbId: f.tmdbId,
    mediaType: f.mediaType,
    title: f.title.trim(),
    year: typeof f.year === 'string' ? f.year : '',
    posterUrl: typeof f.posterUrl === 'string' && f.posterUrl ? f.posterUrl : null,
    runtime: typeof f.runtime === 'number' && Number.isFinite(f.runtime) ? f.runtime : null,
  };
}

// ── DTO mapping ──────────────────────────────────────────────────────────

function tsToIso(t: FirebaseFirestore.Timestamp | null | undefined): string | null {
  return t ? t.toDate().toISOString() : null;
}

function nightToView(id: string, d: NightDoc, callerUid: string): MovieNightView {
  const isHost = d.hostUid === callerUid;
  const isInvitee = d.inviteeUids.includes(callerUid);
  const rsvps = d.rsvps || {};

  const invitees = (d.inviteeUids || []).map((uid) => {
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

  const guestRsvps = Object.entries(d.guestRsvps || {}).map(([guestId, g]) => ({
    guestId,
    name: g.name,
    answer: g.answer,
    respondedAt: tsToIso(g.respondedAt),
  }));

  const counts: MovieNightCounts = { going: 0, maybe: 0, out: 0, waiting: 0 };
  for (const inv of invitees) {
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
    status: d.status,
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
 *  shared by create (host → all invitees) / reschedule / cancel. */
async function fanOutToOtherInvitees(
  db: FirebaseFirestore.Firestore,
  nightId: string,
  data: Pick<NightDoc, 'film' | 'tzOffsetMinutes' | 'inviteeUids'>,
  actorUid: string,
  scheduledForOverride: FirebaseFirestore.Timestamp,
  send: (db: FirebaseFirestore.Firestore, recipientId: string, ctx: MovieNightNotificationCtx) => Promise<void>,
): Promise<void> {
  const actorDoc = await db.collection('users').doc(actorUid).get();
  const actor = actorDoc.data() || {};
  const iso = scheduledForOverride.toDate().toISOString();
  const ctx: MovieNightNotificationCtx = {
    nightId,
    movieTitle: data.film.title,
    dateLabel: formatNightDate(iso, data.tzOffsetMinutes),
    timeLabel: formatNightTime(iso, data.tzOffsetMinutes),
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
};

/**
 * Plan a movie night. Every invitee must be EITHER a member of the given
 * list OR followed by the host — like a blocked pair (either direction),
 * an ineligible invitee is silently DROPPED rather than failing the whole
 * request (mirrors `resolveTaggedUsers` in posts-server.ts). The host is
 * always in `inviteeUids` and auto-RSVPs 'in'.
 */
export async function createMovieNight(hostUid: string, input: CreateMovieNightInput): Promise<MovieNightView> {
  const film = validateFilm(input.film);

  if (typeof input.scheduledFor !== 'string' || !input.scheduledFor) {
    throw new BadRequestError('scheduledFor is required.');
  }
  const scheduledForDate = new Date(input.scheduledFor);
  if (Number.isNaN(scheduledForDate.getTime())) throw new BadRequestError('scheduledFor must be a valid date.');
  if (scheduledForDate.getTime() <= Date.now()) {
    throw new BadRequestError('movie night must be scheduled in the future.');
  }

  const tzOffsetMinutes = clampTzOffset(input.tzOffsetMinutes);
  const reminderPreset: ReminderPreset = isReminderPreset(input.reminderPreset) ? input.reminderPreset : '2h';

  const db = getDb();

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
    status: 'proposed',
    inviteeUids,
    invitees,
    // The host is automatically in.
    rsvps: { [hostUid]: { answer: 'in', respondedAt: FieldValue.serverTimestamp() } },
    guestRsvps: {},
    shareCode,
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
    db, nightRef.id, { film, tzOffsetMinutes, inviteeUids }, hostUid, scheduledForTs,
    createMovieNightInviteNotification,
  );

  const fresh = await nightRef.get();
  return nightToView(nightRef.id, fresh.data() as NightDoc, hostUid);
}

// ── getMovieNight ────────────────────────────────────────────────────────

export async function getMovieNight(callerUid: string, id: string): Promise<MovieNightView> {
  const db = getDb();
  const snap = await db.collection(NIGHTS).doc(id).get();
  if (!snap.exists) throw new NotFoundError('Movie night not found.');
  const data = snap.data() as NightDoc;
  const isHost = data.hostUid === callerUid;
  const isInvitee = data.inviteeUids.includes(callerUid);
  if (!isHost && !isInvitee) throw new ForbiddenError();
  return nightToView(id, data, callerUid);
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
    return snap.docs.map((d) => nightToView(d.id, d.data() as NightDoc, callerUid));
  });
}

// ── getListMovieNight (the pinned-card read) ────────────────────────────

/**
 * The soonest 'proposed' night pinned to a list, or null. Same privacy gate
 * as `getListPreview`: public lists are open, private lists require the
 * caller be the owner or a collaborator. Needs a composite index (`listId`
 * ==, `status` ==, `scheduledFor` ASC).
 */
export async function getListMovieNight(
  callerUid: string | null,
  listOwnerId: string,
  listId: string,
): Promise<MovieNightView | null> {
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
  return nightToView(raw.id, raw.data, callerUid ?? '');
}

// ── rsvpMovieNight ───────────────────────────────────────────────────────

/** Any invitee (host included) sets their RSVP answer. Notifies the host
 *  (skipped when the host RSVPs to their own night). */
export async function rsvpMovieNight(callerUid: string, id: string, rawAnswer: unknown): Promise<MovieNightView> {
  if (!isRsvpAnswer(rawAnswer)) throw new BadRequestError('answer must be "in", "maybe", or "out".');
  const answer = rawAnswer;

  const db = getDb();
  const ref = db.collection(NIGHTS).doc(id);

  type TxOk = { kind: 'ok'; data: NightDoc };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: 'err' as const, error: new NotFoundError('Movie night not found.') };
    const data = snap.data() as NightDoc;
    if (!data.inviteeUids.includes(callerUid)) return { kind: 'err' as const, error: new ForbiddenError() };
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
        timeLabel: formatNightTime(iso, result.data.tzOffsetMinutes),
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
  return nightToView(id, fresh.data() as NightDoc, callerUid);
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
    if (scheduledForDate.getTime() <= Date.now()) {
      throw new BadRequestError('movie night must be scheduled in the future.');
    }
    const scheduledForTs = Timestamp.fromDate(scheduledForDate);

    type TxOk = { kind: 'ok'; data: NightDoc };
    type TxErr = { kind: 'err'; error: Error };
    const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { kind: 'err' as const, error: new NotFoundError('Movie night not found.') };
      const data = snap.data() as NightDoc;
      if (data.hostUid !== callerUid) return { kind: 'err' as const, error: new ForbiddenError('Only the host can reschedule.') };
      tx.update(ref, {
        previousScheduledFor: data.scheduledFor,
        scheduledFor: scheduledForTs,
        status: 'proposed',
        reminderSentAt: null,
        morningAfterSentAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { kind: 'ok' as const, data };
    });
    if (result.kind === 'err') throw result.error;

    invalidateUpcoming(result.data.inviteeUids);
    invalidateListNight(result.data.listOwnerId, result.data.listId);
    await fanOutToOtherInvitees(
      db, id, { film: result.data.film, tzOffsetMinutes: result.data.tzOffsetMinutes, inviteeUids: result.data.inviteeUids },
      callerUid, scheduledForTs, createMovieNightTimeChangedNotification,
    );

    const fresh = await ref.get();
    return nightToView(id, fresh.data() as NightDoc, callerUid);
  }

  if (patch.action === 'cancel') {
    type TxOk = { kind: 'ok'; data: NightDoc };
    type TxErr = { kind: 'err'; error: Error };
    const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { kind: 'err' as const, error: new NotFoundError('Movie night not found.') };
      const data = snap.data() as NightDoc;
      if (data.hostUid !== callerUid) return { kind: 'err' as const, error: new ForbiddenError('Only the host can cancel.') };
      tx.update(ref, { status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
      return { kind: 'ok' as const, data };
    });
    if (result.kind === 'err') throw result.error;

    invalidateUpcoming(result.data.inviteeUids);
    invalidateListNight(result.data.listOwnerId, result.data.listId);
    await fanOutToOtherInvitees(
      db, id, { film: result.data.film, tzOffsetMinutes: result.data.tzOffsetMinutes, inviteeUids: result.data.inviteeUids },
      callerUid, result.data.scheduledFor, createMovieNightCancelledNotification,
    );

    const fresh = await ref.get();
    return nightToView(id, fresh.data() as NightDoc, callerUid);
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
    return nightToView(id, fresh.data() as NightDoc, callerUid);
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
    const attendeeUids = [...new Set(rawAttendees)].filter(
      (uid): uid is string => typeof uid === 'string' && data.inviteeUids.includes(uid),
    );
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
    // it isn't double-logged).
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
        timeLabel: formatNightTime(watchedAtIso, data.tzOffsetMinutes),
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
  // and a later re-entry (e.g. rating it after the fact).
  if (rating != null || note) {
    await logWatch(callerUid, {
      tmdbId: data.film.tmdbId,
      mediaType: data.film.mediaType,
      movieTitle: data.film.title,
      moviePosterUrl: data.film.posterUrl,
      rating,
      note,
      watchedAt: watchedAtIso,
    });
  } else {
    await recordWatchEntry(callerUid, {
      tmdbId: data.film.tmdbId,
      mediaType: data.film.mediaType,
      movieTitle: data.film.title,
      moviePosterUrl: data.film.posterUrl,
      watchedAt: watchedAtIso,
    });
  }

  const fresh = await ref.get();
  return nightToView(id, fresh.data() as NightDoc, callerUid);
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

const REMINDER_WINDOW_BEFORE_MS = 15 * 60_000;
const REMINDER_WINDOW_AFTER_MS = 26 * 3600_000;
const REMINDER_GRACE_MS = 15 * 60_000;

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

/** The instant a reminder should fire, per its preset. */
function reminderFireTime(scheduledFor: Date, tzOffsetMinutes: number, preset: ReminderPreset): Date {
  if (preset === 'showtime') return scheduledFor;
  if (preset === 'morning') return localClockTime(scheduledFor, tzOffsetMinutes, 9, 0);
  return new Date(scheduledFor.getTime() - 2 * 3600_000); // '2h' (also the default)
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
    const fireTime = reminderFireTime(scheduledFor, tzOffsetMinutes, data.reminderPreset ?? '2h');
    const graceEnd = scheduledFor.getTime() + REMINDER_GRACE_MS;
    if (now.getTime() < fireTime.getTime() || now.getTime() > graceEnd) return { claimed: false };

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
    timeLabel: formatNightTime(iso, tzOffsetMinutes),
    // System push, not an actor's action — the empty-string sentinel never
    // equals a real recipient uid, so the creator's self-notify guard never
    // excludes the host from their own reminder (unlike invite/cancel/etc,
    // where the host performing the action legitimately shouldn't self-notify).
    fromUserId: '',
    fromUsername: null,
    fromDisplayName: null,
    fromPhotoUrl: hostProfile?.photoURL ?? null,
    isTonight: isNightToday(scheduledFor, tzOffsetMinutes, now),
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
    timeLabel: formatNightTime(iso, tzOffsetMinutes),
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
 *  list contents, or the code itself. */
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
        timeLabel: formatNightTime(iso, result.data.tzOffsetMinutes),
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

function icsEscapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
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
  const hostHandle = data.invitees?.[data.hostUid]?.username || 'a cinechrony host';
  const shareUrl = `${deployOrigin()}/n/${shareCode}`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//cinechrony//movie night//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${doc.id}@cinechrony.com`,
    `DTSTAMP:${icsDateStampUtc(new Date())}`,
    `DTSTART:${icsDateStampUtc(start)}`,
    `DTEND:${icsDateStampUtc(end)}`,
    `SUMMARY:${icsEscapeText(`movie night: ${data.film.title}`)}`,
    `DESCRIPTION:${icsEscapeText(`hosted by @${hostHandle} on cinechrony`)}`,
    `URL:${shareUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(icsFoldLine);

  const ics = lines.join('\r\n') + '\r\n';
  const safeTitle = data.film.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '').slice(0, 40) || 'movie-night';
  return { filename: `${safeTitle}.ics`, ics };
}
