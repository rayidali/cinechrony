// User ID type (Firebase Auth UID)
export type UserId = string;

// User profile stored in Firestore
export type UserProfile = {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  username: string | null; // Unique username for searching/following
  createdAt: Date;
  followersCount: number;
  followingCount: number;
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
  createdAt: Date;
  updatedAt: Date;
  isDefault: boolean; // The first list created for a user
  isPublic: boolean; // Whether the list is visible to followers
  ownerId: string; // User who owns the list
  collaboratorIds?: string[]; // Users who can edit this list (max 3 total including owner)
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
  credits?: {
    cast: TMDBCast[];
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
  credits?: {
    cast: TMDBCast[];
  };
};
