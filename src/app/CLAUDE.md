# App Routes - Claude Code Reference

## Route Structure

```
src/app/
├── page.tsx              # Landing page (redirects to /home or /login)
├── layout.tsx            # Root layout (providers + native-shell init)
├── globals.css           # Global styles + Tailwind
│  (actions.ts — DELETED in Phase A; see src/lib/*-server.ts)
│
├── (auth)/               # Auth route group (no layout nesting)
│   ├── login/page.tsx        # Email + social (Google/Apple) sign-in
│   ├── signup/page.tsx
│   ├── forgot-password/page.tsx
│   └── reset-password/page.tsx
│
├── home/page.tsx         # Dashboard (protected)
├── add/page.tsx          # Add movie to list (protected)
│
├── lists/
│   ├── page.tsx          # All user lists (protected)
│   └── [listId]/
│       ├── page.tsx      # Single list view (protected)
│       └── settings/page.tsx  # List settings (owner only)
│
├── movie/
│   └── [tmdbId]/
│       └── comments/page.tsx  # Full-screen comments page
│
├── profile/
│   ├── page.tsx          # Current user profile (protected)
│   └── [username]/
│       ├── page.tsx      # Public profile view
│       └── lists/[listId]/page.tsx  # Public list view
│
├── notifications/page.tsx  # Notifications inbox
│
├── onboarding/
│   ├── page.tsx          # Onboarding flow controller
│   └── components/
│       ├── signup-screen.tsx          # Includes social sign-in buttons
│       ├── import-letterboxd-*.tsx    # 5-step Letterboxd import
│       └── …
│
├── invite/[code]/page.tsx  # Invite acceptance (protected)
│
└── api/                   # Phase A: every mutation lives here
    ├── v1/                # Bearer-authed JSON envelope routes
    │   ├── _whoami/                       # Foundation smoke
    │   ├── me/                            # /me, avatar, ensure, push-subscription, ...
    │   ├── lists/[ownerId]/[listId]/…    # CRUD + movies + invites + members
    │   ├── posts/[id]/…                   # Posts + comments + likes
    │   ├── reviews/…  ratings/…           # Reviews + ratings + replies
    │   ├── activities/…                   # Feed + likes
    │   ├── notifications/…                # List, unread-count, mark-read
    │   ├── users/search                   # Search by username
    │   ├── movies/{trending,similar,…}    # TMDB/OMDB proxies
    │   ├── recommendations                # Personal recs
    │   ├── leaderboard                    # Weekly top watchers (follow graph)
    │   ├── bookmarks/…  mutes/…  blocks/… reports/…
    │   ├── friends-watching               # Friends activity hero card
    │   ├── share/story                    # next/og 1080×1920 story-card PNG (route.tsx;
    │   │                                   #   no auth/no Firestore, params-driven; 0.7.4)
    │   ├── share/og                       # next/og 1200×630 link-preview PNG for OG/Twitter
    │   │                                   #   cards (params-driven). generateMetadata on
    │   │                                   #   post/profile/list pages + layout default → it.
    │   ├── verified                       # tiny public set of verified uids (cached) →
    │   │                                   #   UserVerifiedCacheProvider → <VerifiedBadge>
    │   ├── auth/login                     # email-or-@username → custom token (Wave 7)
    │   ├── auth/forgot-password           # branded reset email via Resend (Admin SDK
    │   │                                   #   link); Firebase fallback; non-disclosure
    │   ├── imports/letterboxd/…           # ZIP parse/import + username preview/scrape-import
    │   ├── follow/{status,by-username,…}  # Follow graph
    │   └── admin/…                        # adminRoute-wrapped backfills
    └── cron/weekly-digest                 # Vercel cron (web-push)
```

---

## Page Patterns

### Protected Page Pattern
```typescript
'use client';
export default function ProtectedPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  if (isUserLoading || !user) {
    return <LoadingSpinner />;
  }

  return <PageContent />;
}
```

