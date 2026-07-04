# Cinechrony - Claude Code Reference

> A social movie watchlist app for friends to curate and share movies together.

## Current state (2026-07-04)

- **Optimization + hardening + observability pass (2026-07-03/04, on `main`).** A
  large audit-driven sweep landed: persistent bottom nav (no tab-switch flicker),
  optimistic follow / mark-watched, ratings delta-sync, per-surface TMDB image
  sizing, per-IP rate limits + SSRF guard, the `audienceUids`/`likedBy` privacy
  strip, the **global leaderboard** fix, keyset/window fixes (feed pagination +
  **list-detail virtualization** for big imports), **app-shell skeletons** (LCP),
  and the **`/me/boot`** batch (bookmarks+mutes+blocks in one call). Plus
  DDIA-level correctness fixes (friends-tab full-graph, watch-log idempotency,
  review-vs-reply). Guardrails added: **ESLint rules-of-hooks**, **error
  boundaries**, **CI** (`.github/workflows/ci.yml`) + **Dependabot**. **Sentry**
  wired + DSN live in Vercel; **PostHog** wired (DSN-gated, minimal taxonomy,
  disclosed in `/privacy`). New `/support` page. Tests: **484/484**. Owner: add
  `NEXT_PUBLIC_POSTHOG_KEY`/`HOST` to env. **Marketing website DONE** (separate
  repo/session). **Blaze intentionally deferred** until user volume justifies it.
- **Extraction precision + visible confidence (2026-07-01, merge `5fa8472`, on
  `main`).** Fixes "one film in the reel gets identified as two or three" and
  surfaces certainty to the user. Three fixes, **no new API cost**: (1) the Gemini
  `PROMPT` (`gemini-server.ts`) rewritten **precision-first** (clear evidence
  only; never split one film into several; honest `confidence`); (2) a
  **confidence floor** in `extraction-server.ts` `groundFilms` — candidates below
  `EXTRACTION_CONFIDENCE_MIN` (env, default 0.45) dropped before grounding; (3)
  grounding no longer takes the most-*popular* TMDB hit — `groundOne` matches by
  release-year OR **title similarity** (Dice bigrams ≥ 0.55 + substring,
  `titleSimilar()`), else drops the candidate. UI: a `ConfidenceChip` per film in
  `extract/client.tsx` (`strong match` ≥ 0.8 · `NN% match` ≥ 0.6 ·
  `low · double-check`). **Test on a FRESH reel** (old extractions cached ~30d).
  Details in `HANDOFF.md` § "Extraction precision + confidence".
- **Marketing website — handover written (2026-07-01).** `WEBSITE-HANDOFF.md`
  (repo root) briefs a **separate website repo + Claude Code session** (marketing
  site + waitlist + legal/support + PWA-install explainer). Key gotcha:
  `cinechrony.com` = marketing, `app.cinechrony.com` = app (a PWA installs the
  origin you're on, so `/install` must route to the app origin; the real install
  prompt lives in THIS repo). Product-demo scripts were delivered in-session.
  **iOS beta path:** with the paid Apple account, **TestFlight** public link is the
  effectively-one-tap install channel (up to 10,000 external testers).
- **Phase C — AI "share a video → extract films" hero feature: web-first flow
  COMPLETE & MERGED to `main` (2026-06-28, merge `34bd93e`).** Validated live on
  the Vercel preview by the owner across IG/YouTube/TikTok.
  Paste/share a TikTok·Reel·Short → Apify acquires it → **Gemini watches it**
  (audio + on-screen text + footage) → TMDB grounds the films → save to lists with
  the source video attached. Built: `POST /api/v1/extractions`
  · `GET /[jobId]` · `POST /[jobId]/save`; `src/lib/extraction-server.ts` +
  `gemini-server.ts` + `video-acquire-server.ts` + `extraction-types.ts`; the
  `/extract` UI (destination = pick an existing list OR create-new via
  `list-picker-sheet.tsx`); home "scan" → `/extract`. Per-provider Apify actors (IG →
  `easyapi~instagram-reels-downloader`, TikTok → `wilcode~…`, YouTube → Gemini
  direct), all runs capped 120s/1024MB + retried. **Robust + scalable:**
  cache-stampede dedup (1000 concurrent scans of one video → ONE pipeline) +
  self-healing jobs + poll backoff; **multi-model Gemini fallback**
  (2.5-flash → 2.0-flash → 2.5-flash-lite, separate capacity pools) + caption
  net; pipeline gated on `GEMINI_API_KEY` (falls back to fixtures in tests →
  audit 477/477). Env: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_MODEL_FALLBACKS`,
  `APIFY_TOKEN`, `APIFY_ACTOR_ID`, `APIFY_ACTOR_INSTAGRAM`. Details in
  `HANDOFF.md` § "Phase C" + `PHASE-C-PLAN.md`.
  **Next:** C.3 iOS Share Extension (the native doorway; `/extract?url=` ready).
  Owner TODO: add `APIFY_ACTOR_INSTAGRAM` to Vercel (IG works without it via a
  built-in fallback); set a Firestore TTL on `extraction_jobs.createdAt`.
- **Letterboxd-import hardening (on `main`):** every Apify run is cost-capped
  (timeout+memory — kills the 1-hour ~$3.70 runaway reviews runs); the reviews
  sync is now fault-tolerant (salvages partial data, retries once, idempotent).
- **iOS native bring-up — first Simulator run (2026-06-27), MERGED to `main`.** The Capacitor iOS app now runs
  end-to-end on the Simulator. Getting there fixed five **WKWebView-only** bugs
  (web/PWA unaffected — each fix is native-only or a web no-op):
  (1) added `ios/App/App/GoogleService-Info.plist` (registered the iOS app in
  Firebase `studio-2541484065-75c27`; **gitignored** — public client id, not a
  secret); (2) **auth init** — `getAuth()` hangs in the WebView, so
  `src/firebase/index.ts::resolveAuth()` uses `initializeAuth(app, {persistence:
  indexedDBLocalPersistence})` (no popup/redirect resolver) on native; (3)
  **Firestore** — `experimentalForceLongPolling:true` on native (the streaming
  WebChannel transport can't connect → reads came back empty); (4) **dynamic-route
  navigation** — static export ships one `_` shell per dynamic route, so
  `/lists/<id>` 404s its RSC and crashes; **`src/lib/native-nav.ts`** is a
  web-noop shim (overrides `useRouter`/`useParams` + patched `Link`) routing to
  the shell with ids in the query (~28 files swapped import source); (5) **Radix
  popovers don't open in the WebView** (open on `pointerdown`) → replaced all 6
  DropdownMenu/Select menus with a Vaul **`src/components/ui/sheet-menu.tsx`**
  (`SheetMenu`/`SheetMenuItem`/`SheetMenuLabel`, opened by a plain `onClick`).
  Plus: invite/card-overflow share links now use `shareOrigin()` (were
  `window.location.origin` → dead `capacitor://localhost` links). Build for the
  Sim: `NEXT_PUBLIC_API_BASE_URL=https://movienight-kappa.vercel.app npm run
  build:static && npx cap sync ios`. Open `ios/App/App.xcodeproj` and ▶ (free
  Apple ID OK for Simulator). Debug native JS via Safari → Develop → Simulator.
  Details + remaining items (CLEAR-rating, app icon, WebP warnings) in
  **`HANDOFF.md` § "iOS native bring-up"**. The 3 firebase/nav/plist commits are
  pushed; the menu/link batch is uncommitted.

