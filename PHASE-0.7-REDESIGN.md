# Phase 0.7 — v3 iOS-Native Redesign + Story Share

> **Status: planning locked 2026-06-13.** The working tracker for the
> native-feel UI/UX revamp and the Instagram-story share feature.
> Triggered by repeat "still feels like a webapp" feedback. Supersedes the
> deferred LAUNCH.md 0.6.4 (parallel-route tab shell) — native transitions
> are handled here. Convention from AUDIT.md: **every shippable item has a Test.**

## Source of truth

- **Design package:** `../cinechrony ios redesign june/` (downloaded from
  Claude Design). `README.md` is the spec; `design_files/*.jsx` are
  HTML/React **visual references, not code to copy** — recreate in our real
  components. Fidelity is **final/high** per the handoff; imagery is the only
  placeholder (gradients → real TMDB posters/stills + R2 avatars).
- **Key insight:** v3 is an **evolution of the existing v2 editorial system**,
  not a rebrand. `globals.css` already has the oklch paper/bone/ink palette,
  film-red `--primary`, sage/amber/marker ratings, dark-mode tokens, and the
  three fonts (Bricolage / Space Mono / Newsreader). The 3-tab nav already
  matches. So this is **additive**, lower-risk than a from-scratch reskin.

## Locked decisions (2026-06-13)

1. **Sequence: look first, data rails fast-follow.** Restyle every existing
   screen to v3 + add the native-feel motion layer, using data we already
   have. The rails that need NEW backend (weekly leaderboard, top-picks
   categories, editor-featured carousel) come right after, not in the first
   merge.