### Data Fetching Pattern
Pages that need Firestore data use the real-time hooks:

```typescript
const listsQuery = useMemoFirebase(
  () => user ? collection(firestore, 'users', user.uid, 'lists') : null,
  [firestore, user?.uid]
);
const { data: lists, isLoading } = useCollection<MovieList>(listsQuery);
```

---

## API surface — `/api/v1/*` (the new source of truth)

> **`src/app/actions.ts` has been DELETED (Phase A complete, 2026-06-02).**
> Every former Server Action is now either a `/api/v1/*` route handler OR
> a helper inside a `src/lib/<domain>-server.ts` module that a route
> imports. The "Server Actions tables" that used to live here are gone.
>
> To find an endpoint: walk `src/app/api/v1/**` directly. The directory
> structure mirrors the URL — `/api/v1/lists/[ownerId]/[listId]/movies/route.ts`
> handles `POST/GET /api/v1/lists/<owner>/<list>/movies`.

### How a route is built

```
┌─────────────────────────────────────────────────────────────┐
│ Client (Capacitor WebView OR browser)                       │
│   apiCall<T>('POST', '/api/v1/lists', { name })             │
│     - attaches Bearer ID token from auth.currentUser        │
│     - throws ApiClientError on non-2xx                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Route file: src/app/api/v1/lists/route.ts                   │
│   export const POST = apiRoute(async (req, { auth }) => {   │
│     const body = await req.json();                          │
│     return await createList(auth.uid, body.name);           │
│   });                                                        │
│                                                              │
│   apiRoute wrapper handles:                                 │
│     - verifyCaller (Bearer token → UID)                     │
│     - envelope serialization                                │
│     - typed-error → HTTP-status mapping                     │
│     - CORS headers                                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Helper: src/lib/lists-server.ts                             │
│   export async function createList(callerUid, name) { … }   │
│     - pure function, not 'use server'                       │
│     - throws typed errors that the route wrapper maps       │
│     - uses Firebase Admin SDK via getDb()                   │
└─────────────────────────────────────────────────────────────┘
```

### Domain map — where to find helpers

| Domain | Helper module |
|---|---|
| User profile / account | `src/lib/profiles-server.ts` + `src/lib/account-server.ts` |
| Lists | `src/lib/lists-server.ts` |
| Movies in lists | `src/lib/movies-server.ts` |
| Invites | `src/lib/invites-server.ts` |
| Follows | `src/lib/follows-server.ts` |
| Reviews + ratings | `src/lib/reviews-server.ts` + `src/lib/ratings-server.ts` |
| Activities | `src/lib/activities-server.ts` |
| Posts + post-comments | `src/lib/posts-server.ts` + `src/lib/post-comments-server.ts` |
| Notifications + push subs + prefs | `src/lib/notifications-server.ts` |
| Push delivery (FCM + web push) | `src/lib/push-server.ts` |
| Search (users) | `src/lib/search-server.ts` |
| TMDB + OMDB proxies | `src/lib/tmdb-server.ts` |
| Bookmarks / mutes / blocks / reports | `src/lib/{bookmarks,mutes,blocks,reports}-server.ts` |
| Friends-watching | `src/lib/friends-watching-server.ts` |
| Letterboxd import | `src/lib/letterboxd-server.ts` |
| Admin backfills | `src/lib/admin-backfills-server.ts` |

### Foundation

| File | Purpose |
|---|---|
| `src/lib/api-handler.ts` | `apiRoute` + `publicApiRoute` + `optionsHandler` wrappers, typed `ApiError` hierarchy, envelope contract, CORS allowlist |
| `src/lib/admin-handler.ts` | `adminRoute` wrapper — constant-time `ADMIN_SECRET` compare, used by `/api/v1/admin/*` |
| `src/lib/api-client.ts` | Client-side `apiCall<T>(method, path, body?)`. Auto-attaches Bearer token, parses envelope, throws `ApiClientError`. Resolves base URL from `NEXT_PUBLIC_API_BASE_URL` when set (Capacitor target). |
| `src/lib/auth-server.ts` | `verifyCaller(req)` — admin SDK token verification |
| `src/lib/rate-limit.ts` | `checkRateLimit(uid, bucket)` — review/like/follow/invite/post/pushSubscribe/report buckets |

