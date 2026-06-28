# Lib - Claude Code Reference

## Files Overview

```
src/lib/
│
├── types.ts                  # ALL TypeScript types for the app
├── utils.ts                  # Utility functions (cn, rating colors)
├── video-utils.ts            # Video URL parsing (TikTok, IG, YouTube)
│
├─── API foundation (Phase A) ───────────────────────────────────────
├── api-handler.ts            # apiRoute + publicApiRoute wrappers, ApiError
│                              # hierarchy, envelope contract, CORS allowlist
├── admin-handler.ts          # adminRoute wrapper (ADMIN_SECRET const-time compare)
├── api-client.ts             # apiCall<T>(method, path, body?) for the client
├── auth-server.ts            # verifyCaller(req) — Bearer token → UID
├── auth-login-server.ts      # loginWithIdentifier (email-or-@username → custom
│                              # token; resolves handle→email server-side, verifies
│                              # password via Identity Toolkit REST; Wave 7)
├── email-server.ts           # Transactional email via Resend (verified domain
│                              # cinechrony.com). isEmailConfigured() + sendEmail()
│                              # degrade gracefully when RESEND_API_KEY is unset;
│                              # branded HTML shell + sendPasswordResetEmail(to,link).
│                              # Backs POST /api/v1/auth/forgot-password (Admin SDK
│                              # generatePasswordResetLink → Resend; client falls
│                              # back to Firebase's own email when unconfigured).
├── rate-limit.ts             # checkRateLimit(uid, bucket) — review/like/follow/…
│
├─── Server-side domain helpers (consumed by /api/v1/* routes) ──────
├── profiles-server.ts        # getUserByUsername, ensureUserProfile, …
├── account-server.ts         # deleteUserAccount cascade, avatar upload
├── lists-server.ts           # createList, updateListFields, deleteList,
│                              # transferOwnership, setListCover, list reads
├── movies-server.ts          # addMovieToList, updateMovieStatus, …
├── invites-server.ts         # inviteToList, acceptInvite, revokeInvite, …
├── follows-server.ts         # followUser, unfollowUser, getFollowRelationship
├── reviews-server.ts         # createReview, like/unlike (= "helpful"), threading,
│                              # getReviewHighlights (hot-takes), reactReview/
│                              # unreactReview + getReviewsWall (F12 reviews wall)
├── review-verdict.ts         # loved/liked/fine/nope buckets (pure, server+client)
├── review-reactions.ts       # the 5 icon reactions (pure: types + colours)
├── ratings-server.ts         # createOrUpdateRating, deleteRating
├── watches-server.ts         # logWatch (F03) + getWatchesForMovie (watch log)
├── activities-server.ts      # getActivityFeed, likeActivity, …
├── posts-server.ts           # createPost, updatePost, deletePost, likePost
├── post-comments-server.ts   # createPostComment + likes
├── notifications-server.ts   # All notification creators + push-sub CRUD
├── push-server.ts            # ★ Unified FCM + web-push fan-out (Phase B.3)
├── search-server.ts          # User search by username
├── tmdb-server.ts            # TMDB/OMDB proxies (server-side OMDB key)
├── bookmarks-server.ts       # saveItem, unsaveItem, getSavedFeed
├── mutes-server.ts           # muteUser, unmuteUser
├── blocks-server.ts          # blockUser, unblockUser, getBlockSet
├── reports-server.ts         # reportContent (5 content types)
├── friends-watching-server.ts# Aggregated "your circle is watching"
├── leaderboard-server.ts     # Weekly "top watchers" (follow-graph aggregate)
├── letterboxd-server.ts      # ZIP parse + TMDB match + import
├── letterboxd-scrape-server.ts # USERNAME scrape engine (Apify cheerio+browser
│                              # actors). Decoupled run helpers: startRun /
│                              # getRunStatus / fetchDatasetItems + normalizeRows
│                              # (pure). scrapeLetterboxdLibrary (sync, dry-run) +
│                              # importLetterboxdFromUsername. /preview route.
├── letterboxd-username-import-server.ts # ASYNC + CHUNKED onboarding import:
│                              # startLibraryScrape / pollLibraryScrape (→ deduped
│                              # ImportLibrary; buildImportItems forces Watched for
│                              # any rated/reviewed film) + importFilmChunk (concurrent
│                              # TMDB match, ~120/req, returns posters) / importUserList
│                              # / setUserFavorites / finalizeDefaultList (recount +
│                              # record importedLetterboxd + kick reviews run). REVIEWS
│                              # BACKGROUND: startReviewsRun + syncPendingReviews —
│                              # writes CANONICAL review docs (parentId:null etc. so
│                              # they show in the wall), ratingAtTime from /ratings,
│                              # upserts the film Watched; deterministic lb_{uid}_{tmdbId}
│                              # ids; pendingReviews on users_private. Wired by
│                              # /imports/letterboxd/scrape/{start,status,import} +
│                              # /imports/letterboxd/reviews/sync
├── import-store.ts           # CLIENT singleton (useImportStore) owning the import
│                              # lifecycle so it survives navigation: scrape→poll→
│                              # chunks→finalize, ETA, foreground flag, localStorage
│                              # resume-on-kill (+ resume on app foreground). Views:
│                              # importing-step + import pill. importFilmChunk keeps
│                              # the default-list movieCount live (increment/chunk,
│                              # finalize SETs authoritative). importUserList writes
│                              # films THEN creates the list doc w/ final count (no
│                              # 0→N flicker) + strips LB share-blurb descriptions +
│                              # skips empty lists.
├── admin-backfills-server.ts # 4 idempotent migration functions
│
├─── Caches + Phase B native helpers ────────────────────────────────
├── tmdb-details-cache.ts     # Module-level cache (modal back-nav contract)
├── tmdb-client.ts            # Browser-side TMDB fetch (NEXT_PUBLIC_ token)
├── seeded-gradient.ts        # Deterministic cover/avatar gradient fallback
├── use-cached-action.ts      # SWR-style cache hook with persistence
├── cache-config.ts           # Registers localStorage-mirrored keys
├── list-detail-seed.ts       # sessionStorage seed for list page chrome
├── native-auth.ts            # ★ Capacitor Google/Apple sign-in router
├── native-push.ts            # ★ Capacitor FCM token registration
├── story-card.ts             # Story-share PURE helpers + wire contract: the
│                              # StorySharePayload union (review|watched|list),
│                              # payloadToParams / paramsToModel, rating→hex,
│                              # deterministic gradient/placeholder colours,
│                              # quote/meta formatting. Shared by the renderer
│                              # route + the client. No React/Node/DOM.
├── story-share.ts            # CLIENT glue: storyImageUrl(payload) →
│                              # `${apiOrigin()}/api/v1/share/story?…` (same-origin on
│                              # web/preview so the route is reachable — NOT shareOrigin);
│                              # shareStory() (image → IG Stories) + sendToFriend() (image +
│                              # deep link → iMessage/etc.) via @capacitor/share+filesystem /
│                              # navigator.share / download (web)
├── verified-server.ts        # Official/verified-account system: getVerifiedUids
│                              # (tiny public set, TTL-cached; users/{uid}.verified,
│                              # auto-indexed single-field) + setVerified (Admin SDK:
│                              # flag + {verified,admin} custom claim). Granted by
│                              # scripts/grant-verified.ts; badge = <VerifiedBadge>
│                              # over UserVerifiedCacheProvider (O(1) isVerified(uid)).
│                              # firestore.rules blocks client self-verification.
├── og-shared.ts              # SERVER-only render infra shared by both image routes
│                              # (/share/story + /share/og): loadBrandFonts() (public/fonts
│                              # TTFs), fetchImageDataUri (timeout → null), clapper SVG, shade,
│                              # font-family consts, IMG_HEADERS (ACAO:*). Route handlers only.
└── share-meta.ts             # SERVER-side OG/Twitter metadata: deployOrigin() (absolute
                               # URLs, no headers() → static-export-safe), ogImageUrl() →
                               # /api/v1/share/og?…, pageMetadata() + defaultShareMetadata().
                               # Used by generateMetadata on post/profile/list pages + layout.
```