- **Phases A + B + 0.5 + 0.7 all merged to `main`** (A+B via PR #88 tip `9c81360`;
  **Phase 0.7 merged 2026-06-23, merge `e26871c`** — `feat/v3-redesign` is fully
  integrated; the entire app is v3, no v2 surfaces left).
  `src/app/actions.ts` is deleted — every former Server Action is now a
  `/api/v1/*` route handler (Bearer-token auth, envelope contract) or a
  helper in `src/lib/<domain>-server.ts` (see `src/app/CLAUDE.md`).
  Capacitor 8 wraps the static `out/` bundle in native iOS + Android shells
  (`ios/` + `android/`); native auth, FCM push, Universal Links, native
  polish all in code. Owner manual setup in `PHASE-B-HANDOFF.md`.
- **Phase 0.7 — v3 iOS-native redesign: COMPLETE & merged to `main`** (2026-06-23).
  A screen-by-screen restyle to the downloaded Claude Design package, plus a
  native-feel motion layer (haptics + push/pop transitions + app-wide swipe-back
  all done).
  Tracker: **`PHASE-0.7-REDESIGN.md`**. Done: **Profile tab family**, **Search**
  (0.7.3.6), and the **full Home / feed revamp** (0.7.3.1 a/b + R1/R2 — recomposed
  to `ios-home.jsx`): `font-ui` system-sans; underline `for you·friends` tabs;
  icon-only red pencil FAB; **discovery rails** (dig in [client-direct TMDB] · top
  watchers [new `GET /api/v1/leaderboard`] · featured hero · from-the-community,
  all real loved-lists/TMDB data); and the **borderless reel** (`DiaryEntry` +
  `MovieCell`+`MediaGallery` + inline "because you liked X" poster rows). v3
  primitives in `src/components/v3/*`. The home **feed is now posts-only**
  (rated/reviewed dropped); captions are Bricolage. **The F-screen
  interaction-surface Waves 1–6 are all DONE** (rail detail screens → movie-drawer
  cluster + watch-log → create-a-post → threads + reviews wall → reel·player →
  data-rail finish); see `PHASE-0.7-REDESIGN.md` § "0.7.3.2+". **Wave 7 so far:
  notifications (2026-06-19) + onboarding & auth (2026-06-20) are v3.** The
  onboarding flow was **reordered account-LAST** (welcome → name → letterboxd →
  handle → email[create account] → importing → find-your-people; + login · forgot ·
  check-email · reset). Name/letterboxd-handle/@handle are LOCAL state until the
  email step creates the Firebase account, which then provisions the profile,
  reserves the handle, and fires the import. New v3 kit: `v3/onboarding-kit.tsx` ·
  `v3/poster-wall.tsx` · `v3/social-auth-row.tsx` + step components under
  `onboarding/components/*`. The **letterboxd username scrape** is wired in
  (cheap `/preview` "found" state → an **async, chunked import**:
  `scrape/start` → poll `scrape/status` → `scrape/import` films-in-120-chunks
  with concurrent TMDB matching + a **lovable progress UI** (a real poster wall
  builds, counters tick, ETA, stat reveal), so a thousands-film library never
  blows the serverless time budget. The import lives in a **store**
  (`import-store.ts`) that survives navigation, so "continue in the app" hands off
  to a background **progress pill** (+ resume-on-kill); rated/reviewed films import
  as **Watched**. **Reviews import in the BACKGROUND** after onboarding via
  `<PendingImportSync/>` + `/reviews/sync` (canonical `parentId:null` docs so they
  show in the wall) — the browser actor is minutes-slow so it's never part of the
  wait — and it degrades gracefully when `APIFY_TOKEN` is unset; **username login**
  via secure
  `/api/v1/auth/login` (custom token, email stays private). **Wave 7** (settings ·
  invite · add · list-settings), **native motion slice 2** (push/pop transitions +
  app-wide swipe-back), **story share (0.7.4)**, and **share-link OG/Twitter cards**
  are all DONE & merged. The ONLY deferred Phase 0.7 item is the OPTIONAL
  direct-to-IG pasteboard path (0.7.6.2/3 — a native Swift plugin for the tappable
  link sticker; the share-sheet path ships and satisfies the design). **Next: Phase
  C — iOS Share Extension.**
- **Story share — 0.7.4 DONE (2026-06-23):** "tap share on a post → a branded
  9:16 card, ready for the Instagram story composer" (design screen 06), three
  variants: **review·immersive · watched·paper · list·dark**. Renderer
  `GET /api/v1/share/story` (`next/og`/Satori, `runtime='nodejs'`, 1080×1920) —
  lives under `/api/v1` so the static export excludes it and the native app
  fetches the PNG cross-origin (ACAO:* on the response). **No Firestore / no
  auth:** the client serializes card content into query params
  (`src/lib/story-card.ts`, pure helpers + wire contract) — quota-safe, and the
  output is public anyway. Brand TTFs vendored in `public/fonts/**` (read via fs;
  `outputFileTracingIncludes` bundles them); poster/avatar pre-fetched to
  data-URIs with a timeout → deterministic colour-placeholder fallback. Delivery:
  `@capacitor/share` + `@capacitor/filesystem` (write PNG → `Share.share({files})`
  → IG Stories; web = `navigator.share`/download) in `src/lib/story-share.ts`. An
  app-wide **`StoryShareProvider`** (root layout) exposes
  `useStoryShare().open(payload)` + a Vaul preview sheet; wired on **post/reel**
  (post-card → watched), **reviews wall** (review-react-overlay long-press →
  review), and the **list header** (own + public → list). Verified: typecheck ·
  build · build:static · `cap sync ios` (9 plugins) · audit 460/460 · all three
  PNGs render + visually checked.
- **⚠ Free-tier Firestore (no Blaze — owner budget):** locked decision 4 — build
  quota-first (client-direct TMDB · `server-cache.ts` TTL caches · route
  `softFallback` · lazy detail reads · no per-item N+1). **Deep read-reduction
  pass (2026-06-16, see [[project_quota_read_reduction]]):** `useCachedAction`
  now TTL-gates revalidation (`{staleTime}` + `isCachedActionFresh`) so repeat
  navigations don't refetch; leaderboard uses `getFollowingIds` (no 200-profile
  hydration); `getBlockSet`/collab/members/preview/unread-count/activity-author
  all server-TTL-cached **with write-invalidation** (the cardinal rule — never
  show the user stale data after their OWN action); unbounded queries capped;
  bell poll 30s→120s+cached. Verified by a 9-agent read audit + 5-agent
  adversarial cache-invalidation review (caught + fixed 3 stale-after-own-action
  bugs). Repeat home nav ≈ 0 reads (was ~270); idle bell ~75% lower. Firestore
  client persistence (`persistentLocalCache`) already mitigates the real-time
  `onSnapshot` channel. Preview deploys call their **own** API so server changes
  show on a preview.
