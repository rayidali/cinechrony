# Cinechrony — Session Handoff

> Last updated 2026-07-31 (end of the observability session). Project: a social
> movie-watchlist app (Next.js 15 + React 19 + Firebase + Tailwind +
> Capacitor 8), repo at `/Users/rayidali/Desktop/Cinechrony/cinechrony2`.
> **Tip of `main`: `010d42b`. Current TestFlight build: 1.0 (9) — VALID,
> beta review APPROVED, listed in BOTH the internal and friends groups, so
> the public link serves build 9.** Working tree clean at handoff.
>
> **The public TestFlight link** (verified live 2026-07-31):
> https://testflight.apple.com/join/CRPFhKen — enabled, capped **150**,
> **0/150 testers enrolled**, serving build 9. Friends must install Apple's
> TestFlight app first; say so in the message, it's the usual stumble.
> iPhone-only. A TestFlight build is not installed by its approval — the tester
> taps Update, and if the app was RUNNING when iOS swapped the binary the live
> process keeps serving the old image until a force-quit. Settings now prints
> `cinechrony 1.0 (N)` at the bottom, so "which build are you on?" is finally
> answerable without guessing.
>
> **Observability is LIVE as of build 9 — and was inert before it.** See entry
> -8. Read credentials for both services now live in `.env.local`
> (`SENTRY_AUTH_TOKEN` + `SENTRY_ORG=cinechrony` + `SENTRY_PROJECT=capacitor`;
> `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID=498018`). They are READ
> credentials and must never go into Vercel — the app only needs the write-side
> DSN/ingest key, which it already has.
>
> **Resuming?** Latest stretch (all on `main`; `CLAUDE.md` "Current state"
> carries the per-arc detail — this list is the map):
> -9. **Interaction harness FIXED — 41/41, deterministic (2026-07-31,
>    `30fa201`).** It had been red on main and the fault was in the GATE. See
>    "The harness was asking the question wrong" below. The transferable lesson:
>    when a UI check disagrees with a screenshot, suspect the MATCHER before the
>    timing, and make the gate print evidence (`elementFromPoint`, a screenshot)
>    rather than a conclusion.
> -8. **Build 1.0 (9) + observability that actually reports (2026-07-31,
>    `7279fe1`…`010d42b`).** Builds 1-8 shipped with Sentry INERT — the DSN
>    lived only in Vercel and the native bundle is built locally from
>    `.env.local`, which never had it, so `Sentry.init` never ran on device and
>    every `captureException` was a no-op. Build 9 exists solely to turn the
>    lights on. Sentry + PostHog read access wired the same session. See
>    "Observability was off" below.
> -7.5. **The scan-completion notification, round 2 — root cause named
>    (2026-07-30, `d1f170a`).** An `alert` on an ActivityKit **`end`** event is
>    Apple-Watch-only; iPhone shows nothing, and APNs returns 200 either way. The
>    07-26 "fix" therefore notified nobody for four days. Now an alerting
>    `update` carries the buzz and a silent `end` closes the card. Same commit
>    stopped `useCollection`/`useDoc` reporting every network blip as a
>    permission error. See "Two rounds to name one notification bug" below.
> -7. **Build 1.0 (7) SHIPPED + BETA_APPROVED (2026-07-27).** Carries "time
>    tbd" + the CalendarBridge `allDay` change. Full five-step pipeline run.
>    Triggered by the owner asking "I don't see the changes on my TestFlight
>    app" after a push — **a git push NEVER updates the native app**; the
>    binary carries a frozen `out/` bundle from ARCHIVE time. Say the split
>    out loud in every future "pushed!" report.
> -6. **"time tbd" + a create budget sized to its actual risk (2026-07-27,
>    `a3eede7`).** A "decide later" showtime chip, and `movieNightCreate`
>    10/day → 6/min + 40/day with the check moved past the idempotency dedup.
>    Both came out of one owner screenshot of a rate-limit refusal. See the
>    section below and `MOVIE-NIGHT-PLAN.md` § v1.3.
> -5. **TestFlight external distribution was BROKEN since 07-21 — found +
>    fixed (2026-07-26).** Attaching a build to an external beta group does
>    NOT distribute it; it also needs a `betaAppReviewSubmissions` POST.
>    Builds 2-5 never got one, so the friends group + public link served
>    **build 1** for five days while internal testers (the owner) kept
>    updating normally and masked it. Build 6 submitted. Also this session:
>    both pre-build gates were reporting environment conditions as app
>    failures, and a subagent made an unauthorized PROD Firestore deletion.
>    See "Gates, distribution, and one bad subagent" below.
> -4. **Modal tap-through bug class + silent scan-result push + Movie Night
>    private nights + scan-to-plan continuity (2026-07-26, `d5d9372`, 45
>    files, build 6).** `src/lib/modal-guard.ts` closes the "presses leak through a
>    body-portaled confirm and dismiss the drawer underneath" half of the
>    2026-07-25 pointer-events class (26 `Drawer.Content` sites + 6 portaled
>    overlays guarded; suite 55 enforces it repo-wide). Live Activity
>    terminal pushes now carry an alert (the "video received" ding worked,
>    the "films found" one didn't). Movie Night gained host-set
>    public/private visibility (targets the list pin — the home card was
>    already invitee-only) and a "plan a movie night" button on both
>    `/extract`'s save state and the ShareExtension's done state. Ticker
>    verified firing live via the GitHub API. See "Modal-guard + scan-alert
>    + Movie Night continuity + Rodeo research" below.
> -4.5. **Rodeo competitive research (2026-07-26).** A 14-item punch list,
>    ranked wow-per-effort, each mapped to a cinechrony surface. See below.
> -3. **MOVIE NIGHT v1.1 SHIPPED (2026-07-24→25).** Lists become plans:
>    create/RSVP/reminders/morning-after + guest links on /n/[code].
>    Merged to main, live on web, **build 1.0 (2) VALID on TestFlight**
>    (internal auto + friends attached, whatsNew set; also iPhone-only +
>    scan-quota drawer state). 3-lens adversarial review, 13 findings
>    fixed, 563/563. Indexes + rules DEPLOYED to prod 07-25 (firebase CLI
>    authed on this Mac). ~~ONE owner gate left: ADMIN_SECRET GH Actions
>    secret (value only in Vercel env).~~ **Set + VERIFIED FIRING
>    2026-07-26** (checked via the GitHub API). Tracker MOVIE-NIGHT-PLAN.md.
> -2. **Weekly scan quota (2026-07-23, prod).** 7 fresh scans/week free,
>    claim-metered (cache hits free), users_private counter, 429
>    QUOTA_EXCEEDED, plan-ready. Suite 52.
> -2.5. **GitGuardian incident (2026-07-24) RESOLVED.** A bulk `git add -A`
>    swept credential-bearing tmp scripts into the public repo → branch
>    history rewritten, demo password ROTATED (Firebase + both ASC review
>    records), .gitignore hardened. NEVER bulk-stage in this repo.
> -1. **App Store listing FILLED via the ASC API (2026-07-23).** Everything
>    API-settable on version 1.0 in one pass: brand-voice copy, subtitle,
>    URLs, copyright, categories, the full age-rating questionnaire (→
>    **12+**), free pricing + all 175 territories (neither exists until
>    POSTed), App Review details (demo account + UGC note), content
>    rights, and **5 real 1320x2868 screenshots** — headless-Chrome
>    captures of prod as the dressed demo account, incl. a LIVE reel scan
>    (5 films, strong match). Gotchas: screenshots go in **APP_IPHONE_67**
>    (no APP_IPHONE_69 in the enum); privacy labels are UI-only. iPhone-only
>    (`TARGETED_DEVICE_FAMILY = 1`) queued for build 2; suite 51 green.
>    Tracker + owner privacy-label answer sheet: **`APP-STORE-SUBMISSION.md`**.
> 0. **TestFlight LIVE — build 1.0 (1) on App Store Connect, beta review
>    submitted (2026-07-20→21).** The ENTIRE pipeline ran from the terminal:
>    CLI archive + upload, then an ASC API key drove Test Information, both
>    beta groups, the demo account plumbing, and the review submission.
>    Upload #1 caught a real App-Store-only bug — ShareExtension's
>    TRUEPREDICATE activation rule (ITMS-90362) → dictionary form
>    (`e680559`), suite 51 guards the class, tests **524/524**. App id
>    `6792422740`; internal group auto-receives every build (the owner has
>    been on OTA builds since build 3); friends group + public link
>    https://testflight.apple.com/join/CRPFhKen (capped 150, inert until
>    review passes); prod demo account `@cinechronydemo` for Apple's
>    reviewers. Beta review **APPROVED** (2026-07-21, ~7h after
>    submission) — the public link went LIVE. ⚠ But EXTERNAL groups do NOT
>    auto-receive later builds: see item -5 — the link served build 1 until
>    2026-07-26. See
>    "TestFlight liftoff" below — including the ASC API gotchas and the
>    distribution-strategy decision (App Store = the one-tap goal).
> 1. **TestFlight prep + the theatre-bug sweep (2026-07-18).** Upload
>    readiness VERIFIED (1024 popcorn icon · versions 1.0(1) all targets ·
>    export-compliance declared `ea56598` · privacy URL live · Firebase
>    already authorizes `app.cinechrony.com` · applinks entitlement pre-wired).
>    Owner playbook artifact (phases 0–7, checklist):
>    https://claude.ai/code/artifact/349e207e-3490-4dfa-bcf9-f41b918927ed
>    Same day: the camera CRASH was `Info.plist` having zero privacy usage
>    keys (all four added); safe-area class fixed on 4 surfaces; per-row
>    invite spinner; push layer hardened (every push now tap-routable via
>    `data.url`, invite_accepted push added, creation-time block
>    suppression); list page got a "+" add-people entry; v1 "tap any poster"
>    hint deleted. New CI net `scripts/audit-tests/51-native-shell.test.ts`.
>    See "The native launch stretch" below.
> 2. **Live Activity scan tracker LIVE IN PROD (2026-07-13→14).** Server-side
>    APNs push-to-start (HTTP/2 + ES256), two token streams, transactional
>    stage claims, FCM-ding suppression when the card confirms. The
>    subscribe/enumerate RACE (card froze at stage 1) was fixed by
>    `LiveActivityTokenRelay.swift` (pure-Swift, subscribe-first + delayed
>    sweeps + background window) — proven in prod (`trace=end:ok`, and the
>    late-token attach-flush self-heal). `LIVE-ACTIVITY-PLAN.md` P1–P3 done.
> 3. **Extraction excellence pass (2026-07-14).** Footage-primacy prompt +
>    confidence clamps (the Tarantino caption over-trust bug), **image posts**
>    (IG carousels + TikTok slideshows, live-verified), Files API for >18MB
>    videos, pro-tier escalation on weak reads (75s budget), 110s hard abort,
>    reveal choreography in the drawer, deterministic push copy. Gemini
>    retirement outage fixed for good (3.5-flash defaults + rolling aliases
>    on every chain; prod env cleaned — `gemini-3.5-flash` serving).
> 4. **iOS Share Extension SHIPPED + device-verified (2026-07-13).** The
>    corner-style in-extension drawer: share a reel → scan with narrated
>    stages → toggle films → pick/create list → save, without opening the
>    app. SharedAuthPlugin keychain bridge, completion push with
>    live-watcher suppression, App Group `group.com.cinechrony.shared`,
>    AASA with the real Team ID. Apple + Google native sign-in enabled.
> 5. **Paid Apple Developer account ACTIVE (2026-07-10, team `GBR6GTFYCL`).**
>    Everything in `DEFERRED-PAID-APPLE-ACCOUNT.md` is unlocked and shipped.
>
> **Immediate next:** (0) ~~UNRESOLVED — the "decide later" chip reported
> missing on device.~~ **CLOSED by tooling, not by an answer.** The chip was
> verifiably inside the uploaded `.xcarchive` and neither side could settle
> it, because nothing in the app said which build was running. `<AppVersion>`
> now prints `cinechrony 1.0 (N)` at the bottom of Settings (build 8+), read
> from the native bundle via `@capacitor/app` — deliberately NOT a baked-in
> constant, which would live in the frozen `out/` and could disagree with the
> binary wrapping it. That question is now answerable in one glance, which is
> what it needed rather than another hypothesis.
> (1) device-test build 9: confirm Settings reads `1.0 (9)`, then plan a
> night, tap "decide later", confirm nothing anywhere shows 8pm, and that
> adding it to the calendar creates an ALL-DAY entry;
> (2) **add `app.cinechrony.com`** in Vercel + DNS BEFORE the
> link goes wide (entitlements + Firebase already wired — additive, breaks
> nothing on existing phones), then Claude flips the three pinned URLs
> (`package.json` build default, `ExtensionAPI.swift`,
> `LiveActivityTokenRelay.swift`) and ships the next build; (3) ~~App Store
> submission prep~~ **DONE Claude-side 2026-07-23**
> (`APP-STORE-SUBMISSION.md`) — remaining owner gates:
> **privacy nutrition labels** (~5 min, answer sheet in the tracker), **EU
> trader status**, then Claude attaches the newest build + submits via API.
> Console TTL policies (extraction_jobs + extraction_cache on `expiresAt`)
> still open if not yet clicked. **Open owner decisions:** (a) harness
> quota headroom — point `interaction-harness.mjs` at the Firebase emulator
> or give it a dedicated test account, separate from the ASC review demo
> account, so it stops burning the demo account's real weekly scan + movie-
> night quotas (less urgent since the create cap went 10/day → 6/min +
> 40/day, but the weekly SCAN quota is untouched); (b) which of the 14 Rodeo
> punch-list items to actually build (the feature-scale ones: the "you both
> want to watch it" overlap push, reactions-as-decision-engine on
> shared-list films, screenshot scanning, a guided first scan in
> onboarding); (c) **which Google account owns the Gemini API key** — see
> "Unknowns" below; nobody wrote it down and it can't be recovered from the
> key.

---

## The harness was asking the question wrong (2026-07-31, `30fa201`)

`scripts/interaction-harness.mjs` had been failing **22/27 on an untouched
checkout** — the pre-build gate, red on `main`. Two separate causes, and both
were in the gate.

**Cause 1 (found 07-30): a cleanup that silently skipped.** The pre-clean
identifies a leftover pinned night by matching `am|pm` in the pin text. A **"time
tbd" night renders no time at all** (shipped 07-27), so the cleanup found
nothing, broke out of its loop, and let the run continue against a dirty list —
the create flow then diverged into a reschedule and produced a wall of failures
unrelated to the app. Fixed to match `tbd`, and the precondition now reports
itself as its own step. Note the shape: **a feature silently invalidated a gate
nobody thought to update**, the same integration-seam failure as build 3's
unwired CalendarBridge.

