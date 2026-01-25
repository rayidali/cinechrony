# Components - Claude Code Reference

## Component Categories

```
src/components/
├── ui/                     # shadcn/ui primitives (don't modify)
│
├── Movie Display           # Different movie card presentations
│   ├── movie-card.tsx          # Full card (legacy, used in "cards" view)
│   ├── movie-card-grid.tsx     # Compact poster grid item
│   ├── movie-card-list.tsx     # Horizontal list row
│   ├── movie-list.tsx          # Container with view mode switching
│   ├── movie-details-modal.tsx # Full details in Vaul drawer
│   ├── public-movie-grid.tsx   # Public profile grid item
│   └── public-movie-list-item.tsx
│
├── Video Embedding
│   ├── video-embed.tsx         # TikTok/Instagram/YouTube embeds
│   └── icons.tsx               # Custom icons (TikTok)
│
├── Reviews & Ratings
│   ├── reviews-list.tsx        # Movie reviews with like/edit
│   ├── review-card.tsx         # Single review with threading & @mentions
│   ├── rating-slider.tsx       # 1-10 slider with HSL colors
│   ├── rate-on-watch-modal.tsx # Prompt to rate after watching
│   └── write-review-input.tsx  # Review composer
│
├── Notifications
│   └── notification-bell.tsx   # Header bell icon with unread count badge
│
├── Activity Feed (Home Page)
│   ├── activity-feed.tsx       # Global feed with infinite scroll + pull-to-refresh
│   ├── activity-card.tsx       # Individual activity card (added, rated, watched, reviewed)
│   ├── trending-movies.tsx     # TMDB trending carousel with IMDB ratings
│   └── pull-to-refresh.tsx     # Pull-to-refresh gesture component
│
├── Lists & Collaboration
│   ├── list-card.tsx           # List preview card
│   ├── list-header.tsx         # List title + actions
│   ├── list-collaborators.tsx  # Show collaborator avatars (max 10 members)
│   ├── list-settings-modal.tsx # List settings drawer
│   └── invite-collaborator-modal.tsx  # Invite users + revoke pending invites
│
├── User & Profile
│   ├── user-avatar.tsx         # Current user dropdown
│   ├── profile-avatar.tsx      # Editable profile avatar
│   ├── avatar-picker.tsx       # Avatar upload modal
│   ├── cover-picker.tsx        # List cover upload
│   ├── follow-button.tsx       # Follow/unfollow button
│   ├── user-search.tsx         # Search users input
│   └── favorite-movies-picker.tsx
│
├── Forms & Input
│   ├── add-movie-form.tsx      # Search + add movie
│   ├── add-movie-form-list.tsx # Search for list context
│   ├── add-movie-modal.tsx     # Modal wrapper
│   └── fullscreen-text-input.tsx  # iOS-safe text input
│
├── Navigation & Layout
│   ├── bottom-nav.tsx          # Mobile bottom navigation
│   ├── theme-toggle.tsx        # Dark/light mode
│   ├── theme-provider.tsx      # next-themes wrapper
│   └── grid-view-hint.tsx      # First-time hint tooltip
│
└── Error Handling
    └── FirebaseErrorListener.tsx  # Global error toasts
```

---

## Movie Card Variants

### movie-card-grid.tsx (Primary)
Compact poster-only display for grid views:
```
┌─────────────┐
│  ★7.5  📺  │  ← Rating badge + TV indicator + Social icon
│             │
│   POSTER    │
│             │
│  👤    👁️  │  ← Added by initial + Status indicator
└─────────────┘
  Title
  2024
  @user · note text...
```

### movie-card-list.tsx
Horizontal row for list view:
```
┌────┬─────────────────────────────────┬──────────┐
│    │ 📺 Movie Title                  │ Watched  │
│POST│ 2024                            │          │
│ ER │ ★7.5                            │ 👁️ 🗑️   │
│    │ Added by Username               │          │
└────┴─────────────────────────────────┴──────────┘
```

### movie-details-modal.tsx
Full details in Vaul drawer with tabs:
- **Info Tab**: Poster, ratings, overview, cast, genres, runtime
- **Reviews Tab**: Community reviews + write review
- Actions: Toggle status, update note, delete

---

## Component Patterns

### Memoization Pattern (List Items)
All movie cards use `React.memo` with denormalized data (no async fetches):