> **★** = new in Phase B (2026-06-08). The native-* helpers detect
> `Capacitor.isNativePlatform()` and bail on web. `push-server` runs
> on the Vercel deploy and fans every notification creator's writes
> out to FCM (native) + web-push (browser).

> **All `*-server.ts` modules are pure functions, NOT `'use server'`
> files.** Server Actions (the legacy `'use server'` pattern) were
> retired in Phase A. These helpers are consumed by route handlers
> under `src/app/api/v1/**`.

---

## types.ts - Data Models

### User & Profile
```typescript
type UserId = string;  // Firebase Auth UID

type UserProfile = {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  username: string | null;      // Unique, for @mentions
  bio: string | null;
  createdAt: Date;
  followersCount: number;
  followingCount: number;
  favoriteMovies?: FavoriteMovie[];  // Top 5
};

type FavoriteMovie = {
  id: string;
  title: string;
  posterUrl: string;
  tmdbId: number;
};

type Follow = {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: Date;
};
```

### Lists & Movies
```typescript
type MovieList = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  isDefault: boolean;
  isPublic: boolean;
  ownerId: string;
  collaboratorIds?: string[];  // Max 10 total including owner
  coverImageUrl?: string;
  movieCount?: number;
};

type ListRole = 'owner' | 'collaborator';

type ListMember = {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: ListRole;
};

type Movie = {
  id: string;
  title: string;
  year: string;
  posterUrl: string;
  posterHint: string;          // AI hint for poster
  addedBy: UserId;
  socialLink?: string;         // TikTok/IG/YouTube URL
  status: 'To Watch' | 'Watched';
  createdAt?: Date;
  mediaType?: 'movie' | 'tv';
  tmdbId?: number;
  overview?: string;
  rating?: number;             // TMDB vote_average
  backdropUrl?: string;
  notes?: Record<string, string>;  // { [userId]: note }
  // Denormalized fields (populated at write time to avoid N+1 fetches)
  noteAuthors?: Record<string, { username: string | null; displayName: string | null; photoURL: string | null }>;
  addedByDisplayName?: string | null;
  addedByPhotoURL?: string | null;
  addedByUsername?: string | null;
};
```

