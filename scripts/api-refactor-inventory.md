# API Refactor Inventory — Phase A (LAUNCH.md)

> Generated 2026-05-26 against `src/app/actions.ts` (7,791 lines).
> Source of truth for the Server Actions → API routes migration. Each row
> becomes (or maps into) one `/api/v1/...` route. Tick the **Migrated**
> column as each one ships.
>
> **103 total exports** — 50 WRITE, 32 READ_ADMIN, 4 READ_TMDB, 1 READ_OMDB,
> 4 UPLOAD, 12 INTERNAL, 0 dead. After collapsing related reads (e.g.
> `getFollowers` + `getFollowing` + `isFollowing` share a route),
> expect **~55–60 route files**.
>
> AUDIT.md hooks: 20+ Phase 1 items close as a side-effect of this migration
> (auth check + transactional fix applied per-endpoint).

---

## Migration order (by PR)

| PR | Domain | Endpoints | AUDIT items closed |
|----|--------|-----------|--------------------|
| #1 | **Foundation** | api-handler, api-client, `_whoami` smoke route, test helper | — |
| #2 | User profile | `me` (GET, PATCH), `me/username`, `me/avatar`, `me` (DELETE) | 1.2, 1.10, 2.3a |
| #3 | Lists | `lists` (POST), `lists/[id]` (PATCH, DELETE), `lists/[id]/transfer`, `lists/[id]/cover` | 1.3, 1.5, 2.1 |
| #4 | Movies in lists | `lists/[id]/movies` (POST), `lists/[id]/movies/[mid]` (DELETE, status, note, social-link) | 1.6, 2.2 |
| #5 | Invites | `invites` (POST), `invites/link`, `invites/[code]` (GET, accept, decline), `invites/[id]` (DELETE) | 1.11, 1.12, 1.14, 2.1, 2.9 |
| #6 | Collaborators | `lists/[id]/collaborators/[uid]` (DELETE), `lists/[id]/leave` | 1.4 |
| #7 | Follows | `users/[uid]/follow` (POST, DELETE), `users/[uid]/followers`, `users/[uid]/following` | 3.8 |
| #8 | Reviews + ratings | `reviews` (POST), `reviews/[id]` (PATCH, DELETE, like), `reviews?tmdbId=`, `ratings` | 2.5, 2.6, 3.5, 3.10 |
| #9 | Activities + posts | `activities`, `activities/[id]/like`, `posts` (CRUD), `posts/[id]/like`, post comments | — |
| #10 | Notifications + push | `notifications`, `notifications/read`, `me/push-subscription`, `me/notification-preferences` | 4.2 |
| #11 | Search + TMDB/OMDB | `users/search`, `movies/search`, `movies/[id]`, `movies/[id]/imdb-rating`, trending, similar, recs | 2.8 |
| #12 | Bookmarks + safety | `bookmarks`, `mutes`, `blocks` (via `getMyBlockContext`), `reports`, friends-watching, home-feed, saved-feed | — |
| #13 | Admin + backfills | Existing `/api/admin/*` rehomed under `/api/v1/admin/*` with strict ADMIN_SECRET | 1.8 |
| #14 | Static export | `output: 'export'` in next.config.ts, dynamic-route SPA fallback | — |

PR #1 (this one) ships the foundation only — no behavior change.

---

## Full inventory

Legend:
- **WRITE** — mutation via Admin SDK (must become API route)
- **READ_ADMIN** — server-only read (must become API route)
- **READ_TMDB** / **READ_OMDB** — external API proxy
- **UPLOAD** — handles file body / signed URL
- **INTERNAL** — called by other actions only (stays internal; not a route)

