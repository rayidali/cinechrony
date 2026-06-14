# Cinechrony — The Project Log

> A plain-English diary of how this app got built: what we decided, why we
> decided it, what broke along the way, and how we fixed it.
> Written 2026-06-10. If you're new here (or future-you coming back after a
> break), read this top to bottom and you'll understand the whole journey.

---

## What is Cinechrony, in one paragraph

Cinechrony is a social movie watchlist. Think "shared Spotify playlist, but
for movies": you and your friends keep lists together ("movies for sleepover
night"), you can attach the TikTok or Reel that made you want to watch
something, rate films, write threaded comments, follow people, and discover
lists other people love. It runs on the web today (Next.js on Vercel,
Firebase for data and login, Cloudflare R2 for images) and is now wrapped as
a real iOS + Android app via Capacitor, headed for the App Store.

The **hero feature** — the reason someone downloads this instead of
Letterboxd — is coming next: you watch a TikTok like "top 5 Nolan films,"
hit Share → Cinechrony, and AI reads the video and adds all five films to a
new list for you. Everything in this log was, directly or indirectly, work
to make that feature possible and safe to ship.

---

## The timeline at a glance

| When (2026) | What | Status |
| --- | --- | --- |
| May 15–20 | **The Audit** — security + data-integrity sweep | ✅ done |
| May 21 | **Phase 0** — full UI redesign ("editorial cinema" v2) | ✅ merged |
| May 22 | **Phase 0.5** — Discover: posts, likes, blocks, home rebuild | ✅ merged |
| May 24–25 | Bug-hunt interlude — the drawer/route round-trip saga | ✅ merged |
| May 25 | **Phase 0.6** — Speed & native feel (caches, prefetch) | ✅ merged |
| May 26 – Jun 2 | **Phase A** — Server Actions → real API routes (18 PRs) | ✅ merged |
| Jun 3–8 | **Phase B** — Capacitor wrap: native iOS/Android shells | ✅ merged |
| Jun 13 → | **Phase 0.7** — v3 iOS-native redesign + motion + story share | 🔧 active |
| After | **Phase C** — iOS Share Extension (the hero feature) | ⏳ |
| After | **Phase D** — App Store + Play Store submission | ⏳ |
| Parallel | **Phase E** — TikTok/IG marketing automation | ⏳ |