### Invitations
```typescript
type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

type ListInvite = {
  id: string;
  listId: string;
  listName: string;
  listOwnerId: string;
  inviterId: string;
  inviterUsername: string | null;
  inviteeId?: string;          // For direct invites
  inviteeUsername?: string | null;
  inviteCode?: string;         // For link invites
  status: InviteStatus;
  createdAt: Date;
  expiresAt?: Date;
};
```

### Reviews & Ratings
```typescript
type Review = {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  moviePosterUrl?: string;
  userId: string;
  username: string | null;
  userDisplayName: string | null;
  userPhotoUrl: string | null;
  text: string;
  ratingAtTime: number | null;  // Snapshot when posted
  likes: number;
  likedBy: string[];
  parentId: string | null;      // null for top-level, reviewId for replies
  replyCount: number;           // Number of replies
  createdAt: Date;
  updatedAt: Date;
};

type UserRating = {
  id: string;                   // Format: {userId}_{tmdbId}
  userId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  moviePosterUrl?: string;
  rating: number;               // 1.0 - 10.0
  createdAt: Date;
  updatedAt: Date;
};
```

### Notifications
```typescript
type NotificationType = 'mention' | 'reply' | 'like' | 'follow' | 'list_invite';

type Notification = {
  id: string;
  userId: string;               // Recipient
  type: NotificationType;
  fromUserId: string;
  fromUsername: string | null;
  fromDisplayName: string | null;
  fromPhotoUrl: string | null;
  reviewId?: string;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  movieTitle?: string;
  previewText?: string;
  read: boolean;
  createdAt: Date;
  // For list_invite notifications
  inviteId?: string;            // To accept/decline from notification
  listId?: string;
  listName?: string;
  listOwnerId?: string;
};
```

