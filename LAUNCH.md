# Cinechrony Launch Plan — App Stores + Hero Feature + Marketing

> **Started:** 2026-05-15 · **Updated:** 2026-05-21
> **Goal:** Ship to iOS App Store + Google Play with a refreshed UI + the screenshot-to-watchlist Share Extension as the hero feature, plus automated TikTok-first / Instagram-second daily content.
> **Sequencing:** The pre-launch audit (`AUDIT.md` Phases 0–2) is done. **Phase 0 (UI redesign) runs first** — it sets the design language every later phase builds in. Then A (API routes) → B (Capacitor) → C (Share Extension) → D (stores) → E (marketing).
> **Approach:** Capacitor (right path — static export + API routes refactor). Not a Swift rewrite. Solo dev using Claude Code for Swift work.

---

## Phase 0 — UI Redesign (do first)

> **Why first, not later:** a full redesign (scope B — new visual direction) defines the component language that *every subsequent phase builds in* — the onboarding redesign (C.7), the Share Extension's confirmation UI, and the App Store screenshots (D). Redesign late and that UI gets built twice. Redesign first and everything downstream is built once, in the final look.
>
> **Workflow:** explore visually on **claude.ai (Artifacts)** — fast, live, zero repo risk — to lock a direction; then **Claude Code** implements the chosen direction across the real codebase consistently. Hand the approved Artifact JSX/Tailwind to Claude Code as the reference.
>
> **Scope discipline (a full redesign is the #1 launch-delay risk):** the screen list in 0.3 is FIXED up front — no adding screens mid-flight. Timebox ~2–4 weeks. "Good and shipped" beats "perfect and slipping." Anything that creeps becomes a post-launch polish ticket.

### 0.1 — Direction & identity decision

- [ ] **0.1.1** Explore on claude.ai/Artifacts. Paste screenshots of the current Home feed, Movie detail modal, and the add-movie flow; iterate on 2–3 visual directions.
- [ ] **0.1.2** **Decide: evolve or replace the neo-brutalist identity.** Today it's 3px borders, hard offset shadows, Space Grotesk/Mono. Scope B explicitly allows a new component language — this is a founder call; make it deliberately, once, here.
- [ ] **0.1.3** Lock ONE direction on the 3 hero screens. Everything else conforms to it. No more direction-shopping after this.

### 0.2 — Codify the design system

- [ ] **0.2.1** Update Tailwind tokens (`tailwind.config.ts` + `globals.css`): color palette, type scale, spacing, radii, shadows, motion. One source of truth.
- [ ] **0.2.2** Build/refresh the shared `components/ui` primitives (button, card, surface, input, drawer chrome) to the new system FIRST — the screen rollout then composes them.
- [ ] **0.2.3** Update `src/components/CLAUDE.md` + the Design System section of root `CLAUDE.md` so the new language is the documented one.

### 0.3 — Screen-by-screen rollout (FIXED list, highest-traffic first)

- [ ] **0.3.1** Home (activity feed, trending carousel, cards)
- [ ] **0.3.2** Movie detail modal + the movie-card variants (grid / list / card)
- [ ] **0.3.3** Lists + individual list view
- [ ] **0.3.4** Profile (own + public) + the comments page
- [ ] **0.3.5** Auth (login / signup / forgot / reset) + onboarding screens — coordinate with C.7 (C.7 is the *flow* change; it builds in this system)
- [ ] **0.3.6** Notifications, Settings, add-movie flow, bottom nav + header

### 0.4 — QA & consistency pass

- [ ] **0.4.1** Dark mode parity on every redesigned screen.
- [ ] **0.4.2** iOS PWA / responsive check (notch, safe areas, the Vaul drawers, keyboard).
- [ ] **0.4.3** `npm run build` green, `npm run audit:test` still 74/74 (redesign is presentational — must not regress logic), preview deploy walked end-to-end.

---

## Phase 0.5 — Discover: liked lists + the home/search merge

> **Pulled forward to pre-launch** (owner's call — works soon, after Phase 0).
> Cinechrony has no way to surface great *lists* or new *people* outside your
> follow graph. Three connected pieces: liking public lists, an editorial
> showcase of loved lists, and merging home + search into one **Discover**
> page that houses it. Can run alongside / just before Phase A.
>
> **Brand guardrail:** this is a *showcase*, not a leaderboard. The design
> system explicitly rejects gamification — no #1/#2 ranks, no trophies, no
> XP. Frame it editorially ("loved this week"), the way a magazine runs a
> "what we're into" page. Cinechrony surfaces great lists; it doesn't crown
> winners.

### 0.5.1 — Like public lists

- [ ] **0.5.1.1** Data: add `likes` (number) + `likedBy` (string[]) to the
  list document — mirror the existing review/activity like shape.
- [ ] **0.5.1.2** Server actions `likeList` / `unlikeList` — clone the
  `likeReview` / `likeActivity` pattern: `verifyCaller`, transactional count
  update, reuse the `like` rate-limit key. Only public lists are likeable.
- [ ] **0.5.1.3** `firestore.rules`: `likes` / `likedBy` are server-only
  writes (same as reviews/activities) — clients can't tamper with counts.
- [ ] **0.5.1.4** UI: a heart on the public list view + the list cover card.
  Optimistic toggle, fills sage when liked (matches the v2 like treatment).
- [ ] **0.5.1.5** Notification to the list owner — new `list_like`
  notification type, reuses the existing notification system.
- [ ] **0.5.1.6 — Test:** like / unlike as an authed user; forged token
  rejected; count holds under a concurrent burst; private lists not likeable;
  rate limit trips. Add to `scripts/audit-tests/`.

### 0.5.2 — The loved-lists showcase

- [ ] **0.5.2.1** Rank by a **recency-weighted trending score**, not all-time
  cumulative likes — otherwise the first popular list camps the top forever
  and nothing new breaks in. Likes decay with age (the HN/Reddit "hot"
  formula). Store `trendingScore` on the list, recomputed by a small
  scheduled job — or on read while the dataset is small.
- [ ] **0.5.2.2** Editorial presentation — a wall of `THE COLLECTION · loved
  this week` covers, no numbered ranks. Tap a cover → the public list; tap
  the curator → their profile (people-discovery is the real payoff — it
  grows the follow graph).
- [ ] **0.5.2.3** **Cold-start gate:** don't render the showcase into an empty
  room. Gate it behind a minimum (e.g. ≥ N public lists with ≥ 1 like) so it
  never looks dead at launch. Liking (0.5.1) ships regardless — it works fine
  small.
- [ ] **0.5.2.4 — Test:** showcase returns only public lists, ordered by
  trending score; the gate hides it below threshold; mass self-likes have
  limited payoff thanks to decay + rate limiting.

### 0.5.3 — Merge home + search → one Discover page

- [ ] **0.5.3.1** Collapse `/home` and `/add` (search) into a single
  **Discover** surface: search field at the top, then trending movies, the
  loved-lists showcase, and the activity feed — one destination for "what
  should we watch?".
- [ ] **0.5.3.2** Re-decide the bottom nav. `/add` was the search tab; with
  search folded into Discover that slot frees up — pick the 4 nav slots
  deliberately (Discover · Lists · ? · Profile).
- [ ] **0.5.3.3** Keep the Phase 0 editorial composition — eyebrow → hairline
  → lowercase section titles (`NOW SHOWING`, `THE COLLECTION`, `THE FEED`).
- [ ] **0.5.3.4 — Test:** search still works end-to-end; trending + showcase
  + feed all load; bottom nav routes correctly; pull-to-refresh intact.

### 0.5.4 — User posts in the feed (the Beli-style update)

> The biggest piece of this phase. Today the activity feed is only *system
> events* (added / rated / watched / reviewed). This adds a **user-authored
> post** — free text + photos + an optional movie tag, friend tags ("watched
> with @x and @y") and an optional place. A short Beli/Twitter-style update,
> anchored to a film.

- [ ] **0.5.4.1** Data: a post document — `authorId`, `text`, `imageUrls[]`,
  `taggedMovie` (tmdbId + title + poster), `taggedUserIds[]`, `place`
  (freeform string, optional), `createdAt`, `likes` / `likedBy`. Decide: a
  new `/posts` collection the feed query merges in, or a `type: 'posted'` on
  `/activities`. Keep author fields denormalized (the project's N+1 pattern).
- [ ] **0.5.4.2** Composer — full-screen, editorial: serif text area,
  multi-photo picker (reuse the R2 upload path from `uploadAvatar` /
  `uploadListCover`), a movie-tag search (reuse TMDB search), a friend tagger
  (reuse `searchUsers`), an optional `place` field.
- [ ] **0.5.4.3** Anchor posts to a film — strongly encourage the movie tag.
  A post with no film is just a tweet; with one it's a Cinechrony post. The
  card leads with the tagged poster.
- [ ] **0.5.4.4** Feed rendering — a distinct, larger post card alongside the
  small system-activity cards: avatar + name + place + time, photos, serif
  text, the tagged movie, tagged friends as chips. Likes; comments reuse the
  review/threading system (or likes-only for v1, comments next).
- [ ] **0.5.4.5** Tagged friends get a notification ("@x tagged you in a
  post") — reuses the notification system. Compose entry point (FAB) on the
  Discover page.
- [ ] **0.5.4.6 — Test:** create a post (text only / with photos / with movie
  + friend tags / with place); appears in the feed; tagged users notified;
  like works; forged token can't post; post is reportable; a blocked
  author's posts are hidden. Add to `scripts/audit-tests/`.

> **Location — read this.** `UX_PATTERNS.md` explicitly says the feed has
> **no location data** ("Cinechrony is not a location-aware app"). Honour the
> spirit: `place` is an **optional freeform line** ("at the prince charles
> cinema") — **not** GPS, not a map, not distance/proximity, not "people near
> you." A typed venue is a nice social detail; a location-aware app is a
> different product. Owner to confirm this reading.
>
> **Moderation is now a hard dependency.** Free-form text + photos is real
> UGC — it raises the App Store §1.2 bar well above today's structured
> activity. Before posts ship: posts must be **reportable** (extend
> `reportContent`) and authors **blockable** — see **0.5.5** below.
> **Posts and 0.5.5 ship together or not at all.**

### 0.5.5 — Block a user

> Required for any UGC app (App Store §1.2) and the safety floor under
> 0.5.4's posts. "Block" here means **full mutual invisibility** — a blocked
> user can't see anything you do, you don't see them, and neither can
> interact with the other. (Was D.0.1; pulled forward — posts can't ship
> without it.)

- [ ] **0.5.5.1** Data: a block relationship queryable **both directions** —
  when A blocks B, B's read paths must know too. A top-level `/blocks`
  collection (`{blockerId, blockedId, createdAt}`) or a denormalized pair;
  a per-session blocked-set cache for O(1) filtering.
- [ ] **0.5.5.2** Server actions `blockUser` / `unblockUser` (verifyCaller).
  Blocking also **severs the relationship**: drop any follow in both
  directions, revoke pending invites between the two, stop notifications.
- [ ] **0.5.5.3** Enforcement is **cross-cutting** — every read surface
  filters the blocked-set (this is the real cost, not the action itself):
  profile (→ a not-found / blocked state), public lists, the activity feed
  + posts, reviews / comments, followers / following lists, user search,
  notifications. Both directions.
- [ ] **0.5.5.4** Interaction severance — a blocked user can't follow you,
  like or comment on your content, tag you in a post, or invite you to a
  list. Enforce in the server actions; back it with `firestore.rules` where
  the rules layer can.
- [ ] **0.5.5.5** UI: a `block` action in the ⋯ overflow on another user's
  profile (UX_PATTERNS already calls for this); an unblock list in settings;
  offer "block too" from the report flow.
- [ ] **0.5.5.6 — Test:** after a block — the blocked user can't load your
  profile, lists, posts, or comments, can't find you in search, can't
  follow / tag / like you; you don't see them either; unblock restores; a
  forged token can't block on someone else's behalf. Add to
  `scripts/audit-tests/`.

### Don't

- ❌ A numbered/ranked leaderboard with trophies or "#1" — editorial showcase only.
- ❌ Rank by all-time cumulative likes (it ossifies).
- ❌ Ship the showcase before there's content to fill it.
- ❌ Invent a new like data model — reuse the review/activity like shape.
- ❌ Ship user posts before 0.5.5 (block) + reporting are in place.
- ❌ A half-block that only hides comments — it must filter every read surface.
- ❌ GPS / maps / distance for `place` — freeform text only.

---

## How we test (carries over from `AUDIT.md`)

Same conventions as the audit tracker:
1. **API contract tests** — for every refactored endpoint, a script in `scripts/audit-tests/` calls it as authenticated user / unauthenticated / wrong user. Captured as regression tests.
2. **Build verification** — `npm run build` (static export) succeeds; `npx cap sync` succeeds; Xcode + Android Studio builds succeed.
3. **Device testing** — real iPhone + real Android device via TestFlight / internal Play track. Simulator is a starting point but not sufficient for Share Extension or push notifications.
4. **End-to-end** — a checklist per phase describing the user-visible flow that must work.

---

## Phase A — Foundation: Server Actions → API routes (prep for static export)

> **This is the biggest single block of work.** ~30-40 endpoints to convert. Folds in `AUDIT.md` Phase 1 (auth helper applied per endpoint as we go). Roughly 2-3 weeks if focused.

### A.1 — Inventory & grouping

- [ ] **A.1.1** Categorize every export in `src/app/actions.ts`:
  - **Write actions** → must become API routes (mutations need server-side auth + Admin SDK)
  - **Server-only reads** (use Admin SDK or external APIs like TMDB/OMDB) → API routes
  - **Client-callable reads** already using Firestore Web SDK via `useCollection`/`useDoc` → no change needed
  - **Dead** (legacy `addMovie`, etc.) → delete
- [ ] **A.1.2** Output: a checklist file `scripts/api-refactor-inventory.md` with each action labeled and the target route name. Saves you from forgetting any.

### A.2 — Build the API route foundation

- [ ] **A.2.1** Create `src/lib/auth-server.ts` — `verifyCaller(req): Promise<{ uid }>` reads Firebase ID token from `Authorization: Bearer ...` header, calls `getAuth(adminApp).verifyIdToken(token)`. Throws `UnauthorizedError`.
- [ ] **A.2.2** Create `src/lib/api-handler.ts` — wrapper that handles: JSON parsing, calling `verifyCaller`, error envelope (`{ ok: false, error }` vs `{ ok: true, data }`), CORS headers for the Capacitor `capacitor://localhost` origin.
- [ ] **A.2.3** Create `src/lib/api-client.ts` (client-side) — `apiCall(endpoint, body)` helper that attaches the ID token from `auth.currentUser.getIdToken()`, calls the route, parses the envelope. **Replaces every existing Server Action call site.**
- [ ] **A.2.4 — Test:** `scripts/audit-tests/A2-auth-wrapper.test.ts` — request without token → 401, expired token → 401, valid token → handler receives correct `uid`.

### A.3 — Convert endpoints (one per route file)

> Group by domain. Each route file under `src/app/api/v1/...`. Numbered checklist matches the inventory in A.1.

**Lists**
- [ ] **A.3.1** `POST /api/v1/lists` — `createList`
- [ ] **A.3.2** `PATCH /api/v1/lists/[listId]` — `updateList` (name, isPublic)
- [ ] **A.3.3** `DELETE /api/v1/lists/[listId]` — `deleteList`
- [ ] **A.3.4** `POST /api/v1/lists/[listId]/transfer` — `transferOwnership` (transactional — closes AUDIT.md 2.1 + 1.3)
- [ ] **A.3.5** `POST /api/v1/lists/[listId]/cover` — `updateListCover` (closes AUDIT.md 1.5)
- [ ] **A.3.6** `DELETE /api/v1/lists/[listId]/collaborators/[uid]` — `removeCollaborator` (closes AUDIT.md 1.4)
- [ ] **A.3.7** `GET /api/v1/lists/[listId]/preview` — `getListPreview` w/ privacy check (closes AUDIT.md 1.13)

**Movies in lists**
- [ ] **A.3.8** `POST /api/v1/lists/[listId]/movies` — `addMovieToList` (transactional — closes AUDIT.md 2.2)
- [ ] **A.3.9** `DELETE /api/v1/lists/[listId]/movies/[movieId]` — `removeMovieFromList` (transactional)
- [ ] **A.3.10** `PATCH /api/v1/lists/[listId]/movies/[movieId]/status` — `updateMovieStatus`
- [ ] **A.3.11** `PATCH /api/v1/lists/[listId]/movies/[movieId]/note` — `updateMovieNote` (closes AUDIT.md 1.6)
- [ ] **A.3.12** `PATCH /api/v1/lists/[listId]/movies/[movieId]/social-link` — `updateMovieSocialLink`

**Invites**
- [ ] **A.3.13** `POST /api/v1/invites` — `inviteToList`
- [ ] **A.3.14** `POST /api/v1/invites/link` — `createInviteLink` (CSPRNG code — closes AUDIT.md 2.9)
- [ ] **A.3.15** `POST /api/v1/invites/[code]/accept` — `acceptInvite` (transactional — closes AUDIT.md 1.11)
- [ ] **A.3.16** `POST /api/v1/invites/[code]/decline` — `declineInvite`
- [ ] **A.3.17** `DELETE /api/v1/invites/[id]` — `revokeInvite` (owner OR inviter — closes AUDIT.md 1.12)
- [ ] **A.3.18** `GET /api/v1/invites/[code]` — `getInviteByCode` (require auth — closes AUDIT.md 2.9 enumeration vector)

**User**
- [ ] **A.3.19** `PATCH /api/v1/me` — `updateProfile` (bio, photo, favorites, displayName)
- [ ] **A.3.20** `PATCH /api/v1/me/username` — `updateUsername` (transactional w/ reservation + usernameLower — closes AUDIT.md 1.10)
- [ ] **A.3.21** `DELETE /api/v1/me` — `deleteUserAccount` (closes AUDIT.md 1.2 + 2.7)
- [ ] **A.3.22** `POST /api/v1/me/avatar` — `uploadAvatar` (verified UID as R2 key — closes AUDIT.md 1.1 segment)
- [ ] **A.3.23** `POST /api/v1/me/push-subscription` — `savePushSubscription`
- [ ] **A.3.24** `DELETE /api/v1/me/push-subscription` — `removePushSubscription`
- [ ] **A.3.25** `POST /api/v1/me/notification-preferences` — `updateNotificationPreferences`

**Follows**
- [ ] **A.3.26** `POST /api/v1/users/[uid]/follow` — `followUser` (with rate limit — closes AUDIT.md 3.8 segment)
- [ ] **A.3.27** `DELETE /api/v1/users/[uid]/follow` — `unfollowUser`

**Reviews & ratings**
- [ ] **A.3.28** `POST /api/v1/reviews` — `createReview` (length cap, sanitize — closes AUDIT.md 2.16 segment)
- [ ] **A.3.29** `PATCH /api/v1/reviews/[id]` — `updateReview` (real edit — closes AUDIT.md 2.6)
- [ ] **A.3.30** `DELETE /api/v1/reviews/[id]` — `deleteReview` (also cleans activities)
- [ ] **A.3.31** `POST /api/v1/reviews/[id]/like` — `likeReview` (transactional — closes AUDIT.md 3.5)
- [ ] **A.3.32** `DELETE /api/v1/reviews/[id]/like` — `unlikeReview`
- [ ] **A.3.33** `GET /api/v1/reviews?tmdbId=...&cursor=...` — `getMovieReviews` w/ pagination (closes AUDIT.md 3.10)
- [ ] **A.3.34** `POST /api/v1/ratings` — `createOrUpdateRating`
- [ ] **A.3.35** `DELETE /api/v1/ratings/[tmdbId]` — `deleteRating`

**Activities**
- [ ] **A.3.36** `GET /api/v1/activities?cursor=...` — `getActivityFeed`
- [ ] **A.3.37** `POST /api/v1/activities/[id]/like` — `likeActivity` (transactional)

**Notifications**
- [ ] **A.3.38** `GET /api/v1/notifications` — list
- [ ] **A.3.39** `POST /api/v1/notifications/read` — `markNotificationsRead`

**Search & external**
- [ ] **A.3.40** `GET /api/v1/users/search?q=...` — `searchUsers` w/ prefix query (closes AUDIT.md 2.8)
- [ ] **A.3.41** `GET /api/v1/movies/search?q=...` — TMDB proxy
- [ ] **A.3.42** `GET /api/v1/movies/[tmdbId]` — TMDB details
- [ ] **A.3.43** `GET /api/v1/movies/[tmdbId]/imdb-rating` — OMDB proxy

**Admin**
- [ ] **A.3.44** `POST /api/v1/admin/backfill-movies` — strict `ADMIN_SECRET` (closes AUDIT.md 1.8)
- [ ] **A.3.45** Other backfill routes — same hardening

**Per-endpoint test pattern:** for each route, add `scripts/audit-tests/<route>.test.ts` covering: unauth → 401, wrong user → 403, correct user → 200, invalid input → 400. Standardize via a helper.

### A.4 — Update client call sites

- [ ] **A.4.1** Replace every `import { actionName } from '@/app/actions'` with `apiCall('endpoint', body)`. Search-and-replace pass per endpoint.
- [ ] **A.4.2** Delete `src/app/actions.ts` (or keep as a thin re-export during transition).
- [ ] **A.4.3 — Test:** all existing UI flows work in `npm run dev` against the new routes.

### A.5 — Static export config

- [ ] **A.5.1** Set `output: 'export'` in `next.config.ts`. Configure `images.unoptimized: true` (already done).
- [ ] **A.5.2** Identify any pages still using `getServerSideProps`-equivalent server features or RSC fetching — convert to client-side.
- [ ] **A.5.3** Resolve dynamic route handling for static export — `/lists/[listId]`, `/profile/[username]`, etc. (use `generateStaticParams` returning `[]` + `dynamicParams: true` won't work for export; use a single client-side router pattern instead). May need to introduce a catch-all client-rendered router.
- [ ] **A.5.4** `npm run build` outputs a clean `out/` directory.
- [ ] **A.5.5 — Test:** serve `out/` with a static server (e.g. `npx serve out`); every route works as a client-side app.

---

## Phase B — Capacitor wrap

> ~1 week. Mostly setup + configuration + handling WKWebView quirks.

### B.1 — Install & init

- [ ] **B.1.1** `npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`
- [ ] **B.1.2** `npx cap init Cinechrony com.cinechrony.app --web-dir=out`
- [ ] **B.1.3** Configure `capacitor.config.ts`: app ID, name, `webDir: 'out'`, deep link scheme, allowed navigation domains.
- [ ] **B.1.4** Add iOS and Android platforms: `npx cap add ios && npx cap add android`.
- [ ] **B.1.5** `npm run build && npx cap sync` — produces working Xcode and Android Studio projects.

### B.2 — Auth in Capacitor

> Firebase Auth Web SDK has known issues in WKWebView (popup auth, OAuth redirects). Plan around it.

- [ ] **B.2.1** Decide: use Firebase Auth Web SDK with redirect flow (works but fragile), or use `@capacitor-firebase/authentication` plugin (more reliable, native auth dialogs).
  - **Recommended:** Capacitor Firebase Auth plugin for Google sign-in, Apple sign-in. Email/password can stay on Web SDK.
- [ ] **B.2.2** Add Sign in with Apple — **required by App Store for any app that offers third-party social sign-in** (Google). Use `@capacitor-community/apple-sign-in` or the Firebase plugin's Apple support.
- [ ] **B.2.3** ID token retrieval working from Capacitor context for `apiCall`.
- [ ] **B.2.4 — Test:** login as Google, Apple, email — all three succeed in iOS Simulator + on device.

### B.3 — Push notifications via APNs

- [ ] **B.3.1** Install `@capacitor/push-notifications`.
- [ ] **B.3.2** Configure APNs in Apple Developer + Firebase Console (FCM as the delivery layer).
- [ ] **B.3.3** Replace the half-built web push subscription flow with the Capacitor plugin's `register()` → returns FCM token → save via `/api/v1/me/push-subscription`.
- [ ] **B.3.4** Server-side: `web-push` library still works for web users; add FCM Admin SDK send for native tokens. Update notification creators to fan out to both.
- [ ] **B.3.5** Per-event push (closes AUDIT.md 4.2). Wire `mention`, `reply`, `list_invite` first; `like`, `follow` second.
- [ ] **B.3.6 — Test:** trigger each event type from a second account → push arrives on physical iOS device within seconds.

### B.4 — Deep linking (invites + share extension callbacks)

- [ ] **B.4.1** Set up Universal Links (iOS) and App Links (Android). Required for `/invite/[code]` URLs to open inside the app.
- [ ] **B.4.2** Add `apple-app-site-association` and `assetlinks.json` to the `public/` directory.
- [ ] **B.4.3** Capacitor `App` plugin listens for `appUrlOpen` → routes to the right in-app screen.
- [ ] **B.4.4 — Test:** tap an invite link in Messages → opens directly in the app, not Safari.

### B.5 — Native polish

- [ ] **B.5.1** Status bar style, splash screen, app icons (all sizes — use `@capacitor/assets` to generate from a single source).
- [ ] **B.5.2** Configure safe-area insets for notch/dynamic island.
- [ ] **B.5.3** Verify pull-to-refresh feels native (AUDIT.md 3.4 fix should land first).
- [ ] **B.5.4** Disable WKWebView scroll bounce on body if desired (`@capacitor/keyboard` and viewport config).
- [ ] **B.5.5 — Test:** run on a real iPhone 12+ and a real Android device. Feel-check the basics.

---

## Phase C — Share Extension (iOS) + Share Intent (Android)

> **The hero feature.** ~2 weeks. iOS Share Extension is a separate Swift target inside the Capacitor-generated Xcode project — Claude Code can write the Swift, but you should at least skim what it produces.

### C.1 — AI identification backend

- [ ] **C.1.1** `POST /api/v1/identify-movie` — accepts multipart image, returns `{ matches: [{ tmdbId, title, year, mediaType, posterUrl, confidence }] }`.
- [ ] **C.1.2** Pipeline: receive image → resize/compress to ~1024px (cost control) → Claude vision with structured-output prompt asking for `{title, year, mediaType, confidence: 'high'|'medium'|'low'|'unknown'}` → if high/medium, TMDB search by title+year → return top 1-3 matches.
- [ ] **C.1.3** Fallback: if Claude returns `unknown`, try OCR on the image (look for embedded subtitles/title cards) before giving up.
- [ ] **C.1.4** Rate limit per user (use the same limiter from AUDIT.md 3.8).
- [ ] **C.1.5** Auth: require valid ID token. The Share Extension will send its own.
- [ ] **C.1.6 — Test:** curl with 10 sample screenshots from real TikToks/Reels covering: famous Hollywood, recent A24, anime, TV episode, ambiguous still. Verify identification rate and false-positive rate. Tune the prompt until ≥80% top-1 accuracy on the sample.

### C.2 — Shared auth token (App Group)

- [ ] **C.2.1** Set up an App Group in Apple Developer (`group.com.cinechrony.shared`). Enable on both main app and Share Extension targets.
- [ ] **C.2.2** Main app: after Firebase Auth login, write the current ID token to App Group shared `UserDefaults` (or shared Keychain — more secure). Refresh on token rotation.
- [ ] **C.2.3** Share Extension reads token from shared storage.
- [ ] **C.2.4 — Test:** login in main app, verify token visible to extension via debugger.

### C.3 — iOS Share Extension target

- [ ] **C.3.1** Add Share Extension target in Xcode. Configure `Info.plist`:
  - `NSExtensionAttributes.NSExtensionActivationRule` — only activate for `NSExtensionActivationSupportsImageWithMaxCount = 1`
- [ ] **C.3.2** Custom view controller (SwiftUI is fine for iOS 14+ extension UI) showing:
  - Loading spinner while identifying
  - Identified movie card (poster + title + year) with confirm button
  - If multiple matches: pick one
  - List selector (defaults to user's default list, dropdown to switch)
  - "Add" → call `POST /api/v1/lists/[listId]/movies` → success animation → dismiss
- [ ] **C.3.3** Handle the no-identification case gracefully — show "Couldn't identify, search manually?" with a deep-link into the main app's add flow.
- [ ] **C.3.4 — Test:**
  - Real iPhone, real screenshot from TikTok → share → Cinechrony appears in share sheet → identifies → adds → success
  - Same flow with a screenshot of nothing identifiable → graceful fallback
  - Same flow when logged-out → prompts to open the app first

### C.4 — Share confirmation UX polish

- [ ] **C.4.1** Haptic feedback on add success.
- [ ] **C.4.2** Show a 1-second confirmation that mirrors the "saved with @cinechrony" branding — this is the moment users would screenshot to show friends.
- [ ] **C.4.3** Optional: a "share back" button that exports a styled card with the movie poster + "Saved to my watchlist on Cinechrony" — feeds the viral loop.

### C.5 — Android Share Intent handler

- [ ] **C.5.1** Add `<intent-filter>` in `AndroidManifest.xml` for `ACTION_SEND` with `image/*` MIME type → main activity (no separate process needed on Android, unlike iOS extensions).
- [ ] **C.5.2** Capacitor `App` plugin listens for the share intent → reads the image URI → POSTs to `/api/v1/identify-movie` → routes to a confirmation screen in the main app.
- [ ] **C.5.3 — Test:** share a screenshot from Instagram on Android → Cinechrony appears in share menu → flow completes.

### C.6 — PWA Web Share Target (bonus)

- [ ] **C.6.1** Add `share_target` to `public/manifest.json` for Android PWA users who don't install the app.
- [ ] **C.6.2 — Test:** install PWA on Android Chrome, verify share target works.

### C.7 — Onboarding redesign around try-before-signup

> Only buildable once C.1 (`/api/v1/identify-movie`) exists — it reuses that backend at zero marginal cost. This is the "try before you sign up" idea, sequenced correctly. Do NOT build before the hero feature exists; do NOT add a personalization quiz (it changes nothing in the experience — fake-progress anti-pattern).
>
> **Builds in the Phase 0 design system.** C.7 is the *flow* change (try-before-signup); the *look* is already settled by Phase 0.3.5. Don't redesign onboarding visuals here — apply the existing system.

- [ ] **C.7.1** Replace the static 1.5s logo splash (`onboarding/components/splash-screen.tsx`) with an interactive first screen: "Paste a TikTok/Reel link — see what movie it is" (and, on native, "or share a screenshot"). No auth required.
- [ ] **C.7.2** Wire that screen to `POST /api/v1/identify-movie` (C.1). Show the identified movie card (poster + title + year) — the value reveal — before any signup wall.
- [ ] **C.7.3** Conversion moment: "Sign up to save it to your watchlist" → flows into the existing `signup` → `username` → `import-options` machinery (unchanged).
- [ ] **C.7.4** Pre-signup state: hold the identified movie in local state; after signup completes, auto-add it to the user's default list so the first thing they see is the movie they came for already saved.
- [ ] **C.7.5** Copy reframe on `signup-screen.tsx`: frame signup as "Save your progress," not a gate (cheap; can also be done early via AUDIT.md 4.5).
- [ ] **C.7.6 — Test (manual):** logged-out user pastes a real TikTok link → sees correct movie identified → signs up → lands in app with that movie already in their default list. Also: skip-without-trying path still works.
- [ ] **C.7.7** Optional, last: a one-line stylized founder welcome note on `complete-screen.tsx`. Skip the founder video — over-investment pre-launch.

**Depends on:** C.1 (identify backend), AUDIT.md 4.1 (already-onboarded redirect must be fixed first or returning users hit this flow).

---

## Phase D — App Store + Play Store submission

> ~2-3 weeks including review iterations.

### D.0 — App Store compliance (carried over from the pre-launch audit)

> These are App Store *gate* items — surfaced and partly built during the
> audit (2026-05). Tracked here, not in AUDIT.md, because they're launch
> requirements, not soundness fixes. Status as of 2026-05-20:

- [x] **Account deletion in-app** — already existed (`/settings`); Apple requires it for any app with sign-up.
- [x] **Sign in with Apple** — N/A. App offers only email/password, no third-party social login, so SIWA is not mandated. (If Google/Apple login is ever added, SIWA becomes required — see B.2.2.)
- [x] **AppTrackingTransparency** — N/A. No analytics/tracking SDK in the app.
- [x] **Content reporting (§1.2)** — DONE in the audit: `reportContent` action + Report button on reviews + server-only `/reports` collection.
- [x] **`/privacy` route exists** — built in the audit with an accurate draft. Final legal copy still pending → D.4.1.
- [x] **TMDB attribution** — DONE: shown in `/settings` ("uses the TMDB API but is not endorsed or certified by TMDB").
- [ ] **D.0.1 — Block abusive users (§1.2, REQUIRED before submission).** Spec'd and pulled forward to **0.5.5** (posts depend on it). This line stays as the submission checkpoint — confirm 0.5.5 has shipped before you submit. The Report half (`reportContent`) is already done.
- [ ] **D.0.2 — Error monitoring (Sentry).** At launch scale you need to know what's breaking. Sign up, get a DSN, wire `@sentry/nextjs`. ~1h once the DSN exists. (Replaces the audit's "no observability" gap.)
- [ ] **D.0.3 — Moderation contact email** — a published address (e.g. `support@cinechrony.com`) for abuse reports; referenced by the privacy policy and §1.2.

### D.1 — Apple Developer account

- [ ] **D.1.1** Enroll ($99/yr).
- [ ] **D.1.2** Set up team, certificates, provisioning profiles. Xcode → Automatic signing.
- [ ] **D.1.3** Create App ID with the right capabilities: Push Notifications, App Groups, Sign in with Apple, Associated Domains.

### D.2 — App Store Connect setup

- [ ] **D.2.1** Create app record with bundle ID `com.cinechrony.app`.
- [ ] **D.2.2** Upload icon (1024×1024), screenshots (6.7" + 5.5" required; 6.5" recommended). **Capture against the Phase 0 redesign** — never ship store screenshots of the old UI.
- [ ] **D.2.3** App description, keywords, support URL, marketing URL, privacy policy URL.
- [ ] **D.2.4** App Privacy questionnaire (Firebase Analytics, push tokens, profile data — declare honestly).
- [ ] **D.2.5** Age rating questionnaire.

### D.3 — TestFlight beta

- [ ] **D.3.1** First TestFlight build. Add yourself + 5-10 trusted testers as internal.
- [ ] **D.3.2** Run for at least 1 week. Collect crash reports, feedback on the share-extension UX specifically.
- [ ] **D.3.3** Iterate. **This is where most of `AUDIT.md` Phase 2 and 3 should be done** — beta users surface what really breaks.

### D.4 — Privacy policy & terms

- [~] **D.4.1** Privacy policy — the `/privacy` route + an accurate draft already exist (built in the audit; reflects real data + third parties). Remaining: a lawyer review of the draft, and confirm the support email. Must address: data collected, third parties (Firebase, TMDB, OMDb, R2), retention, user rights, contact.
- [ ] **D.4.2** Terms of service at `cinechrony.com/terms`.
- [ ] **D.4.3** Both linked from inside the app (Settings → Legal).

### D.5 — App Store review submission

- [ ] **D.5.1** First submission. **Expect at least one rejection** — common reasons for an app like this: account deletion flow not obvious enough, missing demo account credentials for the reviewer, screenshots showing copyrighted movie posters (usually fine but be ready), unclear Share Extension purpose.
- [ ] **D.5.2** Demo account credentials in the App Review notes (with pre-seeded data so reviewer sees the app populated).
- [ ] **D.5.3** Screencast of the share-extension flow attached to review notes — pre-empts the "what does this app do?" question.
- [ ] **D.5.4** Iterate on rejection feedback. Most rejections resolve in 1-2 cycles if you respond fast and clearly.

### D.6 — Google Play submission

- [ ] **D.6.1** Google Play Console account ($25 one-time).
- [ ] **D.6.2** Same asset prep (icon, screenshots, description, privacy policy).
- [ ] **D.6.3** Internal testing track → closed testing → production.
- [ ] **D.6.4** Play's review is faster (often <24h) but they enforce a "must have 20 testers test for 14 days" rule for new developer accounts. Plan around it.

---

## Phase E — Marketing automation

> Can run in parallel with Phase D (App Store review). ~1-2 weeks of setup, then ongoing.

### E.1 — Account setup

- [ ] **E.1.1** Create TikTok account `@cinechrony` (you don't have one yet). Sign up for TikTok Business so the Content Posting API is available.
- [ ] **E.1.2** Convert existing Instagram account to Business (Settings → Account Type). Connect to a Facebook Page (required for Graph API). If no Facebook Page exists, create one.
- [ ] **E.1.3** Create Threads / X / Lemon8 accounts if desired (lower priority).

### E.2 — API access

- [ ] **E.2.1** Facebook Developer app + Instagram Graph API access. Required scopes: `instagram_basic`, `instagram_content_publish`, `pages_show_list`. Long-lived access token stored as env var.
- [ ] **E.2.2** TikTok for Developers app + Content Posting API access. Submit for approval (TikTok reviews API access manually; can take 1-2 weeks).
- [ ] **E.2.3** Test post via each API — manually trigger a Hello-World post to verify auth + permissions before automating.

### E.3 — n8n setup

- [ ] **E.3.1** Choose hosting: n8n Cloud ($20-50/mo) or self-host on a $5 Hetzner VPS. Self-host is fine for solo dev.
- [ ] **E.3.2** Set up basic auth + reverse proxy + HTTPS.
- [ ] **E.3.3** Test a hello-world workflow: HTTP trigger → Claude node → respond.

### E.4 — Remotion templates

- [ ] **E.4.1** Set up Remotion project (`npm create video`).
- [ ] **E.4.2** Build 3 templates initially:
  - **Carousel slides** (10 frames, exported as images for IG carousel)
  - **15-second TikTok/Reel video** (poster + title + reveal, music track)
  - **30-second "Top 5 of the week"** countdown
- [ ] **E.4.3** Deploy as Remotion Lambda (AWS) or local Remotion server. Lambda is easier — pay-per-render.
- [ ] **E.4.4** Test render: pass JSON `{movies: [...]}` to each template, verify output renders correctly.

### E.5 — Content generation pipeline

- [ ] **E.5.1** n8n workflow:
  1. Daily cron @ 9am
  2. Branch by day-of-week (Monday = trending list, Tuesday = "if you liked X", etc.)
  3. Fetch data source: TMDB trending API OR Firestore query (most-added on Cinechrony this week)
  4. Claude node generates structured content: `{caption, slides: [{title, subtitle}], hashtags}` with strict JSON schema
  5. Remotion Lambda render → returns video URL
  6. Notify you on Discord/Slack with the rendered output + "approve to post" button
- [ ] **E.5.2** Approval webhook: clicking approve triggers IG + TikTok posting nodes in n8n.
- [ ] **E.5.3** Failure handling: any step fails → notify you, don't post broken content.

### E.6 — Posting workflow

- [ ] **E.6.1** Instagram: Graph API two-step post (create media container → publish).
- [ ] **E.6.2** TikTok: Content Posting API (publish with caption + hashtags).
- [ ] **E.6.3** Cross-post the same Remotion-rendered video to both, adjusted for aspect ratio (9:16 for both TikTok and Reels — easy).
- [ ] **E.6.4 — Test:** end-to-end dry run a week of content. Verify everything renders + posts. Approve manually for the first month before going fully automated.

### E.7 — Launch sequence

- [ ] **E.7.1** Two weeks before launch: start posting daily to build a back-catalog. Algorithm rewards consistency more than recency.
- [ ] **E.7.2** Launch day:
  - Personal launch TikTok showing the screenshot-to-watchlist demo
  - Automated post highlighting the new feature
  - Reach out to 5-10 movie-TikTok creators with early access codes
- [ ] **E.7.3** Week 1 post-launch: respond to every comment manually. Algorithm boost.
- [ ] **E.7.4** Track: install rate, share-extension usage, retention day 7. If share-extension usage < 30% of installs, the demo isn't selling — iterate copy.

---

## Critical dependencies (read before starting)

1. **`AUDIT.md` Phase 1 happens DURING Phase A.** When you refactor each action to an API route, add `verifyCaller()` to that route. The two efforts converge.
2. **Phase A is the long pole.** It's 2-3 weeks of careful refactoring. Everything else assumes it's done.
3. **Phase C depends on Phase B.** Share Extension lives inside the Capacitor iOS project.
4. **Phase E can run fully parallel** with B, C, D. No technical dependencies.
5. **TestFlight (D.3) is the moment to fold in `AUDIT.md` Phase 2 and 3.** Beta users surface real breakage; don't try to ship the audit in isolation.

---

## Realistic timeline (solo dev, focused)

| Week | Primary work | Parallel |
|------|--------------|----------|
| — | Phase 0 — UI redesign (scope B) + UX patterns · **done, merged to main** | — |
| 1-3 | Phase 0.5 — Discover (liked lists + showcase + user posts + home/search merge) | E.1-E.2 (account setup) |
| 4-5 | Phase A.1-A.3 (server actions refactor + auth) | E.1-E.2 (account setup) |
| 6 | Phase A.4-A.5 (client migration + static export) | E.3 (n8n) |
| 7 | Phase B (Capacitor wrap) | E.3 (n8n) |
| 8-9 | Phase C.1-C.3 (Share Extension + AI) | E.4-E.5 (Remotion + pipeline) |
| 10 | Phase C.4-C.7 (Android share + onboarding + polish) | E.6 (posting workflow) |
| 11 | Phase D.1-D.3 (TestFlight + iterate) | Audit Phase 2-3 in TestFlight |
| 12 | Phase D.5-D.6 (App Store submission) | E.7 (back-catalog content) |
| 13 | Apple review iterations | — |
| 14 | **Launch** | — |

~**14 weeks** of remaining work. Phase 0 (the redesign) is done and merged. Phase 0.5 adds ~3 weeks of discovery work pre-launch — user posts (0.5.4) is the heavy part, and it carries blocking (0.5.5) with it. Add 2-4 weeks of buffer for Apple review cycles + the Swift learning curve + the unexpected.

---

## Progress log

| Date | Phase | Item | Notes |
|------|-------|------|-------|
| 2026-05-15 | — | Plan | Launch plan created. AUDIT.md Phase 1 still pending — must complete before Phase A starts. |
| 2026-05-21 | 0 | Plan | Added Phase 0 — full UI redesign (scope B), sequenced first. AUDIT.md Phases 0-2 complete; redesign now leads the launch. |
| 2026-05-21 | 0 | Done | Phase 0 implemented in full — v2 editorial-cinema redesign + the UX patterns (movie detail, activity feed, notes, profile, comments, add, discover surfaces). Merged to main (PR #77). |
| 2026-05-21 | 0.5 | Plan | Added Phase 0.5 — Discover: liked public lists + an editorial loved-lists showcase + merging home/search into one Discover page. Pulled forward to pre-launch. |
| 2026-05-21 | 0.5 | Plan | Added 0.5.4 — user posts in the feed (Beli-style: text + photos + movie/friend tags + optional freeform place). Makes blocking a hard dependency — posts and 0.5.5 ship together. |
| 2026-05-21 | 0.5 | Plan | Added 0.5.5 — block a user (full mutual invisibility — filters every read surface, both directions). Pulled forward from D.0.1; D.0.1 is now the pre-submission checkpoint. |
| 2026-05-22 | 0.5 | Done | **Phase 0.5 implemented in full** on `feat/home-discover-rebuild` (one preview branch, 11 commits). Home rebuilt as the unified editorial feed; bottom nav cut to 3 tabs (`home · lists · profile`). Shipped: 0.5.1 like public lists · 0.5.2 loved-lists showcase (recency-weighted, cold-start gated) · 0.5.3 home/search merge (search is a header overlay) · 0.5.4 user posts (text + image **and video** up to 200MB via presigned R2 uploads, movie/friend tags, place, composer with drafts, posts merged into the feed, post comments) · 0.5.5 block a user. Plus a "for you" recommendation engine + "more like this" on movie detail (TMDB recommendations), a saved/bookmark archive, ⋯ overflow menus, and mute. 52 new audit tests; full suite 126/126 green. |
| 2026-05-22 | 0.5 | Decision | The `nearby` feed pill (0.5.3 / UX_PATTERNS) was **dropped** — it requires GPS, which this plan explicitly forbids (`place` is freeform text only). Shipped 5 pills: `all · saved · friends · for you · trending`. The pill bar is built to extend if a non-GPS reinterpretation is ever wanted. |
| 2026-05-22 | 0.5 | Polish | v3 "editorial cinema" rebuild of the post composer, new-list creator, and `/movie/[tmdbId]/comments` page on top of the Phase 0.5 branch. Pinning a film on posts is now optional (any of text/media/film); list covers gained `coverMode: 'auto' \| 'custom'` with a 3-poster mosaic for `auto`; `Review` gained `hasSpoiler` with a tap-to-reveal shield. Yellow v1 PWA `theme_color` retired (newsprint cream + Next 15 `viewport.themeColor` export). |
| 2026-05-22 | 0.5 | Fix | Modal back-navigation contract — `/movie/[tmdbId]/comments` → back now reopens the modal on every route, even after iOS PWA aborts the second TMDB fetch. Three pieces: (1) `key={selectedMovie?.id}` fresh-mount on every modal call site; (2) `src/lib/tmdb-details-cache.ts` module-level cache for TMDB detail + "more like this" payloads (synchronous hit on reopen — nothing for iOS to abort); (3) `src/contexts/movie-modal-context.tsx` `MovieModalProvider` to centralize the modal on multi-tile pages (`/home`, `/post/[postId]`) with sessionStorage rehydration on `?openMovie=` return. |
