# App Routes - Claude Code Reference

## Route Structure

```
src/app/
├── page.tsx              # Landing page (redirects to /home or /login)
├── layout.tsx            # Root layout (ThemeProvider, FirebaseProvider, etc.)
├── globals.css           # Global styles + Tailwind
├── actions.ts            # ⭐ ALL Server Actions (~4800 lines)
│
├── (auth)/               # Auth route group (no layout nesting)
│   ├── login/page.tsx
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
├── notifications/page.tsx  # Notifications page (deferred to Phase 3)
│
├── onboarding/
│   ├── page.tsx          # Onboarding flow controller
│   └── components/
│       ├── import-letterboxd-guide-screen.tsx  # 5-step screenshot tutorial
│       ├── import-letterboxd-upload-screen.tsx
│       ├── import-letterboxd-preview-screen.tsx
│       └── ...           # Other onboarding screens
│
├── invite/[code]/page.tsx  # Invite acceptance (protected)
│
└── api/admin/
    ├── backfill/route.ts         # User search fields backfill
    ├── backfill-movies/route.ts  # Movie denormalization backfill
    └── backfill-reviews/route.ts # Review threading fields backfill
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

## Server Actions (actions.ts)

This is the **single source of truth** for all mutations. ~3000 lines organized by domain:

### User Management
| Function | Purpose |
|----------|---------|
| `createUserProfile()` | Create profile + default list on signup |
| `ensureUserProfile()` | Ensure profile exists (migration) |
| `getUserProfile()` | Get user by ID |
| `getUserByUsername()` | Get user by username |
| `updateUsername()` | Change username (validates uniqueness) |
| `updateProfilePhoto()` | Update avatar URL |
| `updateBio()` | Update user bio |
| `updateFavoriteMovies()` | Set top 5 movies |
| `searchUsers()` | Search by username/email/name |

### Follow System
| Function | Purpose |
|----------|---------|
| `followUser()` | Create follow relationship |
| `unfollowUser()` | Remove follow relationship |
| `isFollowing()` | Check if following |
| `getFollowers()` | Get user's followers |
| `getFollowing()` | Get who user follows |

### List Management
| Function | Purpose |
|----------|---------|
| `createList()` | Create new list |
| `renameList()` | Rename list |
| `updateListVisibility()` | Toggle public/private |
| `deleteList()` | Delete list + all movies |
| `getUserLists()` | Get user's owned lists |
| `getCollaborativeLists()` | Get lists user collaborates on |
| `getUserPublicLists()` | Get user's public lists |
| `getListPreview()` | Get list with cover previews |
| `canEditList()` | Check edit permission |

### Collaboration (Max 10 members per list)
| Function | Purpose |
|----------|---------|
| `getListMembers()` | Get owner + collaborators |
| `inviteToList()` | Send direct invite |
| `createInviteLink()` | Create shareable link |
| `getInviteByCode()` | Get invite by code |
| `getListPendingInvites()` | Get pending invites for a list |
| `getMyPendingInvites()` | User's pending invites |
| `acceptInvite()` | Accept collaboration invite |
| `declineInvite()` | Decline invite |
| `revokeInvite()` | Cancel pending invite (owner/collaborator) |
| `removeCollaborator()` | Owner removes collaborator |
| `leaveList()` | Collaborator leaves |
| `transferOwnership()` | Transfer list ownership |

**Note**: `MAX_LIST_MEMBERS = 10` (owner + 9 collaborators)

### Movie Operations
| Function | Purpose |
|----------|---------|
| `addMovieToList()` | Add movie to list (FormData) |
| `addMovie()` | Legacy: add to default list |
| `removeMovieFromList()` | Remove movie |
| `updateMovieStatus()` | Toggle watched/to-watch |
| `updateMovieNote()` | Update user's note on movie |
| `getPublicListMovies()` | Get movies for public list |
| `migrateMoviesToList()` | Migrate legacy movies |

### Reviews & Ratings
| Function | Purpose |
|----------|---------|
| `createReview()` | Create movie review (supports parentId for replies) |
| `updateReview()` | Edit review text |
| `deleteReview()` | Delete review |
| `getMovieReviews()` | Get top-level reviews for movie (parentId: null) |
| `getReviewReplies()` | Get replies to a review |
| `getUserReviewForMovie()` | Get user's review |
| `likeReview()` | Like a review |
| `unlikeReview()` | Unlike a review |
| `createOrUpdateRating()` | Set 1-10 rating |
| `deleteRating()` | Remove rating |
| `getUserRating()` | Get user's rating |
| `getUserRatings()` | Get all user's ratings |

### Notifications (Deferred to Phase 3)
| Function | Purpose |
|----------|---------|
| `getNotifications()` | Get user's notifications |
| `markNotificationsRead()` | Mark notifications as read |
| `getUnreadNotificationCount()` | Get count for badge |
| `createMentionNotifications()` | Internal: create @mention notifications |
| `createReplyNotification()` | Internal: create reply notification |

### Admin / Backfill
| Function | Purpose |
|----------|---------|
| `backfillMovieUserData()` | Populate denormalized user data on existing movies |

### File Uploads
| Function | Purpose |
|----------|---------|
| `uploadAvatar()` | Upload avatar to R2 |
| `uploadListCover()` | Upload list cover to R2 |
| `updateListCover()` | Update cover URL |

---

## Route-Specific Notes

### `/add` Page
- Search TMDB for movies/TV shows
- Select destination list
- Add social link (TikTok/IG/YouTube)
- Submits to `addMovieToList()` server action

### `/lists` Page
- Shows all user's lists + collaborative lists
- Extended FAB button: `[+ New List]` (pill shape with label)
- Create list modal

### `/lists/[listId]` Page
- Uses Vaul drawer for movie details modal
- Real-time subscription to movies collection
- Filter tabs: "To Watch" / "Watched"
- View modes: Grid / List / Cards
- Extended FAB button: `[+ Add]` for adding movies (pill shape with label)
- Add movie modal uses fullscreen text input for social links (iOS fix)
- Pull-to-refresh support (disabled when add movie modal is open)
- **Security**: Permission check verifies user's UID is actually in `collaboratorIds` array, not just that the list data is readable

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

### `/onboarding` Flow
- Multi-step onboarding for new users
- Letterboxd import with 5-step screenshot guide
- File upload for ZIP export from Letterboxd

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
3. **Server Actions**: Return `{ error }` or `{ success, data }` pattern
4. **Revalidation**: Call `revalidatePath()` after mutations if using RSC
