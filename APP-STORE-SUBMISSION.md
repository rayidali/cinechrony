# App Store submission — tracker

> Started 2026-07-23. Goal: submit version 1.0 for App Store review (the
> one-tap install channel) after a short TestFlight bake. Everything below
> was done from the terminal via the ASC API (`scripts/asc-api.tmp.mjs`)
> unless marked owner-only. App id `6792422740`, version record
> `f784b7f8-7907-42d6-a3b4-a8fb7ce717ec` (1.0, PREPARE_FOR_SUBMISSION).

## Done via API (2026-07-23)

| Piece | Value / state |
|---|---|
| Description, keywords, promo text | en-US localization `706aeb4c…` — brand-voice copy (lowercase headers, no dashes, no emoji); keywords 96 chars |
| Subtitle | `movie nights with friends` |
| Support / marketing / privacy URLs | cinechrony.com `/support` · `/` · `/privacy` |
| Copyright | `2026 Rayid Ali` |
| Categories | primary ENTERTAINMENT · secondary SOCIAL_NETWORKING |
| Age rating questionnaire | filled honestly (UGC + social + movie artwork at infrequent/mild) → **12+** (Brazil 14, Korea 12) |
| Pricing | free — appPriceSchedule created, base USA |
| Availability | all 175 territories + `availableInNewTerritories: true` |
| App Review details | contact Rayid / rayid@cinechrony.com / phone; demo account `demo@cinechrony.com` (password lives in ASC review details + `.env.local` `DEMO_ACCOUNT_PASSWORD` — NEVER in committed files); UGC-moderation note for guideline 1.2 |
| Content rights | `USES_THIRD_PARTY_CONTENT` (TMDB) |
| Screenshots | 5 × 1320x2868 uploaded to the **APP_IPHONE_67** set, all COMPLETE. Order: scan-result · list detail · movie drawer · profile · lists |