### Capacitor-specific helpers

| File | Purpose |
|---|---|
| `src/lib/native-auth.ts` | Detects Capacitor; routes Google/Apple sign-in via `@capacitor-firebase/authentication` plugin or web popup |
| `src/lib/native-push.ts` | Detects Capacitor; requests permission, fetches FCM token, POSTs to `/api/v1/me/push-subscription` |
| `src/components/native-shell-init.tsx` | Status bar style, splash dismiss, keyboard accessory bar |
| `src/components/deep-link-handler.tsx` | Listens for `App.appUrlOpen` from `@capacitor/app`, routes via Next.js router |
| `src/components/native-push-registration.tsx` | Mount-once registration trigger on first authenticated boot |

All four are no-ops on web.

**Note**: `MAX_LIST_MEMBERS = 10` (owner + 9 collaborators) — defined in
`src/lib/lists-server.ts`.

---

## Route-Specific Notes

### `/add` Page
- Search TMDB for movies/TV shows
- Select destination list
- Add social link (TikTok/IG/YouTube)
- Submits via `apiCall('POST', '/api/v1/lists/.../movies', …)` (`src/lib/movies-server.ts`)

### `/lists` Page
- Shows all user's lists + collaborative lists
- Extended FAB button: `[+ New List]` (pill shape with label)
- Create list modal

### `/lists/[listId]` Page
- Uses Vaul drawer for movie details modal
- Real-time subscription to movies collection
- Filter tabs: "To Watch" / "Watched"
- View modes: Grid / List / Notes (the legacy "Cards" view was retired in 0.7)
- Extended FAB button: `[+ Add]` for adding movies (pill shape with label)
- Add movie modal uses fullscreen text input for social links (iOS fix)
- Pull-to-refresh support (disabled when add movie modal is open)
- **Security**: Permission check verifies user's UID is actually in `collaboratorIds` array, not just that the list data is readable

### `/profile/[username]/lists/[listId]` Page (public read-only list)
- v3 to parity with the editable list: cinematic `Hero` (cover/gradient + glass
  back) → owner attribution + follow → `ListHeader` (read-only: description +
  collaborator stack + like, no manage pill) → `MovieList publicReadOnly canEdit={false}`.
- Reuses the SAME `MovieList` (toolbar, shared cells, openMovie round-trip) as
  the owner page — `publicReadOnly` swaps to the standalone drawer and hides the
  notes view (collaborators are redirected to the editable page, so a public
  viewer never has notes access). No more `public-movie-*` fork.

### `/profile/[username]` Page
- Public profile view (no auth required)
- Shows bio (italic), followers/following/lists counts as styled stat boxes
- Shows Top 5 Films if user has set them
- Lists count highlighted in yellow
- Shows public lists only
- Follow/unfollow button for logged-in users

### `/profile` Page (Own Profile)
- Same stat box design as public profile
- Editable bio, avatar, username
- Top 5 Films picker with tap-to-add placeholders
- Find Friends search
- Shared With Me section for collaborative lists

### `/movie/[tmdbId]/comments` Page
- Full-screen comments/reviews page
- Instagram/TikTok style 1-level threading
- Reply to any comment (replies go under root parent)
- @mentions render as clickable profile links
- Sort by recent or top
- iOS swipe-back gesture returns to movie modal via popstate listener
- **Security**: Uses `returnPath` param to preserve original route context (e.g., `/profile/username/lists/listId`)
- URL params: `title`, `poster`, `type`, `returnPath`, `returnListId`, `returnListOwnerId`, `returnMovieId`

