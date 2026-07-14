# Live Activity — the scan tracker on your lock screen

> The DoorDash/Uber pattern for reel scans: share a reel, close the drawer,
> and a live card on the lock screen (and Dynamic Island) narrates the scan —
> `getting the video → watching it → matching films → 2 films found` — ending
> in a tappable result. This replaces "wait or get one ding" with continuous
> presence.

Status: PLANNED (this doc). The outcome pushes + drawer detach (shipped
2026-07-14, `d45a792`) are the fallback layer this builds on, not a competitor.

---

## 1. UX spec

Lock screen card (and Dynamic Island expanded view), branded paper/ink/film-red:

```
┌──────────────────────────────────────────────┐
│  [reel thumb]   scanning your reel           │   in-flight: stage label +
│                 watching it                  │   a 4-dot stage progress
│                 ● ● ○ ○                      │   (queued·fetch·watch·match)
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│  [poster]       2 films found                │   terminal: films + a
│                 Party (1984) · imdb 7.4      │   deep link to /extract
│                 tap to pick lists            │   ?jobId=… (12h dismissal)
└──────────────────────────────────────────────┘
```

Dynamic Island compact: popcorn glyph + stage dot; minimal: glyph only.
Terminal failure state: `that reel put up a fight. tap to run it back.`

Interaction: the whole card deep-links to `cinechrony://extract?jobId=…`
(same router as the outcome push). No buttons (ActivityKit buttons need
App Intents and add nothing here).

## 2. Platform constraints (what shapes the whole design)

- **A share extension cannot start a Live Activity.** `Activity.request` is
  app-only. Since the hero flow never opens the app, the ONLY viable start
  path is **push-to-start** (iOS 17.2+): the server starts the activity via
  APNs using a per-device *push-to-start token* the app registered earlier.
- **Two token kinds, both rotating.** The push-to-start token (per device,
  per attribute-type) starts activities; each started activity then mints its
  own *update token* which the server needs for subsequent updates. The app
  observes both streams (`pushToStartTokenUpdates`, `activityUpdates` →
  `pushTokenUpdates`) and uploads them. This is an asynchronous handshake —
  the server must tolerate the update token arriving late or never.
- **APNs `liveactivity` pushes are budgeted.** Frequent updates get throttled.
  Our activity emits at most 5 updates (4 stage transitions + terminal), well
  under any budget.
- **Delivery is at-most-once.** APNs may drop an update. Every push therefore
  carries the FULL content-state (never a delta), so any later push fully
  repairs a dropped one (DDIA: idempotent, self-contained messages over
  exactly-once delivery illusions).
- **iOS < 17.2 / activities disabled / token missing** → the fallback ladder
  (§7) degrades to today's outcome pushes. No cliff.

## 3. Architecture

```
app launch (signed in)
  └─ registers pushToStartToken ──────────► users/{uid}/laTokens/{deviceId}

share a reel (extension)
  └─ POST /extractions { url } ──► createExtraction
                                      └─ pipeline (after())
                                           ├─ setStage('fetching') ─┐
                                           ├─ setStage('watching') ─┤
                                           ├─ setStage('matching') ─┤   la-server.ts
                                           └─ finish/fail ──────────┴─► pushLiveActivity(job, state)
                                                                          ├─ no activity yet? send
                                                                          │  push-to-start (token from
                                                                          │  laTokens, newest device)
                                                                          ├─ update token known? send
                                                                          │  update push
                                                                          └─ terminal? event:"end" +
                                                                             dismissal-date now+12h

iphone (ActivityKit)                  app (next foreground)
  └─ activity started by push          └─ observes activityUpdates
     └─ mints update token ──► POST /extractions/{jobId}/live-activity-token
                                 └─ job.liveActivity.updateToken (+ activityId)
```

Key decision: the **pipeline drives everything server-side** — the extension
and app are passive. `setStage` (already a single writer per job, guaranteed
by the cache-claim transaction) gains a fire-and-forget Live Activity emit.

## 4. Data model

```
users/{uid}/laTokens/{deviceId}      # push-to-start tokens, a LEASE not a fact
  ├─ token: string                   # rotates; last-write-wins per device
  ├─ platform: 'ios'
  ├─ updatedAt                       # staleness signal; >30d → ignore + prune
  └─ deviceId = installation uuid (kept in app storage, survives token rotation)

extraction_jobs/{jobId}.liveActivity # the per-job activity state machine
  ├─ requestedAt                     # push-to-start sent (claim, transactional)
  ├─ activityId?: string             # reported by the app, may never arrive
  ├─ updateToken?: string            # ditto; needed for update pushes
  ├─ lastStageSent?: string          # dedupe guard (monotonic ordinal)
  └─ endedAt?                        # terminal push sent (claim, like pushSentAt)
```

## 5. Delivery semantics (the DDIA part)

- **Idempotent full-state updates.** Content-state =
  `{ stageOrdinal, stageLabel, thumbnailUrl, filmCount?, headline?, deepLink }`.
  Any single delivered push renders a correct card regardless of what was
  dropped before it. No deltas, no ordering dependency between updates.
