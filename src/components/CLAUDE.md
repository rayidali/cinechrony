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

---

## Home / Discover Rebuild Components (May 2026)

New components from the Phase 0.5 rebuild:

- `search-overlay.tsx` — fullscreen search (films/TV via TMDB, people, lists).
- `filter-pills.tsx` — the home feed filter row (`all · saved · friends · for you · trending`).
- `trending-strip.tsx` — TRENDING NOW: trending films + loved-list mini-cards, mixed.
- `list-like-button.tsx` — like a public list (detail + cover variants).
- `similar-movies-row.tsx` — "more like this" on the movie-detail modals.
- `recommendation-card.tsx` — "if you liked X" feed card (per-poster `+ to a list`).
- `add-to-list-sheet.tsx` — the shared "which list?" bottom sheet.
- `friends-watching-card.tsx` — the aggregated "your circle is watching" hero card.
- `card-overflow-menu.tsx` — the per-card ⋯ Vaul action sheet.
- `bookmark-button.tsx` — the save toggle (fills sage when saved).
- `post-card.tsx` — a user post in the feed.
- `post-composer.tsx` — fullscreen post composer (image+video upload, drafts).
- `post-fab.tsx` — the film-red post FAB (tap → composer, long-press → action sheet).
- `profile-overflow-menu.tsx` — block / report on another user's profile.
- `blocked-users-section.tsx` — the Settings unblock list.

`activity-feed.tsx` is now the unified home feed — it consumes a `FeedItem[]`
(activities + posts) from `getHomeFeed`/`getSavedFeed` and interleaves
recommendation + friends-watching cards. `trending-movies.tsx` was removed
(superseded by `trending-strip.tsx`). `<Fab>` gained `onLongPress`.

---

## Phase B — Capacitor native components (2026-06-08)

Four mount-once components live in the root layout. All four detect
`Capacitor.isNativePlatform()` and return null on web — they're free
on a desktop browser.

- **`auth/social-sign-in-buttons.tsx`** — Google + Apple buttons. Apple
  button only shows after hydration in a native runtime (avoids flash
  on web). Wired into `(auth)/login/page.tsx` and
  `onboarding/components/signup-screen.tsx`. Uses
  `src/lib/native-auth.ts` to route between Capacitor plugin (native)
  and `signInWithPopup` (web).
- **`native-shell-init.tsx`** — sets `StatusBar.Style.Dark` (dark icons
  on cream paper), hides the splash on React mount, hides the iOS
  keyboard accessory bar.
- **`native-push-registration.tsx`** — on first authenticated boot,
  requests notification permission, fetches the FCM token, and POSTs it
  to `/api/v1/me/push-subscription` as `{ kind: 'fcm', token, platform }`.
  Listens for `tokenReceived` so APNs/FCM rotations replace stale tokens.
- **`deep-link-handler.tsx`** — listens for `App.appUrlOpen` events from
  `@capacitor/app` plus `App.getLaunchUrl()` for cold-start taps. Strips
  the host and routes via Next.js's client router so Universal Links
  navigations feel native (no WebView reload).

Web push opt-in (`push-notification-prompt.tsx`) is unchanged — it
remains the path for desktop browser users via Service Worker + VAPID.

---

## Phase 0.7 — v3 home / feed revamp (2026-06-15)

The home page (`src/app/home/page.tsx`) is recomposed to the design
(`ios-home.jsx`): `for you · friends` tabs → search/scan → discovery rails →
the reel. New + changed components:

**Shell**
- `home-top-bar.tsx` — frosted scroll-collapsing bar; `for you · friends`
  underline tabs + bell + avatar (no `saved`; `HomeFilter = 'all' | 'friends'`).
- `v3/section.tsx` — `Section` (eyebrow → 22px lowercase title → trailing).
- `presence-pill.tsx` — "N of your circle are watching" (real friends-watching
  union; shares the `home-fw:{uid}` SWR key).
- `fab.tsx` — gained an **icon-only round variant** (omit `label`); `PostFab`
  uses it (red pencil compose FAB).

**Discovery rails** (for-you only; each hides when empty)
- `dig-in.tsx` — 4 TMDB category shelves (new/trending/popular/lowkey) as
  fanned 3-poster collages. Data: `getDigIn()` in `tmdb-client.ts` (client-direct).
- `top-watchers.tsx` — weekly leaderboard. Data: `GET /api/v1/leaderboard`
  (`leaderboard-server.ts`).
- `featured-carousel.tsx` — swipeable loved-list hero. Exports `useLovedLists()`
  (shared `home-loved-lists` cache).
- `community-lists.tsx` — gradient loved-list tiles (the lists past the
  featured 4). Reuses `useLovedLists()`.
- `seeded-gradient.ts` (lib) — deterministic cover/avatar gradient fallback.

