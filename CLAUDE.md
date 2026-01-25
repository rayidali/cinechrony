# Cinechrony - Claude Code Reference

> A social movie watchlist app for friends to curate and share movies together.

## Quick Reference

```
Tech Stack: Next.js 15 + React 19 + Firebase + Tailwind + Vaul
DB: Firestore (real-time subscriptions)
Auth: Firebase Auth (email/password, Google)
Storage: Cloudflare R2 (avatars, covers)
APIs: TMDB (movie data), OMDB (IMDB ratings)
Target: iOS PWA + Desktop
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
  ├── rating (1.0-10.0)
  └── createdAt, updatedAt

/notifications/{notificationId}  # Deferred to Phase 3
  ├── userId (recipient)
  ├── type ('mention' | 'reply')
  ├── fromUserId, fromUsername, fromDisplayName, fromPhotoUrl
  ├── reviewId, tmdbId, mediaType, movieTitle
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
│   ├── notifications/     # Notifications page (deferred to Phase 3)
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

## Design System

**Neo-brutalist aesthetic:**
- Borders: `border-[3px] border-black` (light) / `border-2 border-border` (dark)
- Shadows: `shadow-[4px_4px_0px_0px_#000]` (light) / none (dark)
- Press effect: `active:translate-x-1 active:translate-y-1`
- Typography: Space Grotesk (headlines), Space Mono (body)
- Colors: Primary blue (#2962FF), Success green, Warning yellow

**Profile Page Stats Boxes:**
```typescript
// Styled stat boxes with neo-brutalist shadows and hover/press effects
<button className="flex flex-col items-center px-5 py-3 rounded-xl
  border-[3px] dark:border-2 border-border bg-card
  shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none
  hover:shadow-[2px_2px_0px_0px_hsl(var(--border))]
  hover:translate-x-0.5 hover:translate-y-0.5
  active:shadow-none active:translate-x-1 active:translate-y-1
  transition-all min-w-[90px]">
  <span className="font-bold text-2xl">{count}</span>
  <span className="text-xs text-muted-foreground">label</span>
</button>

// Yellow highlight for "lists" stat
className="bg-yellow-400 dark:bg-yellow-500 text-black"
```

**Extended FAB Buttons:**
FAB buttons use pill shape with icon + label for better discoverability:
```typescript
<button className="fixed bottom-24 right-4 z-40 h-12 px-4 rounded-full
  bg-primary text-primary-foreground shadow-lg
  flex items-center gap-2 font-medium">
  <Plus className="h-5 w-5" />
  <span>Add</span>  {/* or "New List" */}
</button>
```

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

- [ ] OMDB API key exposed in client (should move to server)
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

### Notifications (Phase 3 - Deferred)
- Backend ready: notifications created for @mentions and replies
- UI components built but disabled (NotificationBell commented out)
- Requires Firestore index deployment before enabling
- Will revisit in dedicated phase

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
