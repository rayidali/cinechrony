# Cinechrony — Session Handoff

> Last updated 2026-07-26. Project: a social movie-watchlist app
> (Next.js 15 + React 19 + Firebase + Tailwind + Capacitor 8), repo at
> `/Users/rayidali/Desktop/Cinechrony/cinechrony2`.
>
> **Resuming?** Latest stretch (all on `main`; `CLAUDE.md` "Current state"
> carries the per-arc detail — this list is the map):
> -4. **Modal tap-through bug class + silent scan-result push + Movie Night
>    private nights + scan-to-plan continuity (2026-07-26, UNCOMMITTED, ~41
>    files).** `src/lib/modal-guard.ts` closes the "presses leak through a
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
>    `6792422740`; internal group auto-receives every build (owner's invite
>    pending their TestFlight install); friends group + public link
>    https://testflight.apple.com/join/CRPFhKen (capped 150, inert until
>    review passes); prod demo account `@cinechronydemo` for Apple's
>    reviewers. Beta review **APPROVED** (2026-07-21, ~7h after
>    submission) — the public link is LIVE. See
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
> **Immediate next:** (1) owner installs Apple's TestFlight app + accepts
> the internal invite (sent to `rayid.awesome@gmail.com`) → first OTA
> install, the cable retires (still INVITED as of 07-23; 0 public-link
> joins yet); (2) **add `app.cinechrony.com`** in Vercel + DNS BEFORE the
> link goes wide (entitlements + Firebase already wired — additive, breaks
> nothing on existing phones), then Claude flips the three pinned URLs
> (`package.json` build default, `ExtensionAPI.swift`,
> `LiveActivityTokenRelay.swift`) and ships build 2 (which also carries
> iPhone-only); (3) ~~App Store submission prep~~ **DONE Claude-side
> 2026-07-23** (`APP-STORE-SUBMISSION.md`) — remaining owner gates:
> **privacy nutrition labels** (~5 min, answer sheet in the tracker), **EU
> trader status**, then Claude attaches build 2 + submits via API. Console
> TTL policies (extraction_jobs + extraction_cache on `expiresAt`) still
> open if not yet clicked.

---

## Modal-guard fix + scan-alert fix + Movie Night continuity + Rodeo research (2026-07-26)

Four threads, all **UNCOMMITTED on disk (~41 files)** as of this writing.
The bug fixes (1–2) are server/client code — they go live on the next web
deploy independent of any native build. The Movie Night UI + the
ShareExtension Swift changes (3) need a new native build (build 6) to
reach the iOS app, same as every prior stretch. Gates before that build:
typecheck, the full audit suite, the 30-step `interaction-harness.mjs`,
and the native `-smokeCalendar` simulator smoke — unchanged rules, just
restated because this is exactly the class they exist to catch.

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
"ship a new build" is a one-liner request from here on.

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
