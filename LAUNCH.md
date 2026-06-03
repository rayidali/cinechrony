# Cinechrony Launch Plan — App Stores + Hero Feature + Marketing

> **Started:** 2026-05-15 · **Updated:** 2026-05-25
> **Goal:** Ship to iOS App Store + Google Play with a refreshed UI + the **share-TikTok/Reel-to-watchlist** Share Extension as the hero feature (AI dissects the linked video and extracts the mentioned films), plus automated TikTok-first / Instagram-second daily content.
> **Sequencing:** The pre-launch audit (`AUDIT.md` Phases 0–2) is done. Phase 0 (UI redesign) and Phase 0.5 (Discover) are both shipped and on `main`. **Phase 0.6 (Speed & Native Feel) is next** — a small, focused pass to eliminate the loading flashes that will read as "webby" once we ship to the App Store. Then A (API routes) → B (Capacitor) → C (Share Extension) → D (stores) → E (marketing).
> **Approach:** Capacitor (right path — static export + API routes refactor). Not a Swift rewrite. Solo dev using Claude Code for Swift work.

---

## Phase 0 — UI Redesign (✅ SHIPPED on `main`, 2026-05-21)

> v2 editorial-cinema redesign shipped via PR #77. All checkboxes below are
> historical — kept for reference. The component language and design tokens
> in `globals.css` + `tailwind.config.ts` are the source of truth.

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

## Phase 0.5 — Discover: liked lists + the home/search merge (✅ SHIPPED on `main`, 2026-05-22)

> Phase 0.5 shipped on `feat/home-discover-rebuild` (PR #79, merged
> 2026-05-22). 11 commits, 126/126 audit tests green. All sub-checkboxes
> below are marked complete. See the progress log at the bottom.

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

- [x] **0.5.1.1** Data: add `likes` (number) + `likedBy` (string[]) to the
  list document — mirror the existing review/activity like shape.
- [x] **0.5.1.2** Server actions `likeList` / `unlikeList` — clone the
  `likeReview` / `likeActivity` pattern: `verifyCaller`, transactional count
  update, reuse the `like` rate-limit key. Only public lists are likeable.
- [x] **0.5.1.3** `firestore.rules`: `likes` / `likedBy` are server-only
  writes (same as reviews/activities) — clients can't tamper with counts.
- [x] **0.5.1.4** UI: a heart on the public list view + the list cover card.
  Optimistic toggle, fills sage when liked (matches the v2 like treatment).
- [x] **0.5.1.5** Notification to the list owner — new `list_like`
  notification type, reuses the existing notification system.
- [x] **0.5.1.6 — Test:** like / unlike as an authed user; forged token
  rejected; count holds under a concurrent burst; private lists not likeable;
  rate limit trips. Add to `scripts/audit-tests/`.

### 0.5.2 — The loved-lists showcase

- [x] **0.5.2.1** Rank by a **recency-weighted trending score**, not all-time
  cumulative likes — `getLovedLists` does the HN-style decay on read.
- [x] **0.5.2.2** Editorial presentation — `THE COLLECTION · loved this week`
  covers in the trending strip, no numbered ranks.
- [x] **0.5.2.3** Cold-start gate — `getLovedLists` returns `[]` below
  threshold so the showcase doesn't render into an empty room.
- [x] **0.5.2.4 — Test:** added in `scripts/audit-tests/18-loved-lists.ts`.

### 0.5.3 — Merge home + search → one Discover page

- [x] **0.5.3.1** `/home` rebuilt as the unified discover surface — search
  trigger → filter pills → trending strip (films + loved lists) → the feed.
- [x] **0.5.3.2** Bottom nav cut to **3 tabs** (`home · lists · profile`).
  The `/add` route still exists but is out of nav; search is the header
  overlay (`SearchOverlay`).
- [x] **0.5.3.3** Editorial composition retained — eyebrow → hairline →
  lowercase title.
- [x] **0.5.3.4 — Test:** covered by existing audit suite (search,
  trending, feed, nav, pull-to-refresh all walked).

### 0.5.4 — User posts in the feed (the Beli-style update)

