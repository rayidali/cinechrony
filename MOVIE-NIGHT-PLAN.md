# Movie Night — the plan (v1.1 headline feature)

> Started 2026-07-23, branch `feat/movie-nights`. Designs:
> `../design_handoff_movie_night/` (40 MN-numbered screens, light+dark;
> `README.md` is self-sufficient, `mn-app.jsx` carries exact layout/copy).
> Strategy: the Rodeo lesson — a saved film without a time attached never
> happens. Movie night is the bridge from "we should watch this" to
> "friday 8pm", and the completion rate ("X% of movie nights get watched")
> is the product's north-star metric.

## Locked decisions

1. **Scope v1**: one film, one datetime, host + up to 9 invitees, ONE
   reminder (preset: 2h before / morning of / at showtime), 3-state RSVP
   (in / maybe / out — the design added `maybe`, adopted). No recurrence,
   no availability polls, no location, no time-zone UI (we silently store
   the creator's device `tzOffsetMinutes` so "tonight" and morning-after
   timing are honest).
2. **Guest participation ships in v1 (owner call: best long-run, not
   fewest days).** Capability-link model, NO Firebase anonymous auth:
   every night carries an unguessable `shareCode` from creation; the
   server-rendered web page `/n/[code]` lets a guest RSVP with just a
   first name (guestId cookie for edits) and grab an `.ics` — the
   calendar IS the guest's reminder channel, no account needed. The app
   pitch on that page is the social layer, not a gate. Guest powers are
   bounded writes only (RSVP); NO free-text from guests ever (moderation
   is uid-keyed; App Store 1.2). Guest RSVP rows coexist with uid RSVP
   rows forever — no rework if richer guest auth arrives later.
