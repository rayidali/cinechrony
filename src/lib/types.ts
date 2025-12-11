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
};

// Search result from TMDB (used when adding movies)
export type SearchResult = {
  id: string;
  title: string;
  year: string;
  posterUrl: string;
  posterHint: string;
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