**The reel** — now a **borderless** diary stream (no card chrome;
`divide-y divide-hair` in `activity-feed.tsx`):
- `post-card.tsx` — `PostCard`/DiaryEntry: serif caption · `MovieCell`
  (`+`→`AddToListSheet`) · `MediaGallery` (4:3 hero + thumbnail rail) ·
  heart/comment/share/bookmark.
- `activity-card.tsx` — matched to the diary language, borderless.
- `recommendation-card.tsx` — borderless "because you liked X" poster row with
  punched rating stickers (`getRatingStyle`).

`trending-strip.tsx` is **retired from home** (orphaned; safe to delete later).
Deferred (no fake data): hot-take cards (`/api/v1/reviews/highlights`, 0.7.5),
the F15–F18 "view all" detail screens.

---

## Phase 0.7 — v3 movie-drawer cluster (Wave 2, 2026-06-15)

The two detail modals were unified into one **`movie-drawer.tsx`** (`MovieDrawer`),
driven by a `{ kind: 'standalone' | 'in-list' }` context. The old
`public-movie-details-modal.tsx` + `movie-details-modal.tsx` are now **thin
adapters** over it (so every call site is untouched) — standalone = now-showing-
less eyebrow · want-to-watch · comments; in-list = `in · <list>` eyebrow ·
list-name · comments · watch-status. Built on semantic tokens → dark
("projection room") for free.

- `v3/drag-to-rate.tsx` — the big rating-coloured number + 10-segment drag bar
  (replaces `RatingSlider` inside the drawer; same `onChangeComplete` contract).
- `v3/how-was-it-sheet.tsx` (**F03**) — a **non-Vaul** top-anchored overlay
  (a textarea inside a Vaul drawer fights the iOS focus trap), shown while the
  parent drawer is closed. save logs a watch + rating + review + watched; skip
  logs the watch + watched; scrim cancels.
- Drawer sections: scores (IMDb/RT/Metacritic + awards), where to watch (TMDB
  JustWatch chips), cast & crew (incl. director), the conversation (review
  quotes), in-list list-notes, more like this, footer, `your history` (watch log).
- The header bookmark + the want-to-watch button both open `add-to-list-sheet.tsx`
  (raised to z-90 so it clears a drawer opened over the search overlay).

**Gotcha:** the repo has no ESLint, so React rules-of-hooks violations crash at
runtime, not build — keep ALL hooks above the `if (!movie) return null` early
return in `movie-drawer.tsx` (a `useMemo` below it blanked the app when opening
a film from search). `next/image` also throws on empty `src` — poster/hero fall
back to a placeholder.

---

## Phase 0.7 — Wave 3: create-a-post (F04) + thread + reel (2026-06-16)

The post-creation cluster, rebuilt to the F04/F21/F22 designs.

**Composer** — `post-composer.tsx` is now a scrollable **form** (was a
Twitter-style textarea composer): a fixed `visualViewport`-pinned surface
(z-[70], bone backdrop at z-[69], iOS file-picker scrim at z-[71]).
Sections: film cell (**optional**, tap → film picker, shows `dir. <director> ·
<year>` via the module-cached `getMovieOrTVDetails`) → **your take** (serif
textarea, **required** — a post is a written take; `canPost` gates on
`text.trim()`) → **your watch** + **your rating** (rendered only when a film is
attached: first/rewatch `Segmented` + watched-on, then `DragToRate`) → **photos
& clips** (N/10, the R2 presigned upload preserved; a **failed tile is
tap-to-retry** — the `File` is kept on the `MediaItem` for exactly this) → tag
friends → visible to. Drafts are a single auto-restored localStorage slot.

**Pickers** (all open over the composer):
- `v3/film-picker-sheet.tsx` (**F04 "pick a film"**) — Vaul bottom sheet:
  h-12 search (browse-first, no autofocus), a "recently watched" poster rail
  (`GET /api/v1/watches/recent`), and an "all films" list (now-playing by
  default, `searchTmdbMulti` when typing). Poster fallback = `seededGradient`.
- `v3/watched-on-sheet.tsx` — month-grid date picker; today/yesterday/earlier
  chips; future dates disabled (date-fns).
- `v3/tag-friends-sheet.tsx` — Vaul bottom sheet (search + following checklist +
  removable pills + live count). `onDone` (commit) is distinct from `onClose`
  (cancel); `seedFollowing` lets the close-friends manager reuse an already-
  fetched following list (no double read).
- `v3/visible-to-sheet.tsx` — audience radio (everyone / friends / close friends
  / only me) + an "edit list" affordance that reuses the friend picker bound to
  the close-friends list.

> **iOS sheet rule (nuanced):** search/text inputs historically must NOT live in
> a Vaul drawer (focus-trap) — but the shipped how-was-it-sheet proves a Vaul
> text input works in this Vaul version, so the Wave-3 pickers ARE Vaul bottom
> sheets, mitigated by **no autofocus on open** (browse-first; the keyboard only
> appears when the user taps the field). `people-sheet`/`search-overlay` remain
> fullscreen overlays for their autofocus-on-open search.

