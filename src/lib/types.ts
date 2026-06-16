// User ID type (Firebase Auth UID)
export type UserId = string;

// User profile stored in Firestore
export type UserProfile = {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  username: string | null; // Unique username for searching/following
  bio: string | null; // User's bio/about text
  createdAt: Date;
  followersCount: number;
  followingCount: number;
  favoriteMovies?: FavoriteMovie[]; // Top 5 favorite movies
  onboardingComplete?: boolean; // Whether user has completed onboarding
};

// Onboarding step types
export type OnboardingStep =
  | 'splash'
  | 'signup'
  | 'username'
  | 'import-options'
  | 'import-paste'
  | 'import-paste-confirm'
  | 'import-letterboxd'
  | 'import-letterboxd-guide'
  | 'import-letterboxd-upload'
  | 'import-letterboxd-preview'
  | 'find-friends'
  | 'complete';

// Parsed movie from paste input
export type ParsedMovie = {
  originalLine: string;
  title: string;
  year: number | null;
};

// Matched movie from TMDB
export type MatchedMovie = {
  parsed: ParsedMovie;
  match: TMDBSearchResult | null;
  status: 'exact_match' | 'best_guess' | 'not_found';
  selected: boolean;
};

// Letterboxd CSV row
export type LetterboxdMovie = {
  Date?: string;
  Name: string;
  Year: string;
  'Letterboxd URI'?: string;
  Rating?: string;
  Review?: string; // Review text (from reviews.csv)
};

// Letterboxd list (from lists/ folder in export)
export type LetterboxdList = {
  name: string; // List name (from filename)
  description?: string; // List description (from first row or notes)
  movies: LetterboxdMovie[];
};

// A favorite movie (for profile display)
export type FavoriteMovie = {
  id: string;
  title: string;
  posterUrl: string;
  tmdbId: number;
};

// Follow relationship
export type Follow = {
  id: string; // Document ID (usually the followed user's ID)
  followerId: string; // User who is following
  followingId: string; // User being followed
  createdAt: Date;
};

// A movie list
export type MovieList = {
  id: string;
  name: string;
  description?: string; // Optional description/bio for the list
  createdAt: Date;
  updatedAt: Date;
  isDefault: boolean; // The first list created for a user
  isPublic: boolean; // Whether the list is visible to followers
  ownerId: string; // User who owns the list
  collaboratorIds?: string[]; // Users who can edit this list (max 10 total including owner)
  coverImageUrl?: string; // Optional custom cover image for the list
  // How the cover is rendered:
  //  - 'custom' → use coverImageUrl
  //  - 'auto'   → render a 3-poster mosaic from the first 3 movies (default)
  // Older lists (pre-v3 creator) don't have this field; treat missing as 'auto'
  // when coverImageUrl is unset, 'custom' when set.
  coverMode?: 'auto' | 'custom';
  movieCount?: number; // Cached count of movies in the list
  // Likes — server-managed (likeList/unlikeList only). Public lists can be liked.
  likes?: number;
  likedBy?: string[];
  lastLikedAt?: Date; // Recency anchor for the loved-lists showcase ranking
};

// List member role
export type ListRole = 'owner' | 'collaborator';

// List member info (for display)
export type ListMember = {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: ListRole;
};

// List invitation status
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

// List invitation
export type ListInvite = {
  id: string;
  listId: string;
  listName: string;
  listOwnerId: string; // Owner who created the list
  inviterId: string; // User who sent the invite (always owner for now)
  inviterUsername: string | null;
  inviteeId?: string; // Target user ID (for in-app invites)
  inviteeUsername?: string | null;
  inviteCode?: string; // For link-based invites
  status: InviteStatus;
  createdAt: Date;
  expiresAt?: Date; // Optional expiration for link invites
};

// A movie in a list
export type Movie = {
  id: string;
  title: string;
  year: string;
  posterUrl: string;
  posterHint: string;
  addedBy: UserId;
  socialLink?: string;
  status: 'To Watch' | 'Watched';
  createdAt?: Date;
  // Media type (movie or tv)
  mediaType?: 'movie' | 'tv';
  // Optional TMDB details (stored when adding movie)
  tmdbId?: number;
  overview?: string;
  rating?: number; // TMDB vote_average
  backdropUrl?: string;
  // Per-user notes (keyed by userId)
  notes?: Record<string, string>;
  // Denormalized note author info (populated when saving notes)
  noteAuthors?: Record<string, { username: string | null; displayName: string | null; photoURL: string | null }>;
  // Denormalized user data (populated at write time to avoid N+1 fetches)
  addedByDisplayName?: string | null;
  addedByPhotoURL?: string | null;
  addedByUsername?: string | null;
};

