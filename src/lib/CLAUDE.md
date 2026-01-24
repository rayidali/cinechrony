# Lib - Claude Code Reference

## Files Overview

```
src/lib/
├── types.ts        # ALL TypeScript types for the app
├── utils.ts        # Utility functions (cn, rating colors)
└── video-utils.ts  # Video URL parsing (TikTok, IG, YouTube)
```

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

### Notifications (Deferred to Phase 3)
```typescript
type NotificationType = 'mention' | 'reply';

type Notification = {
  id: string;
  userId: string;               // Recipient
  type: NotificationType;
  fromUserId: string;
  fromUsername: string | null;
  fromDisplayName: string | null;
  fromPhotoUrl: string | null;
  reviewId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  previewText: string;
  read: boolean;
  createdAt: Date;
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