```typescript
export const MovieCardGrid = memo(function MovieCardGrid({ movie, onOpenDetails }) {
  const { user } = useUser();
  const { getRating } = useUserRatingsCache();

  // O(1) rating lookup from cache - no network call
  const userRating = useMemo(() => getRating(tmdbId), [getRating, tmdbId]);

  // Memoize computed values
  const ratingStyle = useMemo(() => getRatingStyle(userRating), [userRating]);
  const notesEntries = useMemo(
    () => movie.notes ? Object.entries(movie.notes) : [],
    [movie.notes]
  );

  // Use denormalized data - no fetch needed!
  const addedByName = useMemo(() => {
    if (movie.addedBy === user?.uid) return 'You';
    return movie.addedByDisplayName || movie.addedByUsername || null;
  }, [movie.addedBy, movie.addedByDisplayName, movie.addedByUsername, user?.uid]);

  // Note authors from denormalized noteAuthors field
  const noteAuthorNames = useMemo(() => {
    const authors: Record<string, string> = {};
    notesEntries.forEach(([uid]) => {
      if (uid === user?.uid) {
        authors[uid] = user?.displayName || 'you';
      } else if (movie.noteAuthors?.[uid]) {
        authors[uid] = movie.noteAuthors[uid].username || 'user';
      } else {
        authors[uid] = 'user';
      }
    });
    return authors;
  }, [notesEntries, movie.noteAuthors, user?.uid, user?.displayName]);

  // ...
});
```

**Key Performance Pattern**: No async `useEffect` for user data - everything comes from:
1. **Denormalized fields** on the movie document (`addedByUsername`, `noteAuthors`)
2. **UserRatingsCacheProvider** for O(1) rating lookups

### Vaul Drawer Pattern
Mobile-first modal using Vaul (iOS-safe):

```typescript
<Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
  <Drawer.Portal>
    <Drawer.Overlay className="fixed inset-0 bg-black/40" />
    <Drawer.Content className="fixed bottom-0 left-0 right-0 max-h-[85vh]">
      <div className="mx-auto w-12 h-1.5 bg-muted rounded-full my-4" />
      {/* Content */}
    </Drawer.Content>
  </Drawer.Portal>
</Drawer.Root>
```

### Rating Color Pattern
Use `getRatingStyle()` from `lib/utils.ts`:

```typescript
const ratingStyle = getRatingStyle(7.5);

// Apply to badge background
<div style={{ ...ratingStyle.background, ...ratingStyle.textOnBg }}>
  7.5
</div>

// Apply to star icon
<Star style={{ ...ratingStyle.accent, fill: ratingStyle.accent.color }} />
```

### Non-blocking Update Pattern
Fire-and-forget writes for instant UI response:

```typescript
const handleToggle = () => {
  startTransition(() => {
    const newStatus = movie.status === 'To Watch' ? 'Watched' : 'To Watch';
    updateDocumentNonBlocking(movieDocRef, { status: newStatus });
  });
};
```

---

## Video Embedding (video-embed.tsx)

Supports three providers with platform-specific handling:

| Provider | Desktop | iOS Safari |
|----------|---------|------------|
| YouTube | iframe | iframe |
| TikTok | blockquote + embed.js | iframe player (more reliable) |
| Instagram | blockquote + embed.js | blockquote + embed.js |

Key functions:
- `parseVideoUrl(url)` - Extract provider, videoId, embedUrl
- `isValidVideoUrl(url)` - Check if embeddable
- `getProviderDisplayName(provider)` - "TikTok", "Instagram", etc.

---

## iOS Safari Considerations

### Viewport Height Hook
`useViewportHeight()` handles dynamic viewport:
- Ignores keyboard-induced shrinking
- Updates on orientation change
- Sets `--dvh` CSS variable

### Fullscreen Text Input
`FullscreenTextInput` solves Vaul + iOS keyboard issues:
- Opens full-screen overlay for text entry
- **CRITICAL**: Must render when Vaul drawer is CLOSED (focus trap blocks input)
- Auto-focuses input on open
- Supports `singleLine` mode for URLs, `inputType="url"` for proper keyboard

**Pattern for inputs inside drawers** (used in `add-movie-modal.tsx`):
```typescript
type Step = 'search' | 'preview' | 'select-list' | 'edit-link';

// Instead of inline input, use a tappable trigger
<button onClick={() => setStep('edit-link')}>
  {socialLink || 'Paste TikTok, Reel, or YouTube link...'}
</button>

// FullscreenTextInput renders when drawer is closed
<FullscreenTextInput
  isOpen={step === 'edit-link'}
  onClose={() => setStep('preview')}
  onSave={async (text) => setSocialLink(text)}
  singleLine
  inputType="url"
/>
```

---

## Styling Conventions