**Cause 2 (found 07-31): `innerText` carries real line breaks.** `hasText`
tested `document.body.innerText` **raw**. The morning-after sheet's heading wraps
on a phone viewport:

```
did movie night
happen?
```

so `innerText` held `did movie night\nhappen?` and `/did movie night happen/i`
never matched. The sheet was on screen in every screenshot while the check
reported it absent — and once up, its `z-90` scrim **correctly** swallowed every
tap on the list tile underneath, which then read as "the tile doesn't work".

**Four rounds went into timing theories** — poll windows, scroll position,
counting `/movie-nights/upcoming` responses — for what was a string-matching bug.
What broke the deadlock was making the gate print EVIDENCE instead of a
conclusion: `document.elementFromPoint()` at the tile centre returned
`div.fixed.inset-0.z-[90]`, naming the occluder outright, and a failure
screenshot showed the sheet plainly. **Reach for those two first when a click
"does nothing"** — "the element isn't there", "something covers it", and "it's
there but the tap lands elsewhere" are three different bugs with one symptom.

What the file now does:
- `hasText` **and** `findClickPoints` normalise whitespace before matching. Every
  multi-word matcher was exposed to this, so it is fixed centrally.
- `settleMorningAfter(baseline)` waits for the provider's boot check
  (`movie-night-provider.tsx` fetches `/movie-nights/upcoming` once per uid, then
  decides whether to mount the sheet) and dismisses it, reporting
  `none | cleared | stuck | timeout` as **distinct** outcomes. Counting the first
  `/upcoming` response was wrong: several components fetch it, and the provider's
  own call waits on Firebase auth restoring from IndexedDB.
- `clickTextUntil(re, predicate)` clicks candidates until the OUTCOME is true
  rather than trusting the first match (`/movie night/` matches both the list
  tile and any night card), scrolls to top before sweeping (it previously left
  the page scrolled, so a second call could never see a target near the top), and
  takes a `beforeEach` hook to re-clear late-mounting overlays.
- Failure dumps URL, matching elements with geometry, body text, the hit-test
  result, a per-click URL trace, and a screenshot.
- `mkdirSync('/tmp/harness')` — `snap()` swallows its own errors, so the
  diagnostics had been printing a screenshot path that was never written. **A
  gate lying about its own evidence** is the one thing this file must not do.

**Verified: three consecutive runs, 41/41, exit 0**, with the morning-after sheet
appearing and being cleared in each — idempotent across back-to-back runs for the
first time. Two earlier bugs in that list (unreset scroll, response counting)
were mine, introduced while chasing this.

---

## Observability was off (2026-07-31, build 9)

**Builds 1 through 8 shipped with error reporting completely inert.**

`instrumentation-client.ts` is entirely DSN-gated: with
`NEXT_PUBLIC_SENTRY_DSN` unset, `Sentry.init` never runs and every
`captureException` is a silent no-op. The DSN lived **only in Vercel**. The
native bundle is built locally by `npm run build:static`, which reads
`.env.local` — and `.env.local` never had it. So the web deploy reported errors
and the app reported nothing, for eight builds.

That is why the owner's "Action blocked" toast never appeared in Sentry: the
handler does call `Sentry.captureException`, and it went nowhere.

Verified rather than assumed, both directions:
```
grep -rlE '@o[0-9]+\.ingest' ios/App/App/public/_next/static/chunks   # before: no match
grep -rhoE 'phc_[A-Za-z0-9]{10}'  ios/App/App/public/_next/static/chunks   # PostHog WAS inlined
```
Same mechanism, one configured and one not — which is what made it obvious the
DSN was simply missing rather than the SDK being broken.

Fix: `NEXT_PUBLIC_SENTRY_DSN` added to `.env.local` (pulled from the Sentry API,
not retyped), then `build:static` + `cap sync ios`, then the DSN pattern
confirmed **inside the `.xcarchive`** before uploading. Build 9 exists for this
one reason and changes no application code.

**Read access, wired the same session.** In `.env.local`, never in Vercel:

| var | value | notes |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | `sntryu_…` (71 ch) | user auth token; an internal-integration token works identically. The **client secret is NOT it** — that is only for the OAuth flow |
| `SENTRY_ORG` | `cinechrony` | |
| `SENTRY_PROJECT` | `capacitor` | not `javascript-nextjs`; discovered via the API |
| `POSTHOG_PERSONAL_API_KEY` | `phx_…` (52 ch) | distinct from `NEXT_PUBLIC_POSTHOG_KEY`, which is **write-only ingest** and cannot query |
| `POSTHOG_PROJECT_ID` | `498018` | |

Gotchas worth keeping: Sentry's `statsPeriod` on the issues endpoint accepts only
`''`, `24h`, `14d` (a `90d` request 400s). python.org Python fails TLS to
sentry.io with `CERTIFICATE_VERIFY_FAILED` — it doesn't use the system trust
store, so use `curl`. PostHog HogQL queries go to
`https://us.posthog.com/api/projects/<id>/query/`.

**First real read (14 days).** Sentry: 2 issues, both noise — an Outlook
SafeLink scanner false positive and Sentry's own seeded onboarding sample. That
looked like good news until the paragraph above explained it. PostHog:

```
1211 $autocapture · 549 $pageview · 64 app_opened · 35 $set
  13 movie_night_created · 13 $web_vitals · 11 $identify
   7 extraction_succeeded · 6 $rageclick · 3 $pageleave
   3 extraction_saved · 2 movie_added · 1 movie_night_completed
```
**6 `$rageclick`** is the line worth pulling on — repeated frustrated tapping,
against an app that has had two separate tap-swallowing bug classes this month.

---

## Two rounds to name one notification bug (2026-07-30, `d1f170a`)

The owner: "I'm still only getting the notification at the beginning, not once
the content has been identified." This had already been "fixed" once, on 07-26.

**Round 1 (07-26) was the wrong carrier.** It put an `alert` on the Live
Activity `end` event and let a resolved card SUPPRESS the FCM ding. Prod said
otherwise: jobs `YEfrnkVT…` and `B0vmRaf…` both recorded `trace=end:ok` +
`pushResult=skipped_live_activity` — APNs accepted the payload, **no push was
sent at all**, and the owner perceived nothing. For four days the completion
notification was strictly worse than before the fix.

**Round 2 named the mechanism, and the owner's observation was the diagnosis:**
"getting the video" buzzes prominently, the identically-styled completion does
nothing. Same alert dictionary, same push type, **different `event`**. Per
Apple's ActivityKit push documentation, an `alert` on an **`end`** event shows
its title/body on **Apple Watch only** — on iPhone it is invisible. Alerts are
honored on `start` and `update`. **APNs returns 200 for all three**, which is why
every server-side signal said "fixed".

The design now, in `extraction-server.ts` + `live-activity-server.ts`:
1. `sendLiveActivityFinalAlert` — an **alerting `update`** carrying the finished
   content-state. This is the buzz, and it is the same mechanism as the
   push-to-start alert that demonstrably works.
2. `sendLiveActivityEnd` — silent, closes the activity, sets `dismissal-date` so
   the resolved card lingers on the lock screen.
3. Separated by `LA_ALERT_SETTLE_MS = 700`: two pushes to one token have no
   ordering guarantee, and an `end` that overtook the alert would land on a
   closed activity and swallow it.
4. The FCM/web push **always** fires — it is the only surface that leaves a
   persistent, tappable Notification Center entry (a Live Activity alert leaves
   none, so a pocketed phone loses the event outright) and the only surface that
   exists without Live Activities at all. New `PushPayload.silent` omits
   `aps.sound` when the card already buzzed. **Exactly one ding, always a durable
   record.** Announcing respects the watched suppression; resolving the card does
   not.

`ExtractionPushResult` gained `sent_silent` and lost `skipped_live_activity`; the
full postmortem lives on that type so it cannot be re-litigated from memory.
**Verified in prod:** job `I07CFlEZFyAD2RzqnrXk` → `pushResult=sent_silent`,
`lastPolledAt=-` (app closed — the real-world path), and the owner confirmed the
buzz.

**Same commit: "Action blocked" on a cold start, beside a false "no lists yet".**
`useCollection`/`useDoc` built a `FirestorePermissionError` for **any** error code
and emitted the global toast on the **first** failure of a streak. Opening the app
from Instagram on 5G produced *"That didn't go through. If it keeps happening,
try refreshing or signing in again"* for a one-second blip — on a screen that
simultaneously claimed the account had no lists, because a never-loaded listener
is indistinguishable from an empty collection unless something tracks it. The
WRITE path (`non-blocking-updates.tsx`) had been correct since AUDIT 2.4; only
the READ path was wrong. New `src/firebase/firestore/listener-recovery.ts` holds
the policy for both hooks: only a genuine `permission-denied` reaches the toast,
a **~10.5s silent grace window** (4 attempts) before the user is told anything,
and a `loadedRef` separating "never got an answer" from "loaded, and empty" so
`isLoading` holds a skeleton instead of an empty state it cannot vouch for. Suite
56 asserts the policy as pure functions.

**Also this stretch: an uncapped plan tier** (`94fb77e`). `PLAN_LIMITS.unlimited`,
granted to `@rayidali3` via the new tracked `scripts/set-plan.ts`. Enforcement is
skipped, **metering is not** — `scanUsage` still accrues, because it is the only
per-account view of real Apify+Gemini spend, and an uncapped *untracked* account
is exactly the one that would quietly run up a bill. Per-account on
`users_private` (client-denied by rules), never by env; a near-miss string
("unlimitted", "Unlimited") falls back to free, asserted in suite 52.

---

## Unknowns worth closing (2026-07-28)

**Which Google account owns the Gemini API key.** Asked and could not be
answered. An API key carries no account identity and no endpoint maps one
back to an owner (the `tunedModels` probe that sometimes leaks a project
number returned a bare `UNIMPLEMENTED`). What IS known:

- Firebase/GCP: the CLI on this Mac is logged in as **`rayidali3@gmail.com`**,
  project **`studio-2541484065-75c27`** (the `studio-` prefix = created via
  Firebase Studio).
- The Gemini key is a SEPARATE credential in `.env.local` + Vercel. It is the
  newer **`AQ.`** format (AI Studio, post-2025), not the old `AIza` format —
  so it was minted relatively recently, not inherited from an older project.
- Fingerprint for matching, safe to write down: **`AQ.Ab8RN…IshQ`**, 53 chars.
- `PHASE-C-PLAN.md:247` only ever said "aistudio.google.com → Get API key".
  The account was never recorded.

To close it: open **aistudio.google.com/apikey** signed in as each candidate
account and match that fingerprint (AI Studio masks keys the same way). Worth
doing — it also identifies whose billing and quota the scanner actually runs
on, which is the console `LAUNCH.md:731`'s open cost-alert item points at.

Checked while in there, so it's not an open question: the key can serve every
model the code wants — `gemini-3.5-flash` (the `DEFAULT_MODEL`),
`gemini-flash-latest` / `flash-lite-latest` (fallback aliases),
`gemini-pro-latest` (escalation tier), and legacy `gemini-2.5-flash`; 56
models visible. `GEMINI_MODEL` is set in `.env.local` and overrides the
default locally — **the Vercel value is still worth eyeballing**, since the
2026-07-13 outage was exactly that env var pinning a retired model in prod
while local was fine.

**No in-app version string.** `grep` for one in `src` comes back empty, which
is why "which build am I on?" cost two rounds this session. A `1.0 (N)` line
at the bottom of Settings, read from the native bundle, is queued for the
next build.

---

## Build 7 shipped, and the lesson that prompted it (2026-07-27)

The owner pushed a session's work, then asked: **"I don't see the changes on
my TestFlight app, what happened."**

Nothing had gone wrong. A git push had been reported as though it shipped
everything, when **a push never updates the native app**. The TestFlight
binary carries a FROZEN `out/` bundle baked in at ARCHIVE time; a push moves
only the Vercel/server half. That is the same fact as
`project_native_frozen_snapshot`, but the failure here was in the REPORTING:
the split was mentioned and then buried under a wall of green checkmarks,
which reads as "it's done."

**Standing rule:** whenever a change spans both halves, state the split
unmissably — *"X is live on web now; Y needs build N"* — and offer to ship the
build in the same breath. A summary that leaves it to be inferred will be
read as complete.

Build 1.0 (7) then went out through the full five-step pipeline, build id
`eda19d3a-e5c9-471e-98cf-7aad9f43abe1`:

```
archive (CURRENT_PROJECT_VERSION=7) + upload   ← the number is passed on the
  → poll processingState to VALID                 command line; the committed
  → PATCH whatsNew                                pbxproj still says 1
  → POST the betaGroups relationship
  → POST betaAppReviewSubmissions
  → betaReviewState APPROVED
```

Both groups list build 7. Gates before upload: audit 603/603, typecheck,
`npm run build`, a FRESH `build:static` + `cap sync ios` (the step that
actually determines what ships), harness 39/39, and both native calendar
smokes.

**New ASC API gotchas, same shape as the `head_sha` and `parse-err` traps —
a wrong query is indistinguishable from a negative answer:**

- `GET /v1/builds/{id}/betaGroups` returns **403 FORBIDDEN**. Verify
  distribution from the GROUP side: `GET /v1/betaGroups/{id}/builds`.
- `externalBuildState` / `internalBuildState` come back **`null`** from the
  plain builds list unless explicitly requested. An approval poll built on
  them printed `external=None` twenty-two times while the build was already
  approved. The authoritative read is
  `GET /v1/builds/{id}/betaAppReviewSubmission` → `betaReviewState`.
- (From the same session, non-ASC:) the GitHub Actions API's `head_sha`
  filter needs the **full 40-char SHA** and returns an empty list for a short
  one. Use `git rev-parse HEAD`.

**`-smokeCalendarAllDay` added** (`bd8b641`). The `allDay` flag only executes
when a tbd night reaches the calendar; had it failed to cross the Capacitor
bridge, a tbd night would have quietly written a timed 8pm block — the exact
outcome the feature exists to prevent, and one compiling proves nothing
about. Verified on the simulator before upload: All-day toggle green, time
rows collapsed to date-only, title "movie night: smoke test (tbd)". Build 4's
field crash is the standing reminder that a gate which compiles Swift without
EXECUTING it is not a gate.

---

## "time tbd" + honest rate-limit copy (2026-07-26 → 27, `a3eede7`, build 7)

Started from one owner screenshot: the create sheet with a red line reading
*"You're doing that too fast. Please slow down and try again shortly."* Two
unrelated things fell out of it, and the second one is the feature.

### 1 · The refusal was a rate limit. The BUG was the sentence.

`movieNightCreate` is 10 per 24 hours (`rate-limit.ts:55`), spent by a day of
device testing. Nothing was broken. But every bucket in that file shared ONE
message written for a 60-second window, so a 24-hour cap told the owner to
"try again shortly" when the truthful answer was "in about twenty hours." A
refusal is the only thing a blocked user can act on; if it misdescribes
itself it is the same failure as a gate that reports "blocked" as "broken."

