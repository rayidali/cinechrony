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
│   ├── review-card.tsx         # Single review display
│   ├── rating-slider.tsx       # 1-10 slider with HSL colors
│   ├── rate-on-watch-modal.tsx # Prompt to rate after watching
│   └── write-review-input.tsx  # Review composer
│
├── Lists & Collaboration
│   ├── list-card.tsx           # List preview card
│   ├── list-header.tsx         # List title + actions
│   ├── list-collaborators.tsx  # Show collaborator avatars
│   ├── list-settings-modal.tsx # List settings drawer
│   └── invite-collaborator-modal.tsx
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
All movie cards use `React.memo` with effect cleanup:

```typescript
export const MovieCardGrid = memo(function MovieCardGrid({ movie, onOpenDetails }) {
  const [userRating, setUserRating] = useState<number | null>(null);

  // Memoize computed values
  const ratingStyle = useMemo(() => getRatingStyle(userRating), [userRating]);
  const notesEntries = useMemo(
    () => movie.notes ? Object.entries(movie.notes) : [],
    [movie.notes]
  );

  // Effect with cancellation
  useEffect(() => {
    let cancelled = false;
    async function fetchUserRating() {
      const result = await getUserRating(user.uid, tmdbId);
      if (!cancelled && result.rating) {
        setUserRating(result.rating.rating);
      }
    }
    fetchUserRating();
    return () => { cancelled = true; };
  }, [user?.uid, tmdbId]);

  // ...
});
```

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
- Keeps drawer stable while typing
- Auto-focuses input on open

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

## Adding a New Component

1. Create file in appropriate category
2. Add `'use client'` if interactive
3. Use `memo()` if it's a list item
4. Add effect cleanup for async operations
5. Use `cn()` for conditional classes
6. Follow neo-brutalist styling conventions
7. Test on iOS Safari if using modals/inputs
