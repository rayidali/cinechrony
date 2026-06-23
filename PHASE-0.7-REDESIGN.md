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
4. **Free-tier Firestore is the binding constraint (no Blaze — added 2026-06-15).**
   The owner is on the Spark plan (50K reads/day) until there's revenue, so
   every new screen is built **quota-first**: prefer **client-direct TMDB** for
   non-user data; **cache** shared server reads via `src/lib/server-cache.ts`;
   **soft-degrade** via the route `softFallback` so a quota blip empties a rail
   instead of 500-ing the page; **lazy-load** detail data on tap (drawer/thread),
   never on list render; and **never** add per-item N+1 "social proof" reads
   ("logged by N friends", "weekly movement") unless they fall out of an
   already-running capped scan or a cheap precomputed counter. Reads are the
   budget. (See the quota-hardening pass: `server-cache.ts` + `softFallback`.)

## Verification (applies to every UI item — same as Phase 0.4.3)

The redesign is **presentational — it must not regress logic.** Each PR:
typecheck clean · `npm run build` (Vercel) clean · `npm run build:static`
(Capacitor) clean · **audit suite stays green** (403+/403+). Plus a manual
walk of the restyled flow in `npm run dev`, light + dark, and a Simulator
check for the native-feel items (haptics/transitions can't be seen in a
browser).

---

## Status snapshot — 2026-06-17 (reconciled vs the codebase)

The redesign is essentially done for the **core surfaces**; what remains is the
"outer" screen cluster + native motion + the story-share feature.

**✅ Done:** foundation primitives (0.7.1.1–0.7.1.3) · theme toggle (0.7.1.4) ·
haptics (0.7.2.1) · instant tap states (0.7.2.3) · scroll-collapse chrome
(0.7.2.5) · **home/feed** (0.7.3.1 a–d) · **search** (0.7.3.6) · **lists** +
**own list detail** + **public list detail** (0.7.3.3/4/4b — editable + read-only
now share ONE `movie-cell.tsx` + `MovieList publicReadOnly`; legacy "cards" view
retired) · **profile** own+public (0.7.3.5) · **movie drawer** (Wave 2, + ambient
silent-trailer hero) · **create-a-post + post thread + reel** (Waves 3/5) ·
**reviews wall** (Wave 4 — F12–F15, 2026-06-18) · **data rails** — leaderboard +
weekly movement, dig-in/top-picks, featured, community, **hot-take card** (Wave 6
· 0.7.5.1–0.7.5.4) · **notifications** (Wave 7 · 2026-06-19) · **onboarding + auth**
(Wave 7 · 2026-06-20 — welcome · 4-step **account-last** signup · letterboxd
**username** import · login · forgot/check-email/reset).

**⬜ Remaining UI/UX — the "what's next" list:**
1. ✅ **Wave 7 — DONE (2026-06-22).** notifications · onboarding · auth · **settings ·
   invite · add · list-settings** are all v3. The entire app is now v3 — no v2
   surfaces remain. Settings (frosted header + grouped FieldCard sections + the
   appearance Segmented + v3 toggles + restyled delete modal + v3 blocked-users),
   list-settings (frosted header + cover/name + collaborators + visibility toggle +
   CtaButton save; shadcn AlertDialogs kept), add (v3 search row + 48×72 result rows
   + restyled Select + v3 add form), invite (poster-wall hero + IconTile + CtaButton).
   All logic preserved; haptics added.
2. **Native motion** — page push/pop transitions (0.7.2.2) + app-wide
   edge-swipe-back generalization (0.7.2.4 — today only on `/comments`).
3. **Story-share** (0.7.4.x) + **direct-to-IG** (0.7.6.x) — `@vercel/og` card
   renderer + `@capacitor/share`; not started (Phase-C-adjacent).
4. **QA gates** (0.7.1.5 / 0.7.2.6 / 0.7.3.8) — automated parts run every PR
   (typecheck · build · build:static · audit suite); a Simulator feel-pass is
   still owner-side.
5. **Fast-follows (small, non-blocking):** "add a still" on a review · presence-
   pill final wording from real activity · editable handle (backend feature) ·
   rich per-user share/OG cards (lands with 0.7.4) · dig-in "logged by N friends"
   (deferred — no cheap per-item read on the free tier).

---

## Phase order

### 0.7.0 — Branch base ✅ DONE 2026-06-13

- [x] A+B merged to `main` (PR #88, tip `9c81360`); `feat/v3-redesign` branched
  off the fresh `main`. This is where all 0.7 work lands.

### 0.7.1 — Foundation: tokens + native primitives (no new data)

- [x] **0.7.1.1** Extend `globals.css` + `tailwind.config.ts`: add `sunken`,
  `hair`, frosted `chrome` / `tabTint`, and the accent set (violet / blue /
  pink for leaderboard ranks + category dots). Keep all existing v2 tokens.
  Light + dark, values from `ios-kit.jsx::makeTokens`.
- [x] **0.7.1.2** Frosted-surface primitive (`<Frost>`) — `backdrop-filter:
  blur() saturate()` over the tint. Verify it renders in the Capacitor
  WKWebView (it does; confirm on Simulator). Used by top bar / tab bar / nav bar.
- [x] **0.7.1.3** Shared primitives to match the kit: `GlassBtn` (glass control
  over imagery), `Segmented` (sliding-thumb iOS control), `Section` header
  (eyebrow → title → trailing), `NavBar` (large lowercase title, collapses on
  scroll). Replace the `Fab` with the `AddBtn` (red round +) per design.
- [x] **0.7.1.4** Theme wiring (2026-06-17) — `next-themes`, every screen
  supports both. Shipped as a **visible** light/dark/system toggle in **every
  tab's top-right** (`theme-toggle.tsx` `variant="default"` bordered icon button
  → home `HomeTopBar` + lists `NavBar`; `variant="glass"` translucent circle →
  profile `Hero`), the dropdown checkmarks the active choice; PLUS a Settings →
  **Appearance** `Segmented`. Shared `DEFAULT_THEME` (exported from
  `theme-provider.tsx`) keeps the pre-mount fallback in lockstep with the
  provider. Client-side only (localStorage + `.dark` class) → identical in the
  Capacitor static build. **Note:** the original decision said "system by
  default"; shipped as **default = light** (the brand's paper theme). Flipping
  to system-default is a one-line `theme-provider.tsx` change if wanted.