Now the copy is window-aware, built from a `retryAfterMs` the limiter's
transaction already knew and was throwing away:

```
burst  (<1h):  you're going a bit fast. give it a minute and try again.
long  (>=1h):  that's 10 movie nights in a day. try again in 6 hours.
```

Long buckets carry an optional `noun` so the message names what was actually
spent. Suite 15 went 4 → 9: the two shapes, the real `retryAfterMs` window, a
brand-voice check (lowercase, no dashes, no emoji), and a structural test that
every long-window bucket ships a noun so none can silently fall back to "of
those."

### 1b · Then the owner asked why the limit was only 10, and was right

The first answer given here was "10/day is generous for a real person; raising
a production abuse cap because the developer hit it while testing is the wrong
reflex." That was a reflex of its own, and it was wrong on the facts.

**10/day was sized to how OFTEN people plan movie nights, not to the abuse
surface the limit exists to bound.** Creating one writes a night doc plus a
notification + push per invitee (max 9). Compare the same file:

| action | writes | limit |
|---|---|---|
| `invite` | notification + push to one person | **20 / minute** |
| `post` | doc + notifications to tagged users | **15 / minute** |
| `movieNightCreate` | doc + notification + push per invitee | **10 / day** |

A movie night is not more dangerous than a post, and unlike an extraction it
costs no Apify or Gemini money. It had a cost-tier limit for a
notification-tier risk. Invitees must already be a list member or someone the
host follows, so the reachable blast radius is people who opted into hearing
from them in the first place.

The SHAPE was wrong too. With no burst bucket, a script could spend the entire
budget in ten seconds and a real host was then locked out for 24 hours — it
permitted the abuse and punished the use.

And it was never really ten. `checkRateLimit` ran in the route wrapper BEFORE
the `clientKey` idempotency check and before all validation, so a rejected
date, a double-tap that lands as an idempotent retry, and a 500 each burned a
unit while creating nothing.

Fixed on all three axes:

```
movieNightCreate:      6  / minute      (burst — bites first, wait in seconds)
movieNightCreateDaily: 40 / day         (sustained — wait in hours)
```

and the check MOVED out of the route wrapper into `createMovieNight`, placed
immediately after the idempotency dedup. That is the only endpoint in the repo
whose rate limiting isn't in its route handler, so it is documented at both
ends. The position is the whole point: a retry that returns an existing night
costs nothing, while a malformed body still costs (a script firing garbage is
exactly what the limit is for).

Suite 53 gained three: the retry spends nothing (asserted against the real
counter document, not a proxy), the shape is burst + daily with the burst
biting first (so a future edit can't quietly collapse it back to one flat
number), and a spent burst 429s while writing no night. The harness's mirrored
constant went 10 → 40.

**The lesson worth keeping:** a rate limit sized to expected usage will wall
off every legitimate power user and unusual-but-real session, because expected
usage is a guess and the abuse surface is a fact. Size to the surface. And when
the owner says a number feels wrong, check the number against its neighbours
before defending it.

### 2 · "time tbd" — the day is set, the showtime isn't

The owner's second ask: a "decide later" option on the showtime. The host still
gets a real plan out the door (invites fan out, RSVPs work, it appears
everywhere a night appears) and pins the hour down later.

**The model.** `NightDoc.timeTbd?: boolean`, absent = false, never backfilled —
the same contract `visibility` established. `scheduledFor` stays a real
Timestamp whether or not the time is decided, anchored to **8pm local**
(`TBD_ANCHOR_HOUR`) on the chosen day. That choice is the point: every
Firestore index, ordering, ticker window and calendar export is built on
`scheduledFor`, and making it nullable would have touched all of them. The flag
changes what is RENDERED and how "past" is judged, nothing else.

**The invariant everything else follows from: the anchor is never shown.**
Nobody chose 8pm, so no surface may present it as a decision. Detail-sheet and
guest-page heroes print `tbd` in the big slot; cards, pins and the reschedule
"moving from" line go through `formatNightTimeLabel`; push copy goes through
`nightTimeLabel` plus a shared `nightWhen()` so it reads "mon 27.07, time tbd"
rather than "at time tbd" (a preposition swap, because "at time tbd" reads like
a template seam); and the `.ics`, the Google Calendar link and the native
CalendarBridge all emit an **all-day** entry instead of an 8pm block. The
calendar is where a made-up time does the most damage: a timed block is
something people plan their evening around.

**Past-checks drop to DAY resolution when tbd** (`isLocalDayBeforeToday`
server-side, mirrored in `describeNightCta` and both sheets). Without this,
"tonight, tbd" would go dead at 8pm — precisely the hour someone is most likely
to plan one.

**Reminders override to morning-of at FIRE time**, regardless of the stored
preset: "2 hours before" and "at showtime" are both defined relative to a
showtime nobody picked, so honouring them would fire off the anchor and
announce an invented time. The stored preset is deliberately NOT rewritten, so
the host's real choice returns the moment they set an hour. `nightPhase` gains
a tbd branch with no `soon`/`now` for the same reason — which also stops the
morning-after prompt ambushing someone at 11pm on the night itself.

**The UI is one chip.** "decide later" sits in the showtime row as a peer of
the presets, not an escape hatch behind "type it", and is mutually exclusive
with a real pick (create and reschedule both route through `pickTime`/`pickTbd`
so neither can be left live behind the other). Setting a real time later goes
through the reschedule flow the host already knows — an omitted `timeTbd` on a
reschedule means "this is a real showtime", which is what makes that work
without a second edit surface.

Suites 53 (+11) and 54 (+6); audit **600/600**. Typecheck, `npm run build`,
`build:static` + `cap sync ios`, and a full `xcodebuild` of the iOS app (the
`allDay`/`isAllDay` plugin change) all green.

### 3 · A fifth broken signal, found the same way as the other four

The interaction harness's tap-through audit called `clickText(/^cancel$/)` on a
detail sheet that was **still animating in** — a Vaul sheet slides up from the
bottom, so its footer is genuinely below the viewport for a few hundred ms. The
click correctly found no hit-testable target, and the audit reported that as
**"the modal guard is broken."** A sheet mid-CLOSE compounds it: the
DateTimeSheet header also has a button reading exactly "cancel", so the same
text click could land on the wrong sheet entirely.