### TMDB API Types
```typescript
type SearchResult = {
  id: string;
  title: string;
  year: string;
  posterUrl: string;
  posterHint: string;
  mediaType: 'movie' | 'tv';
  tmdbId?: number;
  overview?: string;
  rating?: number;
  backdropUrl?: string;
};

type TMDBMovieDetails = {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  vote_average: number;
  vote_count: number;
  poster_path: string | null;
  backdrop_path: string | null;
  runtime: number | null;
  genres: Array<{ id: number; name: string }>;
  credits?: { cast: TMDBCast[] };
};

type TMDBTVDetails = {
  id: number;
  name: string;
  overview: string;
  first_air_date: string;
  vote_average: number;
  number_of_seasons: number;
  number_of_episodes: number;
  genres: Array<{ id: number; name: string }>;
  networks: Array<{ id: number; name: string; logo_path: string | null }>;
  credits?: { cast: TMDBCast[] };
};

type TMDBCast = {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
};
```

---

## utils.ts - Utilities

### cn() - Class Name Merger
```typescript
import { cn } from '@/lib/utils';

// Merges Tailwind classes intelligently
<div className={cn(
  'base-classes',
  condition && 'conditional-classes',
  { 'object-syntax': true }
)} />
```

### Rating Color System
HSL-based interpolation for consistent red→green gradient:

```typescript
type RatingStyle = {
  background: React.CSSProperties;  // For badge backgrounds
  textOnBg: React.CSSProperties;    // For text ON the background
  accent: React.CSSProperties;      // For stars/icons
};

// Primary function - returns inline styles
function getRatingStyle(rating: number | null | undefined): RatingStyle

// Example usage:
const style = getRatingStyle(7.5);
// {
//   background: { backgroundColor: 'hsl(80, 70%, 50%)' },
//   textOnBg: { color: 'white' },
//   accent: { color: 'hsl(80, 80%, 45%)' }
// }

// Apply to elements:
<div style={{ ...style.background, ...style.textOnBg }}>7.5</div>
<Star style={{ ...style.accent, fill: style.accent.color }} />
```

**Why inline styles instead of Tailwind?**
Tailwind's JIT compiler doesn't generate dynamic classes like `bg-[hsl(80,70%,50%)]`. Inline styles guarantee the color appears correctly.

### Color Mapping
```
Rating 1.0  → Hue 0   (Red)
Rating 5.5  → Hue 60  (Yellow)
Rating 10.0 → Hue 120 (Green)
```

### Legacy Functions (Tailwind-based)
Still available but prefer `getRatingStyle()`:
```typescript
function getRatingColors(rating): RatingColors  // Returns Tailwind classes
function getRatingTextColor(rating): string
function getRatingBgColor(rating): string
```

---

## video-utils.ts - Video Parsing

### parseVideoUrl()
Extract provider info from social video URLs:

```typescript
type VideoProvider = 'tiktok' | 'instagram' | 'youtube' | null;

type ParsedVideo = {
  provider: VideoProvider;
  url: string;
  embedUrl: string | null;
  embedUrlAutoplay: string | null;
  videoId: string | null;
};

function parseVideoUrl(url: string | undefined): ParsedVideo | null
```

### Supported URL Patterns

**TikTok:**
- `https://www.tiktok.com/@username/video/1234567890`
- `https://vm.tiktok.com/ABC123/`

**Instagram:**
- `https://www.instagram.com/reel/ABC123/`
- `https://www.instagram.com/p/ABC123/`

**YouTube:**
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://youtube.com/shorts/VIDEO_ID`

### Helper Functions
```typescript
function getProviderDisplayName(provider: VideoProvider): string
// Returns: 'TikTok', 'Instagram', 'YouTube', or 'Video'

function isValidVideoUrl(url: string | undefined): boolean
// Returns true if URL is from a supported platform
```

---

## Adding New Types

1. Add type definition to `types.ts`
2. Export it
3. Import in components: `import type { NewType } from '@/lib/types'`
4. Update CLAUDE.md if it's a significant addition

## Modifying Rating Colors

Edit `getRatingHSL()` in `utils.ts`:
- `normalizedRating` maps 1-10 to 0-1
- `hue` interpolates from 0 (red) to 120 (green)
- `saturation` and `lightness` can be adjusted for theme

