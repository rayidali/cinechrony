'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Search, X, Plus, Star, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { updateFavoriteMovies } from '@/app/actions';
import type { FavoriteMovie } from '@/lib/types';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w185';

const retroInputClass = "border-[3px] dark:border-2 border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] dark:focus:shadow-none focus:translate-x-0.5 focus:translate-y-0.5 dark:focus:translate-x-0 dark:focus:translate-y-0 transition-all duration-200 bg-card";
const retroButtonClass = "border-[3px] dark:border-2 border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none active:shadow-none active:translate-x-1 active:translate-y-1 dark:active:translate-x-0 dark:active:translate-y-0 transition-all duration-200";

type SearchResult = {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  vote_average: number;
};

type FavoriteMoviesPickerProps = {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  currentFavorites: FavoriteMovie[];
  onUpdate: (movies: FavoriteMovie[]) => void;
};

export function FavoriteMoviesPicker({
  isOpen,
  onClose,
  userId,
  currentFavorites,
  onUpdate,
}: FavoriteMoviesPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedMovies, setSelectedMovies] = useState<FavoriteMovie[]>(currentFavorites);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedMovies(currentFavorites);
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [isOpen, currentFavorites]);

  // Search movies
  useEffect(() => {
    const searchMovies = async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      const accessToken = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
      if (!accessToken) {
        setIsSearching(false);
        return;
      }

      try {
        const response = await fetch(
          `${TMDB_API_BASE_URL}/search/movie?query=${encodeURIComponent(searchQuery)}&include_adult=false&language=en-US&page=1`,
          {
            headers: {
              accept: 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );
        const data = await response.json();
        setSearchResults(data.results?.slice(0, 10) || []);
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsSearching(false);
      }
    };

    const debounce = setTimeout(searchMovies, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  const handleAddMovie = (movie: SearchResult) => {
    if (selectedMovies.length >= 5) {
      toast({
        variant: 'destructive',
        title: 'Maximum reached',
        description: 'You can only have 5 favorite movies.',
      });
      return;
    }

    if (selectedMovies.some((m) => m.tmdbId === movie.id)) {
      toast({
        variant: 'destructive',
        title: 'Already added',
        description: 'This movie is already in your favorites.',
      });
      return;
    }

    const newFavorite: FavoriteMovie = {
      id: `movie_${movie.id}`,
      title: movie.title,
      posterUrl: movie.poster_path
        ? `${TMDB_IMAGE_BASE_URL}${movie.poster_path}`
        : '/placeholder-poster.png',
      tmdbId: movie.id,
    };

    setSelectedMovies([...selectedMovies, newFavorite]);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleRemoveMovie = (tmdbId: number) => {
    setSelectedMovies(selectedMovies.filter((m) => m.tmdbId !== tmdbId));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await updateFavoriteMovies(userId, selectedMovies);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'Favorites Updated', description: 'Your favorite movies have been saved.' });
        onUpdate(selectedMovies);
        onClose();
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg border-[3px] border-border shadow-[8px_8px_0px_0px_hsl(var(--border))]">
        <DialogHeader>
          <DialogTitle className="text-xl font-headline flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500" />
            Top 5 Favorite Movies
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Selected Movies */}
          <div className="flex gap-2 flex-wrap min-h-[100px] p-3 bg-secondary/30 rounded-lg border-2 border-dashed border-border">
            {selectedMovies.length === 0 ? (
              <p className="text-muted-foreground text-sm w-full text-center py-6">
                Search and add up to 5 favorite movies
              </p>
            ) : (
              selectedMovies.map((movie) => (
                <div key={movie.tmdbId} className="relative group">
                  <Image
                    src={movie.posterUrl}
                    alt={movie.title}
                    width={60}
                    height={90}
                    className="rounded border-2 border-border"
                  />
                  <button
                    onClick={() => handleRemoveMovie(movie.tmdbId)}
                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Search Input */}
          {selectedMovies.length < 5 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for a movie..."
                className={`${retroInputClass} pl-10`}
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          )}

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="max-h-60 overflow-y-auto space-y-2 border-2 border-border rounded-lg p-2">
              {searchResults.map((movie) => {
                const isSelected = selectedMovies.some((m) => m.tmdbId === movie.id);
                return (
                  <div
                    key={movie.id}
                    className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                      isSelected ? 'bg-primary/20' : 'hover:bg-secondary'
                    }`}
                    onClick={() => !isSelected && handleAddMovie(movie)}
                  >
                    {movie.poster_path ? (
                      <Image
                        src={`${TMDB_IMAGE_BASE_URL}${movie.poster_path}`}
                        alt={movie.title}
                        width={40}
                        height={60}
                        className="rounded"
                      />
                    ) : (
                      <div className="w-10 h-15 bg-muted rounded flex items-center justify-center">
                        <Star className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{movie.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {movie.release_date?.split('-')[0] || 'Unknown'}
                        {movie.vote_average > 0 && ` • ${movie.vote_average.toFixed(1)}`}
                      </p>
                    </div>
                    {isSelected ? (
                      <span className="text-xs text-primary font-medium">Added</span>
                    ) : (
                      <Plus className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Save Button */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className={retroButtonClass}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className={`${retroButtonClass} bg-primary text-primary-foreground`}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Favorites'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