**Screenshot pipeline** (rerunnable): `scripts/appstore-screenshots.tmp.mjs`
(headless system Chrome against prod as the demo account — the native app is
a WebView of the same UI; 440x956 css @3x = exact 6.9" pixels) →
`scripts/asc-upload-screenshots.tmp.mjs` (reservation flow + MD5 commit +
explicit ordering). The scan screenshot is a REAL live scan
(instagram.com/reel/DbDmdmJzsR6 → 5 Rurouni Kenshin films, strong match).
Demo account dressed for the shots (`scripts/dress-demo-account.tmp.ts`):
popcorn avatar, top-5 canon, three ratings.

**API gotchas learned:** `APP_IPHONE_69` is NOT a screenshotDisplayType —
6.9-inch (1320x2868) uploads go in **`APP_IPHONE_67`**. A new app has NO
appPriceSchedule/appAvailability until you POST one. Privacy nutrition
labels (`appDataUsages`) are NOT on the public API — ASC UI only.
Attaching a build to an EXTERNAL beta group does not distribute it on its
own — see the 2026-07-26 finding below.

**TestFlight external-distribution gap — found + fixed (2026-07-26).**
Attaching a build to an EXTERNAL beta group does NOT distribute it: the
build must also be POSTed to `/v1/betaAppReviewSubmissions`. Checked via
the API while confirming build 6's rollout: build 1 was `BETA_APPROVED`,
but builds 2, 3, 4, and 5 had all sat at `READY_FOR_BETA_SUBMISSION` since
upload — external testers (the friends group and the public link
https://testflight.apple.com/join/CRPFhKen) had been stuck on build 1
since 2026-07-21 this entire time. Internal testers were unaffected
(`internalBuildState: IN_BETA_TESTING` throughout — internal groups skip
beta review), which is why it went unnoticed across four builds. Build 6
has now been POSTed to `betaAppReviewSubmissions` and reached
**`BETA_APPROVED` within minutes** — confirming that later builds do skip
the review WAIT, which is the grain of truth the old "later builds usually
skip review" note was built on. The SUBMISSION is what was never optional.
**Corrected sequence for every future build:**
upload → set `whatsNew` on `betaBuildLocalizations` → attach beta groups →
POST `betaAppReviewSubmissions` → confirm `externalBuildState` reaches
`BETA_APPROVED`.

**Screenshot redesign — tracked idea, not started (2026-07-26).** Owner
asked to learn from the app **Rodeo** (see `HANDOFF.md`'s 2026-07-26
research section for the full punch list); item 2 of that list is a
screenshot direction worth a future pass here: Rodeo's App Store
screenshots are statement-style — real UI in a black frame, giant display
type, one italic word, a 3D emoji finger pointing at the money moment —
and they literally teach their share-extension flow inside the store
listing itself. We already have the current 5 live screenshots + the
capture pipeline above (`appstore-screenshots.tmp.mjs` +
`asc-upload-screenshots.tmp.mjs`); a redesign in this direction is a
compositing/copy pass over the existing captures, not new infrastructure.
Not scheduled against any of the numbered gates below.

## Code changes riding build 2 — SHIPPED as 1.0 (2), VALID 2026-07-25

Build 2 went up via the CLI pipeline on 07-25 carrying BOTH items below
PLUS Movie Night v1.1 (see MOVIE-NIGHT-PLAN.md); internal group auto,
friends group attached, whatsNew set. The App Store submission can
attach THIS build once the owner gates (privacy labels, trader status)
clear — the domain flip was NOT on it (DNS still pending) and can ride
build 3 without blocking submission.

- **iPhone-only** (`TARGETED_DEVICE_FAMILY = 1`, was `"1,2"`, all 6 configs)
  — the UI is phone-designed; claiming iPad would demand a 13" screenshot
  set + iPad-layout review, and a device family can never be REMOVED after
  release. Pre-release is the only window. iPads still run iPhone apps in
  compatibility mode. Suite 51 green (13/13) after the change.
- **Weekly scan quota (2026-07-23)** — 7 fresh scans/week free tier, Monday
  00:00 UTC reset; only a pipeline CLAIM is metered (cache hits + followers
  free), counted atomically inside the claim transaction on server-only
  `users_private/{uid}.scanUsage`; 429 `QUOTA_EXCEEDED`. Web /extract shows
  the remaining count + a calm full state (live on next deploy); the
  ShareExtension drawer's inline quota state ships with build 2 (old builds
  show the server message via the generic error state — still friendly
  copy). Tier-ready: `PLAN_LIMITS` map + `users_private.plan`. Tests:
  `52-scan-quota` (7); suite 531/531.

## Build 6 — SHIPPED as 1.0 (6), VALID 2026-07-26

Build id `b39c1488-cbe9-4d72-ba26-71246af936fd`, uploaded 2026-07-26 and
processed VALID. Carries Movie Night v1.2 — the visibility control, the
lock indicator, and the ShareExtension "plan a movie night" button (see
MOVIE-NIGHT-PLAN.md) — plus the modal-guard tap-through fix and the
silent-scan-result push fix (see `CLAUDE.md`). `whatsNew` set, friends
group attached. POSTed to `betaAppReviewSubmissions` (see the
distribution-gap finding above) and **`BETA_APPROVED`**, so the friends
group and the public link serve build 6. Now the newest VALID build — the
candidate to attach to the App Store version record (item 4 below).

## Build 7 — SHIPPED as 1.0 (7), BETA_APPROVED 2026-07-27

Build id `eda19d3a-e5c9-471e-98cf-7aad9f43abe1`, uploaded 2026-07-27 and
processed VALID. Carries Movie Night **"time tbd"** (the "decide later"
showtime chip and every surface that renders it, plus the CalendarBridge
`allDay` -> `event.isAllDay` change) — see `CLAUDE.md`. The rate-limit work in
the same commit was server-side and had already gone live with the push.

Full pipeline run, all five steps: archive (`CURRENT_PROJECT_VERSION=7`) +
upload -> polled `processingState` to VALID -> PATCHed `whatsNew` -> POSTed the
friends `betaGroups` relationship -> **POSTed `betaAppReviewSubmissions`** ->
confirmed **APPROVED**. Both groups list build 7. Now the newest VALID build
and the candidate to attach to the version record (item 4 below), superseding
build 6.

**API note learned this run:** `GET /v1/builds/{id}/betaGroups` returns **403
FORBIDDEN**, and `externalBuildState`/`internalBuildState` come back as `null`
from the plain builds list unless requested. Verify distribution from the GROUP
side instead (`GET /v1/betaGroups/{id}/builds`), and read the review outcome
from `GET /v1/builds/{id}/betaAppReviewSubmission` (`betaReviewState`), which
is the authoritative record. Querying the wrong way looks exactly like "not
approved yet" — the same ask-wrong-vs-answer-no trap as the `head_sha` and
`parse-err` polls.

## Remaining before submission

1. **Owner — privacy nutrition labels** (ASC → App → App Privacy; ~5 min,
   not API-settable). Answers:
   - "Do you collect data?" **Yes**. No data used for **tracking**.
   - **Email Address** — linked to identity · App Functionality
   - **Name** — linked · App Functionality
   - **Photos or Videos** (avatars, covers, post media) — linked · App Functionality
   - **Other User Content** (posts, reviews, notes, lists) — linked · App Functionality
   - **User ID** (Firebase uid; PostHog identify) — linked · App Functionality + Analytics
   - **Product Interaction** (PostHog events) — linked · Analytics
   - **Crash Data** (Sentry; no setUser anywhere in src) — NOT linked · App Functionality
2. **Owner — EU trader status** (ASC → Business). Blocks submission
   EU-wide. Non-trader = hobbyist (no monetization intent); trader shows
   contact details publicly on the EU App Store. Owner's call.
3. **Owner — `app.cinechrony.com`** in Vercel + DNS → then Claude flips the
   three pinned URLs (`package.json` build default, `ExtensionAPI.swift`,
   `LiveActivityTokenRelay.swift`) and archives **the next build after
   that** (build 7 or later). This line used to say "build 2, which also
   carries iPhone-only" — stale: iPhone-only shipped in build 2 back on
   07-25 WITHOUT the domain flip, because the DNS never landed. The flip
   has slipped past builds 3, 4, 5 and 6 for the same reason. It rides
   whichever build is next once DNS is live; nothing else is waiting on it.
4. **Claude — attach build 6 + submit** (both via API) once 1–3 land.
   Build 6 supersedes build 2 as the attach candidate (see "Build 6"
   above — newest VALID build). `releaseType` is AFTER_APPROVAL (goes live
   on approval); flip to MANUAL if the owner wants to control launch day.

Blaze before any cohort past ~150 and the Firestore console TTL policies
remain from the TestFlight tracker.
