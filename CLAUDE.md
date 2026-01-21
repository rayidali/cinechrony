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
│  │  • React Context (Firebase, ListMembersCache)              │ │
│  │  • Local state + useTransition (optimistic updates)        │ │
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
  │     ├── ownerId, collaboratorIds[]
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
  │           └── addedBy, createdAt
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
  └── createdAt, updatedAt

/ratings/{ratingId}  (format: {userId}_{tmdbId})
  ├── userId, tmdbId, mediaType
  ├── movieTitle, moviePosterUrl
  ├── rating (1.0-10.0)
  └── createdAt, updatedAt

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
│   ├── profile/           # User profile
│   │   └── [username]/    # Public profiles + lists
│   ├── invite/[code]/     # Invite acceptance
│   ├── api/               # API routes (admin backfill only)
│   ├── actions.ts         # ⭐ ALL server actions (~3000 lines)
│   └── layout.tsx         # Root layout (providers)
│
├── components/
│   ├── ui/                # shadcn/ui primitives
│   ├── movie-*.tsx        # Movie card variants (grid, list, card, modal)
│   ├── video-embed.tsx    # TikTok/IG/YouTube embeds
│   ├── rating-slider.tsx  # 1-10 rating with HSL colors
│   ├── reviews-list.tsx   # Movie reviews display
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
    └── list-members-cache.tsx  # Collaborator caching
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

### 4. Component Memoization Pattern
List item components use React.memo with cancellation in effects:

```typescript
export const MovieCardGrid = memo(function MovieCardGrid({ movie }) {
  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      const result = await getUserProfile(movie.addedBy);
      if (!cancelled) setUser(result);
    }
    fetchData();
    return () => { cancelled = true; };
  }, [movie.addedBy]);
});
```

### 5. Rating Color System
HSL interpolation for consistent red-to-green gradient:

```typescript
// Returns inline styles (not Tailwind classes) for bulletproof colors
const ratingStyle = getRatingStyle(7.5);
// { background: { backgroundColor: 'hsl(80, 70%, 50%)' }, ... }
```

### 6. iOS Safari Handling
- `useViewportHeight()` - Handles dynamic viewport with keyboard
- Vaul drawers for mobile-native modals
- `FullscreenTextInput` for reliable keyboard input in drawers

---

## Design System

**Neo-brutalist aesthetic:**
- Borders: `border-[3px] border-black` (light) / `border-2 border-border` (dark)
- Shadows: `shadow-[4px_4px_0px_0px_#000]` (light) / none (dark)
- Press effect: `active:translate-x-1 active:translate-y-1`
- Typography: Space Grotesk (headlines), Space Mono (body)
- Colors: Primary blue (#2962FF), Success green, Warning yellow

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

- Components use `React.memo` to prevent re-renders
- Async effects use `cancelled` flag for cleanup
- `useMemoFirebase` ensures stable query references
- Images use Next.js `<Image>` with proper `sizes`
- No virtualization needed (typical list < 50 items)

---

## Known Issues & TODOs

- [ ] Activity feed (Coming Soon placeholder)
- [ ] OMDB API key exposed in client (should move to server)
- [ ] Some TypeScript errors suppressed in `next.config.ts`
- [ ] Review type casting in `movie-details-modal.tsx`

---

*Last updated: January 2025*