// Search result from TMDB (used when adding movies/tv shows)
export type SearchResult = {
  id: string;
  title: string;
  year: string;
  posterUrl: string;
  posterHint: string;
  // Media type (movie or tv)
  mediaType: 'movie' | 'tv';
  // Additional details for expanded view
  tmdbId?: number;
  overview?: string;
  rating?: number;
  backdropUrl?: string;
};

// TMDB movie credits (cast)
export type TMDBCast = {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
};

// TMDB movie credits (crew — director, writers, …)
export type TMDBCrew = {
  id: number;
  name: string;
  job: string; // 'Director', 'Writer', 'Screenplay', …
  department: string;
  profile_path: string | null;
};

// TMDB movie details response
export type TMDBMovieDetails = {
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
  production_companies?: Array<{ id: number; name: string; logo_path: string | null }>;
  production_countries?: Array<{ iso_3166_1: string; name: string }>;
  credits?: {
    cast: TMDBCast[];
    crew?: TMDBCrew[];
  };
};

// Raw TMDB API movie search result
export type TMDBSearchResult = {
  adult: boolean;
  backdrop_path: string | null;
  genre_ids: number[];
  id: number;
  original_language: string;
  original_title: string;
  overview: string;
  popularity: number;
  poster_path: string | null;
  release_date: string;
  title: string;
  video: boolean;
  vote_average: number;
  vote_count: number;
};

// Raw TMDB API TV search result
export type TMDBTVSearchResult = {
  adult: boolean;
  backdrop_path: string | null;
  genre_ids: number[];
  id: number;
  original_language: string;
  original_name: string;
  overview: string;
  popularity: number;
  poster_path: string | null;
  first_air_date: string;
  name: string;
  vote_average: number;
  vote_count: number;
  origin_country: string[];
};

// TMDB TV show details response
export type TMDBTVDetails = {
  id: number;
  name: string;
  overview: string;
  first_air_date: string;
  vote_average: number;
  vote_count: number;
  poster_path: string | null;
  backdrop_path: string | null;
  number_of_seasons: number;
  number_of_episodes: number;
  episode_run_time: number[];
  genres: Array<{ id: number; name: string }>;
  status: string;
  networks: Array<{ id: number; name: string; logo_path: string | null }>;
  production_companies?: Array<{ id: number; name: string; logo_path: string | null }>;
  production_countries?: Array<{ iso_3166_1: string; name: string }>;
  credits?: {
    cast: TMDBCast[];
    crew?: TMDBCrew[];
  };
};

// A single streaming/rental provider (normalized from TMDB watch/providers,
// which is powered by JustWatch). `logoUrl` is a full TMDB image URL.
export type WatchProvider = {
  providerId: number;
  name: string;
  logoUrl: string | null;
};

// Normalized "where to watch" for one region (default US). TMDB returns
// flatrate/rent/buy buckets + a JustWatch deep-link; prices are NOT in the
// free API, so we surface providers without invented "from $X".
export type WatchProviders = {
  link: string | null;
  stream: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
};

// Movie review
export type Review = {
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
  ratingAtTime: number | null; // User's rating snapshot when this comment was posted (immutable)
  likes: number;
  likedBy: string[]; // Array of user IDs who liked this review
  // Threading support (1-level, like Instagram)
  parentId: string | null; // If this is a reply, the parent review's ID
  replyCount: number; // Number of replies to this review
  // Author-flagged spoiler — body renders behind a "tap to reveal" shield.
  hasSpoiler?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// User rating for a movie (global, one per user per movie)
export type UserRating = {
  id: string; // Format: `${userId}_${tmdbId}`
  userId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  moviePosterUrl?: string;
  rating: number; // 1.0 - 10.0 with one decimal
  createdAt: Date;
  updatedAt: Date;
};

// A single viewing event — the watch-log behind the drawer's "your history".
// One doc per watch under /users/{uid}/watches; the canonical rating still
// lives in /ratings, the public review in /reviews.
export type Watch = {
  id: string;
  userId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  moviePosterUrl: string | null;
  watchedAt: Date;
  rating: number | null; // snapshot for THIS watch (null = skipped)
  note: string | null; // optional note/quote for this watch
  ordinal: number; // 1 = first watch, 2 = rewatch no. 2, …
  createdAt: Date;
};

// Notification types
export type NotificationType =
  | 'mention'
  | 'reply'
  | 'follow'
  | 'like'
  | 'list_invite'
  | 'list_like' // Someone liked one of your public lists
  | 'post_tag' // Someone tagged you in a post
  | 'post_like' // Someone liked your post
  | 'post_comment'; // Someone commented on your post

// Notification
export type Notification = {
  id: string;
  userId: string; // Recipient
  type: NotificationType;
  // Sender info (denormalized for zero-fetch display)
  fromUserId: string;
  fromUsername: string | null;
  fromDisplayName: string | null;
  fromPhotoUrl: string | null;
  // Review context (for mention, reply, like)
  reviewId?: string;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  movieTitle?: string;
  previewText?: string; // First ~100 chars of the comment
  // List context (for list_invite)
  listId?: string;
  listOwnerId?: string;
  listName?: string;
  inviteId?: string; // For accepting/declining invites from notification
  // Post context (for post_tag / post_like / post_comment)
  postId?: string;
  // State
  read: boolean;
  createdAt: Date;
};

// Notification preferences (stored on user document)
export type NotificationPreferences = {
  // In-app notification types
  mentions: boolean;
  replies: boolean;
  likes: boolean;
  follows: boolean;
  listInvites: boolean;
  // Push notifications
  weeklyDigest: boolean;
};

// Default notification preferences
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  mentions: true,
  replies: true,
  likes: true,
  follows: true,
  listInvites: true,
  weeklyDigest: true,
};

