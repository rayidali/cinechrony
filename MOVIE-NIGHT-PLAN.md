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
   GitHub Actions repo secret.
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
status 'proposed'|'cancelled'|'completed'|'didnt_happen'
  (today/soon/now/awaiting-morning-after are DERIVED from scheduledFor)
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

- [ ] **S1 server core** — types, `movie-nights-server.ts`, all authed
      routes, rules entry, rate buckets, notifications+push types,
      TTL caches + invalidation, tests `53-movie-nights` (create/rsvp/
      permissions/caps/blocks/reschedule/cancel/complete).
- [ ] **S2 ticker + guest** — tick() (reminder presets + morning-after,
      claims, tz-aware), admin route, GH Actions workflow, shared/[code]
      public routes + guest rsvp + .ics, tests `54-movie-nights-guest`.
- [ ] **S3 client: create + object** — MN01–MN09 create flow (drawer
      entry, list-header entry, create sheet + date/time/people/reminder
      expanders, confirm), MN10–MN22 detail sheet + RSVP + host controls
      + cards (list pin, home feed) + notifications rows + add-to-calendar
      + skeletons + edges.
- [ ] **S4 client: lifecycle** — MN23–MN30 + MN32–MN34: day-of/soon/now
      variants, morning-after sheets (watched → how-was-it reuse;
      didn't-happen → reschedule), completed/didnt/rescheduled details,
      empty state, coach mark, in-app reminder toast, PostHog events.
- [ ] **S5 web share page** — `/n/[code]` SSR (static-export `_` shell),
      OG card variant, guest RSVP UI, .ics link, get-the-app CTA,
      MN31/MN35 fidelity.
- [ ] **S6 finish** — where-to-watch row on the detail sheet, docs
      (CLAUDE.md files), `build:static` + `cap sync` note, full-suite
      green, owner-action list (indexes deploy, ADMIN_SECRET GH secret).

## Owner actions when this ships

1. `firebase deploy --only firestore:indexes` (two new composites).
2. GitHub repo → Settings → Secrets → Actions → add `ADMIN_SECRET`
   (same value as the Vercel env var) — the reminder ticker is inert
   without it.
3. Nothing else: rules ship via the repo, the cron workflow ships with
   the branch, no new env vars.