### Retro Button Class
```typescript
const retroButtonClass = `
  border-[3px] border-black rounded-lg
  shadow-[4px_4px_0px_0px_#000]
  active:shadow-none active:translate-x-1 active:translate-y-1
  transition-all duration-200
`;
```

### Dark Mode Adjustments
```typescript
// Light: 3px border, hard shadow
// Dark: 2px border, no shadow
className="border-[3px] dark:border-2 border-border
           shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none"
```

### Card Hover Effect
```typescript
className="transition-all duration-200
           md:hover:shadow-[2px_2px_0px_0px_#000]
           md:hover:translate-x-0.5 md:hover:translate-y-0.5"
```

---

## Component Dependencies

```
movie-list.tsx
├── movie-card.tsx (cards view)
├── movie-card-grid.tsx (grid view)
├── movie-card-list.tsx (list view)
├── movie-details-modal.tsx (modal)
│   ├── video-embed.tsx
│   ├── reviews-list.tsx
│   │   └── review-card.tsx
│   ├── rating-slider.tsx
│   └── fullscreen-text-input.tsx
└── grid-view-hint.tsx

user-avatar.tsx
├── avatar-picker.tsx
└── dropdown-menu (ui)
```

---

---

## Invite Collaborator Modal (invite-collaborator-modal.tsx)

Two-step flow with iOS-safe search:
1. **Options step** (Vaul drawer): Shows spots left, search button, invite link, pending invites with revoke
2. **Search step** (Fullscreen overlay): User search with instant results

Key features:
- `spotsLeft = 10 - members.length` (max 10 collaborators)
- Pending invites show X button to revoke via `revokeInvite()` action
- Search uses fullscreen overlay (not Vaul) for iOS keyboard compatibility

```typescript
// Revoke invite handler
const handleRevokeInvite = async (inviteId: string) => {
  const result = await revokeInvite(user.uid, inviteId);
  if (!result.error) {
    setPendingInvites(prev => prev.filter(i => i.id !== inviteId));
  }
};
```

---

## Review Card with Threading (review-card.tsx)

The review card supports Instagram/TikTok style 1-level threading:

```typescript
<ReviewCard
  review={review}
  currentUserId={user?.uid}
  onDelete={handleDelete}
  onReply={handleStartReply}  // Opens reply input
  isReply={false}             // Set true for nested replies
/>
```

**@Mentions**: Text is parsed for `@username` patterns and rendered as clickable profile links:
```typescript
function renderTextWithMentions(text: string): React.ReactNode {
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;
  // Returns mix of text spans and Link components
}
```

**Reply Threading**:
- Top-level comments have `parentId: null`
- Replies have `parentId: rootCommentId`
- All replies go under the root parent (1-level deep, like Instagram)
- When replying to a reply, the text auto-fills with `@username`

---

## Activity Feed Components

### activity-feed.tsx
Global activity feed with infinite scroll and pull-to-refresh support:

```typescript
<ActivityFeed
  currentUserId={user.uid}
  refreshKey={refreshKey}  // Increment to trigger refresh
/>
```

Features:
- Infinite scroll via Intersection Observer (100px trigger margin)
- Loading skeleton for initial load
- Enhanced empty state with call-to-action
- "You're all caught up!" end-of-feed indicator
- Cursor-based pagination via `getActivityFeed(cursor)`

### activity-card.tsx
Individual activity card with user info, movie poster, and actions:

```
┌───────────────────────────────────────────────┐
│ [Avatar] Username  [RATED badge]     ★ 8.5    │
│          rated · 2 hours ago                  │
├───────────────────────────────────────────────┤
│ [Poster]  Movie Title                         │
│           2024                                │
│           "Review text preview..."            │
├───────────────────────────────────────────────┤
│ ♡ 12                          ⏰ 2 hours ago  │
└───────────────────────────────────────────────┘
```

Activity types with color-coded badges:
- **added** (blue): User added movie to a list
- **rated** (yellow): User rated a movie
- **watched** (green): User marked movie as watched
- **reviewed** (purple): User wrote a review

### trending-movies.tsx
Horizontal scroll carousel of TMDB trending movies:
- Fetches via `getTrendingMovies()` server action
- IMDB ratings displayed with yellow IMDb badge
- Falls back to TMDB rating if IMDB unavailable
- Click opens `PublicMovieDetailsModal`

### pull-to-refresh.tsx
Touch gesture component for mobile pull-to-refresh:

```typescript
<PullToRefresh
  onRefresh={handleRefresh}
  disabled={isModalOpen}  // Disable when modals are open
>
  {/* Content */}
</PullToRefresh>
```

Features:
- 70px pull threshold to trigger refresh
- **Direction locking**: Tracks both X and Y movement, only triggers for primarily vertical swipes (fixes diagonal swipe issue)
- Non-passive touch event listeners to allow `preventDefault()` during pull
- `disabled` prop to prevent refresh when modals/drawers are open
- Visual indicator with spinner rotation
- "Pull to refresh" → "Release to refresh" → "Refreshing..." states
- Content transforms during pull for native feel
- Haptic feedback via `navigator.vibrate()` if available
- `overscrollBehaviorY: 'contain'` prevents browser's native pull-to-refresh

**Used on pages**: Home, Lists, Individual List, Profile, Notifications

---

## Adding a New Component

1. Create file in appropriate category
2. Add `'use client'` if interactive
3. Use `memo()` if it's a list item
4. Add effect cleanup for async operations
5. Use `cn()` for conditional classes
6. Follow neo-brutalist styling conventions
7. Test on iOS Safari if using modals/inputs