- **Verification (every 0.7 PR + the final 0.7 merge):** typecheck ✓ · `npm run
  build` (Vercel) ✓ · `npm run build:static` (Capacitor) ✓ · audit suite green
  (**460/460**). Presentational — must not regress logic.
- **0.7.3.2+ interaction waves (`PHASE-0.7-REDESIGN.md`):** **Wave 1** (rail
  detail screens F15/F16/F17) ✅ + **Wave 2** (movie-drawer cluster) ✅ merged on
  `feat/v3-redesign`. Wave 2 unified the two detail modals into one **`MovieDrawer`**
  (`movie-drawer.tsx`, `{standalone|in-list}` context; old `public-`/`movie-details-modal.tsx`
  are thin adapters) to the F01/F02 design — scores (IMDb/RT/Metacritic+awards),
  where-to-watch (TMDB JustWatch), cast & crew, `v3/drag-to-rate.tsx`, light+dark.
  New **`/users/{uid}/watches`** watch-log (`watches-server.ts` · `/api/v1/watches`
  · F03 `v3/how-was-it-sheet.tsx`) powers `your history` + "how was it?".
  **Wave 3** (create-a-post F04 + post-thread F21 + reel F22) ✅ — the composer
  (`post-composer.tsx`, FAB) with film-optional / **text-required** rule, picker
  sheets (`v3/film-picker-sheet` · `tag-friends-sheet` · `watched-on-sheet` ·
  `visible-to-sheet`), the audience model (`canViewPost`, server-only
  `/closeFriends/{uid}`), the X-style thread (no bottom nav, keyboard-riding
  reply bar), and the forced-dark IG-style `v3/reel-viewer.tsx`.
