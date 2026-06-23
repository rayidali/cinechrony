# Cinechrony — Session Handoff

> Last updated 2026-06-17. Project: a social movie-watchlist app
> (Next.js 15 + React 19 + Firebase + Tailwind + Capacitor 8), repo at
> `/Users/rayidali/Desktop/Cinechrony/cinechrony2`.

---

## TL;DR — where things stand

**Phases A, B, and 0.5 are all merged to `main`** (A+B via PR #88, tip
`9c81360`; Phase 0.5 Discover rebuild before that). `src/app/actions.ts`
is **deleted** — server logic lives in `src/lib/<domain>-server.ts` behind
`/api/v1/**` route handlers. Capacitor 8 wraps the static `out/` bundle in
native iOS + Android shells (`ios/` + `android/`).

**Active work: Phase 0.7 — v3 iOS-native redesign** on branch
`feat/v3-redesign` (branched off the merged `main`). A screen-by-screen
restyle to the downloaded Claude Design package
(`../cinechrony ios redesign june/`), triggered by repeat "still feels like
a webapp" feedback. Tracker: **`PHASE-0.7-REDESIGN.md`** (every item has a
Test, same convention as AUDIT.md).

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

## Active branches

```
main ◄── Phases A + B + 0.5 all merged (PR #88, tip 9c81360)
  │
  └── feat/v3-redesign  ◄── HEAD (Phase 0.7 — profile + search + home revamp done)
```

**Operational rule (in force):** Claude pushes only to feature branches;
owner controls all `main` pushes.

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

**Phase 0.7 — v3 redesign (ACTIVE, before Phase C).** See
`PHASE-0.7-REDESIGN.md`. All core surfaces done (home · search · lists owner +
public · profile · movie drawer · create-post/thread/reel · reviews wall · data
rails). Remaining: **Wave 7** (onboarding · auth · settings · notifications ·
invite · add · list-settings), **motion slice 2** (page push/pop + app-wide
swipe-back), and **story share** (0.7.4 card renderer + share sheet → 0.7.6
direct-to-IG).

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
