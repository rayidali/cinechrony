
"use client";

import { useState, useTransition, useEffect } from "react";
import { Search, Loader2, Plus } from "lucide-react";
import Image from "next/image";

import type { SearchResult, TMDBSearchResult } from "@/lib/types";
import { addMovie } from "@/app/actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';

async function tmdbFetch(path: string, params: Record<string, string> = {}) {
  // Use the API Key, which is the standard for client-side TMDB requests.
  const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY;
  if (!TMDB_API_KEY) {
    // This will now properly throw on the client/server where it's called.
    throw new Error('TMDB API Key is not configured in .env.local');
  }

  const url = new URL(`${TMDB_API_BASE_URL}/${path}`);
  // Add the API key to every request
  url.searchParams.append('api_key', TMDB_API_KEY);

  // Add any other params
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.append(key, value)
  );

  // The API key is sent as a query param, so the Authorization header is not needed and should be removed.
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  };

  try {
    const response = await fetch(url.toString(), options);
    if (!response.ok) {
      console.error(
        `TMDB API Error: ${response.status} ${response.statusText}`
      );
      const errorBody = await response.text();
      console.error('Error Body:', errorBody);
      return null;
    }
    return response.json();
  } catch (error) {
    console.error('Failed to fetch from TMDB:', error);
    return null;
  }
}

function formatTMDBSearchResult(result: TMDBSearchResult): SearchResult {
  const year = result.release_date ? result.release_date.split('-')[0] : 'N/A';
  return {
    id: result.id.toString(),
    title: result.title,
    year: year,
    posterUrl: result.poster_path
      ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
      : 'https://picsum.photos/seed/placeholder/500/750', // Fallback
    posterHint: 'movie poster',
  };
}


/**
 * Searches for movies on TMDB.
 */
export async function searchMovies(query: string): Promise<SearchResult[]> {
  if (!query) return [];

  const data = await tmdbFetch('search/movie', {
    query: query,
    include_adult: 'false',
    language: 'en-US',
    page: '1',
  });

  if (data && data.results) {
    return data.results.slice(0, 10).map(formatTMDBSearchResult);
  }

  return [];
}


const retroInputClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] focus:shadow-[2px_2px_0px_0px_#000] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200";
const retroButtonClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

export function AddMovieForm() {
  const { user } = useUser();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<SearchResult | null>(null);

  const [isSearching, startSearchTransition] = useTransition();
  const [isAdding, startAddingTransition] = useTransition();

  const { toast } = useToast();

  useEffect(() => {
    // Don't search if the query is empty or a movie is already selected
    if (!query.trim() || selectedMovie) {
      setResults([]);
      return;
    }

    // Set a timer to wait 300ms after the user stops typing
    const searchTimer = setTimeout(() => {
      startSearchTransition(async () => {
        const searchResults = await searchMovies(query);
        // Only update results if the query hasn't changed (to avoid race conditions)
        setResults(searchResults);
      });
    }, 300); // 300ms debounce delay

    // Clear the timer if the user types again before the 300ms is up
    return () => clearTimeout(searchTimer);
  }, [query, selectedMovie]); // Re-run this effect when the query or selectedMovie changes
  
  const handleSelectMovie = (movie: SearchResult) => {
    setSelectedMovie(movie);
    setResults([]);
    setQuery("");
  };

  const handleAddMovie = async (formData: FormData) => {
    if (!selectedMovie || !user) return;
    
    formData.append("movieData", JSON.stringify(selectedMovie));
    // Pass the user's UID instead of 'User A' or 'User B'
    formData.append("addedBy", user.uid);

    startAddingTransition(async () => {
      await addMovie(formData);
      toast({
        title: "Movie Added!",
        description: `${selectedMovie.title} has been added to your list.`,
      });
      setSelectedMovie(null);
    });
  };

  return (
    <Card className="w-full max-w-2xl bg-secondary rounded-xl border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
      <CardHeader>
        <CardTitle className="font-headline text-2xl">Add a New Film</CardTitle>
      </CardHeader>
      <CardContent>
        {!selectedMovie ? (
          <div className="space-y-4">
            <form onSubmit={(e) => e.preventDefault()} className="flex gap-2">
              <div className="relative w-full">
                <Input
                  type="text"
                  placeholder="Search for a movie (e.g., Star Wars)..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className={`${retroInputClass} pr-10`}
                  disabled={isAdding}
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  {isSearching ? <Loader2 className="animate-spin text-muted-foreground" /> : <Search className="text-muted-foreground"/>}
                </div>
              </div>
            </form>
            {results.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto p-2 bg-background rounded-lg border-[3px] border-black">
                {results.map((movie) => (
                  <button
                    key={movie.id}
                    onClick={() => handleSelectMovie(movie)}
                    className="w-full text-left p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-4"
                  >
                    <Image src={movie.posterUrl} alt={movie.title} width={40} height={60} className="rounded-sm" data-ai-hint={movie.posterHint}/>
                    <div>
                        <p className="font-bold">{movie.title}</p>
                        <p className="text-sm text-muted-foreground">{movie.year}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <form action={handleAddMovie} className="space-y-4">
            <div className="flex gap-4 items-start">
                <Image src={selectedMovie.posterUrl} alt={selectedMovie.title} width={80} height={120} className="rounded-md border-[3px] border-black shadow-[4px_4px_0px_0px_#000]" data-ai-hint={selectedMovie.posterHint}/>
                <div className="flex-grow">
                    <h3 className="text-xl font-bold font-headline">{selectedMovie.title}</h3>
                    <p className="text-muted-foreground">{selectedMovie.year}</p>
                    <Input
                        type="url"
                        name="socialLink"
                        placeholder="TikTok or Instagram link (optional)"
                        className={`mt-4 ${retroInputClass}`}
                    />
                </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSelectedMovie(null)} className="font-bold">Cancel</Button>
              <Button type="submit" className={retroButtonClass} disabled={isAdding}>
                {isAdding ? <Loader2 className="animate-spin" /> : <Plus />}
                Add to List
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