2. **Presence pill: real data, no live presence.** Keep the pill; feed it from
   the existing `/activities` feed ("N of your circle logged films today/this
   week"). No "watching now" heartbeat system.
3. **Story share: share-sheet first, direct-to-IG fast-follow.** Build the
   card renderer + system-share-sheet path first (works web + iOS + Android,
   no Meta account). Get the free Meta App ID in parallel. Add the
   direct-to-Instagram-story native layer after, with share sheet as the
   permanent fallback (web always uses it). The attribution link sticker in
   the direct path is the growth lever — worth the App ID, but not a blocker.

## Verification (applies to every UI item — same as Phase 0.4.3)

The redesign is **presentational — it must not regress logic.** Each PR:
typecheck clean · `npm run build` (Vercel) clean · `npm run build:static`
(Capacitor) clean · **audit suite stays green** (403+/403+). Plus a manual
walk of the restyled flow in `npm run dev`, light + dark, and a Simulator
check for the native-feel items (haptics/transitions can't be seen in a
browser).

---

## Phase order

### 0.7.0 — Branch base ✅ DONE 2026-06-13

- [x] A+B merged to `main` (PR #88, tip `9c81360`); `feat/v3-redesign` branched
  off the fresh `main`. This is where all 0.7 work lands.

### 0.7.1 — Foundation: tokens + native primitives (no new data)

- [ ] **0.7.1.1** Extend `globals.css` + `tailwind.config.ts`: add `sunken`,
  `hair`, frosted `chrome` / `tabTint`, and the accent set (violet / blue /
  pink for leaderboard ranks + category dots). Keep all existing v2 tokens.
  Light + dark, values from `ios-kit.jsx::makeTokens`.
- [ ] **0.7.1.2** Frosted-surface primitive (`<Frost>`) — `backdrop-filter:
  blur() saturate()` over the tint. Verify it renders in the Capacitor
  WKWebView (it does; confirm on Simulator). Used by top bar / tab bar / nav bar.
- [ ] **0.7.1.3** Shared primitives to match the kit: `GlassBtn` (glass control
  over imagery), `Segmented` (sliding-thumb iOS control), `Section` header
  (eyebrow → title → trailing), `NavBar` (large lowercase title, collapses on
  scroll). Replace the `Fab` with the `AddBtn` (red round +) per design.
- [ ] **0.7.1.4** Theme wiring — `next-themes` (already in use) follows **system
  appearance by default** with a **manual override in settings** (decided
  2026-06-13, option c). Config, not a new dep; every screen supports both.
- [ ] **0.7.1.5 — Test:** render each primitive on a scratch route in
  `npm run dev`, light + dark; typecheck + build green.

### 0.7.2 — Native-feel motion layer (mostly visual-independent; can parallelize)

- [ ] **0.7.2.1** Install **`@capacitor/haptics`**; fire light impact on
  meaningful taps (like, save-to-list, add, tab switch, segmented switch,
  pull-to-refresh trigger) — no-op on web. (Closes the LAUNCH.md C.4.1 haptics
  item too.)
- [ ] **0.7.2.2** Native page transitions (push/pop slide + parallax) for
  pushed routes; replaces the deferred 0.6.4 tab shell. **Must respect the
  Vaul-drawer seam** — see `project-drawer-route-roundtrip` memory:
  BodyStyleWatchdog + the 220ms drawer-close defer stay in force; any
  transition work is tested against the modal→/comments→back round-trip.
- [ ] **0.7.2.3** Instant tap/press states on every interactive element; kill
  the gray iOS tap-highlight flash.
- [ ] **0.7.2.4** App-wide edge-swipe-back (generalize the existing
  `SwipeBackContainer` beyond `/comments`).
- [ ] **0.7.2.5** Scroll-collapse chrome (top bar / nav bar tint+blur+rule fade
  in past the scroll threshold) — already modeled in the design's `scrolled`
  state.
- [ ] **0.7.2.6 — Test:** real iPhone Simulator + ideally a device; feel-check
  taps/transitions/swipe-back; `prefers-reduced-motion` gates decorative
  animation.

### 0.7.3 — Screen-by-screen restyle (FIXED list, highest-traffic first)

> Maps design screens onto existing routes/components. Restyle only — same
> data, same logic. Posts/activity already carry `media[]`, ratings, captions
> → they feed the reel directly. `socialLink` + `video-embed.tsx` already
> handle attached clips. `favoriteMovies` → the "fav" badge + profile top-5.

- [ ] **0.7.3.1** **Home / feed** (centerpiece, `ios-home.jsx`): for-you /
  friends top tabs, in-feed search trigger (+ the red "scan" affordance →
  Phase C extractor entry point), the reel (presence pill [real data] +
  `DiaryEntry` from posts + `MediaGallery` + derived hot-take cards). Top
  picks / leaderboard / featured / lists-for-you render with **placeholder/
  existing-data sources** now; richer data lands in 0.7.5.
- [ ] **0.7.3.2** **Movie detail modal + movie-card variants** (grid / list).
- [x] **0.7.3.3** **Lists** (`ListsIOS`): album tiles + `MiniFan` poster fans +
  collapsing frosted NavBar + mine/shared segmented + AddBtn in the nav (FAB
  retired on this screen). Built `Segmented`, `NavBar`, `AddBtn`, `ListTile`
  primitives in context. All data/seed/refresh/create logic preserved.
  typecheck + build green. — first full-screen v3 restyle, awaiting green-light.
- [x] **0.7.3.4** **List detail** (`ListDetailIOS`): cinematic Hero (cover or
  seeded gradient + glass back/settings/add) → pull-up content sheet (serif
  description + collaborators row w/ "N collaborators · N films" + manage
  button) → to-watch/watched **Segmented** → existing movie grid (already 2:3
  posters + rating chips; view-modes/search/sort/modal all preserved). Built
  universal **GlassBtn** + **Hero** primitives (reused by Profile next). All
  collaborative-lookup / permission / seed / pull-to-refresh logic untouched.
  typecheck + build green. **Universal primitives now: Frost, Segmented,
  NavBar, AddBtn, ListTile, GlassBtn, Hero** + the existing MovieCardGrid is
  the canonical poster tile (kept, not duplicated → consistent card sizes).
- [x] **0.7.3.5** **Own profile**: cinematic Hero (seeded gradient + avatar
  overlaid + name/@handle/since + serif tagline + glass settings/sign-out) →
  pull-up content sheet (editable bio, find-friends/share pills, stats
  sandwich, **Segmented** tabs). Reused Hero + GlassBtn + Segmented. All edit
  logic preserved (avatar picker, inline bio, top-5 picker, follower/following
  modals, cover picker). Public profile (`/profile/[username]`) still pending.
  Also: persistent add **FAB** now on the lists tab. typecheck + build green.
  - **CORRECTION (re-read design):** the design's profile tabs are
    **`films · lists · activity`** (`ios-screens.jsx` ProfileIOS), NOT
    lists/shared/top-5. **films** = top-5 "canon" grid **+** a "recent"
    section (`RecentRow`); **activity** = the owner's full action feed.
    There is **no "shared" tab on the profile** — shared lists live on the
    Lists tab's `mine · shared` segment, and the **pending-invites banner
    moved to the Lists `shared` segment** (also still in /notifications). New
    universal `RecentRow` primitive (poster · badge · rating · title · meta ·
    chevron → opens movie modal). Recent/activity read the owner's
    `/activities` via a real-time `useCollection` query → **needs the new
    `(activities: userId ASC, createdAt DESC)` composite index in
    `firestore.indexes.json`; deploy with `firebase deploy --only
    firestore:indexes`** or recent/activity stay empty.
- [ ] **0.7.3.6** **Search** (`SearchIOS`): pushed results view, genre chips,
  grouped inset results with IMDb chip + add button.
- [ ] **0.7.3.7** Auth / onboarding / notifications / settings: apply the
  system (lower traffic; coordinate onboarding with Phase C.7 later).
- [ ] **0.7.3.8 — Test:** per screen — light/dark walk in `npm run dev`,
  audit suite green, build green; Simulator pass on the hero screens.

### 0.7.4 — Story share: card renderer + share sheet (ships with redesign)

- [ ] **0.7.4.1** **Card renderer** — server-side via **`@vercel/og` (Satori)**
  at **1080×1920**, three layouts (`StoryReview` / `StoryWatched` /
  `StoryList` from `ios-story.jsx`). Lives as a Vercel API route (static
  export moves `/api` aside → native app fetches the PNG from Vercel, same as
  every `/api/v1` call). Embed the three fonts as buffers; **port card colors
  oklch → hex** (Satori's CSS engine; no backdrop-filter/grid). Real inputs:
  TMDB poster/backdrop, rating, list posters, handle.
- [ ] **0.7.4.2** **Share-sheet delivery** — install **`@capacitor/share`**;
  generate the PNG → hand to the OS share sheet (native) / Web Share API
  (web). Add a **"share to story"** action on post, review, and list surfaces.
- [ ] **0.7.4.3 — Test:** `45-story-card.test.ts` — renderer returns a valid
  1080×1920 PNG for each layout + auth/ownership on the endpoint; manual:
  share a card to IG via the sheet on web + Simulator.

### 0.7.5 — Data-rail fast-follow (the deferred backend)

- [ ] **0.7.5.1** Weekly leaderboard — films-watched-per-followed-user over 7
  days (aggregate over `/activities` within the follow graph). **Test:** seed
  activity, assert ranking + counts; block-filtered.
- [ ] **0.7.5.2** Top-picks categories — define + query `new` (fresh logs),
  `trending` (exists), `popular` (all-time loved), `lowkey` (hidden gems).
- [ ] **0.7.5.3** Featured carousel — lean on the Phase 0.5 loved-lists
  showcase + a manual `staffPick` flag for editorial slots.
- [ ] **0.7.5.4** Hot-take cards — selection rule over short, high-rated
  reviews. Presence pill final wording from real activity.

### 0.7.6 — Story share: direct-to-Instagram (native fast-follow)

- [x] **0.7.6.1** (OWNER) Meta app created. **App ID = `4465137393764764`**
  (app "cinechrony"). Sharing-to-Stories is **no-review** — just needs this
  registered App ID. Owner to finish basic settings + flip to Live before
  shipping: Privacy URL `https://cinechrony.vercel.app/privacy`, Terms URL
  `https://cinechrony.vercel.app/terms` (both are real public routes), app
  icon, category. **Ignore the "Manage messaging & content on Instagram" use
  case — that's the Graph API path (App Review + business verification), NOT
  needed for story sharing.** App PUBLISHED/Live in Meta 2026-06-13. URLs use
  the live PWA domain `https://movienight-kappa.vercel.app/{privacy,terms}`.

> ⚠️ **Domain discrepancy to resolve before native/Phase C** (not blocking the
> redesign): the live PWA is **`movienight-kappa.vercel.app`**, but
> `capacitor.config.ts` allowNavigation + PHASE-B-HANDOFF + the planned
> `NEXT_PUBLIC_API_BASE_URL` reference **`cinechrony.vercel.app`**. The iOS
> bundle + deep links + AASA must point at the REAL live API origin (or a
> finalized custom domain like cinechrony.com) before TestFlight. Flag for the
> Phase B owner-setup pass.
- [ ] **0.7.6.2** Small custom Capacitor plugin: write PNG to pasteboard under
  Instagram's keys + open `instagram-stories://share?source_application=<AppID>`
  (iOS) / `com.instagram.share.ADD_TO_STORY` intent (Android). `Info.plist`
  `LSApplicationQueriesSchemes: instagram-stories`. Set the content URL to a
  Cinechrony deep link (the tappable attribution sticker = the growth lever).
- [ ] **0.7.6.3** Wire "share to story" → direct path on native, share sheet
  fallback on web / no-IG. **Test:** Simulator/device — card lands in IG story
  composer with the link sticker; web still falls back cleanly.

---

## New dependencies & owner tasks

- npm: `@capacitor/haptics`, `@capacitor/share`, `@vercel/og` (Satori). Run
  through `.npmrc` (legacy-peer-deps already set) and re-run `npx cap sync`.
- Fonts as buffers for the OG renderer (Bricolage Grotesque, Newsreader,
  Space Mono — already used; bundle the .ttf/.woff for server rendering).
- OWNER: Meta App ID (0.7.6.1) — free, no review, ~10 min, needed only before
  0.7.6.

## Sequencing vs other work

This is the **active priority, before Phase C** (the hero extractor). The
in-feed "scan" affordance (0.7.3.1) is the natural future entry point for the
Phase C extractor — so the redesign leaves a hook for it. Professional-
practices backlog (Sentry/PostHog/CI — LAUNCH D.0.x) still slots in after.

*Decision log: native-feel polish prioritized 2026-06-13; three scope
decisions locked same day (this doc). Design package downloaded 2026-06-13.*