### `/notifications` Page
- Shows user's notifications (mentions, replies, list invites, likes, follows)
- **Accept/Decline buttons** for `list_invite` notifications with loading states
- Mark as read on view
- Pull-to-refresh support
- Notifications auto-deleted when invite is accepted/declined

### `/onboarding` Flow (v3, Wave 7 — 2026-06-20)
- **Account-LAST** state machine in `onboarding/page.tsx`: welcome → name →
  letterboxd → handle → email(create account) → importing → find-friends →
  complete → `/home`. Name / letterboxd-handle / @handle are **local state**;
  nothing hits Firestore until the email step runs
  `createUserWithEmailAndPassword` (or apple/google) then `POST /api/v1/me/profile`
  (provisions profile + reserves handle; a 409 bounces back to the handle step).
- **Letterboxd USERNAME import** (not the ZIP guide): the letterboxd step calls
  `POST /api/v1/imports/letterboxd/preview` (cheap, Apify-free, public) for the
  "found" state. The real import runs after the account exists as an **async,
  chunked pipeline** the importing screen drives (no single request can hold a
  thousands-film scrape + TMDB match):
  - `POST /imports/letterboxd/scrape/start { username }` → `{ runId, datasetId }`
    (Apify cheerio run, **reviews skipped** — the browser actor is minutes-slow).
  - `GET /imports/letterboxd/scrape/status?runId&datasetId` → `{ status, itemCount,
    library? }` (client polls ~4s; on SUCCEEDED returns the normalized+deduped
    `{ films, lists, favorites }`).
  - `POST /imports/letterboxd/scrape/import { phase }` → `films` (a ~120-film
    chunk, **concurrent** TMDB match, returns sample posters for the wall) ·
    `list` · `favorites` · `finalize` (recount + **kick the background reviews
    run**). The client loops chunks with a live progress bar.
  - **Reviews import in the BACKGROUND** (the reviews browser-actor is
    minutes-slow — never part of the wait): `finalize` starts the reviews run +
    stashes `{ runId, datasetId }` on `users_private/{uid}.pendingReviews`; the
    importing screen sets a `cc-pending-reviews` device flag; the mount-once
    `<PendingImportSync/>` (root layout) polls `POST /imports/letterboxd/reviews/sync`
    until it lands, imports the reviews (deterministic `lb_{uid}_{tmdbId}` ids →
    idempotent), clears the flag, and quietly toasts. Zero network unless the flag
    is set.
  Helpers in `src/lib/letterboxd-username-import-server.ts` (over the decoupled
  Apify run helpers + `normalizeRows` in `letterboxd-scrape-server.ts`). Graceful
  skip when `APIFY_TOKEN` is unset. (Distinct from `/imports/letterboxd/import`,
  the paste importer.)
  - **The import runs in a store, not the screen** — `src/lib/import-store.ts` is
    a module singleton that owns the whole lifecycle, so it SURVIVES navigation.
    The importing screen (`importing-step.tsx`) is a VIEW: a building poster wall
    (chunks return sample posters), `useCountUp` counters, an **accurate ETA**
    (from elapsed/done rate), then a stat reveal. After ~9s a **"continue in the
    app"** button hands off to a global progress **pill** (`import-progress-pill.tsx`,
    root layout) that finishes in the background + toasts. The store also
    **resumes** an import interrupted by an app kill (re-fetches the finished
    Apify dataset, idempotent writes — persisted run in `localStorage cc-import-run`).
  - **Smart status**: any film with a rating or review imports as **Watched**
    (never left in "to watch"); reviewed films are upserted Watched on review sync.
  The old ZIP-upload screens
  (`import-letterboxd-*`, `import-paste-*`, `signup-screen`, `username-screen`,
  `splash-screen`, `import-options-screen`) are **orphaned** (safe to delete
  later; the ZIP `/parse` + `/full` routes still back the settings importer).
- Step components live in `onboarding/components/*` (welcome · name · letterboxd ·
  handle · account · importing) over the `v3/onboarding-kit.tsx` chrome.