- **Monotonicity.** `stageOrdinal` (queued=0 … done/failed=4) is written to
  `lastStageSent` in a Firestore transaction before each send; a send is
  skipped unless it strictly increases the ordinal. Guards against the
  pipeline's self-heal re-entry (same class of bug `pushSentAt` already
  solves) and against out-of-order async emits.
- **Exactly-once *effects* via claims, not exactly-once delivery.** The
  push-to-start send and the terminal `event:"end"` send are each guarded by
  a transactional claim field (`requestedAt`, `endedAt`) — the pattern proven
  by `sendExtractionCompletionPush`. Retries after a crash can re-SEND (APNs
  dedupes nothing) but a re-send of full state is harmless by design.
- **The token handshake is eventually consistent.** Between push-to-start and
  the app uploading the update token there is a window where stage updates
  have nowhere to go. Accepted: stages 1-2 may be missed; the terminal update
  matters most and by then the token has almost always arrived (the phone was
  just unlocked, IG in foreground). If `updateToken` never arrives, the
  terminal state falls back to the outcome push (§7) — the user still gets
  closure. (Server-side alternative — buffering updates until the token
  lands, then flushing the LATEST one — is a cheap later enhancement: keep
  `pendingState` on the job doc and flush from the token-upload route.)
- **Reconciliation on app open.** `/extract?jobId=` remains the source of
  truth; the app ends any stale activity for a job that Firestore says is
  terminal (covers a dropped end push — the lock screen never lies forever).
  This is the read-repair path.
- **Suppression interplay.** The Live Activity does NOT replace the outcome
  push; it replaces the NEED for it. Rule: if an update token is on the job
  (activity confirmed live), the terminal state rides the activity and the
  outcome push is skipped (a new result enum: 'skipped_live_activity').
  Otherwise today's push logic runs untouched. `lastPolledAt` suppression
  stays as-is (an open drawer still silences dings; the activity is not a
  ding and always updates).
- **Backpressure / cost.** Ceiling of 6 APNs calls per scan (1 start + 4
  stages + 1 end); stage emits are fire-and-forget with a 5s timeout so a
  slow APNs can never stall the pipeline (the pipeline's latency budget is
  the product; the tracker is best-effort garnish).

## 6. Failure modes

| failure | effect | mitigation |
|---|---|---|
| push-to-start token stale/rotated | start push silently dead | app re-uploads on every launch; server prefers newest `updatedAt`; terminal outcome push still fires (no updateToken ever arrives) |
| update push dropped by APNs | card shows a stale stage | next update carries full state; terminal end push repairs; 12h auto-dismissal caps the damage |
| pipeline crashes mid-scan | card stuck "watching it" | the job's failure path sends `event:"end"` with the failed state (same claim); reconciliation on next app open |
| user force-kills the app | activities keep working | tokens + pushes are OS-level, no app process needed |
| iOS < 17.2 | no activity | fallback ladder §7 |
| user disabled Live Activities | start push ignored | same — outcome push fires because updateToken never arrives |
| two devices | activity on each registered device | send start to ALL fresh laTokens; each device's activity gets updates via its own token (map keyed by deviceId) — v1 may simply use the newest device only |

## 7. Fallback ladder (no cliffs)

1. iOS 17.2+ with tokens → full Live Activity, outcome push suppressed.
2. Activity start confirmed but updates undeliverable → terminal end push
   repairs the card; outcome push suppressed (card carries the result).
3. No activity confirmed (old iOS, disabled, token missing/stale) →
   **today's behavior**: outcome push with the quirky copy. Zero regression.

## 8. Implementation phases

- **P1 — server plumbing (no UI):** `la-server.ts` (APNs JWT p8 auth — reuse
  nothing from FCM; live activities need direct APNs), `laTokens` collection +
  `POST /me/live-activity-token`, `POST /extractions/{jobId}/live-activity-token`,
  stage emit hooks in `setStage`/`finishJob`/`failJob` with the claims above.
  Feature-flagged (`LIVE_ACTIVITY_ENABLED`).
- **P2 — widget extension:** new `ScanActivityWidget` target (WidgetKit +
  ActivityKit attributes shared via a small SPM target or duplicated file),
  lock screen + Dynamic Island layouts, deep-link routing.
- **P3 — app glue:** push-to-start token registration in `AppViewController`
  (or a tiny plugin method next to SharedAuth), `activityUpdates` observer
  uploading update tokens, reconciliation on foreground.
- **P4 — polish:** film poster in terminal state (needs APNs attachment-free
  image loading in the widget via the thumbnail URL), multi-device fan-out,
  pendingState flush.

Estimates: P1 ~1 session, P2+P3 ~1-2 sessions with device iteration, P4 ~1.
Requires: real device on iOS 17.2+ (the owner's iPhone qualifies), the
existing APNs .p8 key (same key works — `liveactivity` is just a push type).

## 9. Test plan

- Unit (emulator): claim transactions (start/end once; stage ordinal
  monotonic under concurrent emits), suppression enum, token-upload routes'
  owner checks.
- Device matrix: happy path; close-drawer-early; airplane-mode mid-scan then
  reconnect (repair on next update); force-kill app; Live Activities toggled
  off (fallback ladder 3); two scans back-to-back (two activities, right
  results on each).
