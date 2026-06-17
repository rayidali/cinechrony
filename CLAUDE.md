# Cinechrony - Claude Code Reference

> A social movie watchlist app for friends to curate and share movies together.

## Current state (2026-06-17)

- **Phases A + B + 0.5 merged to `main`** (A+B via PR #88, tip `9c81360`).
  `src/app/actions.ts` is deleted — every former Server Action is now a
  `/api/v1/*` route handler (Bearer-token auth, envelope contract) or a
  helper in `src/lib/<domain>-server.ts` (see `src/app/CLAUDE.md`).
  Capacitor 8 wraps the static `out/` bundle in native iOS + Android shells
  (`ios/` + `android/`); native auth, FCM push, Universal Links, native
  polish all in code. Owner manual setup in `PHASE-B-HANDOFF.md`.
- **Active: Phase 0.7 — v3 iOS-native redesign** on `feat/v3-redesign`. A
  screen-by-screen restyle to the downloaded Claude Design package, plus a
  native-feel motion layer (haptics done; transitions/swipe-back next).
  Tracker: **`PHASE-0.7-REDESIGN.md`**. Done: **Profile tab family**, **Search**
  (0.7.3.6), and the **full Home / feed revamp** (0.7.3.1 a/b + R1/R2 — recomposed
  to `ios-home.jsx`): `font-ui` system-sans; underline `for you·friends` tabs;
  icon-only red pencil FAB; **discovery rails** (dig in [client-direct TMDB] · top
  watchers [new `GET /api/v1/leaderboard`] · featured hero · from-the-community,
  all real loved-lists/TMDB data); and the **borderless reel** (`DiaryEntry` +
  `MovieCell`+`MediaGallery` + inline "because you liked X" poster rows). v3
  primitives in `src/components/v3/*`. The home **feed is now posts-only**
  (rated/reviewed dropped); captions are Bricolage. **Next: the F-screen
  interaction-surface waves** — full plan + screen catalog in
  `PHASE-0.7-REDESIGN.md` § "0.7.3.2+ — Interaction surfaces". Wave 1 rail detail
  screens (F15/F16/F17) → Wave 2 movie-drawer cluster (F01/F02 + F05 + F03 "how
  was it?" + new **watch-log** model) → Wave 3 create-a-post (F04) → Wave 4
  threads (F18/F07) → Wave 5 reel·player (F19) → Wave 6 data rails → Wave 7
  onboarding/auth/settings.
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
- **Verification (every 0.7 PR):** typecheck ✓ · `npm run build` (Vercel) ✓ ·
  `npm run build:static` (Capacitor) ✓ · audit suite green (403+/403+).
  Presentational — must not regress logic.
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
  `46-review-highlights`. **The home feed is now fully composed. Next: the
  Lists-detail cluster restyle (still v2).**
- **Owner actions pending:** `firebase deploy --only firestore:indexes
  --project studio-2541484065-75c27` (activities index for profile
  recent/activity); **`firebase deploy --only firestore:rules`** (publishes the
  new `/users/{uid}/watches` owner-read rule — non-blocking, the route uses Admin
  SDK); `npx cap sync` (picks up `@capacitor/haptics`).
- **After 0.7:** Phase C — iOS Share Extension (hero feature, ~2 weeks).
  Spec in `LAUNCH.md` §C.

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
│                     SERVER (Next.js Server Actions)              │
├─────────────────────────────────────────────────────────────────┤
│  src/app/actions.ts (~3000 lines)                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Server Actions (Firebase Admin SDK)                      │   │
│  │  • User management (profiles, usernames, follows)        │   │
│  │  • List operations (CRUD, collaborators, invites)        │   │
│  │  • Movie operations (add, remove, status, notes)         │   │
│  │  • Reviews & Ratings (create, update, like/unlike)       │   │
│  │  • File uploads (avatars → R2, covers → R2)              │   │
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

### 1. Server Actions Pattern
All mutations go through `src/app/actions.ts` using Next.js Server Actions with Firebase Admin SDK:

```typescript
'use server';
export async function createList(userId: string, name: string) {
  const db = getDb(); // Firebase Admin Firestore
  // ... validation and write logic
  revalidatePath('/lists');
  return { success: true, listId };
}
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

*Last updated: January 2025*

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