### `(auth)` — v3 (Wave 7 — 2026-06-20)
- `login` (006): poster-wall hero + email-OR-@username + password + apple/google.
  Email logs in via the Web SDK; **@username** routes through
  `POST /api/v1/auth/login` (returns a Firebase **custom token** the client
  exchanges — email stays private; all failures collapse to a generic 401).
- `forgot-password` (007) + its "check your email" success state (008) in one
  page; AUDIT 2.10 non-disclosure preserved. `reset-password` (010): `?oobCode`
  verify → live requirement chips → `confirmPasswordReset` + auto-login → `/home`.
- `signup` still redirects to `/onboarding?skip_splash=true` (jumps to the name step).

### `/invite/[code]` Page
- Validates invite code
- Shows list preview
- Accept/decline buttons
- Redirects to list on accept

---

## Layout Hierarchy

```
RootLayout (layout.tsx)
├── ThemeProvider (next-themes)
├── FirebaseClientProvider (auth + Firestore)
├── ListMembersCacheProvider (collaborator caching)
├── UserRatingsCacheProvider (O(1) rating lookups)
└── Toaster (notifications)
    │
    └── Page Content
        └── BottomNav (mobile, on protected pages)
```

---

## Common Gotchas

1. **Auth State**: Always check `isUserLoading` before `!user` redirect
2. **Real-time Queries**: Must use `useMemoFirebase` for stable references
3. **Mutations**: Use `apiCall<T>('POST'|'PATCH'|'DELETE', '/api/v1/…', body?)` from
   `src/lib/api-client.ts`. Bearer token is auto-attached. Throws
   `ApiClientError` with stable `error.code` on non-2xx. Never call
   Firestore writes directly from the client.
4. **Static export gotcha**: dynamic `[param]` page routes need
   `generateStaticParams` + a `<Suspense>` wrapper. See `src/app/lists/[listId]/page.tsx`
   for the SPA-shell pattern.

---

## Home / Discover Rebuild (Phase 0.5 — May 2026)

- **Bottom nav is 3 tabs** — `home · lists · profile`. The `/add` route still
  exists but is out of nav; search is the header overlay on `/home`.
- **`/home`** rebuilt — topbar, search trigger, filter pills, editorial title,
  trending strip, the merged feed (activities + user posts), the post FAB.
- **`/post/[postId]`** (new) — a user post + its 1-level comment thread + a
  sticky composer.
- The Phase 0.5 logic lives in domain helper modules now —
  `posts-server.ts`, `post-comments-server.ts`, `bookmarks-server.ts`,
  `mutes-server.ts`, `blocks-server.ts`, `friends-watching-server.ts` —
  consumed by their corresponding `/api/v1/*` routes.

---

## Phase B — Capacitor wrap (2026-06-08)

- `src/app/api/` is **moved aside at build time** when `BUILD_TARGET=static`
  is set (see `scripts/static-build.sh`). The route handlers stay on the
  Vercel deploy; the static `out/` bundle ships inside the Capacitor iOS
  binary and calls the Vercel routes cross-origin via
  `NEXT_PUBLIC_API_BASE_URL`.
- Native-only components mounted in `layout.tsx`:
  `<NativeShellInit />`, `<NativePushRegistration />`, `<DeepLinkHandler />`.
  All three are no-ops on web.
- Universal Links manifest at `public/.well-known/apple-app-site-association`
  + Android App Links at `public/.well-known/assetlinks.json`. `next.config.ts`
  pins `Content-Type: application/json` on both via `headers()`.
- Owner manual setup (Apple Developer, Firebase Console iOS/Android,
  APNs key, signing): `PHASE-B-HANDOFF.md` at repo root.

---

## Phase 0.7 — Wave 3: create-a-post (F04) (2026-06-16)

- **Post visibility / audience** is enforced server-side in every read path via
  `canViewPost` (see `src/lib/CLAUDE.md`) — posts are server-only, so there are
  no client-side rules to add for audience. `firestore.rules` adds
  `/closeFriends/{uid}` (server-only, the inner-circle list).
