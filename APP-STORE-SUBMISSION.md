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

## Code changes riding build 2

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
   `LiveActivityTokenRelay.swift`) and archives **build 2** (which also
   carries iPhone-only).
4. **Claude — attach build 2 + submit** (both via API) once 1–3 land.
   `releaseType` is AFTER_APPROVAL (goes live on approval); flip to MANUAL
   if the owner wants to control launch day.

Blaze before any cohort past ~150 and the Firestore console TTL policies
remain from the TestFlight tracker.
