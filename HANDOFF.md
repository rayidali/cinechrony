# Cinechrony — Session Handoff

> Last updated 2026-06-01. Project: a social movie-watchlist app
> (Next.js 15 + React 19 + Firebase + Tailwind), repo at
> `/Users/rayidali/Desktop/Cinechrony/cinechrony2`.

---

## TL;DR — where things stand

**Phase A: PRs #1–#11 merged to main. PRs #12 + #13 + #14 + #15 stacked
on `feat/phase-a-safety-bookmarks-endpoints`, awaiting owner merge of
the tip branch.**

| PR | Status | Tests |
|----|--------|-------|
| #1–#11 | ✅ merged to main | 339/339 |
| #12 — Post comments (5 endpoints) | `feat/phase-a-post-comments-endpoints` | 354/354 |
| #13 — Notifications + push + prefs (8 endpoints) | `feat/phase-a-notifications-endpoints` (stacked #12) | 376/376 |
| #14 — Search + TMDB/OMDB (5 endpoints, closes AUDIT 2.8) | `feat/phase-a-search-tmdb-endpoints` (stacked #13) | 380/380 |
| #15 — Bookmarks + safety + friends-watching (13 endpoints) | `feat/phase-a-safety-bookmarks-endpoints` (stacked #14) | **389/389** |

**Phase A scoreboard: 15/17 PRs done.** AUDIT items closed: 1.2, 1.3, 1.4,
1.5, 1.6, 1.11, 1.12, 1.14, 2.1, 2.2, 2.5, 2.6, **2.8 (end-to-end via the
route layer — PR #14)**, 2.9, 3.5 (across **all five** like surfaces —
reviews, lists, activities, posts, post-comments), 3.8, 3.10, **4.2a
(userId-as-arg auth gap on the notification reads — PR #13)** + the
2.2-bypass + 3.8a findings.

> **PR #15 bonus fix** — the legacy `reportContent` Server Action
> declared `contentType: 'review' | 'user' | 'list' | 'post' | 'post_comment'`
> in its TypeScript signature, but its runtime validator only accepted
> the first three. Post + post-comment reports were silently 400-ing.
> The new route accepts all five.

> **AUDIT 4.2 main fix still TODO** — web-push fan-out from
> `createMentionNotifications` / `createReplyNotification` / `inviteToList`.
> Sized at ~1 PR; do it after Phase A or as a small interleaved task.

> **PR #14 scope note** — original plan listed 7 endpoints; came out as 5.
> TMDB search + details intentionally stay client-side via
> `src/lib/tmdb-client.ts` (the TMDB read token is `NEXT_PUBLIC_*`, so a
> server proxy would add latency without security benefit). Only the
> OMDB-keyed paths and the auth-gated recommendations endpoint became
> routes.

**A.6 UX polish backlog** (post-Phase-A): @-mention autocomplete in
composers, /comments client cursor wire-up.

**Next:** owner merges PRs #12 + #13 + #14 + #15 (single-PR-on-tip merge
of `feat/phase-a-safety-bookmarks-endpoints`). Then Claude starts PR #16
(Admin backfills, closes AUDIT 1.8) and finally PR #17 (static export).

### Local dev setup (do once)

`vercel link` + `vercel env pull .env.local` were done in this repo;
`.env.local` is gitignored. Dev server: `npm run dev` → `localhost:9002`.
For phone testing on same WiFi: bind with `-H 0.0.0.0` and visit
`http://<mac-lan-ip>:9002`.

### Vercel preview gotcha (resolved by design, not by config)

Previews on Hobby plan force "Vercel Authentication" cookie protection.
Our api-client uses `credentials: 'omit'` for Capacitor compat → cookie
can't be sent → preview returns HTML 401 → api-client throws "Invalid
JSON response (HTTP 401)". **Hobby plan can't disable this.** Going
forward: **verify Phase A PRs locally**, not on preview. Production
deployment isn't affected.

**Operational rule:** Claude pushes only to feature branches; owner
controls all `main` pushes.

---

## PR #3 — Preview 401 debug (do this first when you return)

The owner reported "invalid json response http 401 for all of them" on
the `feat/phase-a-lists-endpoints` preview. That error string comes from
`src/lib/api-client.ts` — meaning the routes returned **401 with a
non-JSON body**. My routes always return `{ ok: false, error: {...} }`
JSON, so something upstream is intercepting.

**Prime suspect:** Vercel Deployment Protection. The api-client sets
`credentials: 'omit'` (Bearer auth needs no cookies), which strips
Vercel's auth cookie. Pages load fine (the browser sends cookies on
navigation), but `fetch` calls don't — so requests get the Vercel HTML
401 page instead of reaching my route. PR #2 worked, so this may have
been toggled on between deploys.

**Verification snippet** — paste into DevTools console on the preview:

```js
const t = await firebase.auth().currentUser.getIdToken();
const r = await fetch('/api/v1/_whoami', {
  headers: { Authorization: `Bearer ${t}` },
});
console.log('status:', r.status);
console.log('body:', await r.text());
```

**Possible results:**
- `{"ok":true,"data":{"uid":"..."}}` → routes work, problem is elsewhere
  (token attach, page-level redirect, etc.) → tell Claude
- HTML with "Authentication Required" → **Vercel Deployment Protection.**
  Fix: Vercel dashboard → Project Settings → Deployment Protection →
  set Vercel Authentication / Password Protection to "Disabled" or
  "Production only"
- Empty body / something else → paste it to Claude

---

## What's in each PR

### PR #1 — `feat/phase-a-foundation` (commit `7a9cbbd`)

Foundation only — no behavior change, no existing call site touched.
- `scripts/api-refactor-inventory.md` — 103 actions classified, mapped
  to 14 migration PRs.
- `src/lib/api-handler.ts` — `apiRoute` wrapper, typed `ApiError`
  hierarchy, envelope contract (`{ ok, data | error }`), CORS allowlist
  (production + vercel previews + `localhost:9002` + `capacitor://localhost`).
- `src/lib/api-client.ts` — `apiCall<T>(method, path, body?)`. Auto-
  attaches Bearer ID token from `auth.currentUser`, parses envelope,
  throws `ApiClientError` with stable `code`.
- `src/app/api/v1/_whoami/route.ts` — foundation smoke route.
- `scripts/audit-tests/lib/route-call.ts` — reusable test helper.
- `scripts/audit-tests/26-api-foundation.test.ts` — 10 tests.
- Build-fix commit on top: `RouteContext<P> = { params: Promise<P> }`
  (Next 15's route validator rejects union types).

### PR #2 — `feat/phase-a-user-endpoints` (commit `70691df`)

Migrates 5 `me` actions + closes AUDIT 1.2.
- `PATCH  /api/v1/me`         — collapses updateBio + updateProfilePhoto + updateFavoriteMovies
- `DELETE /api/v1/me`         — wraps deleteUserAccount; AUDIT 1.2
- `POST   /api/v1/me/avatar`  — replaces uploadAvatar (JSON body, not FormData)
- `src/lib/account-server.ts` — 200-line cascade helper extracted
- 5 client call sites migrated (profile/page, favorite-movies-picker,
  avatar-picker, settings/page)
- 3 audit tests migrated (01-idor, 07-special-cases, 10-delete-collab)
- New: `27-me-endpoints.test.ts` (18 tests including AUDIT 1.2 cross-user
  delete impossibility)
- `updateUsername` SKIPPED — discovered to be admin-only with zero client
  callers; stays in actions.ts until PR #13 or gets deleted.

### PR #3 — `feat/phase-a-lists-endpoints` (commit `c7da700`)

Migrates 9 list actions + closes AUDIT 1.3, 1.5, 2.1.
- `POST   /api/v1/lists`                                    — create
- `PATCH  /api/v1/lists/[ownerId]/[listId]`                 — collapsed rename/desc/visibility
- `DELETE /api/v1/lists/[ownerId]/[listId]`                 — owner-only cascade
- `POST   /api/v1/lists/[ownerId]/[listId]/transfer`        — AUDIT 1.3+2.1
- `POST   /api/v1/lists/[ownerId]/[listId]/cover`           — R2 upload+set (AUDIT 1.5)
- `DELETE /api/v1/lists/[ownerId]/[listId]/cover`           — clear
- `src/lib/lists-server.ts` — list-domain helpers (canEditList,
  createList, updateListFields, deleteList, transferOwnership,
  setListCover). Typed errors → route maps to HTTP status.
- 11 client call sites migrated across 4 files. `toggleListVisibility`
  becomes a client-computed flip + PATCH with explicit boolean.
- 9 actions deleted from actions.ts (−637 lines)
- 4 audit tests touched: 3 migrated (03, 07, 12), 1 new (28-lists-endpoints, 24 tests)

URL shape `/[ownerId]/[listId]` mirrors Firestore data model — every
lookup stays O(1) without collectionGroup. Client always has both keys.

**`canEditList` deliberately kept in actions.ts** because still-Server-
Action movie helpers (PR #4) call it. PR #4 deletes it from there once
movies migrate.

---

## actions.ts size history

| State | Lines |
|-------|-------|
| Before Phase A | 7,791 |
| After PR #2 | 7,393 (−398) |
| After PR #3 | 6,756 (−637 more, −13.3% total) |

---

## The 14-PR migration plan

| PR | Domain | AUDIT items closed | Status |
|----|--------|--------------------|--------|
| #1 | Foundation | — | ✅ pushed |
| #2 | User profile (`me`) | 1.2 | ✅ pushed |
| #3 | Lists CRUD + transfer + cover | 1.3, 1.5, 2.1 | ⚠️ 401 debug pending |
| #4 | Movies in lists (CRUD, status, note, social-link) | 1.6, 2.2 | next |
| #5 | Invites (link, accept, decline, revoke) | 1.11, 1.12, 1.14, 2.1, 2.9 | |
| #6 | Collaborators (remove, leave) | 1.4 | |
| #7 | Follows | 3.8 | |
| #8 | Reviews + ratings (CRUD, like, pagination) | 2.5, 2.6, 3.5, 3.10 | |
| #9 | Activities + posts + post-comments | — | extract R2 helper here |
| #10 | Notifications + push + preferences | 4.2 | |
| #11 | Search + TMDB + OMDB proxies | 2.8 | |
| #12 | Bookmarks / mutes / blocks / reports / feeds | — | |
| #13 | Admin backfills + `updateUsername` if still wanted | 1.8 | |
| #14 | `output: 'export'` + SPA fallback | — | |

Full inventory: `scripts/api-refactor-inventory.md`.

---

## How to resume after compaction

1. **First**: run the DevTools snippet in the section above. Tell Claude
   what you see.
2. **If Vercel Deployment Protection**: toggle it off in the dashboard.
   No code change needed. Re-verify the lists endpoints on preview.
3. **If something else**: paste the response to Claude.
4. **After PR #3 verified**: merge PRs in order (foundation → user →
   lists), or merge them as one squash if that's preferred.
5. **Continue Phase A**: PR #4 is movies-in-lists (5 actions, closes
   AUDIT 1.6 + 2.2). Same pattern: branch off the latest, extract
   helper if needed, migrate call sites, delete from actions.ts, write
   audit test, run `npm run build` + `npm run audit:test`.