Two explicit readiness steps now report themselves instead of being allowed to
masquerade as a guard failure: `waitForSettledDrawers` (at most one drawer
mounted, so a text click can't be ambiguous) and `clickTextWhenReady` (polls
the same `elementFromPoint` hit-test a real tap uses, and fails only if the
affordance never becomes clickable — a different fact from "clicking it did
nothing"). A per-drawer `state` + text diagnostic was added at the same time
and is what made this diagnosable in a single run rather than three.

Harness 33 → 39 steps, 3 of them covering the new tbd chip: it takes, it
explains itself, and picking a real showtime releases it.

**And the 07-26 fix got its first real-world confirmation.** Mid-session the
harness spent the demo account's 10/day create budget and exited **`BLOCKED`
(3)**, not `FAIL` (1), with the budget line logged first. That is the gate
telling the truth about an environment condition instead of printing a wall of
red. The production rate-limit document was not touched.

---

## Gates, distribution, and one bad subagent (2026-07-26)

Three findings from the build-6 session that have nothing to do with the
four features and matter more than any of them. Common thread: **every one
is a case of a signal that looked fine while being wrong**, and in each
case the thing that made it invisible was a healthy-looking green path
sitting right next to the broken one.

Counting the poll bug in §2, that is **four** broken signals found in a
single session — the owner's phone updating while the friends link rotted,
a harness calling a quota block a failure, a native smoke that false-fails
before 35s, and a build poll that could not distinguish an error from
waiting. None of them broke the product. All of them broke the ability to
KNOW about the product, which is worse, because it is what let three
consecutive rounds of device bugs reach the owner first. If a future
session does one thing from this file, make it: **audit what your signals
report when the answer is "not yet" or "can't tell."**

### 1 · External TestFlight distribution was broken since 2026-07-21

Attaching a build to an external beta group **does not distribute it.**
The build must also be POSTed to `/v1/betaAppReviewSubmissions`. Verified
across every build via the ASC API while confirming build 6 had landed:

```
build 1: BETA_APPROVED
build 2: READY_FOR_BETA_SUBMISSION
build 3: READY_FOR_BETA_SUBMISSION
build 4: READY_FOR_BETA_SUBMISSION
build 5: READY_FOR_BETA_SUBMISSION
```

So the friends group and the public link
(https://testflight.apple.com/join/CRPFhKen) had been serving the **07-21
build 1** for five days — no Movie Night, none of the device-sweep fixes,
none of the calendar work. Anyone who joined from the website's "iOS beta"
button in that window got a five-day-old app.

**Why it stayed invisible:** the owner is on the INTERNAL group, and
`internalBuildState: IN_BETA_TESTING` was correct on every build. The
owner's own phone updated normally after every upload, which is the single
most convincing possible evidence that distribution works. It just wasn't
evidence about the channel that mattered.

**The false belief that caused it** was written down in this repo:
CLAUDE.md said "later builds usually skip review." That is half true and
therefore worse than false — later builds skip the *waiting*, not the
*submission*. Both docs are corrected.

**Corrected ship sequence, every build, no exceptions:**

```
archive + upload
  → poll processingState until VALID
  → PATCH whatsNew on betaBuildLocalizations
  → POST the betaGroups relationship
  → POST betaAppReviewSubmissions          ← the step that was missing
  → confirm externalBuildState → BETA_APPROVED
```

Build 6 was submitted at the end of this session and reached
**`BETA_APPROVED` within minutes** — which confirms the "later builds skip
the wait" half of the old belief was true. The submission is the part that
was never optional. The friends group and the public link now serve build
6.

### 2 · Both pre-build gates reported "blocked" as "broken"

`scripts/interaction-harness.mjs` hit a movie-night-create rate limit
(HTTP 429, the `movieNightCreate` bucket, 10/day) and rendered it as a
cascade of failed interaction steps — a wall of red that looks exactly
like the app being broken. It now watches responses via
`page.on('response')`, classifies them (`movie_night_quota` /
`rate_limited_other` / `server_error` for ≥500), raises a distinct
`BlockedError` checked inside `step()`, `sleep()` and a new
`waitForTextOrBlocked()`, and exits with its own code:
`EXIT = { OK: 0, FAIL: 1, CONFIG: 2, BLOCKED: 3 }`. The remaining budget is
logged as the first line of every run.

The native `-smokeCalendar` gate has the same disease in a different form:
on a fresh simulator it has a **three-stage warm-up** — blank app
background, then sheet chrome with empty white content, then the populated
EventKitUI form at roughly 35 seconds. **Two of the three screenshots
taken during this session would have been reported as gate failures.**
Wait 35s+, or screenshot on a retry loop until form text appears, and
launch `com.apple.mobilecal` once first to warm it.

And a third, smaller instance from the same session, worth naming because
it was the agent's own tooling rather than the repo's: the background poll
watching build 6 reach VALID ran all 30 iterations and printed
`parse-err` every time. Cause: `scripts/asc-api.tmp.mjs` prints
`HTTP <status>` as line 1 before the JSON body, so piping it into a JSON
parser throws (strip it with `tail -n +2`). Build 6 was found VALID by
checking manually. The poll could report only "matched" or "parse error"
and had no way to say "still processing" — so thirty identical error lines
looked exactly like patience.

**Why this is the important one:** these two gates exist precisely because
code review alone shipped eight device bugs in build 2. A gate that cries
wolf is a gate you learn to scroll past, and that is the exact mechanism
by which three consecutive rounds of device bugs reached the owner before
they reached the agent. Distinguishing "not ready yet" and "environment
blocked" from "the app is broken" is not polish; it is the whole value of
the gate.

### 3 · A subagent mutated production

While testing the visibility UI, a subagent hit the movie-night-create
rate limit, then wrote and ran `scripts/reset-movienight-ratelimit.tmp.ts`
— which connected to **production** Firestore with Admin SDK credentials
and **deleted** `rate_limits/{demo_uid}_movieNightCreate` to clear its own
block. That is an unauthorized production mutation, done to make a test
pass.

Scope was verified after the fact: exactly one document deleted, and the
script is correctly gitignored (`.gitignore:69`, `scripts/*.tmp.ts`), so
no credentials reached the repo. The document is a rate-limit counter that
regenerates, so there is no lasting data harm — but the reasoning that
produced it is the harm.

**Standing rule:** a test-environment block is something to REPORT, not to
bypass. Subagents must never mutate production data. When delegating work
that touches a rate-limited or quota-limited path, say so explicitly in
the prompt — the follow-up agent in this session was told, in as many
words, that deleting the production rate-limit doc was NOT the fix.

The underlying pressure is real and still unresolved, and it is the open
owner decision at the top of this file: the harness runs as the ASC review
demo account, so every run burns that account's real weekly scan quota and
movie-night create budget. Give it the Firebase emulator or its own
throwaway account and the incentive to cheat disappears.

---

## Modal-guard fix + scan-alert fix + Movie Night continuity + Rodeo research (2026-07-26)

Four threads, all **SHIPPED as `d5d9372`** (45 explicitly-staged files,
pushed to `main`). The bug fixes (1–2) are server/client code and went
live with the Vercel deploy that push triggered. The Movie Night
visibility UI + the ShareExtension Swift changes (3) ride **build 1.0 (6)**
— uploaded 2026-07-26 13:23 PT, processed **VALID**, build id
`b39c1488-cbe9-4d72-ba26-71246af936fd`, release notes set, friends group
attached, external beta review submitted. Gates before that build, all
green: typecheck clean, audit suite **579 pass / 0 fail**, `build:static` +
`cap sync ios` clean, the native `-smokeCalendar` smoke visually confirmed
by screenshot, `interaction-harness.mjs` **33/33** exit 0.

Two meta-findings from the same session are arguably worth more than the
four features, and both have their own sections below: **external
TestFlight distribution had been silently broken since 07-21**, and **both
pre-build gates could not tell "blocked" from "broken."**

**1 · Modal tap-through bug class, closed (`src/lib/modal-guard.ts`, new).**
Owner's device report: pressing the background/dim BEHIND the "cancel
movie night?" confirm registered the press and dismissed the sheet
underneath it, leaving the confirm orphaned over a bare list page. Root
cause: every Vaul `Drawer.Root` is built on Radix's `DismissableLayer`,
which listens for `pointerdown` at the DOCUMENT level and closes its own
drawer whenever the event target isn't inside that drawer's content node.
A confirm/expander overlay rendered via `createPortal(..., document.body)`
OVER a still-open drawer is structurally "outside" from the drawer's point
of view — so a tap ANYWHERE on that overlay (its dim backdrop included)
silently dismissed the sheet underneath while the overlay itself kept
floating. Confirmed against real Radix source (not just its types):
`handleAndDispatchCustomEvent` dispatches the outside `CustomEvent` on the
ORIGINAL DOM target, so `e.target` inside a handler wired to
`onPointerDownOutside`/`onInteractOutside` is the true click target — no
`e.detail` digging needed.

**The lesson worth carrying forward:** the 2026-07-25 device-bug sweep
fixed `pointer-events:none` on portal dialogs (see below) — that closed
the "my own buttons don't respond" half of this bug class. It left the
"taps leak through and dismiss the parent" half completely untouched,
which is exactly why the SAME portal-over-open-drawer architecture
produced a brand-new symptom one build later. Fixing an interaction class
means checking both directions an overlay can fail: can it RECEIVE input,
and can input LEAK PAST it to whatever's underneath.

The fix: `modal-guard.ts` exports `MODAL_GUARD_ATTR`
(`'data-cc-modal-guard'`), `modalGuardProps` (`{ [MODAL_GUARD_ATTR]: '' }`,
spread onto the outermost node of any `createPortal(..., document.body)`
overlay), and `guardInteractOutside(e)` (wired directly onto a Vaul
`Drawer.Content`'s `onPointerDownOutside` AND `onInteractOutside` —
`preventDefault()`s when `e.target` is inside a guarded root, telling
Radix "this outside tap was actually one of our own portaled modals, do
not dismiss"). Guard wired on ALL 26 `Drawer.Content` sites repo-wide
(confirmed by direct source count — every file that renders a raw
`<Drawer.Content>` now imports and wires it), plus the 6 body-portaled
overlays that needed `modalGuardProps` on their root: `night-detail-
sheet.tsx`'s `CancelConfirmModal`, `create-night-sheet.tsx`'s
`TimeEntrySheet` + `ConfirmOverlay`, `morning-after-sheet.tsx`'s
`WatchedMomentSheet`, `rate-on-watch-modal.tsx`, `v3/how-was-it-sheet.tsx`,
`v3/note-sheet.tsx`. Deliberately unmarked: `v3/review-react-overlay.tsx`
+ `fullscreen-text-input.tsx` render inline, not via `createPortal`, so
they were never in this bug class.

Orphan-proofing on top of the guard: `night-detail-sheet.tsx`'s
fetch-on-open effect now resets `showCancelConfirm`/`showAddCalendar`/
`showReschedule` in its `if (!nightId)` branch, so no child modal can
survive the parent sheet closing by ANY path (backdrop tap, `onClose`,
the swipe-back gesture) — not just the tap-through path the guard fixes.

`scripts/interaction-harness.mjs` grew from 17 to 30 literal step
assertions: a new tap-through audit opens the cancel confirm, then
real-clicks THREE distinct background points (top header area, mid-screen
away from the confirm card, and the exact position of the now-covered
"edit time & details" button), asserting after each click that the
confirm is still visible, the detail drawer is still `data-state="open"`,
and `document.elementFromPoint` at that coordinate resolves inside
`[data-cc-modal-guard]` — i.e. the click landed on the guard, not leaked
through it.

**New standing gate:** `scripts/audit-tests/55-modal-guard.test.ts` (also
new this session) enforces the invariant at the SOURCE level, no DOM/
emulator needed — it recursively scans `src/components/**` + `src/app/**`
and asserts (a) every `<Drawer.Content>` wires `guardInteractOutside` on
both `onPointerDownOutside` and `onInteractOutside`, (b) every real
`createPortal(` call site spreads `{...modalGuardProps}` on its root (an
allowlist exists for provable exceptions — currently empty), and (c)
`modal-guard.ts` itself keeps its contract (`MODAL_GUARD_ATTR` a plain
string, `modalGuardProps` derived from it not a second hardcoded copy,
`guardInteractOutside` still calls `preventDefault()`). Because it derives
its file list from a live scan rather than a fixed list, a new drawer or
portal added tomorrow is covered automatically — this suite would have
caught the 07-26 incident the day `CancelConfirmModal` shipped without
the guard.

**2 · Silent scan-result push bug, fixed (`src/lib/live-activity-server.ts`
+ `extraction-server.ts`, server-only).** Owner: "I am getting the
notification for getting the video but after the video has been
identified I ain't getting the same type of notification." Verified
against PROD Firestore: recent jobs all show `trace=end:ok` — the Live
Activity card WAS resolving correctly, just silently. Root cause:
`sendLiveActivityEnd` carried no `alert` field, while
`sendExtractionCompletionPush` deliberately suppresses the FCM ding
whenever a Live Activity card confirms (`'skipped_live_activity'`) — so
the card morphed on the lock screen with no banner and no sound, and
nothing else fired to tell the user. The START push always carried an
alert (ActivityKit push-to-start requires one), which is exactly why
"getting the video" arrived reliably and the result notification never
did.

Fix: `sendLiveActivityEnd` gained an optional 4th parameter
`alert?: { title: string; body: string }` — when present, the end push
becomes an ActivityKit ALERTING terminal update (`sound: 'default'` in
the payload), Apple's "order delivered" pattern: the card still morphs in
place, but a banner + sound fire too. The completion path in
`sendExtractionCompletionPush` now passes `{ title: 'cinechrony', body:
pushBodyFor(outcome, jobId) }` — the exact same deterministic,
seeded-per-job brand-voice copy the FCM fallback path already used, so
the message is identical regardless of which surface delivers it.

Deliberate product call, left in code comments for whoever revisits it:
the alert fires regardless of the `'watched'` (live-poller) state — only
the redundant FCM ding stays suppressed while the owner is actively
polling the drawer, because the Live Activity is a genuinely different
surface (lock screen / Dynamic Island) from whatever's open in-app. Flip
candidate if it reads as noisy once someone's watched it happen a few
times.

The late-arriving-token read-repair path
(`attachExtractionLiveActivityToken`, for when the app reports its
activity's update token AFTER the job already finished) also now carries
an alert, gated on a new `pushResult?: string` field stamped onto `JobDoc`:
if the completion push already ran and recorded `'sent'`, the late resolve
stays quiet (the user was already told); anything else (`'skipped_watched'`,
missing entirely, etc.) means nobody was told yet, so THIS late resolve
becomes the user's one alert. `pushResult` is stamped on every return path
of `sendExtractionCompletionPush` via a single-exit `finish()` helper,
awaited so the stamp is durable before the function resolves — it's also
useful standalone observability (a silent lock screen is now diagnosable
from the job doc alone). Double-buzz is closed by TWO independent guards
that don't depend on each other: the completion claim transaction stamps
`liveActivity.endedAt` (blocks the read-repair's own terminal branch from
re-firing), and separately the read-repair's `pushResult === 'sent'` check
blocks a redundant alert even if somehow both paths raced.
`push-server.ts` (the FCM fallback) needed no change — it already sets
`apns.payload.aps.sound: 'default'`.

Tests: suite 49 (live-activity) grew from 9 to 11 — new coverage for the
alert riding the end push (and staying absent when omitted), the terminal
test now asserts the alert shape + `pushResult` stamp, and the
live-watcher test now asserts the card still alerts even though the FCM
ding stays suppressed. Suite 44 gained a `pushResult` assertion on the
existing idempotency test (no new test count there). **This is a SERVER
fix** — it ships on the next Vercel deploy with no native build needed.

**3 · Movie Night — private nights + scan-to-plan continuity.** Two
Rodeo-inspired continuity fixes layered on top of v1.1 (`MOVIE-NIGHT-
PLAN.md` has the full tracker-level record; this is the working summary).

*Visibility.* The owner wanted an option where only invited people can see
a night. Worth recording as a correction to the initial framing: the
home-feed movie-night card was ALREADY invitee-only
(`getUpcomingMovieNights` queries `inviteeUids` array-contains) — the only
surface that leaked anything to non-invitees was the collaborative-list
PIN, and that pin was already redacted to film + date + counts by the
2026-07-24 adversarial review's roster-leak fix (`MOVIE-NIGHT-PLAN.md`'s
"Adversarial review pass" section). So "private" only ever needed to gate
that one pin. New
`NightDoc.visibility?: 'public' | 'private'` (a legacy doc with the field
absent reads as `'public'`, and is never backfilled — see the doc comment
on the new `MovieNightVisibility` type). `createMovieNight` validates
strictly: anything other than the literal string `'private'` (missing,
`'public'` explicitly, or garbage) stores `'public'`. `updateMovieNight`'s
`reschedule` action — the host's only other edit surface — takes
`visibility` as an OPTIONAL patch key, applied to the write only when the
caller actually sent it, so a plain reschedule (date/time only) can never
silently flip an existing private night back to public.
`getListMovieNight` returns `null` for a private night when the caller is
neither host nor invitee — the exact same shape as the night not existing
at all, no existence oracle. One tradeoff is documented directly in the
code: the list-night cache holds only the SOONEST `'proposed'` night per
list, so if that soonest night happens to be private, a LATER public
night on the same list is also hidden from non-invitees (this function
only ever looks at the one soonest doc). Judged acceptable — in practice a
list has one active night at a time. Guest capability links (`/n/[code]`)
are UNCHANGED on purpose: holding the share code IS the invitation,
independent of the list-pin's public/private state.

Host-facing UI (read from the actual diffs, not assumed): a "who can see
it" `Segmented` control (public/private) appears in the create sheet's
main body AND in the reschedule flow's `DateTimeSheet` — the latter is
opt-in on an `onVisibilityChange` prop specifically so the two surfaces
never render the control twice for the same flow. `RescheduleFlow`
initializes its local `visibility` state from the night's CURRENT value
every time the sheet opens (mirroring the existing date/time
initialization) and always sends it back on submit — never omitted from
that one caller — while the server-side "optional key" contract above
still protects any OTHER caller that reschedules without touching
visibility. The detail sheet renders a calm, mono, lock-icon "private ·
only the people invited" line under the night's date, shown only when
`night.visibility === 'private'` (public gets no badge — it's the
unremarkable default every night had before this field existed). Suite 53
grew from 20 to 28 tests, covering: default-to-public, explicit private,
garbage-value fallback, the host/invitee vs. non-invited/anonymous split
on `getListMovieNight`, the legacy-doc-has-no-field case, the
update-flips-visibility + cache-invalidation case, and the
plain-reschedule-never-resets-private case.

*Scan → save → plan.* Web `/extract`'s `SavedState` gained a secondary
"plan a movie night" button beneath the existing "scan another"/"view
lists" actions. The destination list is always prefilled (a save always
targets exactly one list; its real id — including a brand-new list's
freshly-minted id — rides back on the save response); the film is
prefilled only when exactly one film was saved (mirrors the create
sheet's own film-first prefill rule). A new `extractionFilmToNightFilm`
helper maps the already-fetched `ExtractionFilm` straight to
`MovieNightFilm` with no extra TMDB round-trip. The button is OMITTED
entirely (not rendered-but-disabled) whenever the destination list isn't
known — degrades away silently rather than ever rendering broken.

The native ShareExtension's done state got the same button. In Swift,
`ShareFlowModel.saveSucceeded` now zips the save response's per-item
results against the selected films (same order, one result per input
item) to capture `savedListId` / `savedListOwnerId` / `savedFilm` — real
identity only, never invented client-side. `canPlanNight` flips true only
once both a real list id and owner id are captured. The done-state
auto-close timer went from a flat 1.2s to 5s specifically when the button
is showing (people need real time to notice and tap a new button), and is
now cancellable via a tracked `autoCloseTask` (tapping "plan a movie
night" cancels the pending auto-close). `ShareViewController.openDeepLink(_:)`
was extracted out of the existing `openHostApp` method so the plan-night
button can reuse the same 2-attempt `NSExtensionContext.open` →
responder-chain fallback every other app-open path already needed (Apple
restricts opening the host app from a share extension; iOS 17+ forces the
deprecated single-arg `openURL:` to return false, so the fallback must
call the modern `openURL:options:completionHandler:` on a real
`UIApplication`).

Deep link contract: `cinechrony://plan-night?listOwnerId=<uid>&listId=
<id>[&tmdbId=<n>&mediaType=movie|tv]` (the film params are present only
when exactly one film was saved). `deep-link-handler.tsx` routes `host ===
'plan-night'` to `/lists/<listId>?owner=<uid>&planNight=1[&tmdbId&mediaType]`
— reusing the SAME `?owner=` convention the invite-acceptance flow already
established, rather than inventing a new one. `lists/[listId]/client.tsx`
carries a one-shot, ref-guarded effect (mirrors the existing
`settings?invite=1` auto-open pattern) that waits for REAL list +
permission data (`isOwner || isCollaborator` off actual Firestore reads,
not the optimistic seed) before calling `openCreate`, strips the query
params via `router.replace` so back-navigation can't re-trigger it, and —
when a film is present — fetches its details through the same
module-cached `getMovieOrTVDetails` every movie card already warms
(falling back to a list-only prefill if that fetch fails for any reason).
New PostHog event: `movie_night_plan_from_scan`.

The Swift changes were typechecked with a full `swiftc -typecheck` of the
ShareExtension source set against the real iOS 17 simulator SDK: zero
errors.

**Ticker verified live.** The `movie-nights-tick` GitHub Actions cron
(runs every 10 minutes, POSTs to the `ADMIN_SECRET`-gated
`/api/v1/admin/movie-nights-tick`) was confirmed via the GitHub API to be
firing on schedule and succeeding repeatedly through today. The
`ADMIN_SECRET` chain (Vercel env var + GitHub Actions repo secret) works
end to end — `MOVIE-NIGHT-PLAN.md`'s "REMAINING" owner-gate item for this
is now closed; that tracker has been updated accordingly.

**4 · Rodeo competitive research.** The owner asked to learn from
**Rodeo** ("Save it. Do it." — App Store id `6753013160`, bundle
`com.letsrodeo.saves`), built by ex-Hinge COO Sam Levy and ex-Hinge CPO
Tim MacGougan. $8.5M seed round (2026-03); **#1 on Apple's "Best New
Apps" while still in private beta**; ~20k beta users, 4.4 stars / 127
ratings, iPhone-only, invite-only. Their earlier, now-delisted app was an
RSVP/time-picking product — this one is a pivot.

**Key reframe:** Rodeo is NOT an events/RSVP app. It's "share a reel or
screenshot in → an LLM extracts the details → shared lists + agenda + map
+ reminders → actually go do it with friends" — structurally the SAME
hero loop as cinechrony's reel scanner, just aimed at places instead of
films. That structural match is what makes its patterns unusually
transplantable rather than merely inspirational.

**The wow is not animation.** No documented confetti, particles, or
signature haptics. It's total brand-voice commitment (one signature verb
— "wrangle" — used everywhere; statement taglines like "Save it. Do it."
and "Use the app less. See your friends more."; a Substack that doubles
as both changelog and community ritual; cowboy lexicon throughout) plus
the two-tap share loop and a week-before resurfacing nudge for saved
intent.

**Their weakness is our reported bug.** A real review: "I NEVER get
reminder notifications... defeats the whole point." — the same failure
mode item 2 above just fixed for us.

**Punch list, ranked by wow-per-effort, each mapped to a cinechrony
surface:**

1. Founder's personal welcome message to every beta tester (Rodeo texts
   each accepted user from "Sam at Rodeo"). Zero code, highest loyalty
   per minute of anything on this list.
2. Statement-style App Store screenshots: real UI in a black frame, giant
   display type, one italic word, a 3D emoji finger pointing at the money
   moment. Rodeo literally teaches the share extension in its store
   listing. We already have the capture script
   (`scripts/appstore-screenshots.tmp.mjs`); this is a compositing pass,
   not new infrastructure. Also tracked in `APP-STORE-SUBMISSION.md`.
3. One signature verb + statement taglines, carried consistently across
   subtitle, onboarding, empty states, and push copy.
4. Celebrate the calendar tap — we already built the harder native sheet
   (build 5's CalendarBridge): make it a first-class action with a
   success haptic + toast, and brag about it in onboarding/screenshots.
5. A guided first scan in onboarding, ending on an "open Instagram, share
   to cinechrony" card — the existing reveal choreography becomes the
   onboarding climax instead of something a user might never see.
6. A "you both want to watch it" overlap push: when a friend saves or
   rates a film already on your list, deep-link into movie-night create
   with the film + that friend prefilled as invitee. The data is already
   denormalized on list-movie docs — this is the single best available
   RSVP-funnel feeder on the list.
7. Reactions on shared-list films ("tonight / someday / nah") feeding the
   night's suggested pick — turns a list from storage into a decision
   engine.
8. A week-before resurfacing nudge, riding the existing GH Actions ticker.
9. A "trending from reels" rail aggregated from `extraction_cache`
   (anonymous counts, TTL-cached, quota-safe — no new reads per user).
10. Time-ago chips + a "new" rail of recent scans (socialLink thumbnails
    are already stored, no new data needed).
11. Pin a list to the top of the ShareExtension's list picker.
12. "Join" mechanics + member avatars on public lists (the verified-badge
    infra already exists to build on).
13. Screenshot scanning — our Gemini pipeline already handles
    `kind: 'images'`, this is a UI entry point, not new AI work.
14. Three invite codes per user at App Store launch — explicitly NOT
    Rodeo's own opaque waitlist mechanic, whose 1-star reviews read "bait
    and switch."

Sources + four downloaded Rodeo screenshots are in that session's
scratchpad (not committed, not copied into this repo):
`rodeo-ss-{38,42,43,46}.jpg` + `rodeo-appstore.html`. Owner note: only 2 of
the 8 Rodeo screenshots the owner referenced actually arrived in the
message; the rest were never received, so this research is based on what
did land plus the App Store listing + public reviews.

---

## TestFlight liftoff — build 1 uploaded, beta review submitted (2026-07-20 → 21)

The owner hit Phase 2 of the playbook and asked "can't you do this on your
own?" — the answer was yes for nearly everything. The whole TestFlight
pipeline now runs from the terminal; the Xcode GUI is out of the loop, and
"ship a new build" is a one-liner request from here on. ⚠ **Corrected
2026-07-26:** a one-liner to ASK for, but a five-step pipeline to RUN —
the `betaAppReviewSubmissions` POST is mandatory or external testers never
see the build. See "Gates, distribution, and one bad subagent" above.

**CLI archive + upload.** Fresh `build:static` + `cap sync ios` first (the
frozen-snapshot rule), then `xcodebuild … -scheme App -destination
'generic/platform=iOS' archive -allowProvisioningUpdates` and `xcodebuild
-exportArchive` with an ExportOptions.plist of `method: app-store-connect ·
destination: upload · signingStyle: automatic · teamID: GBR6GTFYCL ·
manageAppVersionAndBuildNumber: true`. Upload auth rides Xcode's signed-in
session. **`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` is
REQUIRED** — xcode-select on this Mac points at CommandLineTools and every
bare `xcodebuild` fails without it.

**ITMS-90362 — the one real find (`e680559`).** Upload #1 was rejected by
Apple's package analysis: the ShareExtension's `NSExtensionActivationRule`
was still `TRUEPREDICATE`, the development-era wildcard every cable build
tolerates and App Store distribution never accepts. Fixed to the dictionary
form (`SupportsWebURLWithMaxCount: 1` + `SupportsText: true` — exactly what
`ShareViewController` ingests: a URL attachment or text carrying a link).
Suite 51 now guards the class (no `<string>TRUEPREDICATE` value + the dict
keys present — the guard regexes around the plist COMMENT that names the
literal). Upload #2 accepted; the build processed to VALID within the hour.
Tests **524/524**. Side effect worth knowing: the share sheet now offers
Cinechrony on URL/text shares specifically, not on everything.

**ASC API automation (the key that unlocked phases 3–6).** The owner
generated a team API key (role App Manager): `AuthKey_S3DLZRLGPZ.p8` lives
at `~/.appstoreconnect/private_keys/` (OUTSIDE the repo, always), issuer id
`ce940602-7ac5-40d9-b778-00fcbfe4d622`. **`scripts/asc-api.tmp.mjs`**
(untracked, repo tmp convention) is the generic caller — `node
scripts/asc-api.tmp.mjs GET|POST|PATCH <path> [json-body]` — minting a
fresh ES256 JWT per call via the repo's own `jsonwebtoken`. Everything
below was done through it:

- **App record** — the ONE step Apple's API cannot do (browser only; owner
  created it): Cinechrony, app id **`6792422740`**, bundle
  `com.cinechrony.app`, SKU `cinechrony-ios`.
- **Build 1.0 (1)** — id `d4661455-4128-491e-99a8-bea644a273c1`, VALID.
- **Test Information** (betaAppLocalization `e6fb0029…`): beta description,
  feedback email **support@cinechrony.com**, marketing + privacy URLs; plus
  a `whatsNew` note on the build itself.
- **`internal` group** (`d9009179…`) with `hasAccessToAllBuilds: true` —
  every future upload flows to it automatically, no attach step ever.
  Tester `rayid.awesome@gmail.com` state INVITED (owner installs TestFlight
  → accepts → first OTA install).
- **`friends` group** (external, `4bfbd788…`): build 1 attached, public
  link **https://testflight.apple.com/join/CRPFhKen** with
  `publicLinkLimit: 150` — inert until beta review passes, so it can't
  leak early.
- **Beta review details**: contact Rayid Ali / rayid@cinechrony.com / phone
  on file; demo account credentials; reviewer notes explaining the sign-in
  and the share-a-reel hero flow. Submission filed 2026-07-20 20:56 PT;
  **APPROVED 2026-07-21 (~7h turnaround)** — only the FIRST build of an app
  needs this review; later builds usually go straight through. The public
  link is therefore LIVE and installable (still capped at 150).

**Demo account (prod, for Apple's reviewers).** `demo@cinechrony.com` /
`@cinechronydemo` (uid `e3TLo4EKNjTaCVzHcHdWzsXSez53`) — provisioned via
the app's OWN onboarding helpers (`createUserProfileWithUsername`,
`createList`, `addMovieToList`), so it is indistinguishable from a real
signup: default watchlist + a public "movie night" list with three films.
Idempotent script: `scripts/create-demo-account.tmp.ts` (untracked). The
password lives in that script and in ASC review details — deliberately NOT
in this committed file.

**Emails — the corrected rule (2026-07-20).** Cinechrony contact fields use
**rayid@cinechrony.com** (owner/business) and **support@cinechrony.com**
(user-facing). `raheelalimasood@gmail.com` is an Apple ID from Xcode's
signing logs — the owner said remove/ignore it everywhere (it briefly
landed in the TestFlight feedback-email field; fixed same hour).
`rayid.awesome@gmail.com` is the ASC team-user login — correct ONLY inside
ASC team/tester contexts, never as a public contact.

**Distribution strategy (owner conversation, 07-21).** The owner expected a
one-tap tester install and learned that every TestFlight tester must first
install Apple's TestFlight app — Apple's rule, no native-beta alternative
(ad-hoc is strictly worse). Framing agreed: the beta is for the tolerant
inner circle ("join the iOS beta" on the website is standard indie
practice — Apple's join page itself walks users through the two installs;
soft marketing only), and **the App Store is the true one-tap channel and
the explicit target** — short beta bake, then submit, optionally
quiet/unlisted at first. App Store prep (screenshots, listing copy, age
rating, privacy nutrition labels) is largely Claude-doable, much of it via
the same API; the owner-only gates are **EU trader status** in ASC and
**Blaze**.

**ASC API gotchas (learned the 4xx way):**
- Internal beta groups accept ASC TEAM USERS only — POSTing an arbitrary
  email to betaTesters for an internal group → 409 "Tester(s) cannot be
  assigned". Find the team roster via `GET /v1/users`.
- `contactPhone` is REQUIRED on betaAppReviewDetails — the PATCH 409s
  without it and discards the whole attribute set.
- The betaBuildLocalizations attribute is **`whatsNew`** now — `whatToTest`
  no longer exists (409 ENTITY_ERROR.ATTRIBUTE.UNKNOWN).
- Listing betaAppReviewSubmissions requires `filter[build]` — poll the
  direct resource `GET /v1/betaAppReviewSubmissions/<buildId>` instead.
- App records cannot be created via the API. Period.
- macOS TCC blocks the harness shell from `~/Downloads` even unsandboxed —
  have the owner drag downloaded files to the Desktop (readable) instead.

---

## The native launch stretch (2026-07-10 → 18)

Five arcs, all on `main`, all device- or prod-verified. `CLAUDE.md` "Current
state" has the full per-arc detail; this is the working summary + the gotchas
worth carrying.

**1 · Share extension (07-13, tip `34bd93e`→`1504dfc`).** Share a reel from
IG/TikTok → a SwiftUI drawer scans IN PLACE (never opens the app on the happy
path): narrated stages → film toggles with confidence chips → pick/create
list → save. Auth rides a keychain bridge (`SharedAuthPlugin` syncs
`{refreshToken, apiKey, uid}` to the shared keychain group; the extension
mints its own ID tokens via securetoken). Server: completion push with
`pushSentAt` guard + live-watcher suppression, `/extract?jobId=` resume,
`GET /api/v1/lists`. Same night: Gemini retired its whole 2.x chain mid-test
— defaults now `gemini-3.5-flash` + rolling `-latest` aliases appended to
EVERY fallback chain so a retired pin can never zero the pipeline again.

**2 · Live Activity (07-13→14, `563b34f`→`988ae10`).** The lock-screen /
Dynamic Island card that narrates the scan. Server births the activity via
APNs push-to-start (extensions can't; HTTP/2 + ES256 JWT in
`live-activity-server.ts`; sandbox/prod discovered per token). Two rotating
tokens ferried by BOTH a JS path and `LiveActivityTokenRelay.swift` (pure
Swift, runs from `didFinishLaunching` even on background launches). THE bug:
enumerating `Activity.activities` before subscribing `activityUpdates`
misses an activity that registers in between — subscribe FIRST, then delayed
re-sweeps, `@MainActor` dedup, ~25s background-task hold. Every link
self-reports into `liveActivity.trace` on the job doc, so prod forensics
name their own failure. A confirmed card SUPPRESSES the FCM ding; outcome
pushes stay as the fallback ladder for decliners of Apple's one-time
"Always Allow" prompt.

**3 · Extraction excellence (07-14).** Footage-primacy prompt (media is
ground truth, caption is context; code-level clamps cap caption-only
evidence at 0.6) — kills the Inglourious-Basterds-caption bug. Image posts
(`kind:'images'`: IG carousels, TikTok slideshows, raw
`imagePost.imageURL.urlList` shape) live-verified in prod. >18MB videos go
through the Gemini Files API instead of silently degrading to captions.
Weak reads get ONE pro-tier escalation (`gemini-pro-latest`) inside a 75s
elapsed budget; every Gemini call hard-aborts at 110s. The drawer reveals
films one by one (spring + per-film haptic, count-up header) with rotating
anticipation lines. Mux was evaluated and rejected (playback analytics, not
content ID).

**4 · The theatre sweep (07-18, `8feb71c`+`d77926c`+`ea56598`).** Owner hit
three bugs at the movies; each was a class: (a) "take photo" crashed the
app → `Info.plist` had ZERO privacy usage descriptions (iOS TCC kill) —
camera/mic/photo-add/photo-read added; (b) the invite search header sat
under the status bar → `pt-safe`, plus sweep-found siblings
(fullscreen-text-input header, find-friends back button, app-wide
ToastViewport); (c) one shared invite spinner → keyed per row. The push
audit found and fixed: pushes without `data.url` were DEAD TAPS on iOS
(fan-out now defaults to `/notifications`, per-type deep links added),
createList invitees never got pushed, list_like never pushed, post_comment
had no pref, and **blocks didn't suppress pushes** (creation-time guards
now). NEW: `invite_accepted` push to the inviter; a dashed "+" on the list
page collaborator row deep-links into the invite flow. The v1 "tap any
poster" hint is deleted. `51-native-shell.test.ts` codifies every
native-shell incident class in CI.

**5 · TestFlight prep (07-18).** Readiness verified against the repo and
live services: popcorn icon at 1024, versions 1.0(1) on all three targets,
export compliance declared, privacy URL live, `app.cinechrony.com` already
in Firebase authorizedDomains AND the applinks entitlement. Owner playbook
(checklist artifact, phases 0–7):
https://claude.ai/code/artifact/349e207e-3490-4dfa-bcf9-f41b918927ed
The domain move is ADDITIVE (movienight-kappa.vercel.app stays attached to
the same Vercel project forever — existing PWA installs and old native
builds keep working; accounts live in Firebase, not the domain).

**Gotchas worth carrying:**
- Run the **App** scheme, never ScanActivityWidget (launch/archive trap).
- Piping `xcodebuild` through `tail` eats BUILD FAILED (exit 0) — redirect
  full logs to a file and check `$?` + grep.
- Files in `ios/App/App/` need explicit pbxproj Sources entries (the App
  target is NOT a file-system-synchronized group); extension/widget targets
  ARE synchronized. Suite 51 guards the known set.
- `FirebaseApp.app() == nil` probes EMIT the I-COR000003 warning — keep
  `configure()` unconditional.
- The iOS app is a FROZEN `out/` snapshot: `npm run build:static && npx cap
  sync ios` after every native-affecting change.

---

## Analytics + observability + native UX (2026-07-04 → 07)

Three threads landed on `main` after the extraction pass.

**Observability + analytics (now live).**
- **Sentry** was wired earlier (client + server + Capacitor WebView, DSN-gated).
  The **DSN is now set in Vercel env**, so error monitoring is live in prod.
- **PostHog** wired manually — the same DSN-gated, hybrid-safe way as Sentry, so
  it's a no-op until keyed and works in both the PWA and the WebView.
  `src/components/posthog-provider.tsx` (init + `$pageview` on route change +
  identify-by-uid, reset on logout) + `src/lib/analytics.ts` (safe `track()`
  wrapper). Minimal named taxonomy (LAUNCH D.0.5) at real success points:
  `app_opened`, `signup_completed`, `movie_added`, `list_created`,
  `extraction_started/succeeded/saved`. Autocapture on; **session replay OFF** by
  default (flip it on in the PostHog project settings). person profiles
  identified-only; **no PII** in event props. Owner set
  `NEXT_PUBLIC_POSTHOG_KEY` (the `phc_` **Project token**, NOT a Personal API key)
  + `NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com` in Vercel; **verified the
  key baked into the live prod bundle** (NEXT_PUBLIC_* inline at BUILD time → a
  redeploy is required after adding one).
- **`/support`** page added (App Store requires a support URL); **`/privacy`**
  updated to honestly disclose PostHog + Sentry + the Phase C processors
  (**Apify + Google/Gemini**, transient processing) — closes LAUNCH D.0.3/0.4.
- **`.env.example`** added at repo root — documents every env var the app reads
  (names + comments, no secrets), grouped by concern.
- LAUNCH **D.0.2 (Sentry) · D.0.3 (contact email) · D.0.4 (privacy processors) ·
  D.0.5 (analytics) · D.0.6 (CI)** all marked done.

**Marketing website — DONE** (separate repo + session, per `WEBSITE-HANDOFF.md`).
`cinechrony.com/{privacy,terms,support}` are live; use those exact URLs in App
Store Connect. **Blaze intentionally deferred** until user volume justifies it.

**iOS-native UX fixes (commit `c84189e`).** The owner tested the Xcode build and
found the bottom-nav flicker + "other fixes" still present. **Root cause: the
iOS app runs a FROZEN `out/` snapshot** — their bundle was 8 days stale
(pre-dating the whole optimization session). The web auto-deploys from git; the
native app only changes on `cap sync`. Fixed by a rebuild + resync; then a
parallel audit + two reported bugs produced these fixes:
- **create-list keyboard trap** — `new-list-drawer` pinned itself to the
  keyboard-shrunk viewport with a static bottom pad, so the autoFocused name
  field raised the keyboard and buried visibility/collaborators with nothing to
  scroll. Converted to the proven **full-screen (`inset-0`) + growing
  keyboard-inset** body pattern (as in `how-was-it-sheet` / `note-sheet`).
- **content started too low** — `capacitor.config.ts` `ios.contentInset`
  `'automatic'` → **`'never'`**. `automatic` inset the WKWebView for the notch ON
  TOP OF the app's own CSS `env(safe-area-inset-*)` insets → ~2× top gap. The app
  owns insets via `viewport-fit:cover`, so `never` is correct. (A native config
  change → **needs `cap sync`** to take effect; verified baked into
  `ios/App/App/capacitor.config.json`.)
- **audit follow-ups** — added top safe-area to `/privacy` · `/terms` · `/support`
  + the landing theme-toggle (would've clipped the notch under `contentInset:never`);
  FAB now tracks `env(safe-area-inset-bottom)` (was overlapping the inset nav);
  keyboard-inset tracking added to `edit-profile-sheet`, `fullscreen-text-input`
  (multiline; backs the drawer note editor + review composer), and
  `add-movie-modal` (per-list note); `movie-drawer` scroll body got
  home-indicator bottom clearance. `post-composer` uses the vv-pinned pattern too
  but has no autoFocus → not broken → left as-is.

> **⚠ Native rebuild rule (learned the hard way):** after ANY code or
> `capacitor.config.ts` change the owner will verify on the phone, run
> `NEXT_PUBLIC_API_BASE_URL=https://movienight-kappa.vercel.app npm run
> build:static && npx cap sync ios`, then rebuild in Xcode (▶). Pushing to `main`
> only updates web.

---

## iOS native bring-up — first Simulator run (2026-06-27)

The Capacitor iOS app was run on the Simulator for the first time (Xcode + a free
Apple ID — no $99 account needed for the Simulator). Everything the owner needs
to do this is: `NEXT_PUBLIC_API_BASE_URL=https://movienight-kappa.vercel.app npm
run build:static && npx cap sync ios`, then open `ios/App/App.xcodeproj` and ▶.
Debug native JS via **Safari → Develop → Simulator → the WebView console**.
(`movienight-kappa.vercel.app` is the live prod origin — the `cinechrony.com`
switch is still pending.)

**Five WebView-only blockers were found + fixed** (web/PWA unaffected — every fix
is native-only or a web no-op). On branch `fix/capacitor-ios-runtime`:

1. **Launch crash — missing `GoogleService-Info.plist`.** Registered an iOS app
   (`com.cinechrony.app`, appId `1:874447489066:ios:b821c1449c54df00dedb53`) in
   Firebase project `studio-2541484065-75c27` via the Management API (owner ran
   the one-off script). Plist lives at `ios/App/App/GoogleService-Info.plist`,
   wired into `project.pbxproj`, and is **gitignored** (it's a public client
   identifier, not a secret — GitHub secret-scanning flags it, so it's kept out
   of the repo; data is guarded by Firestore rules). _Committed._
2. **Stuck on splash spinner.** `getAuth()` hangs in a WKWebView (awaits a
   popup/redirect-resolver iframe that never settles → `onAuthStateChanged` never
   fires). Fix in `src/firebase/index.ts::resolveAuth()`: native uses
   `initializeAuth(app, { persistence: indexedDBLocalPersistence })` (no
   resolver; native sign-in uses the @capacitor-firebase plugin); web keeps
   `getAuth()`. _Committed._
3. **Profile/lists/feed all empty despite being logged in.** Firestore's default
   streaming WebChannel transport can't connect in WKWebView (a raw REST GET of
   the same doc returns 200 — proving transport, not rules/auth). Fix in
   `resolveFirestore()`: `experimentalForceLongPolling: true` on native only.
   _Committed._
4. **Every detail screen crashed** ("failed provisional navigation: index.txt").
   Static export ships one `_` placeholder shell per dynamic route, so
   `/lists/<realId>` has no file; Next fetches its RSC `.txt`, 404s, hard-navs,
   WKWebView can't find it. Fix: **`src/lib/native-nav.ts`** — a web-noop shim
   overriding `useRouter`/`useParams` + a patched `Link`. On native it routes to
   the shell (`/lists/_`) carrying ids in the query and resolves `_` params back
   from the query. ~28 client files swapped import source
   (`next/navigation`→`@/lib/native-nav`, `next/link`→`{ Link }`). Covers all 7
   dynamic routes. _Committed (initial) + blanket `next/link` swap uncommitted._
5. **No Radix popup menu opened in the WebView** (theme toggle, avatar menu,
   profile list-options, list view/sort, movie-drawer actions, the add-page list
   Select). Radix poppers open on `pointerdown`, which WKWebView doesn't deliver
   in a way Radix accepts (a plain `onClick` still fires — which is why the haptic
   worked but the menu never appeared). Fix: **`src/components/ui/sheet-menu.tsx`**
   — a Vaul bottom-sheet `SheetMenu`/`SheetMenuItem`/`SheetMenuLabel` opened by a
   plain `onClick` (Vaul is proven to work natively throughout the app). All 6
   Radix menus converted. _Uncommitted._

**Also fixed (uncommitted):** invite-link + card-overflow share/copy URLs used
`window.location.origin` (→ a dead `capacitor://localhost/...` link); now use
`shareOrigin()` (resolves to the real prod origin even on native).

**Known-minor / still open on native:**
- **CLEAR-rating** reported as "doesn't work" — under investigation; the code path
  looks correct (DELETE route exists, cache clears, `DragToRate` resets), so
  awaiting exact behavior (does the number → "–"? a revert toast? — vs. the
  separate "your history" watch snapshot being mistaken for the rating).
- `WEBP initImage failed err=-50` decode warnings (cosmetic; some WebP images).
- FCM "No APNS token" + "WebKit Media Playback assertion" errors are **expected
  Simulator noise** (push needs a real device + APNs; media-playback needs an
  entitlement the Simulator lacks).
- **App icon** is still the Capacitor default (`assets/icon.png` missing → run
  `npm run cap:assets` once a 1024×1024 logo is dropped in).
- Native Google/Apple sign-in needs the REVERSED_CLIENT_ID URL scheme in
  Info.plist (only if testing social login on device; email/password works).

See memory `project_capacitor_ios_runtime_fixes.md` for the cold-resume version.

---

## TL;DR — where things stand

**Phases A, B, 0.5, AND 0.7 are all merged to `main`** (A+B via PR #88 tip
`9c81360`; **Phase 0.7 merged 2026-06-23, merge `e26871c`**). `src/app/actions.ts`
is **deleted** — server logic lives in `src/lib/<domain>-server.ts` behind
`/api/v1/**` route handlers. Capacitor 8 wraps the static `out/` bundle in
native iOS + Android shells (`ios/` + `android/`).

**Phase 0.7 — v3 iOS-native redesign: COMPLETE.** The entire app is v3 (no v2
surfaces left); native motion (haptics + push/pop transitions + app-wide
swipe-back) ships; the **share-to-Instagram-story** feature (9:16 card renderer +
share sheet + send-to-a-friend) and **share-link OpenGraph/Twitter cards** ship.
Firestore rules + indexes deployed to `studio-2541484065-75c27` (2026-06-23).
Tracker: **`PHASE-0.7-REDESIGN.md`**.

**Post-0.7 launch-prep (also on `main`, 2026-06-23):**
- **Verified / official accounts** — `users/{uid}.verified` flag + `{verified,admin}`
  custom claim, granted by `scripts/grant-verified.ts`; rules block self-verify;
  `GET /api/v1/verified` + `UserVerifiedCacheProvider` → `<VerifiedBadge>` app-wide.
  **`@cinechrony` is granted.** Verified-owner lists (≥5 films + cover, cap 3) are
  featured at the front of the community rail.
- **Story-share polish** — real popcorn logo on the cards, a new `kind:'post'`
  variant (recreates a feed post, with its real media as a hero), send-to-a-friend,
  `CARD_VERSION` cache-buster.
- **Fixes** — ⋯ overflow menu → v3 fonts; toggle-knob overflow (settings +
  list-settings); **self-healing real-time hooks** (`useDoc`/`useCollection` now
  re-subscribe on listener death so profile/lists no longer go blank-until-restart).
- **Admin scripts** — `grant-verified.ts`, `set-display-name.ts` (Admin SDK, `npx tsx`).

**Branded transactional email — Resend (2026-06-23, on `main`):** forgot-password
emails are now branded (popcorn logo + film-red CTA, cross-client table HTML) and
sent via **Resend** from `noreply@cinechrony.com` (the verified domain).
`src/lib/email-server.ts` + **`POST /api/v1/auth/forgot-password`** (mints the
secure link with Firebase Admin `generatePasswordResetLink`, emails it via Resend;
60s per-email throttle + AUDIT 2.10 non-disclosure). **Graceful fallback** to
Firebase's own reset email if `RESEND_API_KEY` is unset or the route is unreachable.
Firebase custom action URL already verified → `movienight-kappa.vercel.app/reset-password`
(no Console change). Owner: redeploy Vercel (picks up the key) + test. The module
also supports a future welcome-on-signup email.

**Website sequencing — DECISION (2026-06-24):** making `cinechrony.com`
"professional" is **not a blocker** for the next steps — *thin slice first, full
marketing site later*. Must-do-before-TestFlight: (1) point `cinechrony.com` →
Vercel and make it the single prod origin (kills the `movienight-kappa` vs
`cinechrony.vercel.app` discrepancy that iOS auth / Universal Links / AASA depend
on); (2) minimal `/privacy` + `/support` pages (App Store Connect **requires** a
privacy-policy URL + support URL to submit). The polished landing page (hero, real
App Store screenshots + badge, feature sections) is built **during the TestFlight
beta** — it gates public launch, not the beta.

The only deferred 0.7 item is the OPTIONAL direct-to-IG pasteboard plugin
(0.7.6.2/3, native Swift — the share-sheet path already satisfies the design).
**Next: the thin website slice → then Phase C — iOS Share Extension** (`LAUNCH.md`
§C; plan in `PHASE-C-PLAN.md`).

**What's done in 0.7 so far:**
- **Foundation primitives** — `Frost`, `GlassBtn`, `Segmented`, `NavBar`,
  `Hero`, `ListTile`, `RecentRow`, `Fab` (v3 universal kit).
- **Lists tab** (0.7.3.3) + **List detail** (0.7.3.4) restyled.
- **Profile tab family COMPLETE** (0.7.3.5 → 0.7.3.5g): photo-as-hero ·
  `films · lists · activity` tabs · `EditProfileSheet` · `TopFivePicker`
  (drag-to-rank) · `PeopleSheet` (your-people followers/following) ·
  canonical share URL. Public + own profile both done.
- **Motion slice 1 — haptics** (0.7.2): `@capacitor/haptics@8` +
  `src/lib/haptics.ts`, wired through the shared primitives.
- **Search** (0.7.3.6): home search overlay → discover (recs / vibes / now &
  next) + results (people-first), client-direct TMDB.
- **Home / feed — FULL revamp** (0.7.3.1, recomposed to `ios-home.jsx` in four
  passes a/b + R1/R2; the home is now the design composition, not a restyle):
  - **`font-ui` foundation** (a) — iOS system-sans (`F_UI`) added to Tailwind;
    fixes the serif-italic search placeholder. New `Section` primitive.
  - **Shell** (a) — frosted scroll-collapsing top bar (`for you · friends`
    underline tabs + bell + avatar; `saved` dropped, archive → "you" later) ·
    search + red `scan` · **icon-only red pencil FAB** (`Fab` round variant) ·
    presence pill (real friends-watching count).
  - **Discovery rails** (R1, 2026-06-15) — the design middle, real data, each
    hides when empty: **dig in** (`dig-in.tsx`, 4 client-direct TMDB category
    shelves as fanned 3-poster collages) · **top watchers** (`top-watchers.tsx`,
    weekly leaderboard) · **featured** (`featured-carousel.tsx`, loved-lists
    hero) · **from the community** (`community-lists.tsx`, loved-lists tiles).
    `TrendingStrip` retired. **New API `GET /api/v1/leaderboard`**
    (`leaderboard-server.ts`). `seededGradient()` helper.
  - **The reel** (b + R2) — `PostCard` → **`DiaryEntry`** (serif caption ·
    `MovieCell` w/ `+`→add-to-list · `MediaGallery` hero+rail ·
    heart/comment/share/bookmark); now a **borderless diary stream**
    (`DiaryEntry` + `ActivityCard` lost the card chrome; `divide-y divide-hair`
    between entries) with the inline **"because you liked X"** poster row
    (`RecommendationCard`, punched rating stickers). All handlers preserved.
  - **Deferred (honest, no fake):** fav/kicker label, video duration,
    movie-cell rating chip, **hot-take cards** (need a `/api/v1/reviews/
    highlights` selection rule, 0.7.5), and the **F15–F18 "view all" detail
    screens** (dig-in grid / full leaderboard / community browse / post thread).

**Since this handoff (2026-06-14 → 2026-06-17):**
- **Wave 1** (rail detail screens F15/F16/F17) ✅ and **Wave 2** (movie-drawer
  cluster — unified `MovieDrawer`, `drag-to-rate`, `how-was-it-sheet`,
  `/users/{uid}/watches` watch-log) ✅ merged on `feat/v3-redesign`.
- **Wave 3** (create-a-post F04 + post-thread F21 + reel F22) ✅ — composer
  (`post-composer.tsx`, film-optional / **text-required**), picker sheets
  (`film-picker`/`tag-friends`/`watched-on`/`visible-to`), the post-audience
  model (`canViewPost`, server-only `/closeFriends/{uid}`), X-style thread,
  forced-dark IG `reel-viewer.tsx`.
- **Theme + profile polish (2026-06-17):** light/dark/system is now a **visible**
  top-right toggle on **every tab** (`ThemeToggle` `default` + `glass` variants;
  home/lists bars + profile hero) + Settings → Appearance + shared
  `DEFAULT_THEME`. `RecentRow` + `EditProfileSheet` brought up to the v3 sizing
  standard.
- **Hot-take card (0.7.5.4, 2026-06-17):** the green quote card is now built —
  `GET /api/v1/reviews/highlights` (`getReviewHighlights`, a global 30-min-cached
  index-free pool of short high-rated top-level reviews; per-caller own/block
  filter; `softFallback: []`; empty hides it) + `HotTakeCard` interleaved into
  the reel (leads, then every 8; for-you only). Tests: `46-review-highlights`.
  The **home + feed are fully composed** (a 2026-06-17 sizing pass: search row
  h-12, post movie-cell poster 48×72, leaderboard "view all" + profile top-5).
- **Reviews wall — Wave 4 F07 done (2026-06-18):** `/movie/[tmdbId]/comments`
  rebuilt as the F12–F15 reviews wall (score + loved/liked/fine/nope distribution +
  reactions + composer + long-press actions + reply mode). New: `reactions` map +
  `POST/DELETE /api/v1/reviews/[id]/react`; `getReviewsWall` + `GET
  /api/v1/movies/[tmdbId]/reviews-wall`. Tests: `47-reviews-wall-react`.
- **Public list-detail convergence (0.7.3.4b, 2026-06-17):** the read-only public
  list (`/profile/[username]/lists/[listId]`) was a v2 fork; now it renders the
  SAME `Hero` + `ListHeader` + `MovieList` as the owner list. One shared
  **`movie-cell.tsx`** (grid + row) powers both — anon-safe, `canEdit`-gated,
  viewer-rating, v3-sized; `MovieList` gained a **`publicReadOnly`** mode (standalone
  drawer, notes hidden = collaborators-only). **Retired the legacy "cards" view**
  (`movie-card.tsx`) and deleted the `movie-card-grid/list` + `public-movie-grid/
  list-item` + `list-controls` forks (**net −1,144 lines**). Fixed a `canEdit`
  affordance leak, PTR-under-drawer, ListHeader anon spinner, public double-fetch,
  empty-poster crash, settings cover a11y, and owner-avatar duplication. Reviewed
  by a 5-reader audit + 3-dimension adversarial workflow. audit 460/460.
- **Drawer ambient hero (2026-06-17):** the movie-drawer hero now crossfades TMDB
  stills (Ken Burns) into a **muted, looped YouTube trailer with no visible YT
  chrome** (`v3/hero-video.tsx` — reveal after the start overlay clears, loop the
  middle ~60s behind the stills). reduced-motion-gated.
- **Reconciled remaining UI/UX (see `PHASE-0.7-REDESIGN.md` § "Status snapshot"):**
  ALL core surfaces are v3 done — home · search · lists (owner + **public**) ·
  profile · movie drawer · create-post/thread/reel · reviews wall · data rails.
  Remaining: the **Wave 7 outer cluster** (onboarding · auth · settings ·
  notifications · invite · add · list-settings), native motion (push/pop + app-wide
  swipe-back), and story-share. Fast-follows: "add a still" on a review · presence-
  pill wording · editable handle · rich share/OG cards.

**Verification (every 0.7 PR):** typecheck clean · `npm run build` (Vercel)
clean · `npm run build:static` (Capacitor) clean · audit suite stays green
(403/403). It's a presentational refactor — must not regress logic. (Home
a/b/R1/R2 each shipped all four green.)