- [ ] **0.7.1.5 — Test:** render each primitive on a scratch route in
  `npm run dev`, light + dark; typecheck + build green.

### 0.7.2 — Native-feel motion layer (mostly visual-independent; can parallelize)

- [x] **0.7.2.1** Install **`@capacitor/haptics`**; fire light impact on
  meaningful taps (like, save-to-list, add, tab switch, segmented switch,
  pull-to-refresh trigger) — no-op on web. (Closes the LAUNCH.md C.4.1 haptics
  item too.)
- [ ] **0.7.2.2** Native page transitions (push/pop slide + parallax) for
  pushed routes; replaces the deferred 0.6.4 tab shell. **Must respect the
  Vaul-drawer seam** — see `project-drawer-route-roundtrip` memory:
  BodyStyleWatchdog + the 220ms drawer-close defer stay in force; any
  transition work is tested against the modal→/comments→back round-trip.
- [x] **0.7.2.3** Instant tap/press states on every interactive element; kill
  the gray iOS tap-highlight flash.
- [ ] **0.7.2.4** App-wide edge-swipe-back (generalize the existing
  `SwipeBackContainer` beyond `/comments`).
- [x] **0.7.2.5** Scroll-collapse chrome (top bar / nav bar tint+blur+rule fade
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

- **0.7.3.1** **Home / feed** (centerpiece, `ios-home.jsx`). Too large for one
  PR — sliced a→d so each is independently reviewable on a Vercel preview,
  highest-structural-risk first. Design = the 6 `home / feed` mocks (light
  "paper" + dark "projection room"): `for you · friends` frosted tabs, search +
  red `scan`, **top picks → dig in**, **weekly leaderboard → top watchers**,
  **featured list hero carousel**, **lists for you → from the community**, and
  **the reel → watching lately** (presence pill + `DiaryEntry` posts +
  ticket-stub film card + media gallery + inline "because you liked X" rec rows
  + derived hot-take cards). Restyle only — same feed data/logic.
  - **FOUNDATION (this wave):** read the **actual design source**
    (`design_files/ios-{home,kit}.jsx`) for exact metrics rather than guessing
    off the mocks. Key fix: the design's `F_UI` is the **iOS system sans**
    (`-apple-system / SF Pro`), NOT Newsreader — so the app was missing a 4th
    font family. Added **`font-ui`** to `tailwind.config.ts` (chrome/handles/
    buttons/search/meta use it; Bricolage stays display-only; serif stays for
    pull-quotes). Accent tokens (`violet/blue/pink`) already existed. New shared
    **`Section`** primitive (`v3/section.tsx`) = eyebrow → 22px lowercase title
    (`wdth 95`) → trailing, matching `ios-kit.jsx::Section` exactly.
  - [x] **0.7.3.1a — Home shell & chrome** (structural foundation): frosted
    **scroll-collapsing top bar** with `for you · friends` **underline tabs**
    (Bricolage 22px `wdth 95`, film-red underline — the design's home tabs are
    underline-style, NOT the sunken `Segmented`). Right cluster = **bell + avatar
    only** (faithful to the 2-tab design). `saved` **dropped from the home tabs**
    — the bookmarks feed/endpoint + `BookmarkButton` are untouched (no logic
    lost); the saved *archive* will get a home under the **you** tab in a later
    slice. Search row + red `scan` to exact spec (`font-ui` 16px placeholder —
    fixes the serif-italic bug; scan = honest "coming soon" → Phase C hook). The
    **FAB is now an icon-only red pencil circle** (`Fab` gained a round variant;
    `PostFab` drops the label) — was a labelled pill. `TrendingStrip` kept
    (for-you only, interim) + `ActivityFeed` kept underneath.
  - [x] **0.7.3.1b — The reel cards** (built 2026-06-14): `PostCard` →
    **`DiaryEntry`** (`ios-home.jsx` exact): byline (40px avatar · `font-ui`
    bold handle · tabular-mono time) → **serif-italic caption** → **`MovieCell`**
    (poster chip · lowercase title · `year · film/tv` meta · film-red `+` →
    `AddToListSheet`; body tap → movie drawer) → **`MediaGallery`** (4:3 hero +
    `1/n` counter + thumbnail rail, reuses `VideoTile`) → **actions** (heart
    [film-red] · comment → `/post` · `share` pill [Web Share / clipboard] ·
    bookmark). `ActivityCard` brought to the same language (40px avatar,
    `font-ui` handle, film-red heart). **R2 (2026-06-15): the reel is now a
    borderless diary stream** — `DiaryEntry` + `ActivityCard` dropped the card
    chrome (full-bleed on the paper, `divide-y divide-hair` between entries); the
    in-reel **`RecommendationCard` is now the borderless "because you liked X"
    poster row** (sparkle eyebrow + lowercase headline + 3 posters with punched
    rating stickers). **All handlers preserved** (like /
    delete / report / overflow / bookmark / modal / add-to-list). **Deferrals
    (honest — no fake data):** the ☆fav badge + red kicker label (no post
    "lead"/fav field), video **duration** (not stored), the **movie-cell rating
    chip** (post doesn't carry the film's rating), and **hot-take** cards (need a
    0.7.5 short-high-rated-review selection rule + a `/api/v1/reviews/highlights`
    read) → land with 0.7.5 data. ✅ The inline **"because you liked X"** rows and
    the fully **borderless reel stream** shipped in R2.
  - [x] **0.7.3.1c — Discovery rails** (R1, built 2026-06-15) — for-you tab,
    above the reel, **on real data, each rail hides when empty**:
    - **dig in** (`dig-in.tsx`) — 4 TMDB category shelves (new/trending/popular/
      lowkey) as **fanned 3-poster collages** + colored brand dot, **client-
      direct TMDB** (`getDigIn()` in `tmdb-client.ts`: now_playing / trending /
      most-voted / well-rated-but-under-seen). Tap → top film's drawer (the F15
      category grid is a later slice).
    - **top watchers** (`top-watchers.tsx`) — weekly leaderboard, rounded-square
      avatars + rank badges. **NEW API `GET /api/v1/leaderboard?window=`**
      (`leaderboard-server.ts::getWeeklyLeaderboard` — distinct films logged
      [watched/rated/reviewed] per followed user over the window, block-filtered,
      one capped `/activities` scan grouped in memory; denormalized weekly
      counter = scale follow-up). Tap → profile.
    - **featured** (`featured-carousel.tsx`) — swipeable list hero (ghost title +
      scrim + glass advance + dots) off real **loved lists** (`/api/v1/lists/loved`).
    - **from the community** (`community-lists.tsx`) — gradient tiles off the
      loved lists past the featured 4 (`N films · M saved`, saved = list likes).
    - Accent tokens (`violet/blue/pink`) already existed; dot/rank colors use the
      design's oklch brand constants inline. `seededGradient()` helper added.
    - `TrendingStrip` retired from home (orphaned). **Deferred:** the F15/F16/F17
      "view all" **detail screens**; `friends`-tab rail variant. typecheck ✓ ·
      build ✓ · static ✓ · audit 403/403 ✓.
  - [x] **0.7.3.1d — Home test/polish pass**: scroll-collapse feel, both themes,
    Simulator; audit + build green; `prefers-reduced-motion` gates.