---

## Architectural decisions (encoded in the foundation)

1. **Per-endpoint PRs**, not big-bang.
2. **Bearer ID tokens** in `Authorization: Bearer ...`. Required for iOS
   Share Extension (separate Swift process, can't share cookies).
3. **HTTP status + envelope**. `2xx { ok: true, data }`, `4xx/5xx { ok:
   false, error: { code, message } }`. `error.code` is the stable
   client-facing identifier.
4. **CORS allowlist** — production, vercel previews, localhost:9002,
   `capacitor://localhost`. Share Extension is Swift URLSession (no
   Origin) — CORS doesn't gate it.
5. **Existing infra reused** — `verifyCaller` (auth-server.ts) and
   `checkRateLimit` (rate-limit.ts) intact since the audit. Route
   wrapper adds `verifyHttpCaller(req)` adapter on top.

---

## Next 15 build-validator gotcha

`tsc --noEmit` accepts `params: P | Promise<P>`. Next 15.3's build
validator does NOT — it requires `params: Promise<P>` specifically.
Fix landed in PR #1 + cherry-picked to PR #2. Any future route file
that defines its own param type should use `Promise<...>`. The
`apiRoute` / `publicApiRoute` wrappers already enforce this.

---

## Modal back-navigation — the contract (still on main, unchanged)

The `/movie/[tmdbId]/comments` page navigates back via two URL params
(`returnPath` + `returnMovieId`) to `<returnPath>?openMovie=<id>`.
Three pieces make this work on every route:

1. **Fresh-mount on every open** — every modal call site uses
   `key={selectedMovie?.id ?? 'no-movie-open'}` so reopening yields a
   clean useState rather than reviving a stale React tree.

2. **Module-level TMDB cache** (`src/lib/tmdb-details-cache.ts`). iOS PWA
   silently aborts inflight `fetch()` during the back-nav transition
   window. The cache parks the full payload + the `getSimilarMovies`
   "more like this" payload at the JS module level — survives component
   remounts and SPA navigations.

3. **`MovieModalProvider`** (`src/contexts/movie-modal-context.tsx`).
   Pages with multiple-tile modal opens (`/home`, `/post/[postId]`)
   hoist a single `<PublicMovieDetailsModal>` and rehydrate it from
   `sessionStorage` on `?openMovie=`.

---

## Speed sweep — the contract (on main, see PR #83)

Phase 0.6 brought three waves of speedups. Quick reference:

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

## How to work

| Command | Notes |
|---|---|
| `npm run dev` | dev server, port 9002 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | **the reliable gate** — Next 15 route validator + types + prerender. Prerender step needs `.env` locally; Vercel has env vars. |
| `npm run audit:test` | 187 tests — needs Java 21 + Firebase emulator. |

- Feature work: branch off the LATEST Phase A branch (currently
  `feat/phase-a-lists-endpoints`).
- Claude pushes only to feature branches. Owner pushes to `main`.

---

## Memory

Persistent memory at
`/Users/rayidali/.claude/projects/-Users-rayidali-Desktop-Cinechrony-cinechrony2/memory/`.
This HANDOFF.md is the session snapshot; untracked on purpose. Phase A
strategy is saved as `project_phase_a_migration.md` so future sessions
can resume cold.