3. **Scheduling without Blaze/paid cron**: a GitHub Actions schedule
   (every 10 min, `.github/workflows/movie-nights-tick.yml`) POSTs to
   `adminRoute` endpoint `/api/v1/admin/movie-nights-tick` with
   `x-admin-token`. The ticker owns PUSHES only (reminder, morning-after)
   behind transactional claims (`reminderSentAt`, `morningAfterSentAt`);
   lifecycle correctness is DERIVED from `scheduledFor` at read time
   (self-heal-on-read, like `getExtraction`) so a lagging ticker can
   never show a stale state. Owner action: add `ADMIN_SECRET` as a
   GitHub Actions repo secret (DONE, verified 2026-07-26 — see "Owner
   actions when this ships" below).
4. **Where the object lives**: `movie_nights/{id}`, server-only rules
   (deny all client access), all traffic through `/api/v1/movie-nights*`.
   Reads are TTL-cached with write-invalidation (the quota-first rule).
5. **Completion writes the north star**: "we watched it" logs a watch
   entry (existing `recordWatchEntry`) for EVERY attendee, rating only
   for the caller; other attendees rate from their own morning-after
   prompt. PostHog: `movie_night_created / _rsvp / _completed / _missed`
   + the previously missing `movie_marked_watched`.

## Data model — `movie_nights/{id}` (server-only)

```
hostUid, listId|null, listOwnerId|null, listName|null (denorm)
film { tmdbId, mediaType, title, year, posterUrl|null, runtime|null }
scheduledFor (Timestamp) · previousScheduledFor|null · tzOffsetMinutes
reminderPreset '2h'|'morning'|'showtime'
timeTbd?: boolean (v1.3, 2026-07-27 — optional; absent reads as false and is
  NEVER backfilled, same contract as `visibility`. "the day is set, the
  showtime isn't". scheduledFor stays a REAL Timestamp, anchored to 8pm local
  (TBD_ANCHOR_HOUR) on the chosen day, so every index/ordering/ticker window
  above is untouched — this flag only governs what is RENDERED, when the
  reminder fires, and that past-checks drop to DAY resolution)
status 'proposed'|'cancelled'|'completed'|'didnt_happen'
  (today/soon/now/awaiting-morning-after are DERIVED from scheduledFor)
visibility?: 'public'|'private' (v1.2, 2026-07-26 — optional; a doc with the
  field absent reads as 'public' and is NEVER backfilled; host-set, gates
  ONLY getListMovieNight's redacted pin — the home feed's `upcoming` query
  was already inviteeUids-scoped and unaffected)
inviteeUids[] (incl host, ≤10) · invitees{uid→{username,displayName,photoURL}}
rsvps{uid→{answer:'in'|'maybe'|'out', respondedAt}}
guestRsvps{guestId→{name, answer, respondedAt}} (≤20, name ≤30 chars)
shareCode (128-bit url-safe) · reminderSentAt|null · morningAfterSentAt|null
completion{attendeeUids[], completedAt}|null · createdAt · updatedAt
```

Indexes (firestore.indexes.json, owner deploys): (inviteeUids
array-contains, status ==, scheduledFor ASC) + (listId ==, status ==,
scheduledFor ASC). Reads degrade via `softFallback` until deployed.

## API surface

| Route | Notes |
|---|---|
| `POST /api/v1/movie-nights` | create; invitees must be list members or followed by host; blocks respected (quietlyBlocked); rate bucket |
| `GET /api/v1/movie-nights/upcoming` | mine (host or invitee), proposed, soonest first — feeds home card + list pin |
| `GET /api/v1/movie-nights/[id]` | host/invitee only |
| `PATCH /api/v1/movie-nights/[id]` | host: `{action:'reschedule',scheduledFor}` \| `{action:'cancel'}` \| `{action:'didnt_happen'}` |
| `POST /api/v1/movie-nights/[id]/rsvp` | invitee `{answer}` |
| `POST /api/v1/movie-nights/[id]/complete` | any attendee: `{attendeeUids, rating?, note?}` → watches for all, rating for caller |
| `GET /api/v1/movie-nights/shared/[code]` | public view: film, datetime, host handle, who's going (names/avatars), NEVER list contents |
| `POST /api/v1/movie-nights/shared/[code]/rsvp` | guest `{guestId, name, answer}`; per-IP bucket |
| `GET /api/v1/movie-nights/shared/[code]/calendar.ics` | text/calendar; used by guests AND the in-app apple-calendar option |
| `POST /api/v1/admin/movie-nights-tick` | the ticker (adminRoute) |

Notifications (all with `data.url` deep links → `/home?night=<id>`;
home mounts the detail sheet on that param — static-export-safe):
`movie_night_invite · _rsvp · _reminder · _time_changed · _cancelled ·
_morning_after`. A confirmed in-app foreground reminder renders as the
MN33 toast instead of a dead banner.

## Build slices (verify each: typecheck · audit suite · build)

- [x] **S1 server core** — types, `movie-nights-server.ts`, all authed
      routes, rules entry, rate buckets, notifications+push types,
      TTL caches + invalidation, tests `53-movie-nights` (create/rsvp/
      permissions/caps/blocks/reschedule/cancel/complete).
- [x] **S2 ticker + guest** — tick() (reminder presets + morning-after,
      claims, tz-aware), admin route, GH Actions workflow, shared/[code]
      public routes + guest rsvp + .ics, tests `54-movie-nights-guest`.
- [x] **S3 client: create + object** — MN01–MN09 create flow (drawer
      entry, list-header entry, create sheet + date/time/people/reminder
      expanders, confirm), MN10–MN22 detail sheet + RSVP + host controls
      + cards (list pin, home feed) + notifications rows + add-to-calendar
      + skeletons + edges.
- [x] **S4 client: lifecycle** — MN23–MN30 + MN32–MN34: day-of/soon/now
      variants, morning-after sheets (watched → how-was-it reuse;
      didn't-happen → reschedule), completed/didnt/rescheduled details,
      empty state, coach mark, in-app reminder toast, PostHog events.
- [x] **S5 web share page** — `/n/[code]` SSR (static-export `_` shell),
      OG card variant, guest RSVP UI, .ics link, get-the-app CTA,
      MN31/MN35 fidelity.
- [x] **S6 finish** — where-to-watch row on the detail sheet, docs
      (CLAUDE.md files), `build:static` + `cap sync` note, full-suite
      green, owner-action list (indexes deploy, ADMIN_SECRET GH secret).

## Adversarial review pass (2026-07-24, pre-merge)

Three parallel reviewers (races/transactions · security/abuse ·
client/WebView) over the full diff → **13 confirmed findings, all
fixed + regression-tested** (suites 53: 21, 54: 12). Highlights: a
CRITICAL stuck confirm-overlay on the create happy path; the list-pin
route leaking the full RSVP roster to strangers (now a redacted
MovieNightPinView); duplicate watch docs in the two-attendee completion
flow (watch docs now carry movieNightId and update in place);
reschedule/cancel status guards; create idempotency via clientKey;
retroactive block filtering; .ics CR injection; attendance consent
(in/maybe only); morning-after mutual exclusion + correct notification
routing. Full suite 563/563 · typecheck · build · build:static all
green at close.

## v1.2 — private nights + scan-to-plan continuity (2026-07-26, committed d5d9372)

Two more Rodeo-lesson features on top of v1.1, plus a bug fix the v1.1
sheet architecture exposed. Committed `d5d9372` ("fix: modal tap-through
class + silent scan result + private nights + scan-to-plan", 45 files),
pushed to `main`. Gates passed before the build: typecheck clean, full
audit suite 579/579, `build:static` + `cap sync ios` clean, native
`-smokeCalendar` smoke visually confirmed, interaction harness 33/33 exit
0. The server-side visibility logic is LIVE on web, via the Vercel deploy
the push triggered; the two client-facing pieces below (the visibility
control, the lock indicator, the ShareExtension button) reach iOS in
build 1.0 (6), uploaded and processed VALID on TestFlight.

**Visibility.** Owner wanted an option where only invited people can see a
night. Correction to the initial framing, worth keeping: the home-feed
card was ALREADY invitee-only (`getUpcomingMovieNights` is an
`inviteeUids` array-contains query) — the only leak was the collaborative
LIST PIN, and that pin was already redacted to film/date/counts by this
tracker's own "Adversarial review pass" roster-leak fix above. So
"private" only ever needed to gate `getListMovieNight`'s pin path. New `NightDoc.visibility?:
'public'|'private'` (see the data model above); `createMovieNight`
validates strictly (anything but the literal `'private'` stores
`'public'`); `updateMovieNight`'s `reschedule` action takes `visibility`
as an OPTIONAL patch key, applied only when the caller actually sends it,
so a plain reschedule can never silently reset an existing private night
back to public; `getListMovieNight` returns `null` (not a 403) to a
non-host/non-invitee on a private night — the same shape as no night
existing, no existence oracle. Documented tradeoff: the list-night cache
holds only the SOONEST proposed night per list, so a private soonest
night can hide a later public one from non-invitees (accepted — a list
has one active night in practice). Guest links (`/n/[code]`) are
UNCHANGED: holding the share code is still the invitation, independent of
the pin's public/private state. Host UI: a `who can see it`
public/private segmented control in the create sheet and in the
reschedule flow's date/time sheet (shown once, never duplicated between
the two entry points), and a calm "private · only the people invited"
lock indicator on the detail sheet when applicable. Suite 53 grew from 20
to 28 tests.

**Scan → save → plan.** Web `/extract`'s post-save screen and the iOS
ShareExtension's done screen both gained a "plan a movie night" button:
the destination list is always prefilled (a save always targets exactly
one list), the film is prefilled only when exactly one film was saved,
and the button is omitted entirely (not disabled) when the destination
isn't known. The ShareExtension route is a new
`cinechrony://plan-night?listOwnerId=&listId=[&tmdbId=&mediaType=]` deep
link, handled by the same `?owner=` convention the invite-acceptance flow
already uses, auto-opening the create-night sheet once the list page has
loaded real (non-optimistic) permission data. New PostHog event
`movie_night_plan_from_scan`. No new movie-night API routes — this rides
the existing create/save endpoints.

**The tap-through bug this sheet architecture exposed.** Device report:
pressing the dim behind the "cancel movie night?" confirm registered the
press THROUGH the confirm and dismissed the detail sheet underneath,
orphaning the confirm over a bare list page. This was a repo-wide Vaul/
Radix `DismissableLayer` class (every body-portaled confirm/expander
sitting over an open drawer was affected, not just this one) — full root
cause and the `src/lib/modal-guard.ts` fix are in `CLAUDE.md` and
`HANDOFF.md`. The movie-night-specific fallout: `CancelConfirmModal`
(`night-detail-sheet.tsx`) and the create sheet's `TimeEntrySheet` /
`ConfirmOverlay` / `PeopleSheet` / `ReminderSheet` all needed the guard
wired; `night-detail-sheet.tsx`'s fetch-on-open effect also now resets
every child-modal flag (`showCancelConfirm`/`showAddCalendar`/
`showReschedule`) whenever `nightId` clears, so no child modal can survive
the parent sheet closing by any path. `scripts/interaction-harness.mjs`
grew a dedicated tap-through audit (3 real background clicks behind an
open confirm, each asserting the confirm survives and the click landed
inside the guard) — 17 → 30 steps total.

## v1.3 — "time tbd" + a create budget sized to its risk (2026-07-27, `a3eede7`, build 7)

Both threads started from ONE owner screenshot: the create sheet refusing with
*"You're doing that too fast. Please slow down and try again shortly."*

**"time tbd" — the day is locked, the showtime isn't.** A "decide later" chip
sits in the showtime row as a peer of the presets (not an escape hatch behind
"type it"), mutually exclusive with a real pick — create and reschedule both
route through `pickTime`/`pickTbd` so neither can be left live behind the
other. The host still gets a real plan out the door: invites fan out, RSVPs
work, the night appears everywhere a night appears.

*The invariant the whole feature rests on: the 8pm anchor is NEVER shown.*
Nobody chose it, so no surface may present it as a decision.

| surface | tbd behaviour |
|---|---|
| detail-sheet hero (62px) · guest-page hero (52px) | prints `tbd`, plus a mono "showtime not set yet" line |
| cards · list pin · reschedule "moving from" | `formatNightTimeLabel` |
| push + share text | `nightWhen()` → "mon 27.07, **time tbd**" (comma, not "at" — "at time tbd" reads like a template seam) |
| `.ics` · Google Calendar · native CalendarBridge | **all-day entry**, never an 8pm block |
| `nightPhase` | tbd branch with no `soon`/`now` — both are claims about a time nobody picked |

*Past-checks drop to DAY resolution when tbd* (`isLocalDayBeforeToday`
server-side, mirrored in `describeNightCta` and both sheets). Without it
"tonight, tbd" dies at 8pm — precisely the hour someone plans one.

*Reminders override to morning-of at FIRE time*, regardless of preset ("2h
before" and "at showtime" are both defined against a showtime that doesn't
exist). The stored `reminderPreset` is deliberately NOT rewritten, so the
host's real choice returns intact the moment they pin an hour. The tbd
`nightPhase` branch also stops the morning-after prompt firing at 11pm on the
night itself.

*Setting the time later goes through the EXISTING reschedule flow* — an
omitted `timeTbd` on a reschedule means "this is a real showtime", which is
what makes that work without a second edit surface.

**The create budget was wrong on three axes.** `movieNightCreate` was a flat
**10/day**, sized to how OFTEN people plan nights rather than to the abuse
surface it bounds: a doc write plus one notification/push per invitee — the
same surface as `invite` (**20/min**) and `post` (**15/min**), and unlike an
extraction it costs no Apify/Gemini money. A cost-tier limit for a
notification-tier risk. With no burst bucket it also permitted the abuse (all
ten in ten seconds) and punished the use (locked out for a day). And it was
never really ten: `checkRateLimit` ran in the route wrapper BEFORE the
`clientKey` dedup and before validation, so a rejected date, a double-tap
landing as an idempotent retry, and a 500 each burned a unit while creating
nothing.

Now **6/min + 40/day**, and the check MOVED into `createMovieNight`
immediately after the idempotency dedup — the only endpoint in the repo whose
rate limiting isn't in its route handler, documented at both ends. A retry
that returns an existing night costs nothing; a malformed body still costs.

Suites 53 (+14) and 54 (+6) → audit **603/603**. Gates: typecheck,
`npm run build`, `build:static` + `cap sync ios`, full `xcodebuild`, harness
**39/39**, and BOTH native calendar smokes (`-smokeCalendar` and the new
`-smokeCalendarAllDay`, which proves the all-day path executes rather than
merely compiles — a flag that failed to cross the Capacitor bridge would have
silently written the timed 8pm block this feature exists to prevent).

## Owner actions when this ships

1. ~~`firebase deploy --only firestore:indexes`~~ **DONE 2026-07-25**
   (all four composites READY; deployed via the authed firebase CLI,
   after the service account got PERMISSION_DENIED on the Admin API).
   firestore.rules also deployed same day (repo ruleset = the one the
   563-test suite validates).
2. ~~GitHub repo → Settings → Secrets and variables → Actions → New
   repository secret → name `ADMIN_SECRET`, value copied from Vercel →
   Settings → Environment Variables → `ADMIN_SECRET`.~~ **DONE, VERIFIED
   2026-07-26** — checked via the GitHub API: `movie-nights-tick` has been
   firing on its 10-minute schedule and succeeding repeatedly. The
   reminder/morning-after ticker is live end to end.
3. Nothing else: the cron workflow ships with the repo, no new env vars.