> **Heads-up — broad UI/UX revamp incoming (owner sent F01/F02/F15–F18 mocks
> 2026-06-14).** After the home rails, the next wave restyles the **interaction
> surfaces**. New design screens received (in `../cinechrony ios redesign june/`
> conceptually — owner-supplied mocks):
> - **F01 — movie drawer (from feed/search):** hero backdrop + ghost title +
>   glass collapse/bookmark/⋯; poster + title + rating chips (`9.4` sage +
>   `IMDb 7.8` amber) + `2023 · 1h 46m · drama`; two big buttons **`want to
>   watch`(add-to-list)** + **`comments`**; `your rating` drag-to-rate (10
>   segments); `your history · N watches` (rewatch/first-watch rows w/ rating).
> - **F02 — movie drawer (inside a list):** same, but `IN · DATE NIGHT` eyebrow
>   + **three** buttons (`date night`→add-to-list · `comments` · **`to watch`
>   → how was it?** status flip, styled like the others, NOT a segmented toggle).
> - **"how was it?" sheet:** flipping a film to watched → skip/save header,
>   drag-to-rate + optional review → `save` writes the review + moves to watched.
> - **create-a-post composer:** film cell + `change`; `your watch`
>   (first-watch/rewatch + `watched on` date); drag-to-rate; `your take` (serif);
>   `photos & clips` (N/10).
> - **F15 dig in › all · F16 top watchers › all · F17 from the community ›
>   all · F18 post · thread** — the "view all" / detail destinations for the
>   home rails.
>
> **New APIs needed for these (answer to owner's Capacitor question):** the home
> reel + shell need **none** (reuse existing `/api/v1/*` + client-direct TMDB,
> all already CORS-allowlisted for `capacitor://localhost`/`http://localhost`).
> The only genuinely **new** endpoints are the 0.7.5 rails: **`GET
> /api/v1/leaderboard?window=week|month|all`** (F16 — films-watched per followed
> user, rank + weekly movement, block-filtered) and **top-picks category
> queries** (F15 `new`/`popular`/`lowkey`; `trending` exists). F17 reuses
> `/api/v1/lists/loved` (+ a `staffPick` flag, "N saved" = list `likes`); F01/F02/
> the rate sheet/F18 reuse existing ratings/reviews/status/comments/post-comments
> endpoints (+ a small per-user-per-film "watch history" read). Every new route
> follows the same `/api/v1` + CORS pattern → automatically Capacitor-ready.
>
> The concrete, authoritative plan is the **interaction-surface waves** below
> (this note is the high-level preview). Built screen-by-screen, same cadence.

### 0.7.3.2+ — Interaction surfaces & detail screens (the F-screens)

> **Status: planned 2026-06-15** from the owner's F01–F07 / F15–F19 mocks (light
> "paper" + dark "projection room"). These are the screens every home / list /
> profile tap *leads to*. Convention: **every item has a Test.** All of these are
> governed by **locked decision 4 (free-tier discipline) — reads are the budget.**

**Screen catalog** (mock → where it lives → new/restyle → data):