Phases A + B + 0.5 are **merged to `main`** (A+B via PR #88, tip `9c81360`).
Active work is **Phase 0.7** on `feat/v3-redesign` — the profile tab family
is complete; Search, Home, and the heavier motion layer come next.
Verification per PR: typecheck clean, both build targets clean, audit suite
green (403+/403+).

---

## Chapter 1 — The Audit (why we fixed locks before building rooms)

### The decision

Before adding a single new feature, we did a full audit of the existing
codebase (`AUDIT.md`). The owner's call, and the right one: there's no point
inviting thousands of App Store users into a house where the doors don't
lock.

### The big scary bug class: "trust the name tag"

Almost every server function in the old code had the same flaw. Functions
looked like this:

```ts
updateBio(userId, newBio)   // ← the server BELIEVED whatever userId you sent
```

That's like a school office letting anyone change anyone's records as long
as they *say* the right name at the desk. Any logged-in user could pass
**your** user ID and edit **your** bio, follow people as you, read your
notifications, even delete your account (the delete check compared against
your *public username* — which everyone can see). Security people call this
**IDOR** (Insecure Direct Object Reference).

**The fix** was one idea applied ~48 times: a helper called `verifyCaller`.
Instead of trusting a `userId` argument, every function now demands a
**Firebase ID token** — a cryptographically signed pass that only the real
logged-in user can produce — and derives "who is calling" from that token.
The `userId` parameter simply stopped existing. You can't spoof a parameter
that isn't there.

### How we made sure the fixes were real: attack ourselves

We built a test harness on the Firebase **emulator** (a fake local Firebase,
so tests can't hurt real data) and wrote **exploit scripts**: tests that
literally perform the attack — "as User A, try to edit User B's stuff." Run
before the fix → attack succeeds (proves the bug is real). Apply fix. Run
again → rejected. The script stays in the repo forever as a regression test,
so the bug can never quietly come back. That suite grew from 4 tests to
**403** over the project.

### Other memorable audit finds (each with a story)

- **The race-condition family.** Two button-taps at almost the same moment
  could corrupt counters. Example: tap "like" twice fast → the count goes up
  by 2 even though `likedBy` has you once. Same shape for movie counts on
  lists, follower counts, and the 10-member list cap (two invite-accepts
  racing past the limit). **Fix:** Firestore **transactions** — the database
  re-checks the state and applies the change as one atomic step, like a
  single-occupancy bathroom lock. We later proved each one with tests that
  fire two parallel calls and assert the count is exactly 1.
- **`Math.random()` invite codes.** Invite links used a guessable random
  generator. **Fix:** `crypto.randomInt()` — casino-grade randomness — and
  looking up a code now requires being logged in, so you can't sit there
  guessing codes anonymously.
- **Email addresses leaked on public profiles.** Anyone could read any
  user's email from the public user document. **Fix:** split private fields
  into a `/users_private/{uid}` doc only the owner can read, plus a backfill
  migration for existing users.
- **`forgot-password` confirmed whether an account exists.** Typing an email
  told you if that person had an account (a privacy leak). **Fix:** the
  "user not found" path now shows exactly the same success screen.
- **The `posterHint` crash (found *by* a test, not a user).** While writing
  the movie-count race test we discovered Firestore Admin hard-rejects
  `undefined` field values — so any TMDB movie missing one optional field
  made "add movie" crash for real users. Coalesced to `null`, and later set
  `ignoreUndefinedProperties: true` globally so the whole bug *class* is
  impossible.
- **The cron that never ran.** Strict TypeScript was disabled
  (`ignoreBuildErrors: true`). Re-enabling it surfaced 9 errors, one of
  which was a weekly-digest cron importing a function that **didn't exist**
  — it would have crashed at runtime, silently. Lesson learned and kept:
  the type checker stays on.
- **Scaling landmines:** user search read the *entire* users collection on
  every keystroke (fixed with prefix-range queries, ~40 reads max), and
  account deletion scanned every user in the database (fixed with a single
  indexed collection-group query).

### Decisions made here that still shape everything

1. **Usernames are immutable.** Changing a username broke search, mentions,
   and every denormalized copy of it. Rather than build a propagation
   system, we froze usernames at creation (admin escape hatch exists).
   Display name and photo stay changeable and render live from a cache.
2. **Every fix ships with the test that proves it.** No checkbox gets ticked
   without a named test file.

---

## Chapter 2 — Phase 0: The redesign (and why it came *first*)

The app's v1 look was **neo-brutalist**: 3px black borders, hard offset
shadows, loud yellow stickers. Fun, but it read as a weekend project. v2 is
**"editorial cinema"**: newsprint-cream background, cinema-black ink,
lowercase serif-and-grotesque typography, a single film-red accent. Think
"a good magazine's movie section," not "a sticker book."

**Why redesign before the native app instead of after?** Because every
later phase *builds screens*: onboarding, the Share Extension confirmation
sheet, the App Store screenshots. Redesign late and you build all of that
twice. Redesign first and everything downstream is built once, in the final
look. The screen list was locked up front to stop scope creep ("a full
redesign is the #1 launch-delay risk" — written into the plan and obeyed).

Process note that worked well: explore directions as throwaway mockups on
claude.ai Artifacts (fast, zero repo risk), pick one, then implement it
consistently in the real codebase.

---

## Chapter 3 — Phase 0.5: Discover (posts, likes, blocks)

This phase turned the home page from a passive activity log into a real
social surface. Three connected pieces, and the *connections* are the
interesting part:

1. **Like public lists** + a **"loved this week" showcase**. Deliberate
   brand call: it's an editorial showcase, **not a leaderboard** — no #1
   ranks, no trophies. Ranking uses a recency-weighted decay (like Hacker
   News) instead of all-time likes, because all-time rankings ossify: the
   same three lists would sit on top forever. There's also a cold-start
   gate: the showcase returns nothing until there's enough liked content,
   so it never renders into an empty room.
2. **User posts** — free text + photos/video + a tagged movie + tagged
   friends + an optional typed place ("at the prince charles cinema").
   Decision recorded: `place` is **freeform text, never GPS** — a
   location-aware app is a different product, and the UX docs forbid it.
   (The planned "nearby" feed pill was dropped for exactly this reason.)
3. **Block a user** — full mutual invisibility, both directions, across
   every surface (feed, search, comments, notifications, invites).

The hard rule that tied 2 and 3 together: **posts and blocking ship
together or not at all.** Free-form text and photos are real user-generated
content, and Apple's App Store rule §1.2 requires UGC apps to have report +
block. So blocking was pulled forward from the "before submission" pile to
a hard dependency of posts. This is a good example of the project's style:
sequencing driven by *requirements*, not vibes.

---

## Chapter 4 — Interlude: the drawer/route round-trip saga (our nastiest bug)

The single most recurring bug class in this app lives at the seam between
**Vaul drawers** (the slide-up modal sheets) and **Next.js navigation**.

**The symptom:** open a movie modal → tap into comments (a route change) →
swipe back → the home page is *empty*. Except… the bottom nav and the
floating button are still there. Spooky.

**Root cause #1 — the body-style leak.** To stop the page scrolling behind
an open drawer, Vaul sets `body.style.position = 'fixed'; top: -<scroll>px`
and undoes it on close. But if you navigate away *while* the drawer is
closing, the undo races the route unmount and loses. The body stays
`fixed`, the whole page content is shoved offscreen — but elements that are
themselves `position: fixed` (nav, FAB) don't care about the body offset,
so they remain. That's why the page looked "empty except the nav": that
exact signature is now the documented first thing to check.

**Root cause #2 — the transform trap.** The pull-to-refresh wrapper kept a
`transform: translateY(0)` on itself even at rest. A CSS transform — even a
zero one — creates a new "containing block," which silently breaks
`position: sticky` and `fixed` descendants. Fix: only apply the transform
while actually pulling.

**Root cause #3 — iOS kills your fetches.** On the way back from comments,
iOS Safari/PWA silently aborts in-flight `fetch()` calls during the
transition, so the reopened modal had no data. Fix: a **module-level TMDB
cache** (`tmdb-details-cache.ts`) — data parked at the JS module level
survives component unmounts and SPA navigations, so the reopened modal
rehydrates instantly without refetching.

**The defenses now in place** (all still active):

- `BodyStyleWatchdog` in the root layout — on every route change, if no
  drawer is mounted but the body is stuck `fixed`, scrub it. A safety net
  for the whole bug class.
- Navigating *from inside* a drawer always closes the drawer first, then
  pushes the route ~220ms later so Vaul's cleanup commits.
- Every modal mounts fresh via a `key={movieId}` so reopening never revives
  a stale React tree.

Lesson that generalized: **with system-level UI (drawers, keyboards,
scroll locks) on iOS WebKit, cleanup is never guaranteed to run — build a
watchdog.**

---

## Chapter 5 — Phase 0.6: Speed (because native apps expose slow web apps)

The motivating quote: the app "feels like a webapp cosplaying as a mobile
app." Loading spinners you tolerate in a browser feel broken when the app
sits next to Instagram on a home screen. So before wrapping it natively, a
focused speed pass:

- **Stale-while-revalidate caches** for tab data: show the last known data
  *instantly* on tab switch, refresh quietly in the background. (Like your
  fridge: eat what's there now, restock later.)
- **Touch-start prefetch:** the moment your finger touches a nav tab —
  ~100ms before the tap registers — the data fetch already starts.
- **Firestore IndexedDB persistence:** the local database cache survives
  full app restarts.
- **A security invariant worth remembering:** the list page renders
  instantly from a sessionStorage "seed," but the seed only paints visual
  chrome — *permissions* (can you edit this list?) always derive from the
  real fresh data, never the cache. Fast must never mean wrongly-trusting.

---

## Chapter 6 — Phase A: the great refactor (Server Actions → real API)

### Why this had to happen (the architectural fork in the road)

The app used **Next.js Server Actions** — ~5,500 lines in one
`src/app/actions.ts` file — for every mutation. Server Actions are
convenient, but they only exist when Next.js itself runs the server *and*
serves the pages. The native app plan breaks both assumptions:

1. **Capacitor ships a static bundle.** The iOS app is plain HTML/JS files
   inside a WebView (`npm run build:static` → an `out/` folder, ~3.7 MB).
   No Next.js server in the phone. Server Actions can't exist there.
2. **The Share Extension is a separate Swift process.** It will need to call
   our backend directly, with no browser, no cookies, no React.

So: every mutation became a real, boring, callable-from-anywhere HTTP
endpoint under `/api/v1/*`. That's Phase A — 18 stacked PRs, the single
biggest block of work in the project, ending with `actions.ts` **deleted**.

### The architecture that came out of it

- **Bearer ID tokens, not cookies.** Every request carries
  `Authorization: Bearer <Firebase ID token>`. Chosen specifically because
  the Swift Share Extension can attach a header but can't share browser
  cookies. The audit's `verifyCaller` was reused verbatim — token-in-header
  instead of token-as-argument is a mechanical change. (The audit and the
  refactor were *designed to converge*; that was planned from day one.)
- **One envelope for every response:** success is `{ ok: true, data }`,
  failure is `{ ok: false, error: { code, message } }`. Clients branch on
  `error.code` (e.g. `RATE_LIMITED`), never on message strings.
- **Thin routes, fat helpers.** Each route file just parses input, calls a
  pure function in `src/lib/<domain>-server.ts` (lists-server, posts-server,
  invites-server…), and wraps the envelope. Logic lives in plain modules —
  testable, reusable, no framework magic.
- **CORS allowlist** including `capacitor://localhost` — the strange origin
  the iOS WebView reports — plus localhost and Vercel previews.
- **The static-build trick:** Next.js refuses to do a static export while
  API route files exist in the tree. `scripts/static-build.sh` moves
  `src/app/api/` aside, builds, and restores it on exit (even on failure).
  Slightly gross, fully effective. The same codebase produces both targets:
  `npm run build` (Vercel, with API) and `npm run build:static` (Capacitor,
  calling the Vercel-hosted API cross-origin via `NEXT_PUBLIC_API_BASE_URL`).

### Bugs and gotchas from this phase

- **Next 15 route-validator gotcha:** `tsc` accepts route `params` typed as
  `P | Promise<P>`, but Next 15.3's build validator demands exactly
  `Promise<P>`. Cost us a broken build; the shared `apiRoute` wrapper now
  enforces it so nobody hits it again.
- **A pile of latent holes closed as a side effect**, because converting
  each action meant *reading* it: clients were writing movie status/links
  **directly to Firestore from the browser**, bypassing permission checks
  entirely (now blocked — server-side checks + tests pin strangers at 403);
  notification reads trusted a `userId` argument (any user could read
  anyone's notifications — gone); ghost-unfollows drifted follower counts
  negative (now transactional); the legacy admin backfill accepted the
  literal string `"run-backfill-now"` as a password (now one `ADMIN_SECRET`
  with constant-time comparison, fail-closed).
- Roughly **20 audit items** got closed "for free" during this phase, each
  pinned by tests. This is why the suite ended at 403.

---

## Chapter 7 — Phase B: wrapping it native (Capacitor)

### The decision: Capacitor, not a Swift rewrite

A from-scratch native rewrite would cost months and produce two more
codebases to maintain solo. Capacitor wraps the existing (now static) web
app in a real native shell with real native capabilities — and critically,
the iOS project it generates is a normal Xcode project, so **Phase C's
Share Extension can be added to it as a Swift target**. One codebase, three
platforms, hero feature still possible. Five substeps:

- **B.1 — Scaffolding.** Capacitor 8, `ios/` + `android/` projects at the
  repo root. Uses Swift Package Manager (no CocoaPods pain).
- **B.2 — Native sign-in.** Google/Apple OAuth popups are notoriously broken
  inside iOS WebViews. Fix: the `@capacitor-firebase/authentication` plugin
  shows the *real native* Google/Apple dialog, then hands the credential to
  the Firebase **Web** SDK (`skipNativeAuth: true`). Subtle but important
  call: the Web SDK stays the single source of truth for "who is logged
  in," so every existing `auth.currentUser.getIdToken()` call site works
  unchanged on web *and* native. Apple sign-in is iOS-only for v1 (web
  needs an Apple Service ID we don't have yet — button hidden on web).
- **B.3 — Push notifications.** Decision: **FCM** (Firebase Cloud
  Messaging) rather than raw APNs, because FCM is one server-side API for
  both iOS and Android and we already run firebase-admin. A unified
  `push-server.ts` fans out every notification (mention, reply, like,
  invite, follow, post events — all 8 types) to web-push *and* FCM, and
  auto-prunes dead tokens. This closed the audit's last big item (4.2):
  before this, push only fired for a weekly digest.
- **B.4 — Deep links.** Universal Links (iOS) + App Links (Android) so an
  invite link tapped in Messages opens *inside the app*, not Safari.
  Gotcha worth recording: **Apple silently rejects** the
  `apple-app-site-association` file if it's served as `text/plain` — we pin
  `Content-Type: application/json` in `next.config.ts` headers.
- **B.5 — Feel.** Status-bar style, splash dismissal on React mount,
  safe-area CSS utilities (`pt-safe` etc. for the notch), and
  `overscroll-behavior-y: none` to kill the WKWebView full-page rubber-band
  bounce that screams "this is a website."

### What code can't do: the owner checklist

Some steps require a human with credentials — an Apple Developer account
($99/yr), Firebase Console clicks, an APNs key, a release keystore, the
Team ID patched into the AASA file. All of it is written up step-by-step in
**`PHASE-B-HANDOFF.md`** (§0–§10). Until that's done, the app builds and
runs in the Simulator but Apple sign-in / push / Universal Links stay dark.

---

## Chapter 8 — Phase 0.7: making it *feel* like an app (the redesign)

Phases A + B + 0.5 merged to `main` (A+B via PR #88). The app was now
genuinely native-wrapped — and that's exactly when the real problem showed
up. Wrapped in a Capacitor shell next to actual iOS apps, it still **felt
like a website**. The repeated owner feedback — "it doesn't feel like an iOS
app, I fear the review will be 'it feels like a webapp'" — became the brief.

The diagnosis: it wasn't the colors or the fonts (the v2 editorial system
was already good). It was **proportions and motion**. Outlined web buttons,
components too small for the canvas, and — the big one — *nothing moved like
iOS moves*. So Phase 0.7 became a screen-by-screen restyle to a downloaded
Claude Design package, plus a deliberate **native-feel motion layer**.

Two things we got right by doing it carefully:

- **The profile tab family, done properly.** The profile photo became the
  full-bleed hero; tabs settled on the design's `films · lists · activity`
  (after one wrong turn where earlier work had quietly dropped "recent" and
  "activity" — caught by comparing against the design files in detail). New
  full-screen sheets — `EditProfileSheet`, `TopFivePicker` (with custom
  drag-to-rank, no DnD dependency), `PeopleSheet` (your-people followers/
  following with **zero per-row fetches**) — all built as **full-screen
  overlays, not Vaul**, because text inputs inside Vaul hit the iOS
  focus-trap bug we'd already been burned by.
- **Haptics as the first motion slice.** `@capacitor/haptics`, wired once
  into the shared primitives (`Segmented`, `Fab`, `GlassBtn`, bottom-nav) so
  the whole app inherited it. The lesson from staring at screenshots: you
  can't judge "feels native" in a browser — motion is invisible there, so
  the real verdict waits for the Simulator/device.

Quieter robustness wins along the way: profile recent/activity reads
**degrade silently** when the new Firestore composite index isn't deployed
(one-shot `getDocs` + local try/catch, not a global error toast); and the
share link now resolves a **canonical https origin** instead of
`window.location.origin` (which is the dead `capacitor://localhost` origin
natively). Rich per-user share cards were deliberately deferred to the story
renderer (0.7.4) — same infra, build it once.

Tracker: `PHASE-0.7-REDESIGN.md`. Remaining: Search, Home feed (the
centerpiece), motion slice 2 (page transitions + app-wide swipe-back), story
share, then the deferred data rails.

## Chapter 9 — Where we are, and what's next

### Now (2026-06-14)

- Phases 0 → B + 0.5 **merged to `main`** (A+B via PR #88, tip `9c81360`).
  **403/403 tests**, both builds green.
- **Phase 0.7 redesign active** on `feat/v3-redesign` — profile tab family
  complete; Search + Home + motion slice 2 next. Builds green per PR.
- Owner threads still open: `PHASE-B-HANDOFF.md` manual setup; the
  `firestore:indexes` deploy (activities) + `npx cap sync` (haptics) from
  the profile work; and the `movienight-kappa` vs `cinechrony.vercel.app`
  domain discrepancy to resolve before TestFlight.

### Phase C — the Share Extension (the whole point, ~2 weeks)

The flow we're building toward, end to end:

1. You're in TikTok watching "top 5 Nolan films." Tap **Share →
   Cinechrony**.
2. An iOS **Share Extension** (a small Swift program in our app bundle)
   receives the URL. It grabs your login token from shared **App Group**
   storage (extensions are separate processes — they can't see the app's
   memory, so the token is parked in a shared keychain).
3. It calls the extraction API. The backend fetches the actual video via an
   Apify downloader actor, **Gemini watches it natively** (frames + audio +
   on-screen text), returns films as structured JSON with evidence
   timestamps, and each one is verified against TMDB or dropped.
   *(Redesigned 2026-06-12 — the original text-only pipeline couldn't read
   silent text-overlay TikToks; full spec in `PHASE-C-PLAN.md`.)*
4. You see five film cards with receipts, can remove/add, assign **each
   film to a list of your choice** — or a new one pre-named "top 5 nolan
   films" — and every saved movie carries the TikTok as its `socialLink`,
   so the video plays inside the movie card later.

Direction decision (2026-05-25, recorded in LAUNCH.md): **URL-first, not
screenshot OCR** — a URL yields caption + transcript + frames (the whole
video's signal), a screenshot only shows one frozen moment. Screenshots
remain the fallback. Note how the earlier phases pay off here: the
extension works *only because* the API is token-authed HTTP (Phase A) and
lives inside a real Xcode project (Phase B).

Then: **Phase D** (TestFlight → store submissions, expect at least one
Apple rejection — demo account + screencast prepared in advance) and
**Phase E** (automated TikTok/IG content via n8n + Remotion + Claude),
which can run in parallel. Realistic remaining runway: ~5–7 weeks to
launch, plus Apple-review buffer.

### Small open backlog (not blockers)

- A.6.1 — @-mention autocomplete in comment composers (~1 day)
- A.6.2 — infinite-scroll wiring on the comments page (endpoint ready, ~½ day)
- AUDIT Phase 3 leftovers (notification bell polling, modal flicker, etc.) —
  explicitly deferred to the TestFlight period, where real beta users
  surface what actually matters.

---

## The principles this project keeps proving

1. **Audit before features.** Every later phase leaned on the audit's
   `verifyCaller` and its test harness. Locks first, rooms second.
2. **Every fix ships with the attack that proves it.** 403 tests, each one
   a bug that can never silently return.
3. **Sequence by dependency, not excitement.** Redesign before screens get
   built; blocking before posts; API routes before the native wrap; the
   wrap before the Share Extension.
4. **Decide once, write it down.** Usernames immutable; no GPS; no
   leaderboards; URL-first extraction; FCM over raw APNs; Bearer over
   cookies. Each decision is logged with its *why*, so it doesn't get
   re-litigated.
5. **On mobile WebKit, trust nothing's cleanup.** Watchdogs (BodyStyleWatchdog),
   module-level caches, and fresh mounts beat hoping the framework unwinds
   correctly.

---

*Companion docs: `CLAUDE.md` (architecture reference) · `AUDIT.md` (every
security/integrity item + progress log) · `LAUNCH.md` (the full phase plan,
C–E specs) · `PHASE-B-HANDOFF.md` (owner's manual-setup checklist) ·
`HANDOFF.md` (session snapshot, gitignored).*