---

## Phase 0.7 — Wave 3: post visibility + watch-log + close-friends (2026-06-16)

The server model behind F04 "create a post".

**Post type** (`types.ts`) gained: `watchType?: 'first' | 'rewatch'`,
`watchedOn?: Date | null`, `visibility?: PostVisibility` (`'everyone' |
'friends' | 'close_friends' | 'only_me'`, default `'everyone'`), and
`audienceUids?: string[]` — a WRITE-TIME snapshot of who may see a restricted
post (excludes the author, who always can). New `PostVisibility` +
`PostWatchType` types.

**`posts-server.ts`**:
- `parsePostFields()` — shared create/update validation (text, media, rating,
  watchType, future-clamped watchedOn, visibility).
- `resolveAudience(uid, visibility)` — `everyone` → no snapshot; `only_me` → `[]`;
  `friends` → `getMutualIds`; `close_friends` → `getCloseFriendIds`.
- **`canViewPost(post, viewerUid)` — the single audience guard**, applied in
  EVERY post read path: `getHomeFeed`, `getPost`, `getSavedFeed`
  (bookmarks-server), `getPostComments` + `createPostComment`
  (post-comments-server), and `likePost`/`unlikePost`. Out-of-audience callers
  get the same 404/empty as a missing post (no existence oracle).
- `createPost` also: records a watch (`recordWatchEntry`, no dup review/rating),
  and only sends tag/@-mention notifications to recipients who pass
  `canViewPost` (a restricted post never leaks its preview to outsiders).
- `getHomeFeed` paginates off the RAW scan (bounded rounds), NOT the
  audience-filtered count, so a hidden post can't dead-end infinite scroll;
  `nextCursor` resumes after the last RETURNED post. `MAX_POST_MEDIA = 10`.

**`follows-server.ts`**: `getFollowerIds` (cached, mirror of `getFollowingIds`);
`getMutualIds` (following ∩ followers, scans to `MAX_ID_LIMIT = 2000` so a big
account's `friends` audience isn't capped at 200); `getCloseFriendIds` /
`setCloseFriendIds` (server-only `/closeFriends/{uid}` doc, dedup/self-strip/cap
150). Follow/unfollow now invalidate BOTH the follower and following id caches.

**`watches-server.ts`**: `recordWatchEntry` (the lean core extracted from
`logWatch` — writes the watch doc + ordinal, NO rating/review side-effects;
`logWatch` now calls it then layers the rating upsert + review). `getRecentWatches`
(distinct recently-watched films for the picker rail).

**New endpoints**: `GET/PUT /api/v1/me/close-friends`, `GET /api/v1/watches/recent`.
**firestore.rules**: `/closeFriends/{uid}` server-only.

---

## `native-nav.ts` — static-export dynamic-route shim (2026-06-27)

`src/lib/native-nav.ts` makes dynamic routes work inside the Capacitor static
export. Static export ships ONE `_` placeholder shell per dynamic route
(`generateStaticParams` → `[{listId:'_'}]`), so `/lists/<realId>` has no file: in
the WKWebView Next fetches its RSC `.txt`, 404s, hard-navigates, and the WebView
can't find it → "failed provisional navigation". The shim is a **web no-op** that:
- overrides **`useRouter`** — `push`/`replace`/`prefetch` rewrite a real dynamic
  path to its shell + query on native (`/lists/abc` → `/lists/_?listId=abc`);
- overrides **`useParams`** — resolves a `'_'` path segment back from the query;
- exports a patched **`Link`** that rewrites string hrefs the same way;
- re-exports `useSearchParams` unchanged.

Client files that navigate to / read params of dynamic routes import from
`@/lib/native-nav` instead of `next/navigation`; `<Link>` importers use
`{ Link }` from it instead of `next/link`. Route table covers all 7 dynamic
routes (lists/[listId](+settings), profile/[username](+/lists/[listId]),
post/[postId], movie/[tmdbId]/comments, invite/[code]). On web every export is
identical to Next's — only native rewrites.
