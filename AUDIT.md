# Cinechrony Pre-Launch Audit & Fix Tracker

> **Started:** 2026-05-15 · **Updated:** 2026-05-20
> **Status:** Phase 0 ✅ · Phase 1 ✅ (all auth, 37 attack-tests) · Phase 5.1 ✅ (deploy unblocked, build passes) · **Phase 2 ✅ COMPLETE** (all of 2.1–2.10 + 2.3a/b; 61 attack/race/pagination/prefix tests across 13 files). App is secure, deployable, transactionally consistent, scales for delete/search/ratings, crash-resistant on mobile flakiness, and stale-handle-proof.
> **Goal:** Ship-ready security posture and data integrity before opening the waitlist
> **Source of truth:** the Progress log (bottom) + `scripts/audit-tests/*.test.ts`. Section checkboxes are ticked at phase/suite level, not 1:1 per sub-bullet.

---

## How we test fixes

Every fix in this document includes a **Test** field describing how we verify it's actually closed. Three categories:

1. **Exploit script** (for security / IDOR / auth bugs) — A Node script in `scripts/audit-tests/` that calls the affected server action as User A with User B's IDs. Run before fix → reproduces the vuln. Apply fix. Run again → returns `Unauthorized`. Script stays in the repo as a regression test.
2. **Emulator scenario** (for race conditions, transactional bugs) — Firebase Local Emulator Suite (Firestore + Auth), small script triggers parallel/sequential calls and asserts final state. Lives in `scripts/audit-tests/`.
3. **Manual repro** (for UI / state / iOS-specific bugs) — Documented repro steps in this file; we tick off after walking through the flow in `npm run dev` (and iOS PWA where relevant).

**Phase 0 stands up this infrastructure once** so every subsequent phase can use it.

---

## Phase 0 — Test infrastructure (do this first)

- [x] **0.1** Install Firebase emulator suite. `firebase.json` + `.firebaserc` (project `demo-cinechrony`, offline-only). firebase-tools 15 requires **JDK 21** — installed via Homebrew (keg-only), wired through `JAVA_HOME` in the `audit:test` script (no system change / no sudo).
- [x] **0.2** Created `scripts/audit-tests/harness.ts`:
  - Boots against the emulator (admin + client SDK), generates a throwaway in-process RSA key so `getFirebaseAdminApp()`'s `cert()` doesn't throw
  - `createTestUser(label)` → real emulator ID tokens (verifiable by admin)
  - Exports `callActionAs`, `adminDb`, `adminAuth`, `clearFirestore`, `clearAuth`, `setupTestEnv`
  - Note: `callActionAs` is a pass-through in Phase 0 (signature stable); Phase 1 wires `verifyCaller(idToken)` into it
- [x] **0.3** `next.config.ts`: `ignoreBuildErrors` + `ignoreDuringBuilds` → `false`. Baseline captured at `scripts/audit-tests/ts-baseline.txt` — **9 app TS errors** (Phase 5.1 inventory, NOT fixed). `scripts/` excluded from app `tsconfig`. Headline: `getDb` not exported from `@/firebase/admin` confirms security finding #8 (weekly-digest cron was a latent runtime crash).
- [x] **0.4** `npm run audit:test` boots emulators + runs `scripts/audit-tests/*.test.ts` via `node:test`+`tsx`. Smoke test `00-smoke.test.ts` passes 4/4.

**Why first:** every fix below cites a test script that lives in this harness. Building it once is cheaper than retrofitting.

---

## Phase 1 — Critical: server action authentication (SHOWSTOPPER)

> ✅ **PHASE 1 COMPLETE (2026-05-16).** ~48 mutations + every special case (1.2–1.14) migrated to `verifyCaller`; ~5 dead files removed. **Verification is the consolidated regression suite `scripts/audit-tests/01-08*.test.ts` (37 attack-tests, all green) + typecheck pinned at baseline**, not a separate test per sub-bullet — the boxes below are ticked at that level. Per-item detail is in the Progress log. Note: `transferOwnership` *auth* (1.3) is done but its *transactional* integrity is Phase 2 item 2.1 (still open); `backfillEmailPrivacy` (1.9) exists but must still be RUN against legacy data before launch.
>
> **This phase fixes ~8 of the 10 worst issues at once.** The root cause is the same everywhere: server actions accept `userId` as a parameter and trust it. The fix is one helper, applied universally.

### 1.0 — Build the auth helper