- **New routes**:
  - `GET/PUT /api/v1/me/close-friends` — the caller's close-friends list.
  - `GET /api/v1/watches/recent` — recently-watched distinct films (the film
    picker's "recently watched" rail).
- `POST /api/v1/posts` + `PATCH /api/v1/posts/[id]` now accept
  `{ watchType, watchedOn, visibility, taggedUserIds }` in addition to the
  existing fields; create also logs a watch + snapshots the audience.
- The `/post/[postId]` thread + the composer (`post-composer.tsx`, FAB
  destination) were restyled — see `src/components/CLAUDE.md` Wave 3.
- **Composer product rules**: a post requires **text** (a written take); a film
  is **optional** (its watch/rating sections appear only when attached).

---

## Static-export dynamic routes on native (2026-06-27)

Dynamic `[param]` routes use a single `_` placeholder shell (generateStaticParams
+ `<Suspense>`). On the web that's invisible (the deployment serves the real
route); inside the Capacitor static export there is no server, so navigation to a
real id must go through the **`src/lib/native-nav.ts`** shim — import `useRouter`/
`useParams` from `@/lib/native-nav` (not `next/navigation`) and `Link` from it
(not `next/link`). The shim is a web no-op; on native it routes to the `_` shell
carrying ids in the query and resolves `_` params back. Without it, tapping into
any detail screen crashes the WebView ("failed provisional navigation:
index.txt"). See `src/lib/CLAUDE.md`.

---

## Phase C — extraction routes + /extract UI (2026-06-28)

Branch `feat/phase-c-extraction`. The AI "share a video → extract films" feature.

- **`POST /api/v1/extractions`** `{ url }` → `{ jobId, status }` — validate +
  canonicalize (TikTok/IG/YouTube; others 400), cache-hit or create job + kick
  the pipeline. Rate-limited (`extraction` 5/min + `extractionDaily` 50/day).
- **`GET /api/v1/extractions/[jobId]`** → owner-only job view (status/stage/films).
- **`POST /api/v1/extractions/[jobId]/save`** `{ createLists?, items[] }` →
  per-item results — create caller-owned lists + `addMovieToList` per film with
  the source video as `socialLink`. Per-item `canEditList`, idempotent, integrity.
- **Movie Night (v1.1, `feat/movie-nights`)** — `/api/v1/movie-nights`
  (POST create · GET upcoming · GET/PATCH [id] · POST [id]/rsvp ·
  POST [id]/complete), `GET /api/v1/lists/[o]/[l]/movie-night` (pin),
  PUBLIC `shared/[code]` (view · guest rsvp · calendar.ics),
  `POST /api/v1/admin/movie-nights-tick` (GH Actions 10-min cron).
  Client: `src/components/movie-night/*` (create sheet, detail sheet,
  cards, morning-after, provider with `?night=<id>` deep link) + the
  guest web page **`/n/[code]`** (SSR, `_` shell on static export).
  Plan/tracker: `MOVIE-NIGHT-PLAN.md`.
- **`GET /api/v1/me/scan-quota`** → `{ limit, used, remaining, week, resetsAt }`
  — the free tier's weekly scan quota (7/week, Monday 00:00 UTC reset; only a
  CLAIM counts, cache hits/followers are free). A quota-exhausted claim 429s
  `QUOTA_EXCEEDED` from `POST /api/v1/extractions` instead. See
  `getScanQuota` in `src/lib/CLAUDE.md`.
- **`/extract`** (`page.tsx` Suspense + `client.tsx`) — paste/share a link →
  narrated progress → film cards (poster · year · AI receipt quote · per-film
  destination chip via Vaul `SheetMenu` · remove) + editable AI new-list name →
  save → summary. Empty/failed/auto-`?url=` (native share doorway) states. Static
  route; the home **"scan" button** routes here. Server logic in
  `src/lib/extraction-server.ts` (see `src/lib/CLAUDE.md`).