> The biggest piece of this phase. Today the activity feed is only *system
> events* (added / rated / watched / reviewed). This adds a **user-authored
> post** — free text + photos + an optional movie tag, friend tags ("watched
> with @x and @y") and an optional place. A short Beli/Twitter-style update,
> anchored to a film.

- [x] **0.5.4.1** `/posts/{postId}` collection — `authorId`, `text`,
  `media[]` (images + video on R2), `taggedMovie`, `taggedUserIds[]` +
  denormalized `taggedUsers[]`, `place`, `likes`/`likedBy`, `commentCount`.
- [x] **0.5.4.2** Full-screen post composer with multi-photo + video upload
  (presigned R2 PUT, video ≤200MB), movie-tag search, friend tagger, place.
- [x] **0.5.4.3** Anchored to a film — the post card leads with the tagged
  poster.
- [x] **0.5.4.4** Feed rendering — `PostCard` (with media grid, tagged movie,
  tagged friends as chips, likes, comments) merged into the activity feed
  via `getHomeFeed`. Comments at `/posts/{id}/comments/{id}` (1-level thread).
- [x] **0.5.4.5** Tagged friends notified. Compose entry = the `PostFab` on
  home.
- [x] **0.5.4.6 — Test:** added in `scripts/audit-tests/19`–`22` (create,
  comment, block-filter, report).

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

- [x] **0.5.5.1** `/blocks/{blockerId}_{blockedId}` collection with a
  per-session `UserBlocksCacheProvider` for O(1) filtering. The client gets
  the invisibility union via `getMyBlockContext`.
- [x] **0.5.5.2** `blockUser` / `unblockUser` (verifyCaller). Severs the
  follow relationship in both directions, revokes pending invites, stops
  notifications.
- [x] **0.5.5.3** Cross-cutting enforcement — profile, public lists, feed,
  posts, comments, reviews, followers, search, notifications. Both
  directions.
- [x] **0.5.5.4** Interaction severance enforced server-side + in rules
  where applicable.
- [x] **0.5.5.5** UI: `block` in the `ProfileOverflowMenu` ⋯ menu, unblock
  list in `BlockedUsersSection` in `/settings`, "block too" offered in the
  report flow.
- [x] **0.5.5.6 — Test:** added in `scripts/audit-tests/23`–`25`.

### Don't

- ❌ A numbered/ranked leaderboard with trophies or "#1" — editorial showcase only.
- ❌ Rank by all-time cumulative likes (it ossifies).
- ❌ Ship the showcase before there's content to fill it.
- ❌ Invent a new like data model — reuse the review/activity like shape.
- ❌ Ship user posts before 0.5.5 (block) + reporting are in place.
- ❌ A half-block that only hides comments — it must filter every read surface.
- ❌ GPS / maps / distance for `place` — freeform text only.

---

## Phase 0.6 — Speed & Native Feel (✅ SHIPPED on `main` via PR #83, 2026-05-25)

> Shipped on `feat/speed-swr-cache`. Owner verified locally; merged. The boxes
> below are historical reference. See HANDOFF.md "Speed sweep — the contract"
> for the current API surface.

> **Why now, not after launch:** wrapping the app in Capacitor and putting it
> next to real native apps on a user's phone will MAGNIFY every perceived-
> latency cue we have today. The "feels like a webapp cosplaying as a mobile
> app" comment is the early-warning siren. Fix this before App Store
> submission, not after.
>
> The bugs (Vaul body-style leak, PullToRefresh transform context) and the
> first wave of native-feel polish (swipe-back gesture on `/comments`, tap-
> target sweep, PullToRefresh refactor) shipped on
> `fix/video-thumbnails-composer-reach`. This phase is the bigger structural
> pass that makes tab switches feel instant.

### 0.6.1 — Stale-while-revalidate caches for tab data

- [x] **0.6.1.1** `use-cached-action.ts` — module-level SWR Map with
  inflight coalescing. Used by `/lists`, `/home`, profile.
- [x] **0.6.1.2** `getHomeFeed` cached via the same hook. `cache-config.ts`
  registers the persisted keys to `localStorage` at module load.
- [x] **0.6.1.3** Profile + following set cached.
- [x] **0.6.1.4** `list-detail-seed.ts` — sessionStorage seed renders
  the list-detail page synchronously on remount.
- [x] **0.6.1.5 — Test:** Firestore IndexedDB persistence enabled via
  `persistentLocalCache({ tabManager: persistentMultipleTabManager() })`;
  cache survives full app reloads.

### 0.6.2 — Prefetch on touch-start

- [x] **0.6.2.1** `bottom-nav.tsx` calls `prefetchCachedAction` on
  `onTouchStart`/`onMouseEnter`.
- [ ] **0.6.2.2** Movie-tile touch-start warm-up for
  `getMovieOrTVDetails`. (Partial — module-level TMDB cache exists; tile
  touch-start hook not wired. **Low-impact follow-up.**)

### 0.6.3 — Skeleton consistency

- [~] **0.6.3.1** Skeleton sweep — improvements made on
  `fix/video-thumbnails-composer-reach` (composer, PullToRefresh refactor,
  tap-target sweep). Full audit deferred — current loading states are
  acceptable.

### 0.6.4 — (Optional, deferrable) Parallel-route tab shell

- [ ] **0.6.4.1** **Deferred to post-launch v1.1.** 0.6.1–0.6.3 already
  achieve enough native-feel that this is not blocking the App Store push.

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

- [x] **A.1.1** Categorize every export in `src/app/actions.ts`. 103 exports
  classified. — PR #1
- [x] **A.1.2** Output: `scripts/api-refactor-inventory.md` with each action
  labeled and the target route name. — PR #1

### A.2 — Build the API route foundation

- [x] **A.2.1** `src/lib/auth-server.ts` — `verifyCaller` reads Firebase ID
  token from `Authorization: Bearer ...` and calls
  `getAuth(adminApp).verifyIdToken(token)`. (Existed pre-Phase-A from the
  audit; reused by the route wrapper.)
- [x] **A.2.2** `src/lib/api-handler.ts` — `apiRoute` wrapper, typed
  `ApiError` hierarchy, envelope contract, CORS allowlist incl.
  `capacitor://localhost`. — PR #1
- [x] **A.2.3** `src/lib/api-client.ts` — `apiCall<T>(method, path, body?)`
  auto-attaches Bearer token from `auth.currentUser.getIdToken()`, parses the
  envelope, throws `ApiClientError`. — PR #1
- [x] **A.2.4 — Test:** `scripts/audit-tests/26-api-foundation.test.ts` (10
  tests covering the wrapper, envelope, CORS). — PR #1

### A.3 — Convert endpoints (one per route file)

> Group by domain. Each route file under `src/app/api/v1/...`. Numbered checklist matches the inventory in A.1.

**Lists**
- [x] **A.3.1** `POST /api/v1/lists` — `createList` — PR #3
- [x] **A.3.2** `PATCH /api/v1/lists/[ownerId]/[listId]` — collapsed name+description+isPublic — PR #3
- [x] **A.3.3** `DELETE /api/v1/lists/[ownerId]/[listId]` — `deleteList` — PR #3
- [x] **A.3.4** `POST /api/v1/lists/[ownerId]/[listId]/transfer` — `transferOwnership` (closes AUDIT.md 2.1 + 1.3) — PR #3
- [x] **A.3.5** `POST /api/v1/lists/[ownerId]/[listId]/cover` — `setListCover` (closes AUDIT.md 1.5) — PR #3
- [x] **A.3.6** `DELETE /api/v1/lists/[ownerId]/[listId]/collaborators/[uid]` — `removeCollaborator` (closes AUDIT.md 1.4) — PR #6
- [x] **A.3.6a** `POST /api/v1/lists/[ownerId]/[listId]/leave` — `leaveList` (caller self-removes; owner cannot leave own list) — PR #6
- [ ] **A.3.7** `GET /api/v1/lists/[ownerId]/[listId]/preview` — `getListPreview` w/ privacy check (closes AUDIT.md 1.13) — PR #12

**Movies in lists**
- [x] **A.3.8** `POST /api/v1/lists/[ownerId]/[listId]/movies` — `addMovieToList` (transactional — closes AUDIT.md 2.2) — PR #4
- [x] **A.3.9** `DELETE /api/v1/lists/[ownerId]/[listId]/movies/[movieId]` — `removeMovieFromList` (transactional) — PR #4
- [x] **A.3.10** `PATCH /api/v1/lists/[ownerId]/[listId]/movies/[movieId]` (status) — collapsed into the movie PATCH; closes `updateMovieStatus` — PR #4
- [x] **A.3.11** `PATCH /api/v1/lists/[ownerId]/[listId]/movies/[movieId]` (note) — collapsed into the movie PATCH; closes `updateMovieNote` + AUDIT.md 1.6 — PR #4
- [x] **A.3.12** `PATCH /api/v1/lists/[ownerId]/[listId]/movies/[movieId]` (socialLink) — collapsed into the movie PATCH; ALSO closes the read-bypass where the client was direct-writing `socialLink` via `updateDocumentNonBlocking`, skipping `canEditList`. Stranger writes now → 403. — PR #4

**Invites**
- [x] **A.3.13** `POST /api/v1/lists/[ownerId]/[listId]/invites` — `inviteToList` — PR #5
- [x] **A.3.14** `POST /api/v1/lists/[ownerId]/[listId]/invite-link` — `createInviteLink` (CSPRNG 12-char code; closes AUDIT.md 2.9 generation half) — PR #5
- [x] **A.3.15** `POST /api/v1/invites/accept` — `acceptInvite` (body: `inviteId?` OR `inviteCode?`; transactional; closes AUDIT.md 1.11) — PR #5
- [x] **A.3.16** `POST /api/v1/invites/[inviteId]/decline` — `declineInvite` — PR #5
- [x] **A.3.17** `DELETE /api/v1/invites/[inviteId]` — `revokeInvite` (owner OR inviter; closes AUDIT.md 1.12) — PR #5
- [x] **A.3.18** `GET /api/v1/invites/by-code/[code]` — `getInviteByCode` (auth required; closes AUDIT.md 2.9 enumeration vector) — PR #5
- [x] **A.3.18a** `GET /api/v1/lists/[ownerId]/[listId]/invites` — `getListPendingInvites` (member-only; collaborator does NOT see `inviteCode`; closes AUDIT.md 1.14) — PR #5
- [x] **A.3.18b** `GET /api/v1/me/invites` — `getMyPendingInvites` (verified caller from token; closes IDOR vector) — PR #5

**User**
- [x] **A.3.19** `PATCH /api/v1/me` — collapsed bio+photo+favorites — PR #2
- [~] **A.3.20** `PATCH /api/v1/me/username` — DEFERRED. `updateUsername` was found to be admin-only (ADMIN_SECRET-gated) with zero client callers. Stays in actions.ts until PR #13 (admin endpoints) or gets deleted entirely. AUDIT.md 1.10 already closed.
- [x] **A.3.21** `DELETE /api/v1/me` — closes AUDIT.md 1.2 — PR #2
- [x] **A.3.22** `POST /api/v1/me/avatar` — verified UID as R2 key — PR #2
- [ ] **A.3.23** `POST /api/v1/me/push-subscription` — `savePushSubscription`
- [ ] **A.3.24** `DELETE /api/v1/me/push-subscription` — `removePushSubscription`
- [ ] **A.3.25** `POST /api/v1/me/notification-preferences` — `updateNotificationPreferences`

**Follows**
- [x] **A.3.26** `POST /api/v1/users/[uid]/follow` — `followUser` (rate-limited, closes AUDIT.md 3.8 follow segment; transactional fixes the count-drift bug, block-check enforces LAUNCH.md 0.5.5) — PR #7
- [x] **A.3.27** `DELETE /api/v1/users/[uid]/follow` — `unfollowUser` (idempotent, no negative count drift) — PR #7
- [x] **A.3.27a** `GET /api/v1/users/[uid]/followers` — `getFollowers` (public, paginated via `?limit=`) — PR #7
- [x] **A.3.27b** `GET /api/v1/users/[uid]/following` — `getFollowing` (public, paginated via `?limit=`) — PR #7

**Reviews & ratings**
- [x] **A.3.28** `POST /api/v1/reviews` — `createReview` (rate-limited, length cap 2000, mention+reply notifications, AUDIT 3.8) — PR #8
- [x] **A.3.29** `PATCH /api/v1/reviews/[id]` — `updateReview` (real edit, closes AUDIT.md 2.6) — PR #8
- [x] **A.3.30** `DELETE /api/v1/reviews/[id]` — `deleteReview` (owner-only hard delete) — PR #8
- [x] **A.3.31** `POST /api/v1/reviews/[id]/like` — `likeReview` (transactional, closes AUDIT.md 3.5; rate-limited) — PR #8
- [x] **A.3.32** `DELETE /api/v1/reviews/[id]/like` — `unlikeReview` (transactional) — PR #8
- [x] **A.3.33** `GET /api/v1/reviews?tmdbId=&sort=&cursor=` — `getMovieReviews` w/ cursor pagination (closes AUDIT.md 3.10 top-level read) — PR #8
- [x] **A.3.33a** `GET /api/v1/reviews/[id]/replies?cursor=` — `getReviewReplies` w/ cursor pagination (closes AUDIT.md 3.10 replies read) — PR #8
- [x] **A.3.33b** `GET /api/v1/reviews/by-user?userId=&tmdbId=` — `getUserReviewForMovie` — PR #8
- [x] **A.3.34** `POST /api/v1/ratings` — `createOrUpdateRating` (1–10 validation, rounds to one decimal, emits `rated` activity on first rating only) — PR #9
- [x] **A.3.35** `DELETE /api/v1/ratings/[tmdbId]` — `deleteRating` (owner-only; doc id encodes ownership) — PR #9
- [x] **A.3.35a** `GET /api/v1/ratings/by-user?userId=&tmdbId=` — `getUserRating` (single lookup) — PR #9
- [x] **A.3.35b** `GET /api/v1/users/[uid]/ratings?cursor=` — `getUserRatings` w/ cursor pagination (closes AUDIT.md 2.5) — PR #9
- [x] **A.3.35c** `POST /api/v1/lists/[ownerId]/[listId]/like` — `likeList` (transactional, members-cannot-like-own-list guard, rate-limited) — PR #9
- [x] **A.3.35d** `DELETE /api/v1/lists/[ownerId]/[listId]/like` — `unlikeList` (transactional; lastLikedAt preserved on unlike) — PR #9

**Activities**
- [x] **A.3.36** `GET /api/v1/activities?cursor=` — `getActivityFeed` (public, cursor-paginated) — PR #10
- [x] **A.3.37** `POST /api/v1/activities/[id]/like` — `likeActivity` (rate-limited, transactional, closes AUDIT.md 3.5 activity-like leg) — PR #10
- [x] **A.3.37a** `DELETE /api/v1/activities/[id]/like` — `unlikeActivity` (transactional) — PR #10

**Posts** (split out of original "Activities + Posts" PR)
- [x] **A.3.37b** `POST /api/v1/posts` — `createPost` (rate-limited, validation, mention+tag notifications, rating upsert) — PR #11
- [x] **A.3.37c** `GET /api/v1/posts/[id]` — `getPost` (block-aware; returns null across a block) — PR #11
- [x] **A.3.37d** `PATCH /api/v1/posts/[id]` — `updatePost` (owner-only, writes editedAt) — PR #11
- [x] **A.3.37e** `DELETE /api/v1/posts/[id]` — `deletePost` (owner-only) — PR #11
- [x] **A.3.37f** `POST /api/v1/posts/media-upload-url` — presigned R2 PUT (uid-scoped key, image/video, ≤200MB) — PR #11
- [x] **A.3.37g** `POST /api/v1/posts/[id]/like` — `likePost` (transactional, closes AUDIT.md 3.5 post-like leg — FOURTH and FINAL like surface; rate-limited) — PR #11
- [x] **A.3.37h** `DELETE /api/v1/posts/[id]/like` — `unlikePost` (transactional) — PR #11
- [x] **A.3.37i** `GET /api/v1/home-feed?cursor=` — `getHomeFeed` (merged activities+posts, block-filtered server-side, timestamp cursor) — PR #11

**Post comments — PR #12 (ships AUDIT.md 3.5 comment-like leg)**
- [x] **A.3.37j** `POST /api/v1/posts/[id]/comments` — `createPostComment` (rate-limited via `review` bucket, block-aware vs post author, 1-level replies, recipient = post author for top-level / parent comment author for replies) — PR #12
- [x] **A.3.37k** `GET /api/v1/posts/[id]/comments` — `getPostComments` (public; block-filtered server-side from viewer's perspective; capped at 300) — PR #12
- [x] **A.3.37l** `DELETE /api/v1/posts/[id]/comments/[cid]` — `deletePostComment` (comment author OR post author; decrements parent `replyCount` for replies, post `commentCount` for top-level) — PR #12
- [x] **A.3.37m** `POST /api/v1/posts/[id]/comments/[cid]/like` — `likePostComment` (transactional read-check-write, AUDIT.md 3.5; rate-limited via `like` bucket) — PR #12
- [x] **A.3.37n** `DELETE /api/v1/posts/[id]/comments/[cid]/like` — `unlikePostComment` (transactional) — PR #12

**Notifications — PR #13 (also closes a pre-existing auth gap)**
- [x] **A.3.38** `GET /api/v1/notifications?cursor=&limit=` — `listNotifications` (cursor-paginated, block-filtered). Caller-scoped via Bearer token only — replaces the legacy `getNotifications(userId)` that trusted any UID arg. — PR #13
- [x] **A.3.38a** `GET /api/v1/notifications/unread-count` — `getUnreadNotificationCount` (Firestore `count()` aggregate). Same auth-gap closure. — PR #13
- [x] **A.3.39** `POST /api/v1/notifications/read` — `markNotificationsRead`. With ids → only docs owned by caller are flipped; no ids → all caller's unread. — PR #13
- [x] **A.3.39a** `POST /api/v1/me/push-subscription` — `savePushSubscription` (rate-limited via `pushSubscribe`, idempotent by endpoint). Validates https endpoint + `keys.p256dh/auth` shape. — PR #13
- [x] **A.3.39b** `DELETE /api/v1/me/push-subscription` — `removePushSubscription`. Flips `pushEnabled=false` when last sub removed. — PR #13
- [x] **A.3.39c** `GET /api/v1/me/push-status` — `getPushStatus`. — PR #13
- [x] **A.3.39d** `GET /api/v1/me/notification-preferences` — `getNotificationPreferences` (returns defaults for unset keys). — PR #13
- [x] **A.3.39e** `PATCH /api/v1/me/notification-preferences` — `updateNotificationPreferences` (merge-update; unknown keys / non-booleans dropped). — PR #13

> **Note on AUDIT.md 4.2** — web-push fan-out from notification creators is still TODO. PR #13 migrated the *management* surface and added cursor pagination + closed a userId-as-arg auth gap, but the in-app `createMentionNotifications` / `createReplyNotification` / etc. helpers in `src/lib/notifications-server.ts` do **not** yet call `webpush.sendNotification` for each subscription. That's a separate workstream (sized at ~1 PR; requires a `web-push` lib import + the `webpush.sendNotification` integration + per-event "respect notificationPreferences" gating).

**Search & external — PR #14**
- [x] **A.3.40** `GET /api/v1/users/search?q=...` — `searchUsersForViewer` (publicApiRoute; auth-aware: excludes self + block-filters when Bearer token present). Closes AUDIT.md 2.8 end-to-end. — PR #14
- [x] **A.3.41** `GET /api/v1/movies/trending` — TMDB trending/day enriched with IMDB ratings (server-only OMDB key). Public. — PR #14
- [x] **A.3.42** `GET /api/v1/movies/[tmdbId]/similar?mediaType=movie|tv&limit=N` — TMDB recommendations → fallback to similar. Public. — PR #14
- [x] **A.3.43** `GET /api/v1/movies/imdb-rating/[imdbId]` — OMDB proxy (server-only key). Public. — PR #14
- [x] **A.3.43a** `GET /api/v1/recommendations` — `getRecommendationsForUser` (Bearer auth required; gated on viewer's ratings). — PR #14
- Note: TMDB **search** (`searchTmdbMulti`) and **details** (`fetchTmdbDetailsWithCache`) intentionally stay client-side via `src/lib/tmdb-client.ts` / `tmdb-details-cache.ts` — the TMDB read token is `NEXT_PUBLIC_*` and safe to use from the browser. Adding server proxies for those would add a latency hop with no security benefit.

**Bookmarks + safety + friends-watching + reports — PR #15**
- [x] **A.3.46** `POST /api/v1/bookmarks` — `saveItem` (body `{ itemType, itemId }`; deterministic doc id, idempotent). — PR #15
- [x] **A.3.46a** `GET /api/v1/bookmarks` — `getMyBookmarks` (cache hydrator; up to 1000 keys). — PR #15
- [x] **A.3.46b** `DELETE /api/v1/bookmarks/[itemType]/[itemId]` — `unsaveItem` (idempotent). — PR #15
- [x] **A.3.46c** `GET /api/v1/saved-feed?cursor=&limit=` — `getSavedFeed` (cursor-paginated, hydrated; dangling-bookmark-safe). — PR #15
- [x] **A.3.47** `POST /api/v1/users/[uid]/mute` — `muteUser` (rejects self-mute). — PR #15
- [x] **A.3.47a** `DELETE /api/v1/users/[uid]/mute` — `unmuteUser`. — PR #15
- [x] **A.3.47b** `GET /api/v1/me/mutes` — `getMyMutes` (cache hydrator). — PR #15
- [x] **A.3.48** `POST /api/v1/users/[uid]/block` — `blockUser` (severs follows BOTH ways with count decrements; revokes pending invites both ways; rejects self-block). — PR #15
- [x] **A.3.48a** `DELETE /api/v1/users/[uid]/block` — `unblockUser` (does NOT restore the severed follow). — PR #15
- [x] **A.3.48b** `GET /api/v1/me/block-context` — `getMyBlockContext` (returns `{ blockedIds, iBlocked }`). — PR #15
- [x] **A.3.48c** `GET /api/v1/me/blocked-users` — `getBlockedUsers` (full UserProfile[] for the settings unblock list; email never returned per AUDIT 1.9). — PR #15
- [x] **A.3.49** `GET /api/v1/friends-watching` — `getFriendsWatching` (aggregated; ≥2 followed-user activities on the same film collapse into one card; Bearer auth). — PR #15
- [x] **A.3.50** `POST /api/v1/reports` — `reportContent` (rate-limited via `report` bucket; accepts ALL five content types — fixes legacy validator bug). — PR #15

**Admin — PR #16 (closes AUDIT 1.8 end-to-end)**
- [x] **A.3.44** `POST /api/v1/admin/backfill-user-search` — `backfillUserSearchFields` (legacy doc normalization for AUDIT 2.8 search; idempotent). — PR #16
- [x] **A.3.44a** `POST /api/v1/admin/backfill-movies` — `backfillMovieUserData` (denormalize `addedByUsername`/etc. on existing movies + `noteAuthors`). — PR #16
- [x] **A.3.44b** `POST /api/v1/admin/backfill-reviews` — `backfillReviewsThreading` (adds `parentId: null` + `replyCount`). — PR #16
- [x] **A.3.44c** `POST /api/v1/admin/backfill-email-privacy` — `backfillEmailPrivacy` (moves `email` from public `/users` to owner-only `/users_private`; AUDIT 1.9 prereq). — PR #16
- [x] **A.3.45** Unified auth: `src/lib/admin-handler.ts` (`adminRoute<>` wrapper). ONE env var (`ADMIN_SECRET`), ONE check, `crypto.timingSafeEqual` constant-time compare, dev-mode bypass only when `NODE_ENV === 'development'` AND env unset, fail-closed otherwise. Legacy `ADMIN_SECRET_TOKEN` dual-env-var is retired. — PR #16

**Per-endpoint test pattern:** for each route, add `scripts/audit-tests/<route>.test.ts` covering: unauth → 401, wrong user → 403, correct user → 200, invalid input → 400. Standardize via a helper.

### A.4 — Update client call sites

- [ ] **A.4.1** Replace every `import { actionName } from '@/app/actions'` with `apiCall('endpoint', body)`. Search-and-replace pass per endpoint.
- [ ] **A.4.2** Delete `src/app/actions.ts` (or keep as a thin re-export during transition).
- [ ] **A.4.3 — Test:** all existing UI flows work in `npm run dev` against the new routes.

### A.5 — Static export (PR #17 + the leftover-actions PR #18)

**PR #17 — foundation (shipped):**
- [x] **A.5.1** Env-gated `output: 'export'` in `next.config.ts` (only when `BUILD_TARGET=static`). `images.unoptimized: true` already set. `trailingSlash: true` added for static-host compatibility. — PR #17
- [x] **A.5.2** `<Suspense>` boundaries added to each dynamic-page wrapper so `useSearchParams()` doesn't trip the prerender. — PR #17
- [x] **A.5.3** Each of the 7 dynamic page routes (`/lists/[listId]`, `/lists/[listId]/settings`, `/post/[postId]`, `/invite/[code]`, `/movie/[tmdbId]/comments`, `/profile/[username]`, `/profile/[username]/lists/[listId]`) refactored: `'use client'` body moved to `./client.tsx`; new `page.tsx` is a server component exporting `generateStaticParams` (single placeholder `'_'` so Next produces one HTML shell) + rendering the client inside `<Suspense>`. SPA router rehydrates with the real param at runtime. — PR #17
- [x] **A.5.4a** `scripts/static-build.sh` — moves `src/app/api/` aside during the static export (Next.js doesn't allow Route Handlers in `output: 'export'` mode), clears `.next/` to avoid cross-target chunk reuse, restores on EXIT trap (even on failure). — PR #17
- [x] **A.5.4b** `NEXT_PUBLIC_API_BASE_URL` honored by `src/lib/api-client.ts` — when set, absolute paths starting with `/` get prefixed so the static bundle (Capacitor / Cloudflare Pages) calls the Vercel-hosted API cross-origin. Unset = same-origin (Vercel deploy behavior is unchanged). — PR #17
- [x] **A.5.4c** `npm run build:static` script. — PR #17

**PR #18 — leftover Server Actions migrated (Phase A complete):**
- [x] **A.5.4** `npm run build:static` outputs a clean ~3.7MB `out/` directory. — PR #18
- [x] **A.5.4d** `src/app/actions.ts` deleted. Every former Server Action either ships as a `/api/v1/*` route or was dead code. 19 new routes added (lists/profiles/follow/letterboxd); 4 helper modules added (`profiles-server.ts`, `letterboxd-server.ts`, plus extensions to `lists-server.ts` / `follows-server.ts`). — PR #18
- [x] **A.5.4e** AUDIT 1.13 (private-list preview privacy) closed end-to-end via the new `GET /api/v1/lists/[ownerId]/[listId]/preview` route. — PR #18
- [x] **A.5.4f** `isFollowing` route consolidated to return both directions in one call (`{ isFollowing, isFollowedBy }`); the legacy `isFollowing(a, b)` arg surface that let any client probe any follower→following pair is gone. — PR #18
- [ ] **A.5.5 — Manual smoke (next):** serve `out/` with a static server (`npx serve out`) and verify a real flow end-to-end; deploy to Cloudflare Pages or wrap in Capacitor for Phase B.

---

## Phase A.6 — Pre-launch UX polish (post-Phase-A, pre-Capacitor)

> Small backlog of UX gaps surfaced during Phase A local verification.
> None are launch-blockers individually; each is ~½–1 day. Ship as
> small focused PRs off main once Phase A is fully merged.

- [ ] **A.6.1 — @-mention autocomplete in composers.** Typing `@` in
  the comments composer (and review composer in the movie modal) should
  open an inline user-search picker, the way Twitter / Instagram /
  Slack handle it. Today: only the post composer has a mention picker,
  and it's triggered by an explicit toolbar button — not by typing `@`.
  Comments composer has NO picker at all (you have to type the
  username yourself; mentions still resolve on the server, just no UX
  affordance to find people). **Scope**: build a shared
  `<MentionAutocomplete>` hook + sheet that lives above the on-screen
  keyboard (mirror the existing `visualViewport` handling on
  `/comments`). Reuse the existing `searchUsers` action; on select,
  replace `@partial` with `@username` and reposition the caret. Apply
  in `comments/page.tsx` first, then port the post-composer to it so
  the two stay consistent. ~1 day. Discovered during PR #8 verify.
- [ ] **A.6.2 — Cursor pagination wire-up on /comments.** Endpoint
  ships infinite-scroll-ready in PR #8 (`?cursor=`), but the
  `comments/page.tsx` client still loads only the first page. Add an
  intersection-observer-based "load more" on scroll. ~½ day.
  AUDIT 3.10 follow-up.

---

## Phase B — Capacitor wrap

> ~1 week. Mostly setup + configuration + handling WKWebView quirks.

### B.1 — Install & init

- [x] **B.1.1** Capacitor 8 (core, cli, ios, android) installed.
- [x] **B.1.2** `cap init Cinechrony com.cinechrony.app --web-dir=out` run.
- [x] **B.1.3** `capacitor.config.ts` configured: appId, appName, webDir,
  backgroundColor, server.allowNavigation allowlist (Firebase + Apple
  + Vercel API), iOS contentInset 'automatic', splash + status-bar
  plugin config.
- [x] **B.1.4** `cap add ios && cap add android` done — both Xcode and
  Android Studio projects scaffolded under `ios/` and `android/`.
- [x] **B.1.5** `npm run build:static && cap sync` works — `out/` is
  Capacitor-ready. Added `.vercelignore` so deploys don't ship native
  shells. Added npm scripts: `cap:sync`, `cap:open:ios`, `cap:open:android`,
  `cap:run:ios`, `cap:run:android`, `cap:assets`.

### B.2 — Auth in Capacitor

> Firebase Auth Web SDK has known issues in WKWebView (popup auth, OAuth redirects). Plan around it.

- [x] **B.2.1** Decision: `@capacitor-firebase/authentication` plugin
  with `skipNativeAuth: true` — plugin handles ONLY the native dialog,
  Firebase Web SDK stays the source of truth for auth state. Email/
  password unchanged on Web SDK.
- [x] **B.2.2** Sign in with Apple wired (native runtime only for v1).
  Web SDK Apple flow deferred — requires Apple Service ID config we
  don't have yet. iOS button hidden until `Capacitor.isNativePlatform()`.
- [x] **B.2.3** `auth.currentUser.getIdToken()` works identically in
  native + web — `signInWithCredential` brings the Web SDK in sync
  after native sign-in completes. `apiCall` continues to read from
  `auth.currentUser`.
- [ ] **B.2.4 — Test:** login as Google, Apple, email — all three succeed in iOS Simulator + on device. (Manual; requires GoogleService-Info.plist + Apple Developer enablement — see PHASE-B-HANDOFF.md §1–§7.)

### B.3 — Push notifications via APNs

- [x] **B.3.1** Installed `@capacitor-firebase/messaging` (FCM) instead
  of `@capacitor/push-notifications` (APNs raw). Reason: FCM is one
  API for iOS + Android server-side, we already use Firebase Admin.
- [ ] **B.3.2** Configure APNs in Apple Developer + Firebase Console (FCM as the delivery layer). (Manual; PHASE-B-HANDOFF.md §4.)
- [x] **B.3.3** `src/lib/native-push.ts` + `<NativePushRegistration />`:
  on first authenticated boot, requests permission, fetches FCM token,
  POSTs `{kind:'fcm', token, platform}` to `/api/v1/me/push-subscription`.
  Listens for `tokenReceived` to re-save on rotation.
- [x] **B.3.4** Server-side: `src/lib/push-server.ts` unified entry —
  web subs via web-push (unchanged), FCM subs via firebase-admin
  `getMessaging().send()`. Auto-prunes dead tokens (410/404 on web,
  registration-not-registered on FCM).
- [x] **B.3.5** Per-event push wired into every creator: mention,
  reply, review like, post tag, post like, post comment, list_invite,
  follow. **Closes AUDIT.md 4.2.**
- [ ] **B.3.6 — Test:** trigger each event type from a second account → push arrives on physical iOS device within seconds. (Manual; requires §2 + §4 from handoff.)

### B.4 — Deep linking (invites + share extension callbacks)

- [x] **B.4.1** Universal Links + App Links scaffolded. Owner replaces
  `TEAMID_PLACEHOLDER` (AASA) and `SHA256_PLACEHOLDER` (assetlinks.json)
  once Apple Developer + release keystore exist — PHASE-B-HANDOFF.md §3, §5.
- [x] **B.4.2** Files at `public/.well-known/apple-app-site-association`
  + `public/.well-known/assetlinks.json`. `next.config.ts` headers()
  pins `Content-Type: application/json` on both (Apple silently
  rejects AASA served as text/plain).
- [x] **B.4.3** `<DeepLinkHandler />` listens for `App.appUrlOpen` and
  `App.getLaunchUrl()` (covers cold-start + warm taps). Whitelist of
  `/invite/`, `/post/`, `/movie/`, `/profile/`, `/lists/` paths.
- [ ] **B.4.4 — Test:** tap an invite link in Messages → opens directly in the app, not Safari. (Manual; needs §3 from handoff.)

### B.5 — Native polish

- [x] **B.5.1** `<NativeShellInit />` configures StatusBar (Style.Dark
  → dark icons on cream), hides splash on React mount, hides keyboard
  accessory bar. `@capacitor/assets` wired via `npm run cap:assets`
  with cream/ink color tokens — owner drops a 1024×1024 `icon.png` +
  2732×2732 `splash.png` into `assets/` and regenerates.
- [x] **B.5.2** Safe-area utility classes (`pt-safe`, `pb-safe`,
  `pl-safe`, `pr-safe`) added to globals.css. Viewport meta now
  declares `viewport-fit: cover` so `env(safe-area-inset-*)` returns
  non-zero on notched devices.
- [ ] **B.5.3** Verify pull-to-refresh feels native (AUDIT.md 3.4 fix should land first).
- [x] **B.5.4** `overscroll-behavior-y: none` on the body — kills the
  WKWebView page-level rubber band. Scroll containers (lists, feeds)
  still bounce internally. `@capacitor/keyboard` installed for future
  scroll-into-view + dismiss behaviours.
- [ ] **B.5.5 — Test:** run on a real iPhone 12+ and a real Android device. Feel-check the basics.

---

## Phase C — Share Extension (iOS) + Share Intent (Android)

> **The hero feature.** ~2 weeks. iOS Share Extension is a separate Swift target inside the Capacitor-generated Xcode project — Claude Code can write the Swift, but you should at least skim what it produces.
>
> **Direction (2026-05-25):** share-URL → AI extract is the primary flow.
> Screenshot OCR is the fallback when URL extraction fails. Reasoning:
> a TikTok URL gives the backend access to caption + transcript + frames
> — orders of magnitude more signal than a single screenshot, which is
> how "top 5 nolan films" reliably yields 5 films instead of just whatever
> happens to be on screen when the user hits screenshot.

### C.1 — AI extraction backend (URL-first)

- [ ] **C.1.1** `POST /api/v1/extract-films-from-url` — accepts
  `{ url: string }`, returns `{ films: [{ tmdbId, title, year, mediaType,
  posterUrl, confidence }], suggestedListName?: string }`. Auth required.
- [ ] **C.1.2** Pipeline:
  1. Identify provider (TikTok / Instagram / YouTube) from URL.
  2. Fetch metadata via the platform's official API where available:
     - TikTok oEmbed (title, author) + Display API for caption if a creator
       token is in play.
     - Instagram oEmbed (deprecated for public posts — fallback only).
     - YouTube Data API for title, description, captions.
  3. For richer signal, fall back to `yt-dlp` server-side to grab
     transcript / audio. yt-dlp is fragile against TikTok specifically —
     plan for failure and degrade gracefully.
  4. If no transcript: download audio (yt-dlp `-x`), transcribe via
     Whisper API (~$0.006/min — a 60s TikTok is ~$0.006).
  5. Claude (with structured output) on `{ title, caption, transcript }`:
     "Extract movies/TV shows mentioned. Return JSON array of
     `{title, year, mediaType, confidence}`. Also suggest a list name if
     the content reads like a curated list (e.g. 'top 5 nolan films')."
  6. For each extracted film: TMDB search by title+year → top match +
     poster. Drop unmatched.
- [ ] **C.1.3** Fallback path — `POST /api/v1/identify-films-from-image`
  accepts a multipart image. Same Claude vision pipeline as the original
  spec. Triggered when URL extraction fails or returns 0 matches.
- [ ] **C.1.4** Rate limit per user (use the same limiter from AUDIT.md 3.8).
  Whisper costs add up — cap at ~50 extractions/day per user free tier.
- [ ] **C.1.5** Auth: require valid ID token. The Share Extension sends its
  own (App Group shared token — see C.2).
- [ ] **C.1.6 — Test:** curl with 15 sample URLs covering: a TikTok
  "top 5 nolan films" countdown, a YouTube essay on Tarantino, an
  Instagram Reel review of a single film, a TikTok with no film
  mentioned (should return empty), a private TikTok (should error
  gracefully), a deleted URL (gracefully). Tune until ≥80% extraction
  accuracy on the curated-list cases.

### C.2 — Shared auth token (App Group)

- [ ] **C.2.1** Set up an App Group in Apple Developer (`group.com.cinechrony.shared`). Enable on both main app and Share Extension targets.
- [ ] **C.2.2** Main app: after Firebase Auth login, write the current ID token to App Group shared `UserDefaults` (or shared Keychain — more secure). Refresh on token rotation.
- [ ] **C.2.3** Share Extension reads token from shared storage.
- [ ] **C.2.4 — Test:** login in main app, verify token visible to extension via debugger.

### C.3 — iOS Share Extension target

- [ ] **C.3.1** Add Share Extension target in Xcode. Configure `Info.plist`
  `NSExtensionActivationRule` to accept BOTH:
  - URLs (`NSExtensionActivationSupportsWebURLWithMaxCount = 1`) — primary
  - Images (`NSExtensionActivationSupportsImageWithMaxCount = 1`) — fallback
  
  The TikTok / Instagram / YouTube share sheets all hand off URLs natively;
  images are the screenshot path if the user shares a screenshot instead.
- [ ] **C.3.2** Custom view controller (SwiftUI is fine for iOS 14+ extension UI). Two-phase UX:
  1. **Extraction phase**: progress strip — "fetching transcript → extracting
     films → matching on TMDB". Show 2-3 second checkpoints so the user
     sees real progress; 10–30s end-to-end is fine if it's narrated.
  2. **Confirmation phase**: the list of extracted films as cards (poster +
     title + year + confidence). User can edit (remove a film, search to
     add a missed one). Then choose target:
     - Add to existing list (defaults to user's default list, dropdown to switch).
     - **Or** create a new list with the AI-suggested name (e.g. "top 5
       nolan films") pre-filled.
  3. **Save** → call `POST /api/v1/lists/[listId]/movies` (batch) →
     success animation → dismiss.
- [ ] **C.3.3** Handle the no-extraction case gracefully — show "Couldn't
  find any films in this video. Try a screenshot?" with a deep-link into
  the main app's add flow, or the screenshot-fallback inline.
- [ ] **C.3.4** Handle the logged-out case — prompt to open the app first
  (App Group can detect missing token).
- [ ] **C.3.5 — Test:**
  - Real iPhone, share a "top 5 nolan films" TikTok → extension extracts
    5 films → user confirms → all 5 added to a new "top 5 nolan films"
    list.
  - Same flow with a TikTok with no film mentions → graceful empty state.
  - Same flow with an Instagram Reel review of a single film → 1 film
    extracted.
  - Same flow with a private/deleted URL → error state, offer screenshot
    fallback.
  - Same flow with a screenshot → image fallback pipeline → still works.

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
- [x] **Sign in with Apple** — Phase B.2 added Google + Apple sign-in.
  Native Apple sign-in is wired via `@capacitor-firebase/authentication`
  (button hidden on web for v1; iOS-only). App Store §4.8 requirement
  satisfied — code-side. Owner must enable "Sign in with Apple" in the
  Apple Developer portal + Firebase Console (handoff §6).
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
| — | Phase 0.5 — Discover (liked lists + showcase + user posts + home/search merge) · **done, merged to main 2026-05-22** | — |
| — | Composer + nav-feel hardening (body-style watchdog, swipe-back, tap-target sweep) · **on `fix/video-thumbnails-composer-reach`, pending merge** | — |
| 1 | Phase 0.6 — Speed & Native Feel (SWR caches + prefetch) | E.1-E.2 (account setup) |
| 2-4 | Phase A.1-A.3 (server actions refactor + auth) | E.1-E.2 (account setup) |
| 5 | Phase A.4-A.5 (client migration + static export) | E.3 (n8n) |
| 6 | Phase B (Capacitor wrap) | E.3 (n8n) |
| 7-8 | Phase C.1-C.3 (Share Extension + AI — TikTok/Reel URL → AI extraction pipeline) | E.4-E.5 (Remotion + pipeline) |
| 9 | Phase C.4-C.7 (Android share + onboarding + polish) | E.6 (posting workflow) |
| 10 | Phase D.1-D.3 (TestFlight + iterate) | Audit Phase 2-3 in TestFlight |
| 11 | Phase D.5-D.6 (App Store submission) | E.7 (back-catalog content) |
| 12 | Apple review iterations | — |
| 13 | **Launch** | — |

~**13 weeks** of remaining work. Phase 0 + 0.5 are done and merged. The
composer + nav-feel branch is pending merge. Phase 0.6 (Speed) is a small
3–5 day pass; Phase A (the API-routes refactor) is the long pole at
~3 weeks. Add 2–4 weeks of buffer for Apple review cycles + Swift learning
curve + the unexpected.

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
| 2026-05-24 | — | Polish | Composer hardening on `fix/video-thumbnails-composer-reach`: video poster capture for iOS Safari (R2 sibling `_poster.jpg`), reachable composer toolbar (visualViewport-pinned), full-screen scrim + backdrop to mask the iOS file-picker keyboard-dismiss race. |
| 2026-05-25 | — | Polish | Same branch — kill the "empty home + empty modal" round-trip bugs (PullToRefresh transform context + Vaul body-style leak + a silent-null overview branch). New `BodyStyleWatchdog` in the root layout scrubs stuck body styles on every pathname change. Defer `router.push` to `/comments` by 220ms so Vaul cleanup commits before route change. Persist "more like this" override movies so the round-trip rehydrates the swapped film. Paranoia refetch when a cached TMDB payload is structurally incomplete. |
| 2026-05-25 | — | Polish | Same branch — first wave of native-feel: `SwipeBackContainer` component drives iOS-style edge-swipe-back on `/comments` (commit at >35% viewport OR fast flick, soft drop-shadow on the trailing edge, light haptic on commit). Tap-target sweep — every interactive icon I could find ≥40px (PostCard / ActivityCard / BookmarkButton like-row, comments header/send/spoiler/sort, modal glass back/more, MovieList view-mode switcher, ProfileOverflowMenu). PullToRefresh refactored to bind listeners ONCE via stable refs (the prior code re-bound on every touchmove frame). |
| 2026-05-25 | 0.6 | Plan | Added Phase 0.6 — Speed & Native Feel. SWR caches for `getCollaborativeLists` / `getHomeFeed` / profile + a `useStableCollection` wrapper around `useCollection`. Prefetch on touch-start for nav links + movie tiles. Skeleton consistency. Optional parallel-route tab shell deferred to post-launch unless 0.6.1–0.6.3 don't get us there. |
| 2026-05-25 | — | Decision | Hero feature direction confirmed: **share-URL → AI extract** (not screenshot OCR). User shares a TikTok/IG/YT URL via the iOS Share Extension; backend pulls transcript + caption + thumbnails, Claude extracts mentioned films, user picks the target list(s) or accepts a suggested new-list name (e.g. "top 5 nolan films"). Screenshot path becomes a fallback for URL-extraction failures. Updated C.1 pipeline in this plan to reflect the URL-first approach. |