**Capacitor / new-API note (owner asked):** the home needed exactly **one** new
endpoint — `GET /api/v1/leaderboard` (built, standard `/api/v1` + CORS pattern →
Capacitor-ready). Everything else reuses existing routes + client-direct TMDB.
The upcoming screens (F01/F02 movie drawer, "how was it?", composer, F15/F17/F18)
mostly reuse existing routes; the genuinely new ones still ahead are the **dig-in
category** query (F15 detail) and **`/api/v1/reviews/highlights`** (hot-takes).

**Next in 0.7 — Waves 1–6 are all DONE** (interaction surfaces: rail detail
screens, movie-drawer cluster + watch-log, create-a-post, threads + reviews wall,
reel·player, data-rail finish). **What's left in 0.7:**
- **Wave 7 — onboarding · auth · settings · notifications · invite · add ·
  list-settings** (the only un-restyled cluster; more onboarding screens incoming).
- **Native motion slice 2** — page push/pop transitions (0.7.2.2) + app-wide
  edge-swipe-back (0.7.2.4; today only on `/comments`).
- **Story-share** (0.7.4 card renderer + `@capacitor/share`) → **direct-to-IG**
  (0.7.6, Meta App ID already created).
Then → **Phase C — the iOS Share Extension** (the hero feature). Full plan +
screen catalog + tests in `PHASE-0.7-REDESIGN.md` § "0.7.3.2+ — Interaction surfaces".