// ============================================
// ACTIVITY FEED
// ============================================

export type ActivityType = 'added' | 'rated' | 'watched' | 'reviewed';

export type Activity = {
  id: string;
  // Who performed the action
  userId: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  // What action was performed
  type: ActivityType;
  // Movie context (denormalized for zero-fetch display)
  tmdbId: number;
  movieTitle: string;
  moviePosterUrl: string | null;
  movieYear: string;
  mediaType: 'movie' | 'tv';
  // Action-specific data
  rating?: number; // For 'rated' type (1-10)
  reviewText?: string; // For 'reviewed' type (preview)
  reviewId?: string; // For 'reviewed' type
  listId?: string; // For 'added' type
  listName?: string; // For 'added' type
  // Engagement
  likes: number;
  likedBy: string[];
  // Timestamp
  createdAt: Date;
};

// ---- User posts (LAUNCH 0.5.4) ----

// One image or video attached to a post (stored on Cloudflare R2).
// For videos, `thumbnailUrl` is a JPEG poster frame captured client-side
// at upload time — the feed renders `<video poster={thumbnailUrl}>` so iOS
// PWA doesn't show its grey default placeholder for cross-origin videos.
export type PostMedia = {
  type: 'image' | 'video';
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
};

// A tagged user, denormalized onto the post (the N+1 pattern).
export type TaggedUser = {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
};

// Who can see a post (F04 "visible to"). 'everyone' = public discovery feed;
// 'friends' = the author's mutuals (follow-back); 'close_friends' = the author's
// curated inner circle; 'only_me' = a private log. Restricted posts carry a
// write-time `audienceUids` snapshot so the feed can filter in-memory (no
// per-author relationship reads at read time).
export type PostVisibility = 'everyone' | 'friends' | 'close_friends' | 'only_me';

// Which viewing this post records (F04 "your watch").
export type PostWatchType = 'first' | 'rewatch';

// A Beli-style user post — free text + media, anchored to a film.
export type Post = {
  id: string;
  authorId: string;
  // Denormalized author (avoids per-post profile fetches)
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorPhotoURL: string | null;
  text: string;
  media: PostMedia[];
  // The film this post is about. v3+: required at write time. Older posts may
  // have null; new posts created via the v3 composer always set this.
  taggedMovie: {
    tmdbId: number;
    title: string;
    posterUrl: string | null;
    year: string;
    mediaType: 'movie' | 'tv';
  } | null;
  // Optional rating (1.0–10.0). When set, createPost also upserts the user's
  // /ratings/{uid}_{tmdbId} entry — a post becomes the unified review surface.
  rating?: number | null;
  // Friends mentioned in the post — v3+ extracted from inline @-mentions in
  // `text` rather than a separate tag list. Kept on the document for the
  // denormalized author-info that mention notifications consume, and for
  // legacy posts written by the v2 composer.
  taggedUserIds?: string[];
  taggedUsers?: TaggedUser[];
  place: string | null; // Freeform venue text — never GPS
  // F04 "your watch" — which viewing this post records + when it happened.
  // Older posts (pre-v3) have these undefined.
  watchType?: PostWatchType | null;
  watchedOn?: Date | null;
  // F04 "visible to". Missing/undefined = 'everyone' (every legacy post).
  visibility?: PostVisibility;
  // Write-time snapshot of who may see a RESTRICTED post (excludes the author,
  // who can always see their own). Absent for 'everyone'. Empty for 'only_me'.
  audienceUids?: string[];
  likes: number;
  likedBy: string[];
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
  editedAt?: Date | null;
};

// A comment on a post — 1-level threading, mirrors Review.
export type PostComment = {
  id: string;
  postId: string;
  userId: string;
  username: string | null;
  userDisplayName: string | null;
  userPhotoUrl: string | null;
  text: string;
  likes: number;
  likedBy: string[];
  parentId: string | null;
  replyCount: number;
  createdAt: Date;
};