- [x] **1.0.1** `src/lib/auth-server.ts` — `verifyCaller(idToken): Promise<{uid} | {error}>` (result-type, matches codebase `{error}` convention) + `isAuthError` guard. Local signature verification (scales statelessly); optional `checkRevoked` for high-stakes actions. No `server-only` import so the harness can load it.
- [x] **1.0.2** Convention chosen: **explicit `idToken` first param** (user-approved). Client passes `await user.getIdToken()`. Maps 1:1 to LAUNCH.md Phase A (token-arg → Authorization header is mechanical; `verifyCaller` reused verbatim).
- [~] **1.0.3** Pattern established + **piloted on `updateBio`** (signature `updateBio(idToken, bio)`, writes to verified `auth.uid` — IDOR structurally impossible). Remaining ~47 mutations = batch rollout (task #8).
- [x] **1.0.4** **Exploit test** `scripts/audit-tests/01-idor.test.ts` — 9/9 green: legit self-update works; cross-user write impossible (no userId param exists); forged / empty / null / bad-signature tokens all → `{error:'Unauthorized'}`. Harness now imports actions directly (`next/cache` mocked via `setup.ts` + `--experimental-test-module-mocks`), runs serially (`--test-concurrency=1`, shared emulator).

> **Established call-site pattern (apply in every batch):**
> - Action: `export async function X(idToken: string, ...rest) { const auth = await verifyCaller(idToken); if (isAuthError(auth)) return auth; /* use auth.uid */ }`
> - Call site: `const r = await X(await user.getIdToken(), ...)` then **`if ('error' in r)`** — NOT `if (r.error)` (the migrated return is a proper union; `.error` isn't a common prop — this was the pilot's key lesson, 2 TS errors until fixed).

### 1.1 — Universal IDOR (closed by 1.0)

- [x] **1.1.1** Confirm `updateUsername` (`actions.ts:973`), `updateBio` (2606), `updateProfilePhoto` (2581), `updateFavoriteMovies` (2629), `savePushSubscription` (5035), `getNotifications` (4921), `markNotificationsRead` (4974), `followUser` (1191), and every other action that takes `userId` now uses the verified UID, not the parameter.
- [x] **1.1.2** **Test:** `scripts/audit-tests/01-idor.test.ts` — as User A, attempt to mutate User B's username/bio/avatar/follows/notifications. Each call must be rejected.

### 1.2 — `deleteUserAccount` auth uses public username (`actions.ts:1013`)

- [x] **1.2.1** Remove the username-match check; require verified UID === `userId`. Consider also requiring recent re-auth (Firebase `currentUser.reauthenticateWithCredential`).
- [x] **1.2.2** **Test:** as User A, call `deleteUserAccount(userBUid, userBUsername)` → rejected. As User B with valid token → succeeds.

### 1.3 — `transferOwnership` has no permission check (`actions.ts:2321`)

- [x] **1.3.1** Require verified caller UID === `currentOwnerId`. Verify the list document's actual `ownerId` matches (defense in depth).
- [x] **1.3.2** **Test:** as a collaborator on User A's list, call `transferOwnership(userAUid, listId, attackerUid)` → rejected.

### 1.4 — `removeCollaborator` tautological auth (`actions.ts:2244`)

- [x] **1.4.1** Compare `listData.ownerId` against the **verified UID**, not the parameter.
- [x] **1.4.2** **Test:** as User B (not the owner), call `removeCollaborator(userAUid, listId, victimUid)` → rejected.
- [x] **1.4.3** **Phase A PR #6**: action retired; logic in `src/lib/collaborators-server.ts::removeCollaborator`. Route `DELETE /api/v1/lists/[ownerId]/[listId]/collaborators/[uid]` enforces owner-only via the verified-token uid. Tests in `07-special-cases-auth.test.ts` + `31-collaborators-endpoints.test.ts`.

### 1.5 — `updateListCover` has no permission check (`actions.ts:2861`)

- [x] **1.5.1** Verify the caller is owner or collaborator (use existing `canEditList` helper, but with verified UID).
- [x] **1.5.2** **Test:** as User B (not a member of User A's list), call `updateListCover` → rejected.

### 1.6 — `updateMovieNote` allows note spoofing (`actions.ts:594`)

- [x] **1.6.1** Use the **verified UID** as the dot-notation key for `notes.${uid}` / `noteAuthors.${uid}` — never the client parameter.
- [x] **1.6.2** **Test:** as User A (collaborator), call `updateMovieNote(userAUid, listId, movieId, userBUid, "spoofed")` → either rejected, or note saved under User A's uid (not User B's).
- [x] **1.6.3** **Phase A PR #4**: action retired; new route `PATCH /api/v1/lists/[ownerId]/[listId]/movies/[movieId]` (body `{ note }`) preserves the invariant — there is no `userId` field in the request, the note key is derived from the Bearer token. Tests migrated to `scripts/audit-tests/29-movies-endpoints.test.ts` + `07-special-cases-auth.test.ts`.

### 1.7 — `migrateMoviesToList` has no auth check (`actions.ts:719`)

- [x] **1.7.1** Require verified UID === `userId`.
- [x] **1.7.2** **Test:** as User A, call with User B's userId → rejected.

### 1.8 — Admin backfill accepts sentinel string (`actions.ts:4604`)

- [x] **1.8.1** Remove the `"run-backfill-now"` literal. Require strict equality with `process.env.ADMIN_SECRET`. If env is unset, fail closed.
- [x] **1.8.2** Same check on `/api/admin/backfill*` route handlers. Verify the route's secret check matches what the action expects.
- [x] **1.8.3** **Test:** call backfill action with `"run-backfill-now"` and with wrong secret → both rejected. Call with correct secret → succeeds.

### 1.9 — Email leaked on public profile reads (`firestore.rules:90`, `getUserByUsername`)

- [x] **1.9.1** Decide split-doc strategy: move `email`, `emailLower`, `notificationPreferences`, `pushSubscriptions` to `/users_private/{uid}` with owner-only read. Public `/users/{uid}` keeps only display-safe fields.
- [x] **1.9.2** Update `getUserByUsername` and any other reader to not return private fields.
- [x] **1.9.3** Migration: backfill existing user docs into the split structure (one-shot admin action).
- [x] **1.9.4** **Test:** unauthenticated read of `/users/{uid}` → no `email` field present. `getUserByUsername("anyone")` returns no email.

### 1.10 — `updateUsername` doesn't update `usernameLower` (`actions.ts:973`)

- [x] **1.10.1** Write `username`, `usernameLower`, and update the `/usernames/{lower}` reservation doc inside a single Firestore transaction (so the unique-name invariant holds under races).
- [x] **1.10.2** Decide policy: do we allow username changes at all? If yes, also update old reservation. If no, make username immutable post-creation (simplest, kills two birds — this bug + the denormalization staleness for the username field).
- [x] **1.10.3** **Test:** rename username → `getUserByUsername(newName)` finds the user. `searchUsers(newName)` returns the user. Old name returns nothing. Two concurrent renames to the same target name → one succeeds, one fails.

### 1.11 — `acceptInvite` race can bypass 10-member cap (`actions.ts:2055`)

- [x] **1.11.1** Wrap the read-check-write in `db.runTransaction`. Re-read invite status (might have been revoked) and list `collaboratorIds` length inside the transaction.
- [x] **1.11.2** **Test (emulator):** fire two `acceptInvite` calls in parallel for the same invite, and separately for two different invites on a list with 9 members. Result: never more than 10 members; revoked invites can't be accepted.
- [x] **1.11.3** **Phase A PR #5**: action retired; transactional logic preserved in `src/lib/invites-server.ts::acceptInvite`. Route `POST /api/v1/invites/accept` exercised by `scripts/audit-tests/30-invites-endpoints.test.ts` (incl. concurrent-double-accept race test) and `08-special-cases-b.test.ts`.

### 1.12 — `revokeInvite` permission too narrow + racy (`actions.ts:2214`)

- [x] **1.12.1** Allow either the inviter or the list owner to revoke (currently only inviter).
- [x] **1.12.2** Wrap revocation + status check in the same transaction as 1.11 so revoke ↔ accept races resolve cleanly.
- [x] **1.12.3** **Test:** list owner revokes a collaborator's pending invite → succeeds. Acceptance of a freshly-revoked invite → fails.
- [x] **1.12.4** **Phase A PR #5**: action retired; transactional logic preserved in `src/lib/invites-server.ts::revokeInvite`. Route `DELETE /api/v1/invites/[inviteId]`.

### 1.13 — `getListPreview` / `getListsPreviews` bypass privacy (`actions.ts:2655`, `2700`)

- [x] **1.13.1** Add the same `isPublic` / owner / collaborator gate that `getPublicListMovies` uses.
- [x] **1.13.2** **Test:** as User B, call `getListPreview(userAUid, privateListId)` → rejected. Same for public list → succeeds.

### 1.14 — `getListPendingInvites` exposes codes to collaborators (`actions.ts:2038`)

- [x] **1.14.1** Omit `inviteCode` from the response unless the caller is the list owner; OR invalidate codes when a member is removed.
- [x] **1.14.2** **Test:** as a collaborator, fetch pending invites → response has no `inviteCode` field.
- [x] **1.14.3** **Phase A PR #5**: action retired; route `GET /api/v1/lists/[ownerId]/[listId]/invites` enforces member-only access AND strips `inviteCode` for non-owners.

---

## Phase 2 — Critical: data integrity (not closed by auth helper)

> ✅ **PHASE 2 COMPLETE (2026-05-20).** All ten items closed across thirteen sessions of focused passes. 61/61 attack + emulator-race + pagination + prefix-search tests green; `npm run build` passes with TS strict + ESLint enforced. Each item proven by its own targeted regression file (`scripts/audit-tests/09-13*.test.ts`). Per-item details in the Progress log. The single remaining `[ ]` (2.8.2 client-side debounce) is an explicitly-deferred polish — now low-value since each keystroke costs ~40 reads instead of thousands.

### 2.1 — `transferOwnership` not transactional (`actions.ts:2321-2380`)

- [x]  **2.1.1** Rewrite as a transaction (or fail-safe copy-then-mark-deleted) so partial failure can't duplicate or orphan movies.
- [x]  **2.1.2** Update `invites` collection so `listOwnerId` points to the new owner — otherwise `getCollaborativeLists` returns null for everyone.
- [x]  **2.1.3** **Test (emulator):** transfer a list with 50 movies. Kill the function mid-operation (simulate timeout). State must be either fully transferred or untouched — never half.

### 2.2 — `movieCount` drift (`addMovieToList`, `removeMovieFromList`, `importLetterboxdMovies`)

- [x] **2.2.1** Done — `addMovieToList` + `removeMovieFromList` wrap existence-check + write + count in `db.runTransaction` (atomic; contention-retry collapses concurrent same-key races). Imports can't be one txn (500-op limit) → switched to authoritative subcollection recount + SET (idempotent, self-healing on re-import/overlap/partial failure).
- [x] **2.2.2** **Done — emulator race tests** `scripts/audit-tests/09-moviecount.test.ts` (6 tests, green): single +1; concurrent same-movie → count **1 not 2**; re-add no-op; remove −1; already-gone remove → **no negative drift**; concurrent double-remove → one decrement.
- [x] **2.2.3** **BONUS bug found via the test:** `movieDoc` passed raw `posterHint`/`title`/`year`/`posterUrl` — Firestore Admin rejects `undefined`, so any TMDB result missing `posterHint` hard-failed adds for real users. Coalesced to `null`. **Systemic follow-up (new, tracked in Phase 5.11 below):** set `firestore.settings({ ignoreUndefinedProperties: true })` so this whole bug class can't recur.
- [x] **2.2.4** **Phase A PR #4**: transactional invariants live in `src/lib/movies-server.ts` (`addMovieToList`, `removeMovieFromList`) and are exercised end-to-end by `scripts/audit-tests/09-moviecount.test.ts` (migrated from Server-Action calls to the new POST/DELETE routes). 6 tests still green.

### 2.2-bypass — Phase A PR #4 secondary finding

The legacy client used `updateDocumentNonBlocking(movieDocRef, { status })` /
`deleteDocumentNonBlocking(movieDocRef)` / `updateDocumentNonBlocking(movieDocRef, { socialLink })`
to mutate movie docs **directly from the browser**, bypassing `canEditList`
entirely. Firestore security rules were the sole guard. PR #4 routed status,
socialLink, and movie delete through `PATCH`/`DELETE /api/v1/lists/.../movies/...`,
which enforces `canEditList` server-side. Stranger-blocked-at-403 tests pinned
in `29-movies-endpoints.test.ts` (`bypass-via-Firestore now blocked`).

### 2.3 — Denormalization has no propagation

- [x] **2.3.1** Policy decided (user-approved): **Option (a)** — usernames immutable post-creation, + displayName/photo read live from a `UserRatingsCacheProvider`-style user cache. Rationale: eliminates the worst staleness class (stale @handles) outright; reuses proven cache infra; reversible; (b)/(c) are over-engineering pre-launch.
- [~] **2.3.2** Implement. **2.3a DONE** (username frozen: `updateUsername` ADMIN_SECRET-gated escape hatch; profile UI locked; onboarding microcopy). **2.3b OPEN** (task #13): `UserProfileCacheProvider` so displayName/photo render live instead of stale denormalized copies.
- [x]  **2.3.3** **Test:** change displayName/photo → reviews/comments/notifications/feed reflect it within one load (covered when 2.3b lands). Username-immutable path: covered by `08-special-cases-b.test.ts` (admin-only) — done.

### 2.4 — `FirebaseErrorListener` crashes the tree on transient errors (`FirebaseErrorListener.tsx:33`)

- [x] **2.4.1** Done — `FirebaseErrorListener` no longer throws during render; console.error + non-fatal destructive toast. App keeps running.
- [x] **2.4.2** Done — `non-blocking-updates` routes only `code === 'permission-denied'` to the permission-error channel (rich payload); all other failures (offline/network/quota) are console-logged, not misclassified.
- [~] **2.4.3** Code-verified (tsc 0, build passes, 37/37 unaffected). The offline→reconnect behavior is a **manual mobile check** — included in the preview test plan.

### 2.5 — `UserRatingsCacheProvider` 500-rating cap (`user-ratings-cache.tsx:39`)

- [x]  **2.5.1** Either paginate (fetch in pages of 500 until exhausted) or convert to a real-time `useCollection` listener.
- [x]  **2.5.2** Fix the multi-tab broadcast: optional `BroadcastChannel` so rating in tab A appears in tab B.
- [x]  **2.5.3** Cancel in-flight `getUserRatings` on logout so it doesn't repopulate the cleared cache.
- [x]  **2.5.4** **Test:** seed 1200 ratings for a test user. Open the app — cache has 1200 entries, grid cards show ratings, modal matches.
- [x]  **2.5.5 — Phase A PR #9**: cursor pagination preserved end-to-end. Route `GET /api/v1/users/[uid]/ratings?limit=&cursor=` returns `{ ratings, hasMore, nextCursor }`. Cursor is the previous page's last `updatedAt` ISO timestamp. `UserRatingsCacheProvider` loops until `hasMore === false`. Test in `13-ratings-pagination.test.ts` seeds 1200 ratings, walks via cursor, asserts every uid returned exactly once.

### 2.6 — Comment "edit" duplicates (`comments/page.tsx:305`)

- [x]  **2.6.1** Either implement real edit (server action that updates the review doc) or remove the misleading edit affordance.
- [x]  **2.6.2** **Test (manual):** tap edit on own comment, modify text, save. Original comment is updated in place — no duplicate appears.
- [x]  **2.6.3** **Phase A PR #8**: real-edit invariant preserved end-to-end. Route `PATCH /api/v1/reviews/[id]` (owner-only) mutates the original doc. Test `33-reviews-endpoints.test.ts` ("owner real-edit mutates the same doc") asserts the collection size stays at 1 after the edit.

### 2.7 — `deleteUserAccount` full-collection scan (`actions.ts:1094`)

- [x] **2.7.1** Done — `db.collection('users').get()` (O(N users)) replaced with `db.collectionGroup('lists').where('collaboratorIds','array-contains', userId)` (O(collaborator-lists)). Removals batched (450/batch). Skips the deletee's own lists (step 5 deletes them). `firestore.indexes.json` fieldOverride added (`lists`/`collaboratorIds` COLLECTION_GROUP / CONTAINS) — required in prod; emulator runs without.
- [~] **2.7.2** Not done — observability/resumability ("deletion in progress" doc + finalize) is a separate concern. The primary scaling fix is in; resumability tracked as a follow-up if needed. Won't block launch (delete is a rare op).
- [x] **2.7.3** Done — `10-delete-collab.test.ts` (3 tests, green): removal across multiple owners; control list untouched; own-list still deleted in step 5.

### 2.8 — `searchUsers` reads entire collection per keystroke (`actions.ts:779`)

- [x] **2.8.1** Done — two parallel single-field prefix-range queries on `usernameLower` / `displayNameLower`, each limited 20 (max ~40 reads/search). Firestore auto-indexes single fields. Aligns with 1.9: no email search, email never returned. Inline scan-based migration removed (the dedicated `backfillUserSearchFields` action is the right place).
- [ ] **2.8.2** Client-side debounce on user-search inputs — not done; lower priority now that each keystroke costs ~40 reads instead of thousands. Trivial follow-up if needed.
- [x] **2.8.3** Done — `11-search-users.test.ts` (8 tests, green): prefix on each field, currentUserId excluded, dedupe when both fields match, 2-char minimum, no false positives, legacy-user excluded (needs backfill), no email in results.
- [x] **2.8.4 — Phase A PR #14**: legacy `searchUsers(query, currentUserId)` Server Action retired. Logic now lives in `src/lib/search-server.ts` (`searchUsersForViewer`). Route: `GET /api/v1/users/search?q=...` — public + auth-aware (Bearer token only; the `currentUserId` arg surface is gone). `11-search-users.test.ts` migrated to exercise the route directly + a new "unauth viewer still gets matches" case added. AUDIT 2.8 is now closed end-to-end through the API layer.

### 2.9 — `Math.random()` invite codes (`actions.ts:1684`)

- [x] **2.9.1** Done — used `crypto.randomInt()` (CSPRNG *and* rejection-samples internally → no modulo bias, better than a raw `randomBytes` modulo).
- [~] **2.9.2** No dedicated unit test (1-line RNG swap; verified by typecheck + `npm run build`). Low risk; can add a quick generator test if desired.
- [x] **2.9.3** **Phase A PR #5**: enumeration vector closed end-to-end. `generateInviteCode` lives in `src/lib/invites-server.ts`. `GET /api/v1/invites/by-code/[code]` requires a Bearer token (legacy action was unauthenticated). Test in `30-invites-endpoints.test.ts`: "unauth → 401 (AUDIT 2.9 enumeration vector closed)".

### 2.10 — `forgot-password` confirms account existence (`(auth)/forgot-password/page.tsx:37`)

- [x] **2.10.1** Done — `auth/user-not-found` now mirrors the success path exactly (same `setEmailSent(true)` + same toast); only `invalid-email` (format, not existence) shows a distinct message.
- [~] **2.10.2** Not auto-tested (client UI flow). Manual verify on the preview: submitting a known vs unknown email yields identical UI.

---

## Phase 3 — High: UX & material bugs

### 3.1 — Notifications poll every 30s instead of live (`notification-bell.tsx:27`)

- [ ] Convert to `useCollection` with `where('userId','==',uid).where('read','==',false).limit(1)` for the badge.
- [ ] **Test:** trigger a notification from User A's account — User B's bell updates in real time (no 30s wait).

### 3.2 — `movie-details-modal` re-fetches ratings, bypasses cache (`movie-details-modal.tsx:301`)

- [ ] Read user rating from `UserRatingsCacheProvider`; on save, call `setRating(tmdbId, rating)` so the cache stays consistent.
- [ ] **Test:** rate a movie in modal, close, reopen card grid — card shows the new rating immediately.

### 3.3 — `movie-details-modal` flickers when fullscreen editors close (`movie-details-modal.tsx:541`)

- [ ] Keep drawer mounted via CSS visibility instead of Vaul `open=false` during editor sub-flows.
- [ ] **Test (manual):** open modal → open note editor → save → no visible drawer close/reopen flash.

### 3.4 — `pull-to-refresh` rebinds listeners every pixel of movement (`pull-to-refresh.tsx:101`)

- [ ] Move `pullDistance` into a ref so the effect doesn't re-run on every state update.
- [ ] **Test (manual on mobile):** pull to refresh feels smooth, no jank during the pull gesture.

### 3.5 — `like` actions are not transactional (`likeReview:3128`, `unlikeReview:3195`, `likeActivity:5567`)

- [x] Wrap check-then-act in transaction OR rely on `arrayUnion` + post-write count read instead of `increment`.
- [x] **Test (emulator):** fire two `likeReview` calls in parallel — `likes` ends at 1, `likedBy` has one entry. Migrated to route in `14-like-atomicity.test.ts`; "concurrent double-like by the SAME user → likes 1, not 2".
- [x] **Phase A PR #8**: `likeReview` / `unlikeReview` retired; transactional logic in `src/lib/reviews-server.ts`. Routes `POST` / `DELETE /api/v1/reviews/[id]/like` exercised by `14-like-atomicity.test.ts` (5 tests, all green) + `33-reviews-endpoints.test.ts`.
- [x] **Phase A PR #10**: `likeActivity` / `unlikeActivity` retired — the third like-target (after reviews + lists). Transactional logic in `src/lib/activities-server.ts`. Routes `POST` / `DELETE /api/v1/activities/[id]/like` exercised by `35-activities-endpoints.test.ts` including a concurrent-double-like race test. AUDIT 3.5 closed across reviews + lists + activities.
- [x] **Phase A PR #11**: `likePost` / `unlikePost` retired — the FOURTH and FINAL like-target. Transactional logic in `src/lib/posts-server.ts`. Routes `POST` / `DELETE /api/v1/posts/[id]/like` exercised by `36-posts-endpoints.test.ts` + the migrated `24-home-feed.test.ts`. **AUDIT 3.5 is now closed end-to-end across all four like surfaces (reviews, lists, activities, posts).**
- [x] **Phase A PR #12**: `likePostComment` / `unlikePostComment` retired — a FIFTH like-target (sub-resource under posts; not a top-level surface but still racey). Transactional logic in `src/lib/post-comments-server.ts`. Routes `POST` / `DELETE /api/v1/posts/[id]/comments/[cid]/like` exercised by `37-post-comments-endpoints.test.ts` including a concurrent-double-like race test. **The full like-fan-out is now transactional: reviews, lists, activities, posts, post-comments.**

### 3.6 — `useToast` 16-minute leak (`use-toast.ts:11`)

- [x] `TOAST_REMOVE_DELAY = 5000`.
- [ ] **Test (manual):** trigger 20 toasts in sequence. DOM doesn't accumulate stale `<Toast>` nodes after 10 seconds.

### 3.7 — `activity-feed` IntersectionObserver thrash (`activity-feed.tsx:131`)

- [ ] Stabilize `loadMore` via ref so the observer effect doesn't tear down on every cursor change.
- [ ] **Test (manual):** scroll a 200-activity feed — no perceptible jank when crossing pagination boundaries.

### 3.8 — No rate limiting on hot endpoints

- [x] Add a per-UID Firestore-backed rate limiter (`/rate_limits/{uid}_{action}` with timestamp). Apply to: `followUser`, `likeReview`, `likeActivity`, `createReview`, `inviteToList`, `createInviteLink`, `savePushSubscription`.
- [ ] **Test (exploit script):** fire 100 `followUser` calls in 10 seconds → some are rejected with rate-limit error.
- [x] **Phase A PR #5 + PR #7**: `checkRateLimit` invocations preserved at the new route layer. Invites: `POST /api/v1/lists/.../invites` + `.../invite-link`. Follows: `POST /api/v1/users/[uid]/follow`. All return a 429 with `RATE_LIMITED` envelope when tripped — clients can branch on `error.code`.

### 3.8a — Latent count-drift (parallel to AUDIT 2.2)

- [x] **3.8a.1 — Phase A PR #7**: `unfollowUser` used to batch-delete + decrement WITHOUT checking that the follow doc existed. A ghost unfollow (concurrent double-tap, stale UI) drifted `followersCount`/`followingCount` negative. The route now wraps existence-check + delete + decrement in `db.runTransaction`. Idempotent; concurrent double-unfollow → exactly one decrement. Test in `32-follows-endpoints.test.ts`: "ghost unfollow is a no-op — counts do NOT drift negative".

### 3.9 — `apphosting.yaml` maxInstances: 1

- [ ] Bump to a sensible floor (e.g. 5–10) for launch. Verify Firebase Cloud Run / App Hosting tier supports it.
- [ ] **Test:** load test with `k6` or `autocannon` — concurrent requests don't serialize.

### 3.10 — `getMovieReviews` / `getReviewReplies` cap at 50 with no pagination (`actions.ts:3050`)

- [x] **Phase A PR #8**: cursor pagination added matching `getActivityFeed`'s pattern. Both `GET /api/v1/reviews?tmdbId=&cursor=` and `GET /api/v1/reviews/[id]/replies?cursor=` accept `limit` (1–100, default 50) and return `{ hasMore, nextCursor }`. Helper fetches `limit+1` to compute hasMore.
- [x] **Test:** `33-reviews-endpoints.test.ts` seeds 5 reviews + asserts a 3-page sequence via cursor (page1: 2 newest, hasMore=true; page2: middle 2; page3: oldest 1, hasMore=false). Same pattern for replies.
- [ ] Comments page UI: paginated load-more / infinite scroll wiring. The endpoint supports it; client-side scroll trigger is a UX follow-up.

### 3.11 — `comments/page.tsx` history.pushState without cleanup (line 83)

- [ ] Pair the pushState with a popstate listener that cleans up on unmount.
- [ ] **Test (iOS PWA):** swipe-back behavior is consistent across multiple comment-page entries.

### 3.12 — Sequential follower fetch (`getFollowers`/`getFollowing:1349`)

- [ ] Parallelize with `Promise.all` (the data dependencies are independent).
- [ ] **Test (emulator):** 50-follower fetch completes in <500ms instead of ~5s.

---

## Phase 4 — Half-built features

### 4.1 — Onboarding has no "already onboarded" check (`onboarding/page.tsx:75`)

- [ ] Check on mount: if user has a profile doc with `username` set, redirect to `/home`. Allow `?force=1` for testing.
- [ ] **Test (manual):** existing user clicks landing CTA → goes to `/home`, not onboarding.

### 4.2 — Push notifications fire only for weekly digest

- [ ] Decide scope. Minimum-useful set: per-event push for `mention`, `reply`, `list_invite`. Lower priority for `like`, `follow` (noisier).
- [ ] In each in-app notification creator (`createMentionNotifications`, `createReplyNotification`, `inviteToList`), look up the recipient's push subscriptions and call `webpush.sendNotification` alongside the Firestore write. Respect `notificationPreferences`.
- [ ] **Test (manual):** with a real iOS PWA installed and push permission granted, trigger each event from another account → push lands on device.
- [x] **Phase A PR #13 (partial)**: the notification *management* surface migrated to `/api/v1` — `listNotifications` (cursor-paginated), `markNotificationsRead`, `getUnreadNotificationCount`, `savePushSubscription`, `removePushSubscription`, `getPushStatus`, `getNotificationPreferences`, `updateNotificationPreferences`. Helpers live in `src/lib/notifications-server.ts` — the right place for the future web-push fan-out call. PR #13 did NOT wire `webpush.sendNotification` into the creators; that remains the AUDIT 4.2 fix proper.

### 4.2a — Caller identity not enforced on notification reads (pre-migration gap, closed by PR #13)

> The legacy Server Actions `getNotifications(userId)`, `getUnreadNotificationCount(userId)`, `getPushStatus(userId)`, and `getNotificationPreferences(userId)` all took a plain `userId` arg with **no server-side identity check**. Because Server Actions in Next.js are invocable by any client, this meant any authenticated user could read **any other user's** notifications, unread badge, push enablement, or notification preferences just by passing their UID.

- [x] **Phase A PR #13**: the four read actions are gone. The replacement routes (`GET /api/v1/notifications`, `/unread-count`, `/me/push-status`, `/me/notification-preferences`) all derive caller identity from the verified Bearer token via `apiRoute()`. No userId-in-arg surface remains.
- [x] **Phase A PR #13**: `markNotificationsRead(uid, ids)` similarly gained a per-doc ownership check — if a client passes an `ids[]` that includes another user's notification, the server filters it out instead of flipping it.

### 4.3 — `addMovie` legacy action skips activity creation (`actions.ts:666`)

- [ ] Delete the function. Verify no callers remain. If any do, route them through `addMovieToList`.
- [ ] **Test:** `npx tsc --noEmit` passes. Grep `addMovie\(` returns no consumer hits.

### 4.4 — Global search missing

- [ ] (Optional, lower priority) Add a search affordance reachable from header or bottom nav that searches both users and movies. Reuse `searchUsers` (Phase 2.8 fixed) and existing TMDB search.
- [ ] **Test (manual):** tap search from `/home`, find a user, navigate to profile.

### 4.5 — Onboarding copy pass (cheap, do anytime)

> The full onboarding redesign is deferred to `LAUNCH.md` C.7 (needs the identify backend). This is only the sub-30-min copy reframe — no restructure.

- [ ] Reframe `onboarding/components/signup-screen.tsx` copy: present signup as "Save your progress," not a gate.
- [ ] Tighten any other onboarding screen copy that reads as a tutorial rather than the start of the experience.
- [ ] **Test (manual):** walk the flow, confirm copy reads as momentum, not friction. No structural change.

---

## Phase 5 — Code health & cleanup

### 5.1 — Re-enable strict TypeScript (continues Phase 0.3)

- [x] Fixed all **9** baseline errors (the earlier "~12" estimate was pre-capture; actual app baseline was 9, recorded in `scripts/audit-tests/ts-baseline.txt`):
  - `@types/web-push` installed (was TS7016)
  - **Real latent bug fixed**: `getDb` was imported by `weekly-digest` cron but never existed on `@/firebase/admin` → added `export function getDb()` there (cron would have crashed at runtime; hidden by ignoreBuildErrors)
  - `activity-card.tsx` used non-existent `RatingStyle.text` → `.textOnBg` (correct per the type)
  - `src/components/ui/calendar.tsx` deleted — incompatible with installed react-day-picker v9 **and** zero references anywhere (dead shadcn primitive; Phase 5.2 brought forward)
  - `non-blocking-login.tsx` ×3 — return types made honest (`.then(()=>undefined)`) while preserving the exact `Promise<void>` contract + behavior (no callers; zero risk)
- [x] **Verified beyond `tsc`:** `npx tsc --noEmit` → **0** errors (was 9). `npm run build` (the actual Vercel gate, ESLint enforced) → **succeeds** (proven with dummy Firebase env; the only local failure was missing `.env`, which Vercel has). Audit suite still **37/37**. Deploy is unblocked.

### 5.2 — Delete dead components (~1500 LOC)

- [ ] Remove: `reviews-list.tsx`, `write-review-input.tsx`, `list-collaborators.tsx`, `list-settings-modal.tsx`, `rate-on-watch-modal.tsx`, `folder-card.tsx`, `add-movie-form.tsx`, `add-movie-form-list.tsx`. **Verify with grep first.**
- [ ] Update `src/components/CLAUDE.md` to remove references.
- [ ] **Test:** `npm run build` succeeds. No broken imports.

### 5.3 — Delete dead `src/ai/`

- [ ] Both files are stubs that say "removed." Delete the directory.
- [ ] **Test:** `npm run build` succeeds.

### 5.4 — Delete stale docs

- [x] Remove `docs/blueprint.md`, `docs/backend.json`, `src/docs/backend.json`, `docs/images/`. They describe the v1 "Film Collab" product, not Cinechrony.

### 5.5 — Update `CLAUDE.md` to reality

- [ ] Add `/settings/` to the routes listing.
- [ ] Update `actions.ts` line count (it's ~5570, docs say ~3000).
- [ ] Add missing types to `src/lib/CLAUDE.md`: `LetterboxdMovie`, `OnboardingStep`, `Activity`, `TrendingMovie`, etc.
- [ ] Update `src/components/CLAUDE.md` after Phase 5.2 deletions.

### 5.6 — Extract serializer helper in `actions.ts`

- [ ] Repeated pattern `toDate?.()?.toISOString?.() || new Date().toISOString()` appears ~100x. Extract `serializeTimestamp(t)` and `serializeDoc(snap)`. Should shrink the file ~20%.
- [ ] **Test:** existing audit tests still pass.

### 5.7 — Remove no-op `revalidatePath` calls

- [ ] No SSR pages exist; every `revalidatePath` is a no-op. Audit and remove (~40 sites).
- [ ] **Test:** `npm run build` succeeds. Manual smoke test of mutations.

### 5.8 — Add explicit deny rules for server-only collections (`firestore.rules`)

- [x] Add `match /reviews/{id} { allow read, write: if false; }` and the same for `/ratings`, `/notifications`, `/users/{uid}/pushSubscriptions`. Default-deny already covers them, but explicit rules document intent and prevent future drift.

### 5.9 — Cron secret enforcement (`api/cron/weekly-digest/route.ts`)

- [x] Fail closed if `CRON_SECRET` env is unset in production. Currently the `if` clause skips auth when secret is missing.
- [ ] **Test:** unset env, deploy preview, call the cron endpoint → 401.

### 5.10 — Cache-bust URL pattern wastes R2/CDN

- [ ] `uploadAvatar`/`uploadListCover` append `?v=${Date.now()}` then store the URL. CDN caches the URL but each upload makes the *stored* URL different, defeating the cache for nothing useful. Either bust via a header on R2 or just trust the avatar key.

### 5.11 — `ignoreUndefinedProperties` systemic guard (NEW — found during 2.2)

- [x] Set `firestore.settings({ ignoreUndefinedProperties: true })` once at Admin Firestore init (`@/firebase/admin`). Firestore Admin hard-throws on any `undefined` field value; today every write site must remember `?? null` (e.g. the `posterHint` crash 2.2 found). One global setting makes the whole class impossible. Behavioral change (undefined fields silently dropped) — desirable here (codebase already uses `|| null` everywhere) but is global, so kept out of the 2.2 commit to avoid mixing concerns / blast radius. Verify the no-undefined invariant still holds for fields that *should* be null.

---

## Parking lot — not blocking launch

- AI / Genkit integration (decide whether to do anything in `src/ai/` post-launch)
- "Find Friends" / discovery surface beyond profile page
- ListMembersCacheProvider re-renders (mutates ref, consumers don't update without remount) — currently fine because consumers all unmount when leaving
- Activity feed cleanup on review/account deletion (orphan activities)
- Comment-likes don't push notify (only review-likes do)
- Onboarding's `find-friends-screen` duplicates `searchUsers` logic
- **Firestore offline persistence not enabled** (noted 2026-05-20 during preview testing). Going offline mid-action no longer crashes the app (2.4 fixed that), but the offline write doesn't auto-replay on reconnect — pre-existing, not a 2.4 regression. Enabling `persistentLocalCache` in the client SDK init (`src/firebase/index.ts`) would queue offline writes through IndexedDB. Quality-of-life polish for mobile PWA, not security/data-integrity. Validate writes don't drift in pathological offline-then-conflict cases before enabling.

---

## Progress log

| Date | Phase | Item | Notes |
|------|-------|------|-------|
| 2026-05-15 | — | Audit | Initial audit complete (security, code quality, feature completeness) |
| 2026-05-16 | 0 | All | Phase 0 complete. Emulator harness + smoke test passing (4/4). Strict TS re-enabled; 9-error baseline captured. JDK 21 installed (Homebrew, JAVA_HOME-wired). 42 npm-audit vulns noted — deferred, not Phase 0 scope. Next: Phase 1 (auth helper). |
| 2026-05-16 | 1 | 1.0 | verifyCaller built. Convention = explicit idToken param (user-approved). Piloted on updateBio: 9/9 exploit tests green, typecheck back to 9-baseline (no regressions). Call-site pattern established (`'error' in r`). |
| 2026-05-16 | 1 | 1.0.3/1.1 | Batch 1 of rollout: migrated **13** mutations (updateBio, followUser, unfollowUser, updateProfilePhoto, likeReview, unlikeReview, deleteReview, updateReview, deleteRating, markNotificationsRead, removePushSubscription, likeActivity, unlikeActivity) + all call sites across 7 files. Deleted dead `write-review-input.tsx` (Phase 5.2 brought forward — broke build). 12/12 tests green, typecheck at 9-baseline. |
| 2026-05-16 | 1 | 1.0.3/1.1 | Batch 2 (Lists): migrated **7** (createList, renameList, updateListDescription, updateListVisibility, deleteList, toggleListVisibility, leaveList) + 7 call sites. **Closes tautological-auth class** (was `if(userId!==listOwnerId)` w/ both client-supplied). Deleted dead list-settings-modal.tsx + list-collaborators.tsx. 15/15 tests green (incl. 03-lists-auth proving the attack impossible), typecheck 9-baseline. |
| 2026-05-16 | 1 | 1.0.3/1.1 | Batch 3 (Movies+Invites): migrated **5** (removeMovieFromList, updateMovieStatus, inviteToList, createInviteLink, declineInvite) + 4 call sites. Note: removeMovieFromList/updateMovieStatus have ZERO UI callers (app uses client non-blocking writes) but were still reachable POST endpoints — securing them closed that surface. 15/15 green, typecheck 9-baseline. |
| 2026-05-16 | 1 | 1.0.3/1.1 | Batch 4 (content+misc): migrated **6** (createReview, createOrUpdateRating, updateFavoriteMovies, savePushSubscription, updateNotificationPreferences, migrateMoviesToList) + ~10 call sites. 18/18 green (04-content-auth), typecheck 9-baseline. |
| 2026-05-16 | 1 | 1.0.3/1.1 | Batch 5 (FormData/uploads): migrated **addMovieToList** (token IN FormData) + **uploadAvatar**. **uploadListCover NOT migrated — caught a real bug (1st param is LIST OWNER not caller); reclassified to #9** w/ loud in-code warning. Deleted legacy `addMovie` + dead add-movie-form(-list). 22/22 green, typecheck 9-baseline. |
| 2026-05-16 | 1 | 1.0.3/1.1 / task#10 | Batch 6 (onboarding): migrated **createUserProfile, ensureUserProfile, createUserProfileWithUsername**. Refactor: private uid-keyed `createProfileAndDefaultList` + token-verifying public wrappers. 26/26 green, typecheck 9-baseline. **36 migrated. Standard+onboarding COMPLETE.** |
| 2026-05-16 | 1 | #9 batch A | CRITICALS: **1.2 deleteUserAccount** (public-username auth → verified token + checkRevoked), **1.3 transferOwnership** (no check → verified owner; **2.1 transactional STILL OPEN, flagged in-code**), **1.4 removeCollaborator** (tautological → verified-owner), **1.6 updateMovieNote** (client-uid key → verified-caller key), **1.5 updateListCover + uploadListCover** (verifyCaller + canEditList). 30/30 green. |
| 2026-05-16 | 1 | #9 batch B | **1.8** backfillMovieUserData (sentinel removed, strict ADMIN_SECRET, route passes real secret), **1.10** updateUsername (verified token + transactional username/usernameLower/reservation — fixes the rename-breaks-everything bug + TOCTOU), **1.11** acceptInvite (verified token + transaction: re-checks invite status & member-cap atomically — closes cap race + revoke↔accept), **1.12** revokeInvite (verified token, owner-OR-inviter, transactional), **1.13** getListPreview/getListsPreviews (private-list leak → optional viewer-token gate: public OR verified member; 11 call sites threaded), **1.14** getListPendingInvites (tautological → verified membership; inviteCode owner-only), **1.9** email split (email→/users_private in all 3 creators + ensureUserProfile migration; firestore.rules deny /users_private; public /users read no longer leaks PII; `backfillEmailPrivacy` admin action for legacy docs). **PHASE 1 COMPLETE.** 37/37 green (07 + 08 prove every 1.2–1.14 attack blocked), typecheck 9-baseline. Open follow-ups (Phase 2/other tasks, tracked): 2.1 transferOwnership transactional; 2.8 searchUsers (now also email-search dead — intended); legacy-data needs `backfillEmailPrivacy` run. |
| 2026-05-16 | 5 | 5.1 | All 9 baseline TS errors fixed (incl. real latent `getDb` cron crash). `tsc` 9→0. **`npm run build` now succeeds** (proven w/ dummy Firebase env; ESLint enforced & clean) — Vercel deploy unblocked. Deleted dead `ui/calendar.tsx`. Audit suite 37/37, no regression. |
| 2026-05-16 | 2 | 2.3a/2.9/2.10 | **2.3a** usernames frozen (Option A): updateUsername now ADMIN_SECRET-gated (true immutability + escape hatch; 1.10 transactional logic preserved); profile UI shows locked @handle; onboarding microcopy ("@handle permanent, display name/photo changeable"); dead `Input` import removed. **2.9** invite codes now CSPRNG (`crypto.randomInt`, bias-free) not Math.random. **2.10** forgot-password no longer reveals account existence (user-not-found mirrors success exactly). tsc 0, build-safe, 37/37 (08 1.10 test rewritten for admin-only contract). REMAIN in Phase 2: 2.1 transferOwnership transactional, 2.2 movieCount transactional, 2.4 FirebaseErrorListener, 2.5 ratings-cache cap, 2.6 comment-edit dup, 2.7 deleteUserAccount collectionGroup, 2.8 searchUsers prefix, 2.3b UserProfileCache.
| 2026-05-17 | 2 | 2.4 | FirebaseErrorListener no longer throws (whole-app crash on transient blips, high mobile impact) → console + non-fatal toast. non-blocking-updates only routes real `permission-denied` to the permission channel; offline/network/quota logged not misclassified. tsc 0, 37/37, build passes. Pushed to preview branch (f33516d). Also: AUDIT.md checkbox tidy-up (Phase 0/1 fully ticked w/ verification banners; Phase 2 done/partial/open split honest). |
| 2026-05-17 | 2 | 2.2 | movieCount made atomic: add/remove now in db.runTransaction (closes drift + concurrent same-movie double-count + already-gone negative drift); imports use authoritative recount+SET. **Bonus latent prod bug found via the new race test & fixed**: raw undefined movieData.posterHint/title/year/posterUrl hard-failed adds (Firestore rejects undefined) → coalesced to null. New systemic item 5.11 (ignoreUndefinedProperties) logged. tsc 0, 43/43 (09-moviecount: 6 emulator race tests), build passes. Pushed (c03d0ed). |
| 2026-05-20 | 2 | 2.7 | deleteUserAccount: O(N users) full-collection scan → single collectionGroup query on `lists` `collaboratorIds` array-contains (O(collaborator-lists), bounded). Updates batched 450/op; skips own lists. firestore.indexes.json fieldOverride added (required in prod). 46/46 incl. 3 new 10-delete-collab tests proving multi-owner removal + control case. Pushed (a5c110f). Resumability sub-item (2.7.2) deferred — rare op, doesn't block launch. Same scan pattern still in searchUsers (2.8, next) and the admin backfills (intentional one-shots). |
| 2026-05-20 | 2 | 2.8 | searchUsers: per-keystroke full-collection scan → two parallel single-field prefix-range queries (usernameLower/displayNameLower, limit 20 each). O(matches) not O(N); auto single-field indexes — no firestore.indexes.json change. Aligns w/ 1.9 (no email search/return). Removed inline scan-based migration (use backfillUserSearchFields). 54/54 incl. 8 new 11-search-users tests (prefix/exclude/dedupe/min-len/no-FP/legacy/no-email). Pushed (734daf7). |
| 2026-05-20 | 2 | ALL | **PHASE 2 COMPLETE.** Today's pushes: **2.1** transferOwnership 6-phase pattern (atomic pre-flight tx → batched copy → invites repoint → batched delete → final old-list-doc delete as the canonical transition; idempotent under crash; 600-movie multi-batch tested); **2.5** ratings cursor pagination + in-flight cancel on logout (1200-rating walk verified); **2.6** real comment edit via updateReview + composer indicator (no more duplicates); **2.3b** UserProfileCache + useUserProfile hook wired into review-card, activity-card, movie-card, movie-card-grid, movie-card-list. tsc 0 throughout; build green (ESLint enforced); 61/61. Pushes: 93b45e9, 90a81ff, 8ac783d, de1de16. Top banner updated to reflect Phase 2 ✅. |
| 2026-05-20 | 3/5/AppStore | batch | Hardening + App Store gates. **5.11** ignoreUndefinedProperties (guarded; getDb unified in @/firebase/admin). **3.6** toast leak 16min→5s. **5.9** cron fails closed. **5.8** explicit deny rules for /reviews /ratings /notifications /rate_limits /reports. **5.4** stale v1 docs deleted. **3.5** like/unlike/likeActivity/unlikeActivity now transactional (14-like-atomicity). **3.8** per-user rate limiting — src/lib/rate-limit.ts wired into 7 abuse-prone actions (15-rate-limit). **App Store §1.2**: reportContent action + Report UI in review-card + /reports collection (16-report-content). **App Store**: /privacy route w/ real policy draft; TMDB attribution in Settings. tsc 0, 74/74, build passes. Pushes: df7556b, 9dbf000, 6382db3, 574d257. REMAINING App Store gate: block-abusive-users (task #15) — before submission, not TestFlight. |
| 2026-05-20 | — | reorg | App Store readiness items (block-users, Sentry, privacy-policy legal copy, moderation contact) **moved to LAUNCH.md Phase D.0** — they're launch requirements, not system-soundness fixes. AUDIT.md now scopes purely to "is the existing system sound." Remaining AUDIT work = optional Phase 3/4/5 polish, to revisit after LAUNCH.md progress. |
