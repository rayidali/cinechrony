"use server";

import { revalidatePath } from "next/cache";
import type { Movie, SearchResult, User } from "@/lib/types";

// --- MOCK DATABASE ---

let movies: Movie[] = [
    {
        id: '1',
        title: 'Pulp Fiction',
        year: '1994',
        posterUrl: 'https://picsum.photos/seed/pulp/500/750',
        posterHint: 'movie poster',
        addedBy: 'User A',
        status: 'To Watch',
        socialLink: 'https://www.tiktok.com/tag/pulpfiction'
    },
    {
        id: '2',
        title: 'The Grand Budapest Hotel',
        year: '2014',
        posterUrl: 'https://picsum.photos/seed/budapest/500/750',
        posterHint: 'movie poster',
        addedBy: 'User B',
        status: 'To Watch',
    },
    {
        id: '3',
        title: 'Inception',
        year: '2010',
        posterUrl: 'https://picsum.photos/seed/inception/500/750',
        posterHint: 'movie poster',
        addedBy: 'User A',
        status: 'Watched',
    },
    {
        id: '4',
        title: 'Parasite',
        year: '2019',
        posterUrl: 'https://picsum.photos/seed/parasite/500/750',
        posterHint: 'movie poster',
        addedBy: 'User B',
        status: 'Watched',
        socialLink: 'https://www.instagram.com/explore/tags/parasitemovie/'
    },
];

let searchResults: SearchResult[] = [
    { id: '101', title: 'Star Wars: A New Hope', year: '1977', posterUrl: 'https://picsum.photos/seed/starwars4/500/750', posterHint: 'movie poster' },
    { id: '102', title: 'The Empire Strikes Back', year: '1980', posterUrl: 'https://picsum.photos/seed/starwars5/500/750', posterHint: 'movie poster' },
    { id: '103', title: 'Return of the Jedi', year: '1983', posterUrl: 'https://picsum.photos/seed/starwars6/500/750', posterHint: 'movie poster' },
];

// --- SERVER ACTIONS ---

export async function getMovies(): Promise<Movie[]> {
  // In a real app, you'd fetch this from a database.
  return Promise.resolve(movies);
}

export async function searchMovies(query: string): Promise<SearchResult[]> {
  if (!query) return [];
  // In a real app, this would call the TMDB API.
  // Here, we just filter our mock results.
  const filteredResults = searchResults.filter(movie => 
    movie.title.toLowerCase().includes(query.toLowerCase())
  );
  return Promise.resolve(filteredResults.length > 0 ? filteredResults : searchResults);
}

export async function addMovie(formData: FormData) {
  try {
    const movieData = JSON.parse(formData.get("movieData") as string) as SearchResult;
    const addedBy = formData.get("addedBy") as User;
    const socialLink = formData.get("socialLink") as string;
    
    if (!movieData || !addedBy) {
        throw new Error("Missing movie data or user.");
    }

    const newMovie: Movie = {
      id: movieData.id,
      title: movieData.title,
      year: movieData.year,
      posterUrl: movieData.posterUrl,
      posterHint: movieData.posterHint,
      addedBy: addedBy,
      socialLink: socialLink || undefined,
      status: 'To Watch',
    };
    
    // Prevent adding duplicates
    if (!movies.some(m => m.id === newMovie.id)) {
        movies.unshift(newMovie);
    }

  } catch (error) {
    console.error("Failed to add movie:", error);
    // In a real app, you might return an error state.
  }
  
  revalidatePath("/");
}

export async function toggleWatchStatus(movieId: string) {
    const movie = movies.find(m => m.id === movieId);
    if (movie) {
        movie.status = movie.status === 'To Watch' ? 'Watched' : 'To Watch';
    }
    revalidatePath('/');
}