| F | Screen | From → leads to | File | New/restyle | Backend |
|---|---|---|---|---|---|
| F01 | movie drawer (feed/search) | poster/cell → drawer | `movie-details-modal.tsx` | restyle | existing ratings/status/comments (+ watch log) |
| F02 | movie drawer (in list) | list cell → drawer | same, in-list variant | restyle | + list membership + watch log |
| F03 | how was it? sheet | status→watched → sheet | `rate-on-watch-modal.tsx` | rebuild (Vaul sheet) | writes rating + review + watch |
| F04 | create a post | + FAB → composer | `post-composer.tsx` | restyle | existing posts (+ optional watch) |
| F05 | add to a list | drawer `+` → sheet | `add-to-list-sheet.tsx` | restyle | existing lists |
| F07 | comments | post comment icon → thread | `/movie/[tmdbId]/comments` | restyle | existing reviews / post-comments |
| F15 | dig in › all | rail "view all" → drawer | new screen + `dig-in.tsx` data | new | client-direct TMDB (+ social proof, deferred) |
| F16 | top watchers › all | leaderboard "view all" → profile | new screen | new | `/api/v1/leaderboard` (movement deferred) |
| F17 | community lists › all | "lists for you" view all → list detail | new screen | new | `/api/v1/lists/loved` (+ pagination) |
| F18 | post · thread | tap post → full post + replies | `/post/[postId]` | restyle | existing post + comments |
| F19 | the reel · player | reel clip → full-screen viewer | new screen | new | a user's posts-with-media |

**New data model — the watch log** (F02 history; F03/F04 first-watch · rewatch):
`users/{uid}/watches/{watchId}` = `{ tmdbId, mediaType, watchedOn, rating?,
note?, watchNumber, createdAt }`, **server-only** in `firestore.rules`. The
canonical *current* rating stays in `/ratings/{uid}_{tmdbId}` (the latest watch
syncs it; review text → `/reviews`). Drawer "your history · N watches" = one
small `where tmdbId ==` query, **lazy on drawer open, cached** — one read, never
on a list render. "how was it?" + the composer write one watch entry (+ sync the
rating + optional review). Quota: ~1 small read/open, 1–2 writes/log.

**Build waves** (recommended order — reorderable; each ships green per the
Verification gate, plus `prefers-reduced-motion` + light/dark + Simulator):