- **Theme + profile polish (2026-06-17):** light/dark/system is now a **visible**
  top-right toggle on **every tab** — `ThemeToggle` gained `default` + `glass`
  variants (home/lists bars + the profile hero) with an active-choice checkmark,
  a Settings → **Appearance** `Segmented`, and a shared `DEFAULT_THEME` (from
  `theme-provider.tsx`) so the pre-mount fallback can't drift; the avatar menu is
  reverted to its original. Profile activity rows (`RecentRow`) + the
  `EditProfileSheet` were brought up to the **v3 sizing standard** (see
  `src/components/CLAUDE.md`). next-themes is client-side only (default = light;
  the 0.7.1.4 spec's "system-default" is a one-line flip if wanted).
- **Hot-take card (0.7.5.4, 2026-06-17):** the design's green quote card is now
  built — `GET /api/v1/reviews/highlights` (`getReviewHighlights`) serves a
  GLOBAL, 30-min-cached, index-free pool of short high-rated top-level reviews
  (per-caller filtered for own/blocks; `softFallback: []`; empty hides it — real
  data only); `HotTakeCard` is interleaved into the reel (`activity-feed.tsx`,
  leads then every 8, for-you only, client block/mute/self filter). Tests:
  `46-review-highlights`. **Home + feed are fully composed** (a 2026-06-17 sizing
  pass took the search row to `h-12` and the post movie-cell poster to the
  standard 48×72; leaderboard "view all" + profile top-5 also de-timidified).
- **Reviews wall — Wave 4 F07 COMPLETE (2026-06-18):** `/movie/[tmdbId]/comments`
  rebuilt as the **F12 reviews wall** (friends-framed score card + loved/liked/
  fine/nope distribution + friends-seen rail + helpful/recent/highest sort +
  featured most-helpful + review cards w/ score-badge-or-NOTE + 5 icon reactions
  + threaded reply bubbles), **F13** rating-forward composer, **F14** long-press
  react/action overlay, **F15** reply mode. New backend: a `reactions` map on
  reviews (one-per-user) + `POST/DELETE /api/v1/reviews/[id]/react`;
  `getReviewsWall` + **`GET /api/v1/movies/[tmdbId]/reviews-wall`** (publicApiRoute
  optional-auth; ONE index-free scan → summary + grouped reviews/replies;
  deliberately no-cache for no-stale-after-own-post; block-filtered). Shared pure
  helpers `review-verdict.ts` + `review-reactions.ts`; v3 components
  `reviews-summary-card` · `review-wall-card` · `review-composer-sheet` ·
  `review-react-overlay` · `reaction-icon`. Tests: `47-reviews-wall-react`.
  Reviewed by a 2-pass adversarial workflow (server + client) — fixed a
  helpful-double-tap desync (debounce + treat 409 as success) + a stale-snapshot
  overlay + long-press flag. **"add a still" on reviews is a tracked fast-follow.**
- **Reconciled remaining UI/UX (see `PHASE-0.7-REDESIGN.md` § "Status snapshot"):**
  core surfaces (home · search · lists + own list detail · **public list detail** ·
  profile · movie drawer · create-post/thread/reel · **reviews wall** · data rails)
  are **v3 done**. The editable + read-only lists now share ONE cell
  (`movie-cell.tsx`) + `MovieList` (with a `publicReadOnly` mode) so they can't
  drift again; the legacy "cards" view was retired. **Wave 7 is fully v3:**
  notifications · onboarding · auth · **settings · invite · add · list-settings**
  (2026-06-22) — the entire app is now v3, no v2 surfaces left.
- **Native motion slice 2 (2026-06-23):** app-wide iOS-native page transitions +
  edge-swipe-back via `<NativeTransitions>` (root layout, wraps `{children}`):
  push → slide-in-from-right, pop → slide-in-from-left + parallax dim, tab↔tab →
  instant, plus an interactive left-edge swipe-back everywhere. Direct-DOM
  transforms CLEARED when idle (never leaves a transform on the tree → no
  `fixed`/sticky breakage, the BodyStyleWatchdog class of bug); direction from a
  pathname stack + popstate; gated to native/coarse-pointer + reduced-motion;
  swipe suppressed on tab roots, `/movie/…/comments` (owns its `SwipeBackContainer`),
  and under any covering fixed overlay (detected by walking up from the touch
  target — no overlay opts in). **iOS native project synced** (`npx cap sync ios`):
  `@capacitor/haptics` now registered in `CapApp-SPM/Package.swift` (was missing —
  haptics now fire on a real build) + latest web bundle copied in.
  Plus native motion (push/pop transitions + app-wide swipe-back) and the
  story-share feature (`@vercel/og` + `@capacitor/share`).
- **Share-link OpenGraph/Twitter cards (2026-06-23):** every shared link now
  previews as a branded card. **`GET /api/v1/share/og`** renders a 1200×630
  (1.91:1) link card (param-driven, no Firestore; same Satori/font infra as the
  story card — extracted to `src/lib/og-shared.ts`). `generateMetadata` on
  `/post/[id]`, `/profile/[username]`, `/profile/[username]/lists/[listId]` (+ a
  site-wide default in `layout.tsx`) emits `openGraph` + `twitter:summary_large_image`
  via `src/lib/share-meta.ts` (`deployOrigin()` → absolute URLs; the `_` static-shell
  param + any private/missing entity fall back to brand defaults, so `build:static`
  is safe). Crawlers hit the Vercel SSR deploy → dynamic per-entity cards. The
  **story share sheet** also gained a **"send to a friend"** action (`sendToFriend`
  in `story-share.ts` → OS share sheet with the image + a deep link → iMessage /
  WhatsApp / AirDrop). **Preview-broken-image fix:** `storyImageUrl` now resolves
  via `apiOrigin()` (same-origin on web/preview — so the route is reachable) not
  `shareOrigin()` (which pointed at prod, 404 pre-merge).
- **Post-0.7 launch-prep (all merged to `main`, 2026-06-23):**
  - **Verified / official accounts (RBAC + badge).** `users/{uid}.verified` (the
    public flag, auto-indexed single-field) + a `{verified, admin}` Auth custom
    claim, granted by **`scripts/grant-verified.ts <username>`** (Admin SDK).
    `firestore.rules` BLOCKS clients from self-setting `verified`.
    **`GET /api/v1/verified`** serves the tiny public uid set; `UserVerifiedCacheProvider`
    (root layout) loads it once for O(1) `isVerified(uid)`. `<VerifiedBadge uid|verified>`
    (film-red ✓) is rendered on post + activity bylines, review cards + replies, the
    reel, and both profile headers. `src/lib/verified-server.ts`. **`@cinechrony` is
    granted** (the official account). Pure web/Firebase — no native dep.
  - **Featured official lists.** `getLovedLists` floats verified-owner lists to the
    FRONT of the community rail, gated on quality (`FEATURED_MIN_MOVIES = 5` films
    AND a cover image, capped at `FEATURED_MAX = 3`); non-qualifying verified lists
    rank normally. Tunable constants in `lists-server.ts`.
  - **Story-share polish.** Real cinechrony **popcorn logo** on the cards (bundled
    `public/brand/cinechrony-logo.png`, read via `logoDataUri()` in `og-shared.ts`;
    drawn clapper only as fallback). New **`kind:'post'`** variant — recreates a
    feed post (byline + star verdict + caption + film cell + ♥/💬 stats + the post's
    real media as a hero, video → thumbnail+play badge; text posts center the card).
    `post-card` share now always uses it (film optional). `CARD_VERSION` cache-buster
    (now `v4`) on every card URL — **bump it on any card design change**.
  - **Bug fixes.** `card-overflow-menu` (the ⋯ sheet) restyled serif→`font-ui` v3.
    The custom **Toggle** knob no longer overflows the track (explicit `left` +
    `border-0 p-0`; was UA button-padding) — settings + list-settings.
    **Self-healing real-time hooks** (`useDoc` + `useCollection`): a Firestore
    listener is dead after an error (token expiry / dropped WebChannel on
    background) — both hooks now KEEP last-known data + RE-SUBSCRIBE with backoff,
    so profile/lists no longer go blank-until-restart. See `src/firebase/CLAUDE.md`.
  - **Admin scripts:** `scripts/grant-verified.ts`, `scripts/set-display-name.ts`
    (both Admin SDK, load `.env.local`, run via `npx tsx`).
- **Branded transactional email — Resend (2026-06-23, on `main`):** forgot-password
  emails are now **branded** (popcorn logo, film-red CTA, table-based HTML that
  renders across mail clients) and sent via **Resend** (`cinechrony.com` is the
  verified sender domain). `src/lib/email-server.ts` — `isEmailConfigured()`
  (`!!RESEND_API_KEY`), `sendEmail()`, `renderShell()`, `sendPasswordResetEmail()`;
  `FROM = 'cinechrony <noreply@cinechrony.com>'` (override with `RESEND_FROM`).
  **`POST /api/v1/auth/forgot-password`** (`publicApiRoute`, `skipAuth`) mints the
  secure link via Firebase Admin `generatePasswordResetLink(email)` (Firebase still
  owns the oobCode/token — only delivery+design move to Resend) and emails it; per-
  email 60s throttle + AUDIT 2.10 non-disclosure (always returns success-shaped).
  **Graceful fallback:** if `RESEND_API_KEY` is unset OR the route is unreachable,
  the client (`(auth)/forgot-password/page.tsx`) falls back to Firebase's own
  `sendPasswordResetEmail` — reset always works. **Verified from terminal:** the
  Firebase custom action URL ALREADY points at `movienight-kappa.vercel.app/reset-password`
  (no Console change needed). The module also supports a future welcome-on-signup email.
- **Website sequencing — DECISION (2026-06-24):** make `cinechrony.com` "professional"
  is **NOT a blocker for the next steps** — do a *thin slice first, full marketing
  site later*. Must-do-before-TestFlight: (1) point `cinechrony.com` → Vercel and
  make it the single prod origin (resolves the `movienight-kappa` vs
  `cinechrony.vercel.app` discrepancy that iOS auth / Universal Links / AASA all
  depend on); (2) ship minimal `/privacy` + `/support` pages (App Store Connect
  REQUIRES a privacy-policy URL + support URL to submit). The polished marketing
  landing page (hero, App Store screenshots + badge, feature sections) can be built
  **during the TestFlight beta window** — it gates public launch, not the beta.
- **Owner actions:** ~~`firebase deploy --only firestore:indexes`~~ + ~~`--only
  firestore:rules`~~ **(DONE — deployed to `studio-2541484065-75c27`)**;
  ~~`npx cap sync`~~ (DONE); ~~`APIFY_TOKEN` in Vercel~~ (user reports set);
  ~~`RESEND_API_KEY` in Vercel~~ (user reports added — **redeploy to pick it up,
  then test forgot-password**). **Remaining (pre-TestFlight):** point
  **`cinechrony.com` → Vercel** as the single prod origin + set the iOS
  `NEXT_PUBLIC_API_BASE_URL` to it (see `PHASE-B-HANDOFF.md` §9); add `/privacy` +
  `/support` pages.
- **NOW (Phase C web-first + extraction precision done):** (1) build the
  **marketing website** in a separate repo (brief: `WEBSITE-HANDOFF.md`) with the
  waitlist + legal/support + PWA-install explainer, on the `cinechrony.com` /
  `app.cinechrony.com` domain split; (2) build the app-repo **PWA `<InstallPrompt>`**
  + `/support` page; (3) buy the **paid Apple Developer account** → **TestFlight**
  public-link beta; then (4) **Phase C — iOS Share Extension** (the native doorway;
  `/extract?url=` ready). Owner's forward plan after beta: turn the feature into
  push notifications, automate demo content, then submit to the App Store. Optional
  carry-overs: direct-to-IG pasteboard plugin (0.7.6.2/3, needs a native build);
  welcome-on-signup email (module already there); an `@cinechrony`
  admin/moderation console (the `admin` claim is already provisioned).

## Quick Reference

```
Tech Stack:  Next.js 15 + React 19 + Firebase + Tailwind + Vaul + Capacitor 8
DB:          Firestore (real-time subscriptions)
Auth:        Firebase Auth (email/password + Google + Apple, native + web)
Storage:     Cloudflare R2 (avatars, covers, post media)
APIs:        TMDB (movie data), OMDB (IMDB ratings)
Push:        FCM (native iOS/Android) + web-push (desktop browser)
Targets:     Web (Vercel SSR) + iOS app (App Store) + Android app (Play Store)
Build:       `npm run build` (Vercel) · `npm run build:static` (Capacitor `out/`)
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser/PWA)                      │
├─────────────────────────────────────────────────────────────────┤
│  Next.js App Router                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Pages/Routes│  │ Components  │  │ Firebase Client SDK     │  │
│  │ (RSC + CSR) │  │ (React 19)  │  │ (Real-time listeners)   │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                      │                │
│         ▼                ▼                      ▼                │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    State Management                         │ │
│  │  • useCollection/useDoc (real-time Firestore hooks)        │ │
│  │  • React Context (Firebase, ListMembersCache, RatingsCache)│ │
│  │  • Local state + useTransition (optimistic updates)        │ │
│  │  • Denormalized data (addedBy info, noteAuthors on movies) │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│        SERVER — /api/v1/* route handlers (Phase A, 2026-06)      │
├─────────────────────────────────────────────────────────────────┤
│  src/app/api/v1/**/route.ts  (actions.ts is DELETED)            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  apiRoute/publicApiRoute wrappers (Bearer auth, envelope) │   │
│  │  → src/lib/<domain>-server.ts helpers (Firebase Admin SDK)│   │
│  │  • profiles · lists · movies · invites · follows          │   │
│  │  • reviews · ratings · watches · activities · posts        │   │
│  │  • notifications + push · bookmarks/mutes/blocks/reports   │   │
│  │  • TMDB/OMDB proxies · letterboxd import · share/story+og  │   │
│  │  • File uploads (avatars → R2, covers → R2, post media)    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        EXTERNAL SERVICES                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Firebase   │  │ Cloudflare R2│  │      TMDB API        │  │
│  │  Firestore   │  │   (Storage)  │  │   (Movie Search)     │  │
│  │    Auth      │  │              │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model (Firestore)

```
/users/{userId}
  ├── uid, email, displayName, photoURL
  ├── username (unique), bio
  ├── followersCount, followingCount
  ├── favoriteMovies[] (top 5)
  ├── createdAt
  │
  ├── /lists/{listId}
  │     ├── name, isDefault, isPublic
  │     ├── ownerId, collaboratorIds[]  # Max 10 members total
  │     ├── coverImageUrl, movieCount
  │     ├── createdAt, updatedAt
  │     │
  │     └── /movies/{movieId}
  │           ├── title, year, posterUrl
  │           ├── status ('To Watch' | 'Watched')
  │           ├── mediaType ('movie' | 'tv')
  │           ├── tmdbId, rating, overview
  │           ├── socialLink (TikTok/IG/YT URL)
  │           ├── notes: { [userId]: string }
  │           ├── noteAuthors: { [userId]: { username, displayName, photoURL } }  # Denormalized
  │           ├── addedBy, createdAt
  │           ├── addedByDisplayName, addedByUsername, addedByPhotoURL  # Denormalized
  │           └── (denormalized fields populated at write time)
  │
  ├── /followers/{followerId}
  │     └── followerId, followingId, createdAt
  │
  └── /following/{followingId}
        └── followerId, followingId, createdAt

/invites/{inviteId}
  ├── listId, listName, listOwnerId
  ├── inviterId, inviteeId (optional)
  ├── inviteCode (for link invites)
  ├── status ('pending' | 'accepted' | 'declined' | 'revoked')
  └── createdAt, expiresAt

/reviews/{reviewId}
  ├── tmdbId, mediaType, movieTitle
  ├── userId, username, userDisplayName
  ├── text, ratingAtTime
  ├── likes, likedBy[]
  ├── parentId (null for top-level, reviewId for replies)  # Threading
  ├── replyCount (number of replies)                        # Threading
  └── createdAt, updatedAt

/ratings/{ratingId}  (format: {userId}_{tmdbId})
  ├── userId, tmdbId, mediaType
  ├── movieTitle, moviePosterUrl
  ├── rating (1.0-10.0)          # one canonical rating per user per film
  └── createdAt, updatedAt

/users/{userId}/watches/{watchId}  (Phase 0.7 Wave 2 — the watch log)
  ├── tmdbId, mediaType, movieTitle, moviePosterUrl
  ├── watchedAt, rating (per-watch snapshot | null), note (| null)
  ├── ordinal (1 = first watch, 2 = rewatch no. 2, …)
  └── createdAt
  # Server-only writes (logWatch) + owner-read. Powers the drawer's "your
  # history". /ratings stays the canonical rating; the note becomes the
  # user's single /reviews entry. Index-free reads (tmdbId equality).

/notifications/{notificationId}
  ├── userId (recipient)
  ├── type ('mention' | 'reply' | 'like' | 'follow' | 'list_invite')
  ├── fromUserId, fromUsername, fromDisplayName, fromPhotoUrl
  ├── reviewId, tmdbId, mediaType, movieTitle (for review notifications)
  ├── inviteId, listId, listName, listOwnerId (for list_invite notifications)
  ├── previewText
  ├── read (boolean)
  └── createdAt

/activities/{activityId}
  ├── userId, username, displayName, photoURL  # Denormalized
  ├── type ('added' | 'rated' | 'watched' | 'reviewed')
  ├── tmdbId, movieTitle, moviePosterUrl, movieYear, mediaType
  ├── rating (for 'rated' type)
  ├── reviewText, reviewId (for 'reviewed' type)
  ├── listId, listName (for 'added' type)
  ├── likes, likedBy[]
  └── createdAt

/usernames/{username}
  └── uid (for uniqueness enforcement)
```

---

## Directory Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/            # Auth pages (login, signup, forgot-password)
│   ├── home/              # Dashboard
│   ├── add/               # Add movie page
│   ├── lists/             # User's lists
│   │   └── [listId]/      # Single list view + settings
│   ├── movie/[tmdbId]/    # Movie-specific pages
│   │   └── comments/      # Full-screen comments/reviews page
│   ├── profile/           # User profile
│   │   └── [username]/    # Public profiles + lists
│   ├── notifications/     # Notifications page (mentions, replies, invites)
│   ├── onboarding/        # New user onboarding flow
│   │   └── components/    # Letterboxd import guide, etc.
│   ├── invite/[code]/     # Invite acceptance
│   ├── api/               # API routes (admin backfill only)
│   ├── actions.ts         # ⭐ ALL server actions (~4800 lines)
│   └── layout.tsx         # Root layout (providers)
│
├── components/
│   ├── ui/                # shadcn/ui primitives
│   ├── movie-*.tsx        # Movie card variants (grid, list, card, modal)
│   ├── video-embed.tsx    # TikTok/IG/YouTube embeds
│   ├── rating-slider.tsx  # 1-10 rating with HSL colors
│   ├── reviews-list.tsx   # Movie reviews display
│   ├── review-card.tsx    # Single review with threading, @mentions
│   ├── notification-bell.tsx  # Header notification icon
│   ├── activity-feed.tsx  # Global activity feed with infinite scroll
│   ├── activity-card.tsx  # Individual activity card
│   ├── trending-movies.tsx # Trending movies carousel with IMDB ratings
│   ├── pull-to-refresh.tsx # Pull-to-refresh gesture for mobile
│   └── ...                # See src/components/CLAUDE.md
│
├── firebase/
│   ├── index.ts           # Client SDK initialization
│   ├── admin.ts           # Admin SDK (server-side)
│   ├── provider.tsx       # FirebaseProvider + auth hooks
│   ├── non-blocking-updates.tsx  # Fire-and-forget writes
│   └── firestore/         # useCollection, useDoc hooks
│
├── lib/
│   ├── types.ts           # ⭐ ALL TypeScript types
│   ├── utils.ts           # cn(), rating color system
│   └── video-utils.ts     # Video URL parsing
│
├── hooks/
│   ├── use-toast.ts       # Toast notifications
│   ├── use-mobile.tsx     # Mobile detection
│   └── use-viewport-height.ts  # iOS Safari viewport fix
│
└── contexts/
    ├── list-members-cache.tsx  # Collaborator caching
    └── user-ratings-cache.tsx  # User ratings O(1) lookup cache
```

---

## Key Patterns & Conventions

### 1. API Route Pattern (Phase A — Server Actions retired)
All mutations go through `/api/v1/*` route handlers. The client calls
`apiCall<T>(method, path, body?)` (`src/lib/api-client.ts`, Bearer token
auto-attached); the route wrapper verifies the token + serializes the
`{ ok, data | error }` envelope, then delegates to a pure helper in
`src/lib/<domain>-server.ts`. `src/app/actions.ts` no longer exists.

```typescript
// src/app/api/v1/lists/route.ts
export const POST = apiRoute(async (req, { auth }) => {
  const { name } = await req.json();
  return createList(auth.uid, name); // helper in src/lib/lists-server.ts
});
export const OPTIONS = optionsHandler;
```

### 2. Real-time Data Pattern
Client reads use Firebase Client SDK with real-time listeners:

```typescript
const moviesQuery = useMemoFirebase(
  () => query(collection(firestore, 'users', ownerId, 'lists', listId, 'movies')),
  [firestore, ownerId, listId]
);
const { data: movies, isLoading } = useCollection<Movie>(moviesQuery);
```

### 3. Non-blocking Writes Pattern
UI updates use fire-and-forget writes for snappy feel:

```typescript
// Doesn't await - errors go to global error handler
updateDocumentNonBlocking(movieDocRef, { status: 'Watched' });
```

### 4. Denormalization Pattern (N+1 Prevention)
User data is denormalized at write time to avoid per-movie fetches:

```typescript
// When adding a movie (in addMovieToList server action):
const movieDoc = {
  ...movieData,
  addedByDisplayName: userData?.displayName || null,
  addedByUsername: userData?.username || null,
  addedByPhotoURL: userData?.photoURL || null,
};

// When saving a note (in updateMovieNote server action):
await movieRef.update({
  [`notes.${userId}`]: note,
  [`noteAuthors.${userId}`]: {
    username: userData?.username,
    displayName: userData?.displayName,
    photoURL: userData?.photoURL,
  },
});
```

### 5. User Ratings Cache Pattern
Ratings are fetched once per session and cached for O(1) lookup:

```typescript
// In UserRatingsCacheProvider - fetches all ratings once
const { getRating } = useUserRatingsCache();

// In movie card components - instant lookup, no network call
const userRating = useMemo(() => getRating(tmdbId), [getRating, tmdbId]);
```

### 6. Component Memoization Pattern
List item components use React.memo with useMemo for computed values:

```typescript
export const MovieCardGrid = memo(function MovieCardGrid({ movie }) {
  const { getRating } = useUserRatingsCache();

  // O(1) rating lookup from cache
  const userRating = useMemo(() => getRating(tmdbId), [getRating, tmdbId]);

  // Use denormalized data - no fetch needed
  const addedByName = movie.addedByUsername || movie.addedByDisplayName || 'Someone';
});
```

### 7. Rating Color System
HSL interpolation for consistent red-to-green gradient:

```typescript
// Returns inline styles (not Tailwind classes) for bulletproof colors
const ratingStyle = getRatingStyle(7.5);
// { background: { backgroundColor: 'hsl(80, 70%, 50%)' }, ... }
```

### 8. iOS Safari Handling
- `useViewportHeight()` - Handles dynamic viewport with keyboard
- Vaul drawers for mobile-native modals
- `FullscreenTextInput` for reliable keyboard input (renders OUTSIDE Vaul to avoid focus trap)

### 9. Fullscreen Input Pattern for Drawers
When text input is needed inside a Vaul drawer, close the drawer and open `FullscreenTextInput`:

```typescript
// In add-movie-modal.tsx - social link input
type Step = 'search' | 'preview' | 'select-list' | 'edit-link';

// When user taps input field, transition to edit-link step (closes drawer)
<button onClick={() => setStep('edit-link')}>
  {socialLink || 'Paste TikTok, Reel, or YouTube link...'}
</button>

// Render FullscreenTextInput when drawer is CLOSED
<FullscreenTextInput
  isOpen={step === 'edit-link'}
  onClose={() => setStep('preview')}  // Returns to drawer
  onSave={async (text) => setSocialLink(text)}
  singleLine
  inputType="url"
/>
```

**Critical**: FullscreenTextInput must render when Vaul drawer is closed - the drawer's focus trap blocks input.

---

## Design System — v2 "editorial cinema"

> v1 was chunky neo-brutalist (3px black borders, hard 4×4 offset shadows,
> dot-grid paper). v2 is **editorial cinema**: newsprint cream paper, cinema-
> black ink, soft lifts, lowercase display headlines, a serif body, tabular
> dates. Even the FAB — v1's last brutalist holdout — is now a calm
> film-red pill.

**Foundations** (tokens in `src/app/globals.css`, oklch; bound in `tailwind.config.ts`):
- Surfaces: `bg-background` (newsprint cream), `bg-card` (bone). No dot grid.
- Borders: `border border-border` — a hairline, ~1px low-opacity. No 3px black.
- Shadows: `shadow-lift` (default card), `shadow-photo` (hero photo cards),
  `shadow-press` (inputs), `shadow-fab` (the soft film-red FAB lift).
- Typography: `font-headline` = Bricolage Grotesque (display, **lowercase**),
  `font-body` = Newsreader (serif), `font-mono` = Space Mono (data).
- Accent: `--primary` is film red — reserved for the one hero CTA + focus
  rings + the notification dot. Standard buttons are ink (`Button` default).

**Brand patterns:**
- Eyebrow → hairline → lowercase title at the top of every content block.
  Use `.cc-eyebrow` (UPPERCASE mono label) and `.cc-meta` / `.cc-lead`.
- Headlines are lowercase. The wordmark is always `cinechrony`.
- Tabular data (dates, runtimes, ratings) in Space Mono: `23.04.25`, `2h 14m`.
- Rating chips are a 3-bucket system (sage ≥7.5 / amber ≥5.5 / marker <5.5) —
  see `getRatingStyle()` in `src/lib/utils.ts`.
- No emoji in product copy. The voice does the playfulness; visuals stay calm.

**The FAB** — a film-red pill: white icon + lowercase label, no border, a
soft red-tinted lift (`shadow-fab`). One per screen, bottom-right. The v1
yellow brutalist sticker is retired; yellow is now a tertiary highlight only.
Use the shared `<Fab>` component — don't hand-roll one.
```typescript
import { Fab } from '@/components/fab';
import { Plus } from 'lucide-react';

<Fab icon={Plus} label="add" onClick={...} />        // inside a list
<Fab icon={Plus} label="new list" onClick={...} />   // lists screen
```

The full design system package (README.md + `colors_and_type.css` + UI kit)
is the source of truth for v2 — kept alongside the repo, not committed to it.

---

## Security Model

See `firestore.rules` for complete rules. Key principles:
- User profiles: Public read, owner-only write
- Lists: Public read if `isPublic`, owner/collaborator write
- Movies in lists: Inherit list permissions
- Invites: Owner creates, invitee accepts
- Usernames: Unique reservation system

---

## Common Tasks

### Adding a New Server Action
1. Add function to `src/app/actions.ts`
2. Export with `'use server'` at top of file
3. Use `getDb()` for Firestore access
4. Call `revalidatePath()` if needed

### Adding a New Component
1. Create in `src/components/`
2. Use `'use client'` for interactive components
3. Follow memo pattern for list items
4. Use `cn()` for conditional Tailwind classes

### Adding a New Route
1. Create `page.tsx` in `src/app/[route]/`
2. Use `layout.tsx` for shared UI
3. Protect with auth check in useEffect or middleware

### Modifying Data Model
1. Update types in `src/lib/types.ts`
2. Update `firestore.rules` if permissions change
3. Add migration in server action if needed
4. Update affected components

---

## Sub-documentation

- `src/app/CLAUDE.md` - Routes and pages
- `src/components/CLAUDE.md` - Component architecture
- `src/firebase/CLAUDE.md` - Firebase layer
- `src/lib/CLAUDE.md` - Utilities and types

---

## Performance Notes

- **Denormalization eliminates N+1 fetches**: User data (addedBy info, note authors) stored on movie docs at write time
- **UserRatingsCacheProvider**: Fetches all user ratings once, provides O(1) Map lookup via `getRating(tmdbId)`
- **Before**: ~100+ network calls per list view (user profile + rating per movie)
- **After**: 1-2 network calls total (real-time movie subscription + ratings cache)
- Components use `React.memo` to prevent re-renders
- `useMemoFirebase` ensures stable query references
- **Image Optimization Disabled**: `unoptimized: true` in next.config.ts to stay within Vercel free tier. TMDB already serves pre-optimized images at various sizes (w92, w185, w342, w500, w780), and R2 images are already on Cloudflare CDN.
- No virtualization needed (typical list < 50 items)

---

## Known Issues & TODOs

- [x] ~~OMDB API key exposed in client~~ (Fixed: moved to server via `getImdbRating` server action)
- [ ] Some TypeScript errors suppressed in `next.config.ts`
- [x] ~~Activity feed~~ (Implemented: global feed with infinite scroll, pull-to-refresh)
- [x] ~~N+1 fetch problem~~ (Fixed: denormalization + ratings cache)
- [x] ~~"Added by Someone" / "@user" for existing data~~ (Fixed: backfill script)
- [x] ~~Bio/Top 5 not showing on public profiles~~ (Fixed: getUserByUsername now returns bio + favoriteMovies)
- [x] ~~Collaborator limit too low~~ (Increased from 3 to 10)
- [x] ~~No way to revoke pending invites~~ (Added revoke button in invite modal)
- [x] ~~FAB buttons unclear for first-time users~~ (Added labels: "+ Add", "+ New List")
- [x] ~~Vercel image optimization quota exceeded~~ (Disabled: TMDB/R2 already CDN-optimized)
- [x] ~~Comments threading~~ (Added: Instagram/TikTok style 1-level threading)
- [x] ~~Letterboxd import guide missing images~~ (Added: 5-step screenshot tutorial)
- [x] ~~Notifications UI~~ (Enabled: NotificationBell in header, real-time badge)

## Admin Scripts

- `/api/admin/backfill-movies` - One-time migration to populate denormalized user data on existing movies
  - Run via GET in development, or POST with `x-admin-token` header in production

---

*Last updated: 2026-07-01 — Phase C web-first hero feature merged (`34bd93e`);
extraction precision pass + visible confidence scores merged (`5fa8472`);
marketing-website handover (`WEBSITE-HANDOFF.md`) written for a separate repo.
The "Current state" section at the top of this file is the authoritative
status; the dated sections below are a historical changelog.*

## Recent Changes (January 2025)

### Comments & Reviews System (Phase 1 & 2)
- Full-screen comments page at `/movie/[tmdbId]/comments`
- Instagram/TikTok style 1-level threading (reply to any comment)
- @mentions render as clickable profile links
- Swipe-back gesture returns to movie modal (iOS PWA)
- Like/unlike comments, sort by recent or top

### Notifications (Phase 3 - Complete)
- Full notifications system: @mentions, replies, likes, follows, list invites
- NotificationBell in header with real-time unread count badge
- Accept/Decline buttons for list invites directly in notifications page
- Notifications auto-deleted when invites are accepted/declined

### Letterboxd Import
- Step-by-step guide with 5 screenshot images
- Portrait layout optimized for mobile viewing

### Image Optimization
- Disabled Vercel image optimization (`unoptimized: true`)
- TMDB already serves pre-optimized images at multiple sizes
- R2 images served via Cloudflare CDN
- Prevents burning through Vercel's free tier quota

### Profile Page Redesign
- Stats displayed as styled boxes (followers, following, lists) with neo-brutalist shadows
- Lists count highlighted in yellow
- Bio text displayed in italics
- Public profiles now show bio and Top 5 Films (was missing before)

### Collaboration System
- Max collaborators increased from 3 to 10
- Added revoke button for pending invites in invite modal
- Invite modal shows accurate "X spots left" count

### iOS Keyboard Fixes
- Social link input in add-movie flow uses FullscreenTextInput
- Drawer closes during text input to avoid Vaul focus trap issues

### UX Improvements
- FAB buttons now show labels ("+ Add", "+ New List") for discoverability
- Extended pill-shaped FABs instead of icon-only circles

### Activity Feed (Phase 4)
- Global activity feed on home page showing all user actions
- Activity types: added (movie to list), rated, watched, reviewed
- Trending movies carousel with TMDB trending/day + IMDB ratings
- ActivityCard component with user avatar, action badge, movie poster
- Like/unlike activities with optimistic updates
- Infinite scroll using Intersection Observer (replaces "Load more" button)
- Pull-to-refresh gesture for mobile (iOS PWA native feel)
- Enhanced empty state with call-to-action
- "You're all caught up!" end-of-feed indicator

### Activity Feed Data Model
- `/activities` collection stores denormalized activity documents
- Activities created automatically when users: add movies, rate, mark watched, write reviews
- Cursor-based pagination for efficient loading
- Server actions: `getActivityFeed`, `likeActivity`, `unlikeActivity`, `createActivity` (internal)

### Security Fixes
- **Critical**: Fixed unauthorized list editing vulnerability where users could gain edit access to public lists by navigating from comments page back to list view
- Root cause: Permission check was based on `collabListData` being truthy (any public list), instead of verifying user's UID is in `collaboratorIds` array
- Added `returnPath` parameter to comments page to preserve original route context (e.g., `/profile/username/lists/listId`)

### Notifications Improvements
- Accept/Decline buttons for `list_invite` notifications directly in notification page
- `inviteId` field added to Notification type for handling invites
- Notifications auto-deleted when invite is accepted or declined (queries by `listId` for backwards compatibility with older invites)

### Collaboration System Improvements
- Real-time collaborator updates: `ListHeader` and settings page now track `collaboratorIds` changes and invalidate cache immediately
- No more 5-minute delay when someone accepts an invite - collaborator appears instantly via Firestore real-time subscription

### Pull-to-Refresh Universal Support
- Improved `PullToRefresh` component with direction locking (fixes diagonal swipe triggering refresh)
- Uses non-passive touch event listeners to allow `preventDefault()`
- Added `disabled` prop for when modals are open
- Now available on all main pages: Home, Lists, Individual List, Profile, Notifications

---

## Home / Discover Rebuild — Phase 0.5 (May 2026)

Branch `feat/home-discover-rebuild`. The home page was rebuilt as the unified
editorial feed and the bottom nav cut to **3 tabs** (`home · lists · profile`)
— the `/add` search tab is retired (search is a header overlay; `/add` still
works as a route but is out of nav).

### New collections / fields
- **`/posts/{postId}`** — user posts: `text`, `media[]` (image/video on R2),
  `taggedMovie`, `taggedUserIds[]` + denormalized `taggedUsers[]`, `place`,
  `likes`/`likedBy`, `commentCount`. Server-only. `/posts/{id}/comments/{id}` —
  1-level threaded comments.
- **`/blocks/{blockerId}_{blockedId}`** — block records, server-only. The
  client gets the invisibility union via `getMyBlockContext`.
- **`users/{uid}/bookmarks/{type}_{id}`** — the saved archive (owner-read).
- **`users/{uid}/mutes/{mutedId}`** — muted users (owner-read).
- List docs gained `likes` / `likedBy` / `lastLikedAt` (server-managed —
  `firestore.rules` blocks the owner from editing them).

### Key endpoints (formerly server actions — now `/api/v1/*` routes)
- Likes: `POST /api/v1/lists/.../like`, `/posts/.../like`, `/posts/.../comments/[cid]/like`.
- Discover: `GET /api/v1/lists/loved`, `/lists/search`, `/movies/[tmdbId]/similar`,
  `/recommendations`, `/friends-watching`.
- Feed: `GET /api/v1/feed/home`, `/feed/saved`.
- Posts: `POST /api/v1/posts/media-upload-url`, `/api/v1/posts` (create/update/delete),
  `/api/v1/posts/[id]/comments`.
- Safety: `/api/v1/blocks`, `/api/v1/mutes`, `/api/v1/bookmarks`,
  `/api/v1/blocks/context`, `/api/v1/reports`.

Helpers behind each route live in `src/lib/<domain>-server.ts`. See
`src/lib/CLAUDE.md` for the full module map.

### New cache providers (`src/contexts/`)
`UserBookmarksCacheProvider`, `UserMutesCacheProvider`, `UserBlocksCacheProvider`
— each loads its set once for O(1) lookup, mirroring `UserRatingsCacheProvider`.

### Notes
- The `nearby` feed pill was dropped (needs GPS, which `LAUNCH.md` forbids).
  Five pills ship: `all · saved · friends · for you · trending`.
- All audit tests green (126/126) — the redesign did not regress the
  security suite. New tests: `scripts/audit-tests/17`–`25`.

*Last updated: 2026-06-08*

---

## Phase A — Server Actions → `/api/v1/*` (2026-05-26 → 2026-06-02)

18 PRs, single stacked branch `feat/phase-a-leftover-actions`.
**`src/app/actions.ts` deleted.** Server-side logic now lives in
`src/lib/<domain>-server.ts` modules consumed by route handlers under
`src/app/api/v1/**`. Bearer ID-token auth, envelope contract (`{ ok, data
| error }`), per-endpoint rate limiting, CORS allowlist for Capacitor
WKWebView origin. Static-export build (`npm run build:static`) produces a
~3.7 MB `out/` directory consumed by Capacitor.

AUDIT items closed: 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.11, 1.12, 1.13, 1.14,
2.1, 2.2, 2.5, 2.6, 2.8, 2.9, 3.5 (across all five like surfaces), 3.8,
3.10, 4.2a.

Inventory: `scripts/api-refactor-inventory.md` (historical trace).

---

## Phase B — Capacitor wrap (2026-06-03 → 2026-06-08)

5 substeps, branch `feat/phase-b-capacitor-wrap` stacked on Phase A tip.
Capacitor 8 wraps the static `out/` bundle in native iOS + Android shells.

What landed:
- **B.1** — Capacitor install + `ios/` (SPM-based, no CocoaPods needed)
  + `android/` scaffolding + `capacitor.config.ts` with allowlist for
  Firebase / Apple / Vercel API.
- **B.2** — Native Google + Apple sign-in via
  `@capacitor-firebase/authentication`. `skipNativeAuth: true` — plugin
  handles native dialog, Firebase Web SDK stays the source of truth for
  `auth.currentUser`. Apple button hidden on web for v1 (no Apple Service
  ID yet). Email/password unchanged.
- **B.3** — Push delivery. Unified `src/lib/push-server.ts` fans out to
  both web-push and FCM. Every notification creator (mention, reply,
  review like, post tag, post like, post comment, list_invite, follow)
  now triggers a push. **Closes AUDIT 4.2.**
- **B.4** — Universal Links + Android App Links. AASA + assetlinks.json
  in `public/.well-known/`. `<DeepLinkHandler />` routes
  `App.appUrlOpen` events via Next.js router.
- **B.5** — Status bar (dark icons on cream), splash dismiss on React
  mount, safe-area CSS utilities (`pt-safe` / `pb-safe` / `pl-safe` /
  `pr-safe`), `overscroll-behavior-y: none` to kill WKWebView body
  rubber band, `viewport-fit: cover`, `@capacitor/assets` wired for
  one-command icon regeneration. **`PHASE-B-HANDOFF.md`** documents
  every owner-side manual step (Apple Developer account, Firebase
  Console iOS/Android, APNs key, Team ID + SHA256 patches, etc.).

Native components in root layout (all no-op on web):
`<NativeShellInit />`, `<NativePushRegistration />`, `<DeepLinkHandler />`.

Plugins added:
`@capacitor-firebase/authentication`, `@capacitor-firebase/messaging`,
`@capacitor/app`, `@capacitor/status-bar`, `@capacitor/splash-screen`,
`@capacitor/keyboard`, `@capacitor/assets`.

New npm scripts:
`cap:sync`, `cap:open:ios`, `cap:open:android`, `cap:run:ios`,
`cap:run:android`, `cap:assets`.
