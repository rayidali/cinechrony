# App Routes - Claude Code Reference

## Route Structure

```
src/app/
├── page.tsx              # Landing page (redirects to /home or /login)
├── layout.tsx            # Root layout (ThemeProvider, FirebaseProvider, etc.)
├── globals.css           # Global styles + Tailwind
├── actions.ts            # ⭐ ALL Server Actions (see below)
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
├── profile/
│   ├── page.tsx          # Current user profile (protected)
│   └── [username]/
│       ├── page.tsx      # Public profile view
│       └── lists/[listId]/page.tsx  # Public list view
│
├── invite/[code]/page.tsx  # Invite acceptance (protected)
│
└── api/admin/
    ├── backfill/route.ts         # User search fields backfill
    └── backfill-movies/route.ts  # Movie denormalization backfill
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

### Collaboration
| Function | Purpose |
|----------|---------|
| `getListMembers()` | Get owner + collaborators |
| `inviteToList()` | Send direct invite |
| `createInviteLink()` | Create shareable link |
| `getInviteByCode()` | Get invite by code |
| `getMyPendingInvites()` | User's pending invites |
| `acceptInvite()` | Accept collaboration invite |
| `declineInvite()` | Decline invite |
| `revokeInvite()` | Owner revokes invite |
| `removeCollaborator()` | Owner removes collaborator |
| `leaveList()` | Collaborator leaves |
| `transferOwnership()` | Transfer list ownership |

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
| `createReview()` | Create movie review |
| `updateReview()` | Edit review text |
| `deleteReview()` | Delete review |
| `getMovieReviews()` | Get reviews for movie |
| `getUserReviewForMovie()` | Get user's review |
| `likeReview()` | Like a review |
| `unlikeReview()` | Unlike a review |
| `createOrUpdateRating()` | Set 1-10 rating |
| `deleteRating()` | Remove rating |
| `getUserRating()` | Get user's rating |
| `getUserRatings()` | Get all user's ratings |

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

### `/lists/[listId]` Page
- Uses Vaul drawer for movie details modal
- Real-time subscription to movies collection
- Filter tabs: "To Watch" / "Watched"
- View modes: Grid / List / Cards

### `/profile/[username]` Page
- Public profile view (no auth required)
- Shows bio, followers/following counts
- Shows public lists only
- Follow/unfollow button for logged-in users

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