- [x] **Wave 1 — Rail detail screens (F15 · F16 · F17). ✅ built 2026-06-15.**
  Continues the home rails just shipped; reuses existing endpoints; quota-light.
  Shared `v3/detail-screen.tsx` shell (fixed `z-[70]` overlay · film-red back ·
  centered title · body-scroll-lock), rendered at the home root **outside
  PullToRefresh**. `dig-in-all.tsx` (client-direct `getDigIn(20)`, cached, tabs +
  2-up grid + rating chips → own `PublicMovieDetailsModal` at `z-[80]`);
  `top-watchers-all.tsx` (week/month/all-time `Segmented` over the cached
  `GET /api/v1/leaderboard?window=&limit=50` — **added a `limit` param** — podium
  top-3 + ranked rows + your-row highlight → profile); `community-lists-all.tsx`
  (cached `/api/v1/lists/loved?limit=60` · 2-up cover-fan cards → list detail).
  Shared `ViewAll` affordance added to `v3/section.tsx`; the three home rails got
  an `onViewAll` prop. **Deferred (honest):** "logged by N friends" (F15) +
  weekly movement +/− (F16) — no fake data until a cheap social-proof/snapshot
  source exists. typecheck · build · static · audit 403/403 all green.
  - **F15 dig in › all** — new/trending/popular/lowkey tabs over a 2-up poster
    grid (rating chip · title · "logged by N friends"). Posters **client-direct
    TMDB** (`getDigIn` extended to return full paginated lists). "logged by N
    friends" derived from ONE capped `/activities` scan grouped by tmdbId
    (shared with the leaderboard) **or deferred** (drop the line) for v1.
  - **F16 top watchers › all** — week / month / all-time tabs · podium top-3 ·
    ranked rows · your row highlighted. `/api/v1/leaderboard?window=` exists
    (cached). **Weekly movement (+4 / −2) deferred** — needs a prior-window rank;
    show "–" until a cheap weekly snapshot exists (don't double the scan/load).
  - **F17 community lists › all** — 2-up cover cards (films · N saved ·
    visibility). `/api/v1/lists/loved` (cached) + a `limit`/cursor for "all".
  - Routes vs overlays: full-screen **overlays** (the `search-overlay`
    precedent) to avoid new static-export shells; back-chevron now, native
    push/pop later.
  - **Test:** each renders on real data + hides/empties gracefully; tap → drawer
    / profile / list detail; typecheck + build + static + audit green; **no
    per-item fetches** (quota check).

- [x] **Wave 2 — Movie drawer cluster (F01 · F02 · F05 · F03 + watch log). ✅ built 2026-06-15.**
  The keystone, shipped in three slices on `feat/v3-redesign`:
  - **Slice 1 — data layer.** OMDB extraction now returns rottenTomatoes (from
    `Ratings[]`) + awards + metascore; the TMDB details fetch appends
    `watch/providers` (normalized stream/rent/buy, region US) + exposes
    `credits.crew` + `production_companies`/`_countries` — all on the SAME
    details request (zero extra calls). Types in `types.ts`
    (`WatchProvider`/`WatchProviders`/`TMDBCrew`); enrichment in
    `tmdb-details-cache.ts` (`watchProviders` on `MediaDetails`).
  - **Slice 2 — unified drawer.** Two divergent modals → one
    **`movie-drawer.tsx`** (`MovieDrawer`) driven by a
    `{kind:'standalone'|'in-list'}` context; `public-movie-details-modal.tsx`
    + `movie-details-modal.tsx` are now thin adapters (zero call-site churn).
    Semantic tokens → dark "projection room" for free. Green-wash hero + ghost
    title + glass close/bookmark/⋯; poster straddles hero; F01 = want-to-watch ·
    comments, F02 = `in · <list>` eyebrow + list-name · comments · status. New
    **`v3/drag-to-rate.tsx`** (number + 10-segment bar). Sections: scores
    (IMDb/RT/Metacritic + awards) · where to watch · cast & crew (incl.
    director) · the conversation · list notes (F02) · more like this · footer.
    `listName` threaded list page → `MovieList` → drawer. **Bookmark + the
    want-to-watch button both open the add-to-list sheet** (raised to z-90).
  - **Slice 3 — watch log.** New **`/users/{uid}/watches/{id}`** subcollection
    (server-only + owner-read; `watches-server.ts` + `/api/v1/watches`). `logWatch`
    computes ordinal via `count()`, writes the watch, best-effort upserts
    `/ratings` + makes the note your SINGLE public review (update-or-create).
    **Index-free** (tmdbId equality → automatic single-field index; no composite,
    no owner deploy). **F03 `v3/how-was-it-sheet.tsx`** is a non-Vaul top-anchored
    overlay (textarea would fight the parent drawer's focus trap) — save
    logs+rates+reviews+watched, skip logs+watched, scrim cancels. `your history ·
    N watches` rows in the drawer. The list-PATCH still owns the `watched`
    activity, so logWatch never double-emits. 9 endpoint tests (42-watches),
    415/415 audit green. **`now showing` badge removed** per owner.
  - **Deferred (honest, no fake data):** footer friend counts (`9 friends
    watched` — needs a follow-graph fan-out) → Wave 6. Per-film "save" model
    (header bookmark = add-to-list for now). F05 = the existing
    `add-to-list-sheet.tsx`, reused as-is (restyle deferred).
  - **Owner action (non-blocking — defense-in-depth only, route uses Admin SDK):**
    `firebase deploy --only firestore:rules` to publish the `/watches` owner-read
    rule. No index deploy needed.
  - **Fixed in-flight:** a hooks-order crash (a `useMemo` below the `if (!movie)
    return null`) blanked the app when opening a film from search — the repo has
    NO ESLint, so it wasn't caught at build; keep hooks above the early return.

- [x] **Wave 3 — Create a post (F04).** Restyle `post-composer.tsx`: film cell +
  change · first-watch / rewatch + watched-on date · drag-to-rate · serif take ·
  photos & clips (N/10) · tag friends · visibility. **No "add to a list"** (it
  doesn't belong in a post). Optionally writes a watch-log entry too. **Test:**
  post lands in feed + reel; R2 media upload unchanged; audit green.

- [x] **Wave 4 — Threads (F18 post · thread · F07 comments).** Restyle
  `/post/[postId]` (post body + movie cell → drawer + still + engagement bar +
  threaded replies + sticky composer) and `/movie/[tmdbId]/comments` (pinned
  original + threaded replies + sticky reply composer). Restyle only — threading
  logic preserved. **Test:** reply/like/thread invariants unchanged; swipe-back +
  modal back-nav hold; audit green.
  - **Status (2026-06-18): DONE.** `/post/[postId]` (F21/F18) ✅. `/movie/[tmdbId]/comments`
    rebuilt as the **F12–F15 reviews wall** — friends-framed score + loved/liked/
    fine/nope distribution + friends-seen + helpful/recent/highest sort + featured
    most-helpful + review cards (score-badge-or-NOTE + 5 icon reactions) + threaded
    reply bubbles + **F13** composer + **F14** long-press react/actions + **F15**
    reply mode. New backend: a `reactions` map on reviews (one-per-user) +
    `POST/DELETE /api/v1/reviews/[id]/react`; `getReviewsWall` + **`GET
    /api/v1/movies/[tmdbId]/reviews-wall`** (optional-auth, one index-free scan,
    no-cache). Shared `review-verdict.ts` + `review-reactions.ts`. Tests:
    `47-reviews-wall-react`. Reviewed by a 2-pass adversarial workflow. **"add a
    still" on a review is a tracked fast-follow.**

- [x] **Wave 5 — The reel · player (F19).** New full-screen viewer for a user's
  uploaded photos/clips: author + follow · serif caption · tappable film tag →
  drawer · segment progress (clip n/N) · swipe → next. Data: a user's
  posts-with-media (reuse, lazy). **Test:** swipe through media; film tag →
  drawer; follow toggle; no extra reads per swipe.

- [x] **Wave 6 — Data-rail finish.** Hot-take rail (`GET /api/v1/reviews/
  highlights` — short, high-rated reviews → the green quote card); leaderboard
  weekly-movement (cheap snapshot); dig-in "logged by N friends". All cached +
  soft-degraded. **Test:** each rail real-data + cached + hides empty.
  - **Status (2026-06-17): DONE.** Hot-take rail ✅ (0.7.5.4); weekly movement ✅
    (`home-snapshot-server.ts` `filmsPrior` → `leaderboard-server` movement,
    rendered in `top-watchers-all.tsx`). The dig-in **"logged by N friends"**
    social-proof stays **deliberately deferred** — no cheap per-item read on the
    free tier (would be a per-poster N+1).

- [~] **Wave 7 — Onboarding · auth · settings · notifications** (folds the old
  0.7.3.7). **Notifications** ✅ (2026-06-19). **Onboarding + auth** ✅ (2026-06-20):
  the 9 design screens (001 welcome → 002 name → 003 letterboxd → 004 handle →
  005 email → importing → find-your-people; 006 login · 007 forgot · 008 check-
  email · 010 reset). Reordered to **account-LAST** (name/letterboxd/handle are
  local state until the email step creates the Firebase account, which then
  provisions the profile + reserves the handle + fires the import). New v3 kit:
  `v3/onboarding-kit.tsx` (StepShell · StepHeader · FieldCard · CtaButton ·
  OrDivider · AuthTopBar · IconTile), `v3/poster-wall.tsx`, `v3/social-auth-row.tsx`;
  step components under `onboarding/components/*` (welcome/name/letterboxd/handle/
  account/importing). **Letterboxd username import** wired to the new scrape engine:
  cheap Apify-free `/preview` "found" state → an **async, chunked pipeline** after
  the account exists (`scrape/start` → poll `scrape/status` → `scrape/import` in
  ~120-film chunks with concurrent TMDB matching + a **lovable progress UI** — a
  real poster wall builds as chunks land, counters tick (`useCountUp`), then a
  stat reveal), so a thousands-film library never exceeds the serverless time
  budget. **Reviews import in the BACKGROUND** after onboarding (the browser actor
  is minutes-slow): `finalize` kicks the reviews run, `<PendingImportSync/>` (root
  layout, gated by a device flag) polls `/reviews/sync` and quietly toasts.
  Graceful skip when `APIFY_TOKEN` is unset. **Username login** via secure
  `/api/v1/auth/login` (custom
  token; email stays private). **Still v2:** settings · invite · add · list-settings.
  **Test:** per-screen light/dark walk; `audit:test` green.

> After the waves: **motion slice 2** (push/pop transitions + app-wide
> swipe-back — the F-screens are designed as pushed screens, so build them
> transition-ready) and **story share (0.7.4)**, both already tracked below.
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
- [x] **0.7.3.4b** **Public list detail** (`/profile/[username]/lists/[listId]`)
  — **converged onto the SAME Hero + ListHeader + MovieList as the owner list
  (2026-06-17).** It had drifted to a v2 fork (no Hero, brutalist Tabs, hand-rolled
  header, `PublicMovieGrid`, full-page spinner) because every v3 change only landed
  on the editable side. Now ONE shared **`movie-cell.tsx`** (grid tile + list row)
  powers both lists — anon-safe (renders logged-out), `canEdit`-gated, shows the
  VIEWER's own rating, v3-sized (48×72 `rounded-[10px]` · 16px headline · 44px
  actions); `MovieList` gained a **`publicReadOnly`** mode (standalone drawer,
  notes view hidden — notes stay collaborators-only, who are redirected to the
  editable page → **no server change, no privacy change**). **Retired the legacy
  "cards" view** + its `movie-card.tsx`, which removed a `canEdit` affordance leak,
  a duplicate client TMDB/OMDB fetch, and brutalist remnants in one move. Deleted
  the divergent `movie-card-grid/list` + `public-movie-grid/list-item` +
  `list-controls` forks (**net −1,144 lines**). `getPublicListMovies` now projects
  `addedBy*`/`mediaType`/`coverMode` (already on the doc → no extra reads; notes
  deliberately NOT projected). Bugs fixed along the way: PTR-live-under-open-drawer,
  ListHeader infinite spinner for logged-out viewers, public page double-fetch
  before auth settled, empty-`posterUrl` next/image crash, settings cover-picker
  a11y, and the **owner-avatar duplication** on the public header (ListHeader
  `hideOwnerInStack`). Reviewed by a 5-reader audit + a 3-dimension adversarial
  workflow (editable flow confirmed unregressed). typecheck · build · static ·
  audit **460/460** ✓.
- [x] **0.7.3.4c** **List notes → a first-class tab** (2026-06-17, owner-proposed).
  Promoted collaborator notes from a buried view-mode (`movie-card-annotated`,
  now deleted) + drawer section into a **`notes · N` tab** on the in-list
  segmented (owner/collaborator only — `canViewNotes = canEdit && !publicReadOnly`,
  so the public read-only list never shows it). New **`v3/notes-board.tsx`** = a
  chronological board of every note across the list (author · relative time ·
  text · film chip → that film's drawer; "your note" highlighted + edit), which
  **flattens the already-loaded movies → ZERO extra reads**. New
  **`v3/note-sheet.tsx`** = the "note on this film" editor (full-screen portal,
  keyboard-safe like `how-was-it-sheet`); the bottom composer opens a film-picker
  step first (the list's films, your existing note prefilled), "edit"/the drawer
  jump straight in. Data model: added a backward-compatible **`noteUpdatedAt[uid]`**
  server timestamp on the movie doc (written in `movies-server.ts` alongside the
  existing `notes`/`noteAuthors`; old notes predate it → no relative time, sorted
  oldest). Reuses the existing authorized `PATCH …/movies/[id] {note}` route — no
  new endpoint. Notes stay collaborators-only (NOT projected to the public
  payload). Reviewed by a 2-dimension adversarial workflow (6 low-severity polish
  fixes applied: pending-timestamp ordering, tab-switch search reset, save-race
  guards, textarea auto-grow, lost-access bounce). typecheck · build · static ·
  audit **460/460** ✓.
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
- [x] **0.7.3.5b** **Public profile** (`/profile/[username]`): same cinematic
  Hero (seeded gradient + avatar + name/@handle/since + serif bio tagline) +
  glass **back** (top-left) + glass **block/report ⋯** (top-right, new
  `ProfileOverflowMenu variant="glass"`) → content sheet (Follow + share pills,
  stats sandwich, **Segmented films · lists · activity**). lists tab uses the
  universal **ListTile** with the `ListLikeButton` (cover variant) in its
  likeButton slot; films = top-5 + recent; activity = `RecentRow` feed of the
  viewed user (world-readable `/activities` getDocs, same graceful try/catch).
  Wrapped in `MovieModalProvider`. **Dropped the old "shared" tab** — it never
  populated for other users (only the owner can list collaborative lists), so
  no feature lost. `ProfileListCard` is now orphaned (both profiles use
  ListTile) — safe to delete later. typecheck + build green.
- [x] **0.7.3.5c** **Profile-photo hero revamp** (both profiles, new mock): the
  **profile photo IS the hero** (full-bleed `coverImageUrl={photoURL}`), no more
  circular avatar. Eyebrow `critic · @handle · since` + lowercase name + serif
  tagline overlay the photo. `Hero` gained a `placeholder` slot (shown over the
  gradient when no cover) + sheen/scrim are now `pointer-events-none` so the
  empty-state affordance is tappable. Own profile: empty state = tappable "add a
  profile photo" → AvatarPicker; pills changed find-friends → **edit profile**
  (→ AvatarPicker) + share (find-friends still lives in Home search). Public:
  empty state falls back to the seeded gradient + name ghost. **Taste chips:
  real "N films" count only** (vibe tags like comedy/rom-com deferred — no
  genre/taste data model yet; would need an editable taste-tags feature). First
  tab kept as **films** (accurate to its top-5 + recent content). typecheck +
  build green.
- [x] **0.7.3.5d** **Edit-profile sheet** (mock 13): new full-screen
  `EditProfileSheet` (NOT Vaul — text inputs hit the iOS focus-trap bug) with
  cancel · save header. Photo hero preview + **change** glass pill + **camera
  roll** / **take photo** (file inputs, `capture="user"`) + **house avatars**
  (existing `DEFAULT_AVATARS`); name + bio inputs; one PATCH /me save. Reuses the
  avatar upload (`POST /me/avatar`) — extracted `compressAvatar` to
  `src/lib/avatar-image.ts` (shared with AvatarPicker). Extended **PATCH /me to
  accept `displayName`** (+ `displayNameLower`; denormalized copies resolve via
  the live profile cache, historical stay as-was). Profile now opens the sheet
  from the edit-profile pill, hero tagline, and the empty-photo placeholder;
  retired the inline bio editor + AvatarPicker usage on the profile.
  **Handle is read-only** — usernames are permanent (AUDIT 2.3) + denormalized
  widely; a once-a-year change is a deliberate backend feature (uniqueness +
  rate-limit + accepted historical staleness), offered as a follow-up rather
  than shipped silently. typecheck + build green.
- [x] **0.7.3.5e** **Top-5 picker revamp** (mocks 14+15): new full-screen
  `TopFivePicker` (replaces `FavoriteMoviesPicker`, now orphaned). **Sheet mode**:
  cancel·save header, serif subtitle, 5 ranked slots with **drag-to-rank**
  (custom pointer-events reorder — no new dep), rank badge + × remove, empty
  slots → search; "N of 5 picked · M spots open"; search trigger; **suggested
  for you** (trending). **Search mode** (tap the field): live `searchTmdbMulti`
  (films+tv) with **all · films · tv** pills, a YOUR CANON mini-row, each
  result's **+** drops into the next open slot, **done** returns. Saves the
  existing `FavoriteMovie[]` via PATCH /me (no schema change; dedup by tmdbId).
  Search meta is **year · film/tv** (genre/director need per-item detail
  fetches — omitted for cost). typecheck + build green.
- [~] **0.7.2** **Native-feel motion layer — slice 1 (haptics)**: installed
  `@capacitor/haptics@8`; `src/lib/haptics.ts` `haptic(kind)` helper (dynamic
  import, native-only, web no-op). Wired into the shared primitives so the whole
  app inherits it: **Segmented** (selection on switch; thumb already springs;
  bumped h-30→h-34), **Fab** (medium tap / heavy long-press), **GlassBtn**
  (light), **bottom-nav** (selection + `active:scale-90` press). Plus success
  on edit-profile + top-5 saves, selection on top-5 add and on each drag-rank
  crossing, light on remove. **Owner: run `npx cap sync` so the native build
  picks up the plugin.** Still TODO in 0.7.2: page push/pop transitions +
  app-wide swipe-back (the heavier motion piece). typecheck + build + static ✓.
- [x] **0.7.3.5f** **"your people" sheet** (mocks 17+18): new full-screen
  `PeopleSheet` replacing the two Card modals on both profiles. Eyebrow
  (@subject) + "your people" + ×, **Segmented followers/following** (with
  counts, inherits haptics+spring), search field (client-side filter), rows =
  ProfileAvatar + name/@handle/bio + **FollowButton** + tap-to-profile.
  **FollowButton restyled to a v3 pill** (universal): film-red filled for
  follow / follow-back, tonal + ✓ for following, lowercase, size-aware, haptic
  on toggle. **Zero per-row status fetches** — every row's relationship is
  pre-resolved from the viewer's own follower/following sets (loaded once; on
  the owner's own profile those ARE the subject lists → no extra calls). Meta
  is the person's **bio** (real); films-count / mutual-count deferred (no cheap
  aggregation). Removed Card/ProfileAvatar/Link/X usage from the profiles.
  typecheck + build ✓.
- [x] **0.7.3.5g** **Share profile — canonical URL fix.** The share was using
  `window.location.origin`, which in the native app is the Capacitor WebView
  origin (`capacitor://localhost`) → a **dead link**, and is also exposed to the
  `cinechrony.vercel.app` vs live `movienight-kappa.vercel.app` domain mismatch.
  New `src/lib/share.ts` (`shareOrigin()` + `profileShareUrl(username)`) resolves
  a real public https origin (NEXT_PUBLIC_APP_URL → NEXT_PUBLIC_API_BASE_URL →
  Vercel preview→prod → `window.location.origin`), so a shared link opens on the
  web AND triggers the Universal Link into the app. Both profiles' `handleShare`
  now use it + `haptic('light')` + friendlier share text. **Rich per-user
  iMessage/OG card deliberately deferred to 0.7.4** — a personalized link preview
  needs server-rendered per-user OG metadata (conflicts with the static SPA
  shell) + a generated OG image = the exact same infra as the story cards. Build
  it once there, not as a throwaway half-version now. typecheck + build ✓.
  > **✅ Profile tab family complete** — photo hero · films/lists/activity tabs ·
  > edit-profile sheet · top-5 picker · your-people sheet · canonical share.
  > Plus the app-wide density pass + haptics motion slice. Two deliberate
  > deferrals carried forward: editable handle (backend feature) and rich share
  > cards (0.7.4).
- [x] **0.7.3.6** **Search** (`SearchIOS`): rebuilt the home search overlay
  (`search-overlay.tsx`, in place — the home trigger wiring is untouched) into
  a three-view discovery surface. **Discover** (empty query): **recommended for
  you / "from what you've watched"** — a horizontal poster row flattened from
  the existing **`GET /api/v1/recommendations`** (already reads the viewer's
  ratings: loved ≥8 → liked ≥6.5 → most-recent), round-robined across bases so
  the first cards show variety, each carrying its own tier-voiced reason ("you
  loved …" / "because you liked …" / "because you watched …" — reason text
  moved server-side into `getRecommendationsForUser`). Section hides for
  no-history users (no fake "from what you've watched"). **browse by vibe** —
  serif-italic keyword chips from a new shared `src/lib/vibes.ts` (9 curated
  vibes); tapping → a vibe-results grid via new **`GET /api/v1/movies/vibe/[vibeId]`**
  → `discoverByVibe()` which resolves the term to a TMDB keyword id at runtime
  (`/search/keyword` → `/discover/movie?with_keywords=…&sort_by=vote_count.desc`)
  and falls back to a plain movie search so a vibe never renders empty. **now &
  next** — a v3 **Segmented** (in theatres / coming soon) over two new public
  proxies **`GET /api/v1/movies/now-playing`** + **`/upcoming`** (`getNowPlayingMovies`
  / `getUpcomingMovies`; upcoming filtered to future releases). **Results** view
  (typed query) restyled to v3 (films/tv grid + people + lists) — same TMDB +
  user + list search as before. Discover data loads once per session and is
  kept across open/close; vibe results are cached per-vibe; haptics on chip tap
  / close / segmented. New endpoint types imported `import type` only (no server
  code in the client bundle — static build verified). typecheck ✓ · build ✓ ·
  static ✓ · audit **403/403**. **`/api/v1/movies/genres` was NOT needed** —
  the design's "genre chips" are the vibe/keyword chips, which read better than
  raw TMDB genres.
  - **Revision (2026-06-14):** moved now-playing / upcoming / vibe from
    `/api/v1/*` proxies to **client-direct TMDB calls** (`tmdb-client.ts`, same
    precedent as `searchTmdbMulti`); removed the 3 server routes + helpers.
    They're public, non-secret, non-user-scoped reads — proxying them only added
    a deploy dependency (the new routes 404'd on a Vercel **preview** because the
    preview client calls the *production* API origin — see
    [[project_preview_calls_prod_api]] — and prod didn't have the unmerged
    routes). Client-direct → works on web + preview + native + localhost with no
    round-trip. **Recommendations stays server-side** (reads ratings via admin
    SDK; already on prod). Also swapped 3 dead-keyword vibes for neo-noir /
    nonlinear / whodunit (verified populated), and put **people first** in
    results. typecheck ✓ · build ✓ · static ✓.
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

- [x] **0.7.5.1** Weekly leaderboard — films-watched-per-followed-user over 7
  days. ✅ Shipped, then **re-architected for free-tier scale (2026-06-16):** no
  longer a per-user 800-doc `/activities` scan (which grew with users × activity
  → would blow the 50k-reads/day cap). Now a GLOBAL `/snapshots/home` doc built
  by ONE scan (lazy, SWR, transaction-claimed rebuild ~hourly — no Vercel-cron
  dependency), read once + filtered to the follow graph in memory; friends-watching
  shares the same snapshot. `src/lib/home-snapshot-server.ts`; both rails fall back
  to a live scan if the snapshot is missing. Tests: `43-leaderboard-snapshot`
  (ranking, seen-signals-only, block-filter, follow-scope, week-window, fallback).
- [x] **0.7.5.2** Top-picks categories — define + query `new` (fresh logs),
  `trending` (exists), `popular` (all-time loved), `lowkey` (hidden gems).
- [x] **0.7.5.3** Featured carousel — lean on the Phase 0.5 loved-lists
  showcase + a manual `staffPick` flag for editorial slots.
- [x] **0.7.5.4** Hot-take cards (2026-06-17) — the design's green quote card on
  the home reel. `GET /api/v1/reviews/highlights` (`getReviewHighlights` in
  `reviews-server.ts`): a GLOBAL pool of short (12–240ch), high-rated (≥8),
  top-level reviews from an index-free `createdAt desc` scan held in a 30-min
  module TTL cache; per-caller it drops own takes + the block set. `softFallback:
  []`; an empty pool hides the card (real data only). `HotTakeCard`
  (`hot-take-card.tsx`) = seeded-color, theme-independent pull-quote → tap opens
  the film drawer, avatar/handle → profile. Interleaved in `activity-feed.tsx`
  (leads the reel, then every 8; for-you only; client-filtered block/mute/self).
  Tests: `46-review-highlights` (selection rule, replies/low-rated/length/unrated
  exclusion, own + blocked exclusion, per-film dedupe, empty pool). Verified by a
  2-agent adversarial review (quota / privacy / interleave / Capacitor). Scale
  follow-up if reviews grow huge: move the pool into `/snapshots/home` like the
  leaderboard. Presence-pill final wording from real activity still TODO.

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