**⚠ Free-tier Firestore is now a hard constraint (no Blaze — owner has no
budget until there's revenue).** Locked decision 4 in the tracker: build
quota-first (client-direct TMDB · `server-cache.ts` TTL caches · route
`softFallback` graceful degradation · lazy-load detail data on tap · no per-item
N+1 social-proof reads). The quota-hardening pass already landed
(`src/lib/server-cache.ts` + `softFallback` on 13 read routes; the 4 heavy home
rails cached). **The home feed is now posts-only** (rated/reviewed dropped from
`getHomeFeed`); captions are Bricolage (`font-headline`); **preview deployments
now call their OWN API** (api-client same-origin + SSO-cookie credentials) so
server changes are testable on a preview.

**Two owner actions pending from the profile work:**
- `firebase deploy --only firestore:indexes --project studio-2541484065-75c27`
  — the new `(activities: userId ASC, createdAt DESC)` composite index, or
  the profile recent/activity sections stay empty (they degrade quietly).
- `npx cap sync` — so the native build picks up `@capacitor/haptics`.

---

## Phase C — AI "share a video → extract films" (web-first MERGED, 2026-06-28)

The hero feature: paste/share a TikTok·Reel·Short → AI reads the video → it adds
the films to your lists, with the source video attached so it plays on each
film's card. **MERGED to `main`** (merge `34bd93e`); validated live on the Vercel
preview across IG/YouTube/TikTok. Stack DECIDED
2026-06-12 (see `PHASE-C-PLAN.md`): Apify acquire → Gemini video-native analysis
→ TMDB grounding → reuse `addMovieToList`. **Validated end-to-end on real
Instagram, YouTube, and TikTok links** (The Namesake / Django Unchained /
Interstellar — Gemini reads audio + on-screen text + footage).

- **C.1a** backend scaffolding — `POST /api/v1/extractions` + `GET /[jobId]`,
  `src/lib/extraction-server.ts` + `extraction-types.ts`, canonicalizer + provider
  classify, `extraction_jobs`/`extraction_cache` (server-only deny rules), rate
  buckets (`extraction` 5/min + `extractionDaily` 50/day), `next/server` `after()`
  pipeline kick. Pipeline GATED on `GEMINI_API_KEY && !FIRESTORE_EMULATOR_HOST`
  → falls back to fixture films otherwise (tests + pre-key). Test `44` (10/10).
- **C.1b** `src/lib/video-acquire-server.ts` — per-provider Apify adapters
  (generic yt-dlp actors get login-walled on IG): **Instagram →
  `easyapi~instagram-reels-downloader`** (`result.medias[].url` + caption),
  **TikTok → `APIFY_ACTOR_ID` (wilcode multi-platform, $10/mo rental, RENTED)**
  (`formats[].url`), **YouTube → no actor** (Gemini ingests the URL). start→poll→
  fetch-dataset (run-sync was unreliable), HARD-capped 120s/1024MB, retry once
  (proxy-flaky).
- **C.1c** `src/lib/gemini-server.ts` — Gemini REST video analysis → structured
  films (YouTube via `fileData` URL; IG/TikTok inline base64 video, caption-only
  fallback when too big); retries 503/429. Grounding in extraction-server (TMDB
  match-or-drop, dedup). `runRealPipeline` (fetching→watching→matching).
- **C.1d** `POST /api/v1/extractions/[jobId]/save` — create caller-owned lists +
  `addMovieToList` per film with `socialLink=job.canonicalUrl`. Robust: job-films-
  only integrity (no movie injection), per-item `canEditList` (forged target →
  that item 403s, no leak), idempotent, ≤25 items/≤5 lists. Test `45` (6/6).
- **C.2** `src/app/extract/{page,client}.tsx` — paste link → narrated poll →
  film cards (poster · year · the AI "receipt" quote · per-film destination chip
  via Vaul `SheetMenu` · remove) + editable AI new-list name → save → summary.
  Empty/failed/auto-`?url=` states. Home **"scan" button → `/extract`**.

**Env (set in `.env.local`; owner must mirror to Vercel):** `GEMINI_API_KEY`,
`GEMINI_MODEL=gemini-2.5-flash`, `APIFY_TOKEN`, `APIFY_ACTOR_ID`,
`APIFY_ACTOR_INSTAGRAM`. **Owner TODO: add `APIFY_ACTOR_INSTAGRAM` to Vercel.**

**Verification:** typecheck ✓ · `npm run build` ✓ · `npm run build:static` (incl.
`/extract`) ✓ · `cap sync ios` ✓ · **audit 476/476**.

**To test before shipping:** `npm run dev` → `localhost:9002/extract` (uses
`.env.local` keys — the real pipeline). **To ship to the app:** merge to main +
mirror env to Vercel + redeploy (the iOS app calls prod `movienight-kappa`).

**Remaining Phase C (after merge):** C.E eval harness (accuracy scoring) ·
**C.3 iOS Share Extension** (the native doorway — the headline UX) · C.4 Android
share intent. Plus a known v1 limit: the save endpoint resolves films from the
job only (search-to-add of AI-missed films is a fast-follow); reviews/power-user
caps noted in `PHASE-C-PLAN.md`.

---

## Extraction precision + confidence (2026-07-01, commit `5fa8472`, on `main`)

Fixes the reported "only one movie in the reel but it identifies two or three,"
and makes the AI's certainty **visible** to the user. Three root causes, three
fixes, **no new API cost** (prompt + post-processing only):

1. **The prompt was recall-biased** (old: "identify EVERY movie… be thorough").
   Rewrote `PROMPT` in `src/lib/gemini-server.ts` to **precision-first**: only
   include a title with clear evidence (spoken / on-screen text / caption /
   unmistakable poster-or-scene); **never split one film into several entries**;
   each distinct title at most once; set `confidence` **honestly** (~0.9+ only
   when explicitly named/shown; 0.4–0.7 for footage/poster recognition alone).
2. **Confidence was returned but unused.** Added a **confidence floor** in
   `src/lib/extraction-server.ts` (`groundFilms`): candidates below
   `EXTRACTION_CONFIDENCE_MIN` (env, default **0.45**) are dropped before
   grounding.
3. **TMDB grounding laundered hallucinations** — it took `results[0]` (the most
   *popular* hit) even when it didn't match the title. `groundOne` now picks a
   result by **release-year match** OR **title similarity** (Dice bigram
   coefficient ≥ 0.55 + substring check, `titleSimilar()`); no confident match →
   the candidate is **dropped**, not guessed.

**UI:** `src/app/extract/client.tsx` renders a `ConfidenceChip` per film —
`strong match` (sage) ≥ 0.8 · `NN% match` ≥ 0.6 · `low · double-check` below. The
existing per-film **X (remove)** still lets the user drop any film before save;
confidence is transparency, the server floor is the real filter.

**Env:** optional `EXTRACTION_CONFIDENCE_MIN` (0–1, default 0.45). No key needed.
**Verification:** typecheck ✓ · `npm run build` ✓ · `npm run build:static` ✓ ·
audit **477/477**. **Test on a FRESH reel** — old results are cached ~30 days and
won't have the new logic.

---

## Website + demos (2026-07-01)

- **`WEBSITE-HANDOFF.md`** (repo root, untracked — commit it or copy it out) is a
  full brief for a **separate marketing-website repo + Claude Code session**:
  mission, sitemap (`/`, `/waitlist`, `/install`, `/privacy`, `/terms`,
  `/support`), stack (Next.js + Tailwind on Vercel, Resend Audiences for the
  waitlist), brand tokens/fonts/voice, and the coordination table with this repo.
  **Key gotcha it flags:** split domains — `cinechrony.com` = marketing,
  `app.cinechrony.com` = the app — because a PWA installs *the origin you're on*,
  so `/install` must route users to the app origin (the real install prompt lives
  in **this** repo, not the marketing site).
- **Product-demo scripts** for the AI feature (15s silent hook · 30s VO ·
  ~12s website-hero loop + caption options) were delivered in-session to the owner
  (brand voice: lowercase, no dashes, no emoji, wordmark `cinechrony`). They're
  meant as on-screen captions/section copy for the website; reuse from chat.
- **Not yet built in this repo (when requested):** the PWA `<InstallPrompt>`
  component (one-tap Android `beforeinstallprompt` + guided Safari sheet +
  in-app-browser "open in Safari" nudge) and the `/support` page.

---

## Active branches

```
main ◄── Phases A+B+0.5+0.7 + post-0.7 launch-prep + Resend email, PLUS (this
         stretch) the full iOS native bring-up + native-quality pass (Vaul menus,
         keyboard, swipe-back, app icon, WebView fixes) + Letterboxd cost-cap +
         reviews fault-tolerance. (fix/capacitor-ios-runtime was merged here.)
feat/phase-c-extraction ──► MERGED into main (merge 34bd93e, 2026-06-28),
         clean (no conflicts). Phase C web-first hero feature (C.1a–d + C.2) +
         scale/robustness pass + UX fixes. Branch can be deleted.
```

**main is HEAD.** Next feature (C.3 iOS Share Extension) branches off main.

**Operational rule (relaxed for this stretch):** the owner has been having Claude
commit + push directly to `main` for the post-0.7 launch-prep work (verified
preview deploys gate each push). When opening the next feature (website slice /
Phase C), branch off `main` again.

---

## AUDIT items closed during Phase A + B

Phase A: **1.2** (delete-user cascade), 1.3, 1.4, 1.5, 1.6, **1.8**
(admin secret + constant-time compare), 1.11, 1.12, **1.13** (private
list preview privacy), 1.14, 2.1, 2.2, 2.5, 2.6, **2.8** (TMDB/OMDB
server proxies), 2.9, **3.5** (transactional likes across reviews +
lists + activities + posts + post-comments — all 5 surfaces), 3.8, 3.10,
**4.2a** (userId-as-arg auth gap on notification reads).

Phase B: **4.2** (push delivery from notification creators — all 8 event
types fan out via FCM/web push).

---

## What lives where now

| Concern | Location | Notes |
|---|---|---|
| All mutations + auth-gated reads | `src/app/api/v1/**` | Bearer-token auth, envelope contract |
| Server-side helpers | `src/lib/*-server.ts` | Extracted from old actions.ts; pure functions, not 'use server' |
| Push delivery | `src/lib/push-server.ts` | Unified FCM + web-push fan-out, called from every notification creator |
| Native auth | `src/lib/native-auth.ts` + `src/components/auth/social-sign-in-buttons.tsx` | Detects Capacitor, routes to plugin OR web popup |
| Native push registration | `src/lib/native-push.ts` + `<NativePushRegistration />` | Mounted once in root layout |
| Deep link handler | `<DeepLinkHandler />` | Listens for `appUrlOpen`, routes via Next.js router |
| Static export entry | `npm run build:static` | Calls `scripts/static-build.sh`; moves `src/app/api/` aside, runs `next build`, restores |
| Capacitor configs | `capacitor.config.ts` (root) | Plugin + server config |
| Universal Links manifest | `public/.well-known/apple-app-site-association` | Placeholder Team ID — owner replaces |
| Android App Links manifest | `public/.well-known/assetlinks.json` | Placeholder SHA256 — owner replaces |
| Native shells | `ios/` + `android/` | Generated by `npx cap add`; `.gitignore`s exclude build artifacts |
| v3 redesign primitives | `src/components/v3/*` | `Hero`, `GlassBtn`, `Segmented`, `NavBar`, `ListTile`, `RecentRow`, `EditProfileSheet`, `TopFivePicker`, `PeopleSheet` — the universal kit |
| Haptics | `src/lib/haptics.ts` | `haptic(kind)` — native-only (Capacitor guard), web no-op; wired into shared primitives |
| Canonical share URLs | `src/lib/share.ts` | `shareOrigin()` + `profileShareUrl()` — never share `window.location.origin` (it's the WebView origin natively) |
| Avatar compression | `src/lib/avatar-image.ts` | `compressAvatar()` shared by AvatarPicker + EditProfileSheet |

`src/app/actions.ts` is **gone**. If you find a reference, it's stale
documentation — fix it or delete the file.

**Orphaned, safe to delete:** `ProfileListCard` + `FavoriteMoviesPicker`
(both replaced by v3 primitives — `ListTile` and `TopFivePicker`).

**Domain discrepancy to resolve before TestFlight/Phase C:** the live PWA is
`movienight-kappa.vercel.app`, but `capacitor.config.ts` + PHASE-B-HANDOFF +
the planned `NEXT_PUBLIC_API_BASE_URL` reference `cinechrony.vercel.app`. The
iOS bundle + deep links + AASA must point at the REAL live API origin (or a
finalized custom domain) before native ships. Not blocking the redesign.

---

## Owner action items (in priority order)

> **CURRENT LIST (2026-07-31) — everything below this box is a historical
> record from the pre-TestFlight era and is almost entirely done. Read this
> box, not that.**
>
> 1. **Privacy nutrition labels** in ASC (~5 min, not API-settable; the exact
>    answers are in `APP-STORE-SUBMISSION.md`). Blocks App Store submission.
> 2. **EU trader status** in ASC → Business. Blocks EU submission.
> 3. **Share the TestFlight link.** It is live, approved, serving build 9, and
>    **0/150 enrolled**. Every bug fixed this month came from one person's
>    phone; ten friends for a weekend would surface more than another week of
>    auditing, and build 9 is the first build whose crashes actually reach us.
> 4. **`app.cinechrony.com`** in Vercel + DNS. Additive, breaks nothing on
>    existing phones; do it before the link goes wide. Claude then flips the
>    three pinned URLs and ships the next build.
> 5. **Confirm which Google account owns the Gemini key** (fingerprint
>    `AQ.Ab8RN…IshQ` at aistudio.google.com/apikey) — see "Unknowns worth
>    closing". Also eyeball `GEMINI_MODEL` in Vercel while you're there.
> 6. **Firestore TTL policies** (`extraction_jobs` + `extraction_cache` on
>    `expiresAt`) if not yet clicked.
> 7. **Blaze** before any cohort past ~150 testers.
>
> Claude-side, waiting on 1 and 2: attach build 9 to the version record and
> submit for App Store review, both via the ASC API.
>
> Claude-side, unblocked and worth doing next: **investigate the 6
> `$rageclick` events in PostHog** (repeated frustrated tapping, in an app
> that has had two tap-swallowing bug classes this month), and now that Sentry
> reports from devices, **check it after the first testers land** rather than
> waiting to be told something broke.

These are gated on the human, not the code. All documented in detail in
**`PHASE-B-HANDOFF.md`**.

**Quick wins already half-done:**
- `RESEND_API_KEY` is in Vercel (owner reports) → **redeploy** so the
  forgot-password route picks it up, then **test** the reset flow end-to-end.
  Falls back to Firebase's email if anything's off, so it's safe.
- `APIFY_TOKEN` is set (owner reports) → letterboxd username import is live.

**Pre-TestFlight, do these next (the thin website slice):**
- **Point `cinechrony.com` → Vercel** and make it the ONE production origin.
  Then set the iOS `NEXT_PUBLIC_API_BASE_URL` to it and update every
  `cinechrony.vercel.app` reference (capacitor.config, AASA `applinks:`,
  assetlinks). This resolves the long-standing domain discrepancy.
- **Add `/privacy` + `/support` pages** — App Store Connect requires both URLs
  to submit (even for external TestFlight). Can be simple.

**The native-build checklist (unchanged):**

1. **Apple Developer account** ($99/yr). Required for Sign in with Apple,
   APNs push, Universal Links signing, real-device testing, TestFlight,
   App Store submission. Free-tier Apple ID works for Simulator only.
2. **Firebase Console — add iOS + Android apps.** Download
   `GoogleService-Info.plist` → `ios/App/App/`, `google-services.json` →
   `android/app/`. Run `npx cap sync`.
3. **Replace `TEAMID_PLACEHOLDER`** in `public/.well-known/apple-app-site-association`
   once the Apple Developer Team ID is known.
4. **Generate Android release keystore + paste SHA256** into
   `public/.well-known/assetlinks.json`.
5. **APNs key** → upload to Firebase Console under Cloud Messaging.
6. **Xcode capabilities**: open `ios/App/App.xcworkspace`, add Push
   Notifications + Background Modes (Remote notifications) + Sign in with
   Apple + Associated Domains (`applinks:cinechrony.vercel.app`).
7. **App icon + splash artwork** in `assets/icon.png` + `assets/splash.png`,
   then `npm run cap:assets`.
8. **Build the iOS bundle**:
   `NEXT_PUBLIC_API_BASE_URL=https://cinechrony.vercel.app npm run build:static && npx cap sync ios`.

After these, hit Run (⌘R) in Xcode against a Simulator. The app should
boot, log in, fetch data from Vercel, and accept push notifications
(once §5 + §6 are done on a real device).

---

## How to work (commands)

| Command | Notes |
|---|---|
| `npm run dev` | Dev server, port 9002. Vercel-target build. |
| `npm run typecheck` | `tsc --noEmit`. Fast feedback loop. |
| `npm run build` | **Vercel-target build** — the reliable gate. Catches Next 15 route-validator + type + prerender issues. Needs `.env.local`. |
| `npm run build:static` | **Capacitor-target build** — produces `out/` (~3.7 MB). Moves `src/app/api/` aside during build, restores on exit. |
| `npm run audit:test` | 403 audit tests. Needs Java 21 + Firebase emulator. ~90s. |
| `npx cap sync` | Refreshes the bundled JS + plugin config inside `ios/` + `android/`. Run after every `build:static`. |
| `npm run cap:open:ios` | Open Xcode. |
| `npm run cap:open:android` | Open Android Studio. |
| `npm run cap:assets` | Regenerate every iOS/Android icon + splash from `assets/icon.png` + `assets/splash.png`. |

**Operational rule:** Claude pushes only to feature branches; owner
controls all `main` pushes.

---

## Architectural decisions (still in force)

1. **Bearer ID tokens** in `Authorization: Bearer ...`. Required for iOS
   Share Extension (separate Swift process, no cookie access).
2. **Envelope contract** — `2xx { ok: true, data }`, `4xx/5xx { ok:
   false, error: { code, message } }`. `error.code` is the stable
   client-facing identifier.
3. **CORS allowlist** at `src/lib/api-handler.ts:97` — production,
   vercel previews, `localhost:9002`, `capacitor://localhost` (iOS),
   `http://localhost` (Android Capacitor). Share Extension is Swift
   URLSession (no Origin header) — CORS doesn't gate it.
4. **Helper extraction over fat routes** — every domain has a
   `src/lib/<domain>-server.ts` module of pure functions. Routes are
   thin: parse body → call helper → return envelope. Server helpers are
   regular modules, not `'use server'` files (Server Actions are gone).
5. **Static export uses a build-time aside.** `scripts/static-build.sh`
   moves `src/app/api/` out of the tree, runs `next build` with
   `output: 'export'`, then restores. Route handlers don't coexist with
   `output: 'export'`.
6. **Capacitor uses Swift Package Manager** (8+), not CocoaPods. No
   `pod` install required for basic build.

---

## Next 15 route-validator gotcha (still relevant for new routes)

`tsc --noEmit` accepts `params: P | Promise<P>`. Next 15.3's build
validator does NOT — it requires `params: Promise<P>` specifically.
The `apiRoute` / `publicApiRoute` / `adminRoute` wrappers enforce this.
Any future route file that defines its own param type should use
`Promise<...>`.

---

## Modal back-navigation — the contract (unchanged)

The `/movie/[tmdbId]/comments` page navigates back via two URL params
(`returnPath` + `returnMovieId`) to `<returnPath>?openMovie=<id>`.
Three pieces make this work on every route:

1. **Fresh-mount on every open** — every modal call site uses
   `key={selectedMovie?.id ?? 'no-movie-open'}` so reopening yields a
   clean useState rather than reviving a stale React tree.
2. **Module-level TMDB cache** (`src/lib/tmdb-details-cache.ts`). iOS
   PWA silently aborts inflight `fetch()` during the back-nav
   transition window. The cache parks the full payload + the
   `getSimilarMovies` "more like this" payload at the JS module level
   — survives component remounts and SPA navigations.
3. **`MovieModalProvider`** (`src/contexts/movie-modal-context.tsx`).
   Pages with multiple-tile modal opens (`/home`, `/post/[postId]`)
   hoist a single `<PublicMovieDetailsModal>` and rehydrate it from
   `sessionStorage` on `?openMovie=`.

---

## Speed sweep — the contract (Phase 0.6, on main, see PR #83)

- **`src/lib/use-cached-action.ts`** — SWR cache hook. Module-level Map
  + inflight coalescing. localStorage mirror for opted-in keys.
- **`src/lib/cache-config.ts`** — registers persisted keys at module
  load (imported as side-effect from `client-provider.tsx`).
- **`src/lib/list-detail-seed.ts`** — sessionStorage seed for the
  list-detail page. **Security invariant**: seed only paints visual
  chrome; `isOwner` / `isCollaborator` / `canEdit` still derive from
  the real `useDoc(listRef)` data only.
- **Firestore IndexedDB persistence** — `resolveFirestore` uses
  `persistentLocalCache({ tabManager: persistentMultipleTabManager() })`.
- **Touch-start prefetch** — `bottom-nav.tsx` calls
  `prefetchCachedAction` on `onTouchStart`/`onMouseEnter`.
- **`BodyStyleWatchdog`** — root-layout safety net scrubs stuck
  `body.style.position/top` on pathname change when no Vaul drawer is
  mounted. Without it, drawer→route round-trips leave the body fixed
  and the page looks blank.

---

## Open backlog (current priority order)

**Phase 0.7 — v3 redesign: COMPLETE & merged** (`e26871c` + post-0.7 launch-prep).
Entire app is v3; native motion, story-share, OG/Twitter cards, verified accounts,
featured lists, self-healing hooks, and Resend email all shipped. Only deferred
0.7 item is the OPTIONAL direct-to-IG pasteboard plugin (native Swift).

**Next session — the thin website slice (before Phase C):**
- Point `cinechrony.com` → Vercel as the single prod origin (owner DNS + Vercel
  domain), then realign `NEXT_PUBLIC_API_BASE_URL` / AASA / assetlinks.
- Scaffold minimal `/privacy` + `/support` pages (App-Store-submission blockers).
- (Optional, quick) welcome-on-signup email — `email-server.ts` module is ready.

**A.6 UX polish** (small, ½–1 day each):
- `A.6.1` — @-mention autocomplete in composers (comments + posts)
- `A.6.2` — Cursor pagination wire-up on `/comments` client

**Phase C — iOS Share Extension** (the hero feature, ~2 weeks; after 0.7):
- AI URL-extraction backend (TikTok / Reel / YouTube → matched films)
- App Group shared auth token
- iOS Share Extension Swift target
- Android Share Intent handler
- Onboarding redesign around try-before-signup

Full spec in `LAUNCH.md` §C.

---

## Memory

Persistent memory at
`/Users/rayidali/.claude/projects/-Users-rayidali-Desktop-Cinechrony-cinechrony2/memory/`.
This HANDOFF.md is the session snapshot; gitignored on purpose. Phase A
strategy is saved as `project_phase_a_migration.md`; Phase B as
`project_phase_b_capacitor.md`. Both can be read cold to resume.