| Line | Function | Category | Target route | AUDIT |
|------|----------|----------|--------------|-------|
| 119 | `createUserProfile` | WRITE | `POST /api/v1/me/profile` (or auto on signup) | 1.9 |
| 129 | `ensureUserProfile` | WRITE | `POST /api/v1/me/ensure` | 1.9 |
| 221 | `createList` | WRITE | `POST /api/v1/lists` | — |
| 331 | `renameList` | WRITE | `PATCH /api/v1/lists/[id]` (name) | — |
| 363 | `updateListDescription` | WRITE | `PATCH /api/v1/lists/[id]` (description) | — |
| 395 | `updateListVisibility` | WRITE | `PATCH /api/v1/lists/[id]` (isPublic) | — |
| 428 | `deleteList` | WRITE | `DELETE /api/v1/lists/[id]` | — |
| 492 | `addMovieToList` | WRITE | `POST /api/v1/lists/[id]/movies` | 2.2 |
| 629 | `removeMovieFromList` | WRITE | `DELETE /api/v1/lists/[id]/movies/[mid]` | 2.2 |
| 682 | `updateMovieStatus` | WRITE | `PATCH /api/v1/lists/[id]/movies/[mid]/status` | — |
| 757 | `updateMovieNote` | WRITE | `PATCH /api/v1/lists/[id]/movies/[mid]/note` | 1.6 |
| 839 | `migrateMoviesToList` | WRITE | (legacy — delete after PR #2) | 1.7 |
| 889 | `searchUsers` | READ_ADMIN | `GET /api/v1/users/search` | 2.8 |
| 977 | `getUserProfile` | READ_ADMIN | `GET /api/v1/users/[uid]` | — |
| 1017 | `getUserByUsername` | READ_ADMIN | `GET /api/v1/users/by-username/[u]` | — |
| 1091 | `updateUsername` | WRITE | `PATCH /api/v1/me/username` | 1.10, 2.3a |
| 1158 | `deleteUserAccount` | WRITE | `DELETE /api/v1/me` | 1.2 |
| 1359 | `followUser` | WRITE | `POST /api/v1/users/[uid]/follow` | 3.8 |
| 1467 | `unfollowUser` | WRITE | `DELETE /api/v1/users/[uid]/follow` | — |
| 1511 | `isFollowing` | READ_ADMIN | (folded into profile fetch) | — |
| 1532 | `getFollowers` | READ_ADMIN | `GET /api/v1/users/[uid]/followers` | — |
| 1584 | `getFollowing` | READ_ADMIN | `GET /api/v1/users/[uid]/following` | — |
| 1636 | `getUserPublicLists` | READ_ADMIN | `GET /api/v1/users/[uid]/lists` | — |
| 1756 | `getLovedLists` | READ_ADMIN | `GET /api/v1/lists/loved` | — |
| 1802 | `searchPublicLists` | READ_ADMIN | `GET /api/v1/lists/search` | — |
| 1828 | `getPublicListMovies` | READ_ADMIN | `GET /api/v1/lists/[id]/movies` | — |
| 1916 | `toggleListVisibility` | WRITE | (folded into `PATCH /api/v1/lists/[id]`) | — |
| 1957 | `backfillEmailPrivacy` | INTERNAL | admin-only | 1.9 |
| 2000 | `backfillUserSearchFields` | INTERNAL | admin-only | 2.8 |
| 2082 | `canEditList` | INTERNAL | helper — stays internal | — |
| 2097 | `getListMembers` | READ_ADMIN | `GET /api/v1/lists/[id]/members` | — |
| 2140 | `inviteToList` | WRITE | `POST /api/v1/invites` | 3.8 |
| 2254 | `createInviteLink` | WRITE | `POST /api/v1/invites/link` | 2.9 |
| 2322 | `getInviteByCode` | READ_ADMIN | `GET /api/v1/invites/[code]` (auth required) | 2.9 |
| 2368 | `getMyPendingInvites` | READ_ADMIN | `GET /api/v1/me/invites` | — |
| 2403 | `getListPendingInvites` | READ_ADMIN | `GET /api/v1/lists/[id]/invites` | 1.14 |
| 2466 | `acceptInvite` | WRITE | `POST /api/v1/invites/[code]/accept` | 1.11, 2.1 |
| 2574 | `declineInvite` | WRITE | `POST /api/v1/invites/[id]/decline` | — |
| 2626 | `revokeInvite` | WRITE | `DELETE /api/v1/invites/[id]` | 1.12 |
| 2668 | `removeCollaborator` | WRITE | `DELETE /api/v1/lists/[id]/collaborators/[uid]` | 1.4 |
| 2711 | `leaveList` | WRITE | `POST /api/v1/lists/[id]/leave` | — |
| 2756 | `transferOwnership` | WRITE | `POST /api/v1/lists/[id]/transfer` | 1.3, 2.1 |
| 2896 | `getUserLists` | READ_ADMIN | `GET /api/v1/me/lists` | — |
| 2933 | `getCollaborativeLists` | READ_ADMIN | `GET /api/v1/me/collaborative-lists` | — |
| 2997 | `uploadAvatar` | UPLOAD | `POST /api/v1/me/avatar` | — |
| 3096 | `updateProfilePhoto` | WRITE | (folded into `PATCH /api/v1/me`) | — |
| 3125 | `updateBio` | WRITE | (folded into `PATCH /api/v1/me`) | — |
| 3154 | `updateFavoriteMovies` | WRITE | (folded into `PATCH /api/v1/me`) | — |
| 3184 | `getListPreview` | READ_ADMIN | `GET /api/v1/lists/[id]/preview` | 1.13 |
| 3252 | `getListsPreviews` | READ_ADMIN | `POST /api/v1/lists/preview-batch` | 1.13 |
| 3283 | `uploadListCover` | UPLOAD | `POST /api/v1/lists/[id]/cover` | 1.5 |
| 3426 | `updateListCover` | WRITE | (folded into `POST /api/v1/lists/[id]/cover`) | 1.5 |
| 3466 | `createReview` | WRITE | `POST /api/v1/reviews` | 2.16 |
| 3617 | `getMovieReviews` | READ_ADMIN | `GET /api/v1/reviews?tmdbId=` | 3.10 |
| 3671 | `getReviewReplies` | READ_ADMIN | `GET /api/v1/reviews/[id]/replies` | — |
| 3714 | `likeReview` | WRITE | `POST /api/v1/reviews/[id]/like` | 3.5, 3.8 |
| 3793 | `unlikeReview` | WRITE | `DELETE /api/v1/reviews/[id]/like` | 3.5 |
| 3836 | `likeList` | WRITE | `POST /api/v1/lists/[id]/like` | 3.5, 3.8 |
| 3910 | `unlikeList` | WRITE | `DELETE /api/v1/lists/[id]/like` | 3.5 |
| 3944 | `deleteReview` | WRITE | `DELETE /api/v1/reviews/[id]` | — |
| 3976 | `updateReview` | WRITE | `PATCH /api/v1/reviews/[id]` | 2.6 |
| 4018 | `getUserReviewForMovie` | READ_ADMIN | `GET /api/v1/reviews/by-user?userId=&tmdbId=` | — |
| 4067 | `createOrUpdateRating` | WRITE | `POST /api/v1/ratings` | — |
| 4156 | `getUserRating` | READ_ADMIN | `GET /api/v1/ratings?userId=&tmdbId=` | — |
| 4190 | `deleteRating` | WRITE | `DELETE /api/v1/ratings/[tmdbId]` | — |
| 4223 | `getUserRatings` | READ_ADMIN | `GET /api/v1/users/[uid]/ratings` | 2.5 |
| 4285 | `checkUsernameAvailability` | READ_ADMIN | `GET /api/v1/usernames/[u]` | — |
| 4326 | `createUserProfileWithUsername` | WRITE | (folded into `POST /api/v1/me/profile`) | — |
| 4424 | `parseAndMatchMovies` | READ_TMDB | `POST /api/v1/movies/match-text` | — |
| 4533 | `importMatchedMovies` | WRITE | `POST /api/v1/import/matched` | — |
| 4665 | `parseLetterboxdExport` | INTERNAL | helper used by importer | — |
| 4886 | `importLetterboxdMovies` | WRITE | `POST /api/v1/import/letterboxd` | 2.2 |
| 5371 | `backfillMovieUserData` | INTERNAL | admin-only | 1.8 |
| 5508 | `backfillReviewsThreading` | INTERNAL | admin-only | — |
| 5693 | `getNotifications` | READ_ADMIN | `GET /api/v1/notifications` | — |
| 5751 | `markNotificationsRead` | WRITE | `POST /api/v1/notifications/read` | — |
| 5793 | `getUnreadNotificationCount` | READ_ADMIN | `GET /api/v1/notifications/unread-count` | — |
| 5816 | `savePushSubscription` | WRITE | `POST /api/v1/me/push-subscription` | 3.8 |
| 5878 | `removePushSubscription` | WRITE | `DELETE /api/v1/me/push-subscription` | — |
| 5923 | `getPushStatus` | READ_ADMIN | `GET /api/v1/me/push-status` | — |
| 5943 | `getNotificationPreferences` | READ_ADMIN | `GET /api/v1/me/notification-preferences` | — |
| 5976 | `updateNotificationPreferences` | WRITE | `PATCH /api/v1/me/notification-preferences` | — |
| 6086 | `getImdbRating` | READ_OMDB | `GET /api/v1/movies/imdb-rating?imdbId=` | — |
| 6127 | `getTrendingMovies` | READ_TMDB | `GET /api/v1/movies/trending` | — |
| 6183 | `getSimilarMovies` | READ_TMDB | `GET /api/v1/movies/[tmdbId]/similar` | — |
| 6250 | `getRecommendationsForUser` | READ_TMDB | `GET /api/v1/movies/[tmdbId]/recommendations` | — |
| 6301 | `createActivity` | INTERNAL | helper — stays internal | — |
| 6385 | `getActivityFeed` | READ_ADMIN | `GET /api/v1/activities` | — |
| 6432 | `saveItem` | WRITE | `POST /api/v1/me/bookmarks` | — |
| 6452 | `unsaveItem` | WRITE | `DELETE /api/v1/me/bookmarks/[type]/[id]` | — |
| 6469 | `getMyBookmarks` | READ_ADMIN | `GET /api/v1/me/bookmarks` | — |
| 6492 | `getSavedFeed` | READ_ADMIN | `GET /api/v1/me/saved-feed` | — |
| 6564 | `muteUser` | WRITE | `POST /api/v1/me/mutes/[uid]` | — |
| 6582 | `unmuteUser` | WRITE | `DELETE /api/v1/me/mutes/[uid]` | — |
| 6599 | `getMyMutes` | READ_ADMIN | `GET /api/v1/me/mutes` | — |
| 6633 | `getFriendsWatching` | READ_ADMIN | `GET /api/v1/movies/[tmdbId]/friends-watching` | — |
| 6702 | `isBlockedBetween` | INTERNAL | helper | — |
| 6716 | `getBlockSet` | INTERNAL | helper | — |
| 6736 | `blockUser` | WRITE | `POST /api/v1/me/blocks/[uid]` | — |
| 6794 | `unblockUser` | WRITE | `DELETE /api/v1/me/blocks/[uid]` | — |
| 6812 | `getMyBlockContext` | READ_ADMIN | `GET /api/v1/me/block-context` | — |
| 6833 | `getBlockedUsers` | READ_ADMIN | (folded into block context) | — |
| 6904 | `getPostMediaUploadUrl` | UPLOAD | `POST /api/v1/posts/media-upload-url` | — |
| 6994 | `createPost` | WRITE | `POST /api/v1/posts` | — |
| 7160 | `updatePost` | WRITE | `PATCH /api/v1/posts/[id]` | — |
| 7245 | `deletePost` | WRITE | `DELETE /api/v1/posts/[id]` | — |
| 7265 | `getPost` | READ_ADMIN | `GET /api/v1/posts/[id]` | — |
| 7296 | `getHomeFeed` | READ_ADMIN | `GET /api/v1/home-feed` | — |
| 7353 | `likePost` | WRITE | `POST /api/v1/posts/[id]/like` | 3.8 |
| 7408 | `unlikePost` | WRITE | `DELETE /api/v1/posts/[id]/like` | — |
| 7442 | `createPostComment` | WRITE | `POST /api/v1/posts/[id]/comments` | — |
| 7538 | `getPostComments` | READ_ADMIN | `GET /api/v1/posts/[id]/comments` | — |
| 7582 | `deletePostComment` | WRITE | `DELETE /api/v1/posts/[id]/comments/[cid]` | — |
| 7617 | `likePostComment` | WRITE | `POST /api/v1/posts/[id]/comments/[cid]/like` | 3.8 |
| 7646 | `unlikePostComment` | WRITE | `DELETE /api/v1/posts/[id]/comments/[cid]/like` | — |
| 7675 | `likeActivity` | WRITE | `POST /api/v1/activities/[id]/like` | 3.5, 3.8 |
| 7717 | `unlikeActivity` | WRITE | `DELETE /api/v1/activities/[id]/like` | 3.5 |
| 7760 | `reportContent` | WRITE | `POST /api/v1/reports` | — |

---

## Notes for the migration

1. **`isFollowing` collapses.** It's just a derived boolean — `GET /api/v1/users/[uid]` can return `viewerIsFollowing` when the viewer is authed. No standalone route needed.
2. **`updateProfilePhoto` / `updateBio` / `updateFavoriteMovies` collapse into `PATCH /api/v1/me`.** One JSON-merge endpoint replaces three.
3. **`updateListVisibility` / `renameList` / `updateListDescription` collapse into `PATCH /api/v1/lists/[id]`** for the same reason.
4. **`migrateMoviesToList`** is one-shot legacy migration — delete it during PR #2 unless usage analysis shows it's still firing.
5. **`getInviteByCode`** must require auth (currently doesn't — AUDIT 2.9 enumeration vector). Adding auth makes the client login-walled before invite acceptance, which is fine — the existing `/invite/[code]` page already prompts login.
6. **R2 uploads.** `uploadAvatar` and `uploadListCover` are FormData today (token in the body). The migration moves to two patterns:
   - Small images (avatar): JSON body with base64 — keeps things uniform (already what the client does post avatar-compress).
   - Large media (post images, video): presigned R2 PUT via `getPostMediaUploadUrl` — already the right pattern, just rename the route.
7. **Static-export gotcha (Phase A.5).** `/lists/[listId]`, `/profile/[username]`, `/movie/[tmdbId]/comments` are dynamic on user content. Pure `output: 'export'` needs SPA-fallback at the host level OR a client-rendered catch-all. Capacitor's WKWebView config handles this for native; for the web build we'll need either Cloudflare Pages `_redirects` or a Vercel rewrite to `index.html`. Flagged for PR #14.

---

## Test pattern (every endpoint)

Per LAUNCH.md A.3 footer: each route gets a `scripts/audit-tests/<NN>-<route>.test.ts` covering:

- Unauthenticated → 401
- Wrong-user authenticated → 403 (where ownership applies)
- Correct user → 200 + assertion on side effects
- Invalid input → 400

Test helper: `scripts/audit-tests/lib/route-call.ts` (added in PR #1). All endpoint tests use it.
