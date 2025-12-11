// User ID type (Firebase Auth UID)
export type UserId = string;

// User profile stored in Firestore
export type UserProfile = {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: Date;
};

// A movie list
export type MovieList = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  isDefault: boolean; // The first list created for a user
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
  // Optional TMDB details (stored when adding movie)
  tmdbId?: number;
  overview?: string;
  rating?: number; // TMDB vote_average
  backdropUrl?: string;
};

// Search result from TMDB (used when adding movies)
export type SearchResult = {
  id: string;
  title: string;
  year: string;
  posterUrl: string;
  posterHint: string;
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

// Raw TMDB API search result
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