**Thread** — `app/post/[postId]/client.tsx` (F21): centered header; "N replies"
over hairlines; comment rows = mono @handle + compact relative time + serif body
+ "reply" (every row; nested replies thread under the root — the banner names
the TAPPED reply's author via a separate `replyHandle`) + a right-side like
column; sticky composer = viewer avatar + sunken pill + red circular send (↑).
The post body still reuses the Wave-1 `PostCard`.

**The reel** — `v3/reel-viewer.tsx` (F22): full-screen story viewer opened by
tapping the `PostCard` `MediaGallery` hero (the old inline `VideoTile` is
retired — the reel is the player). Header → "clip N/M" chip → media (native
video `controls`) → author + `FollowButton` → serif caption → tappable film tag
(→ movie drawer; closes the reel first) → segment progress bars (tap target
padded to ~19px). Swipe moves between segments — **disabled over a `<video>`**
so it doesn't fight the scrubber.

---

## v3 sizing standard (build to this by default)

New v3 surfaces must match the **home search overlay's** confidence — not a
smaller "webapp" feel. Defaults:

- **Search bar**: `h-12 rounded-[14px] border border-hair bg-sunken px-3.5`,
  icon `h-[18px]`, input `font-body text-[15px]`.
- **Bottom sheet**: Vaul `z-[95] rounded-t-[22px] bg-card`; handle
  `mx-auto mt-2.5 h-1 w-10`; header `px-5 py-2.5` = cancel / **title
  `text-[19px] font-headline font-bold lowercase`** / done; content `px-5`.
- **Section titles**: `text-[18px]–[19px]` (composer/sheets), `text-[22px]`
  (home `Section`) — `font-headline font-bold lowercase tracking-[-0.02em]`.
- **List rows**: `py-3`–`py-3.5`; leading = avatar `size="md"` (40px) OR
  icon-circle `h-11 w-11` (icon `h-[22px]`) OR poster chip
  `w-12 h-[72px] rounded-[10px]`; title `text-[16px]–[17px] font-headline bold
  lowercase`; meta `font-mono text-[11px] text-muted-foreground`; trailing
  `ChevronRight h-5`.
- **Posters**: composer film cell `52×76 rounded-[11px]` (title `text-[20px]`);
  reel rail `w-[108px] aspect-[2/3]`; media tiles `100×100 rounded-[14px]`.
- **Circular actions**: `h-11 w-11` (send ↑, etc.).
- **Rule of thumb**: unsure of a size → match `search-overlay.tsx`; bigger, not
  timid.

## Detail-page chrome (X-style)

A detail page (e.g. `/post/[postId]`) shows **NO bottom nav** — only its sticky
action bar (the reply composer), which rides above the iOS keyboard via a
`visualViewport` inset (`bottom: kbInset`). Tapping the post **caption** opens
the thread (PostCard `disableThreadNav` suppresses this on the detail page
itself). The reel viewer (F22) is a forced-**dark** surface (`bg-black`,
white text) on both themes; nav = tap left/right thirds + centre play/pause +
swipe; every MediaGallery tile (hero AND thumbnails) opens it at its index.

## Theme switcher — visible on every tab (2026-06-17)

Light · dark · system is a **visible** top-right control on every tab, NOT
buried in a menu (an earlier attempt hid it in the avatar dropdown — corrected).
`theme-toggle.tsx` exposes two variants:
- `variant="default"` — a bordered icon button for the frosted bars: home
  `HomeTopBar` (bell · theme · avatar) + lists `NavBar` (bell · theme · avatar).
- `variant="glass"` — a translucent dark-glass circle matching `GlassBtn`, for
  use OVER imagery: the profile `Hero` top-right.

Both open the same dropdown (light/dark/system, a `Check` on the active choice;
light haptic on tap). `Settings → Appearance` (the v3 `Segmented`) is the
secondary canonical home. `DEFAULT_THEME` (exported from `theme-provider.tsx`,
= `'light'`) is the single source for the provider default AND any pre-mount
fallback, so the two surfaces can't drift. next-themes is fully client-side
(localStorage + `.dark` class via `attribute="class"`) → behaves identically in
the Capacitor static `out/` build.

## Profile family — built to the sizing standard

`RecentRow` (profile "recent" + "activity") and `EditProfileSheet` follow the
"v3 sizing standard" above: 48×72 poster chips, 16px row titles, 11px mono meta,
h-5 chevrons (RecentRow); 19px sheet title, px-5 inset, 60px house-avatar tiles
(`justify-between`), py-3 field cards (EditProfileSheet). The selected
house-avatar ring uses `border-primary` (film-red) — on-system: the design
reserves film-red for selection/focus rings.
