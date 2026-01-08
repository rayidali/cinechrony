'use client';

import { useState, useTransition, useEffect, useCallback } from 'react';
import { Search, Loader2, X, Film, Tv, Instagram, Youtube, Plus, Bookmark, Check } from 'lucide-react';
import Image from 'next/image';
import { Drawer } from 'vaul';
import { TiktokIcon } from './icons';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import type { SearchResult, TMDBSearchResult, TMDBTVSearchResult } from '@/lib/types';
import { addMovieToList } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';

async function tmdbFetch(path: string, params: Record<string, string> = {}) {
  const accessToken = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  if (!accessToken) return null;

  const url = new URL(`${TMDB_API_BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url.toString(), {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function formatMovieSearchResult(result: TMDBSearchResult): SearchResult {
  const year = result.release_date ? result.release_date.split('-')[0] : 'N/A';
  return {
    id: result.id.toString(),
    title: result.title,
    year,
    posterUrl: result.poster_path
      ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
      : 'https://picsum.photos/seed/placeholder/500/750',
    posterHint: 'movie poster',
    mediaType: 'movie',
    overview: result.overview,
    rating: result.vote_average,
  };
}

function formatTVSearchResult(result: TMDBTVSearchResult): SearchResult {
  const year = result.first_air_date ? result.first_air_date.split('-')[0] : 'N/A';
  return {
    id: result.id.toString(),
    title: result.name,
    year,
    posterUrl: result.poster_path
      ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
      : 'https://picsum.photos/seed/placeholder/500/750',
    posterHint: 'tv show poster',
    mediaType: 'tv',
    overview: result.overview,
    rating: result.vote_average,
  };
}

async function searchAll(query: string): Promise<SearchResult[]> {
  if (!query) return [];

  const [moviesData, tvData] = await Promise.all([
    tmdbFetch('search/movie', { query, include_adult: 'false', language: 'en-US', page: '1' }),
    tmdbFetch('search/tv', { query, include_adult: 'false', language: 'en-US', page: '1' }),
  ]);

  const movies = moviesData?.results?.slice(0, 10).map(formatMovieSearchResult) || [];
  const tvShows = tvData?.results?.slice(0, 10).map(formatTVSearchResult) || [];

  // Interleave results
  const combined: SearchResult[] = [];
  const maxLength = Math.max(movies.length, tvShows.length);
  for (let i = 0; i < maxLength; i++) {
    if (i < movies.length) combined.push(movies[i]);
    if (i < tvShows.length) combined.push(tvShows[i]);
  }
  return combined.slice(0, 15);
}

interface AddMovieModalProps {
  isOpen: boolean;
  onClose: () => void;
  listId: string;
  listOwnerId: string;
  listName?: string;
}

export function AddMovieModal({ isOpen, onClose, listId, listOwnerId, listName }: AddMovieModalProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<SearchResult | null>(null);
  const [socialLink, setSocialLink] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'To Watch' | 'Watched'>('To Watch');
  const [isSearching, startSearchTransition] = useTransition();
  const [isAdding, startAddingTransition] = useTransition();

  const parsedVideo = parseVideoUrl(socialLink);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setSelectedMovie(null);
      setSocialLink('');
      setNote('');
      setStatus('To Watch');
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!query.trim() || selectedMovie) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      startSearchTransition(async () => {
        const searchResults = await searchAll(query);
        setResults(searchResults);
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [query, selectedMovie]);

  const handleSelectMovie = useCallback((movie: SearchResult) => {
    setSelectedMovie(movie);
    setResults([]);
    setQuery('');
  }, []);

  const handleBack = useCallback(() => {
    setSelectedMovie(null);
    setSocialLink('');
    setNote('');
    setStatus('To Watch');
  }, []);

  const handleAddMovie = useCallback(async () => {
    if (!selectedMovie || !user) return;

    const formData = new FormData();
    formData.append('movieData', JSON.stringify(selectedMovie));
    formData.append('userId', user.uid);
    formData.append('listId', listId);
    formData.append('listOwnerId', listOwnerId);
    formData.append('status', status);
    if (socialLink) formData.append('socialLink', socialLink);
    if (note) formData.append('note', note);

    startAddingTransition(async () => {
      const result = await addMovieToList(formData);
      const itemType = selectedMovie.mediaType === 'tv' ? 'TV Show' : 'Movie';

      if (result?.error) {
        toast({
          variant: 'destructive',
          title: `Error adding ${itemType.toLowerCase()}`,
          description: result.error,
        });
      } else {
        toast({
          title: `${itemType} Added!`,
          description: `${selectedMovie.title} has been added to ${listName || 'the list'}.`,
        });
        onClose();
      }
    });
  }, [selectedMovie, user, listId, listOwnerId, status, socialLink, note, listName, onClose, toast]);

  const getProviderIcon = () => {
    if (!parsedVideo?.provider) return null;
    switch (parsedVideo.provider) {
      case 'tiktok': return <TiktokIcon className="h-4 w-4 text-primary" />;
      case 'instagram': return <Instagram className="h-4 w-4 text-primary" />;
      case 'youtube': return <Youtube className="h-4 w-4 text-primary" />;
      default: return null;
    }
  };

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Drawer.Content className="fixed inset-0 z-50 flex flex-col bg-background outline-none">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <Drawer.Title className="text-lg font-semibold">
              {selectedMovie ? 'Add to List' : 'Search'}
            </Drawer.Title>
            <button
              onClick={selectedMovie ? handleBack : onClose}
              className="p-2 rounded-full hover:bg-secondary transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {!selectedMovie ? (
            // Search View
            <div className="flex-1 flex flex-col min-h-0">
              {/* Search Input */}
              <div className="p-4 border-b border-border">
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Search movies or TV shows..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pr-10 h-12 text-base"
                    autoFocus
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    {isSearching ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : (
                      <Search className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </div>

              {/* Search Results */}
              <div className="flex-1 overflow-y-auto">
                {results.length === 0 && query && !isSearching ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Search className="h-12 w-12 mb-4 opacity-50" />
                    <p>No results found</p>
                  </div>
                ) : results.length === 0 && !query ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Film className="h-12 w-12 mb-4 opacity-50" />
                    <p>Search for movies or TV shows</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {results.map((movie) => (
                      <button
                        key={`${movie.mediaType}-${movie.id}`}
                        onClick={() => handleSelectMovie(movie)}
                        className="w-full text-left p-4 hover:bg-secondary/50 transition-colors flex items-center gap-4"
                      >
                        <Image
                          src={movie.posterUrl}
                          alt={movie.title}
                          width={48}
                          height={72}
                          className="rounded border border-border object-cover flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{movie.title}</p>
                          <p className="text-sm text-muted-foreground">{movie.year}</p>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-full">
                          {movie.mediaType === 'movie' ? (
                            <>
                              <Film className="h-3 w-3" />
                              <span>Movie</span>
                            </>
                          ) : (
                            <>
                              <Tv className="h-3 w-3" />
                              <span>TV</span>
                            </>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Add to List View
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
              {/* Movie Info */}
              <div className="p-4 border-b border-border">
                <div className="flex gap-4">
                  <Image
                    src={selectedMovie.posterUrl}
                    alt={selectedMovie.title}
                    width={80}
                    height={120}
                    className="rounded-lg border border-border object-cover flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-semibold">{selectedMovie.title}</h3>
                    <p className="text-muted-foreground">{selectedMovie.year}</p>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-full w-fit mt-2">
                      {selectedMovie.mediaType === 'movie' ? (
                        <>
                          <Film className="h-3 w-3" />
                          <span>Movie</span>
                        </>
                      ) : (
                        <>
                          <Tv className="h-3 w-3" />
                          <span>TV Show</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Toggle */}
              <div className="p-4 border-b border-border">
                <div className="flex rounded-full bg-secondary p-1">
                  <button
                    onClick={() => setStatus('To Watch')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-full font-medium transition-all ${
                      status === 'To Watch'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Bookmark className="h-4 w-4" />
                    To Watch
                  </button>
                  <button
                    onClick={() => setStatus('Watched')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-full font-medium transition-all ${
                      status === 'Watched'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Check className="h-4 w-4" />
                    Watched
                  </button>
                </div>
              </div>

              {/* Note Input */}
              <div className="p-4 border-b border-border">
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Add a note (optional)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What did you think? Why add this?"
                  rows={2}
                  maxLength={200}
                  className="w-full resize-none rounded-lg border border-border bg-secondary/50 px-4 py-2.5 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-background"
                />
              </div>

              {/* Social Link Input */}
              <div className="p-4 border-b border-border">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">
                  What made you want to watch this? (optional)
                </label>
                <p className="text-xs text-muted-foreground mb-2">
                  Paste a TikTok, Reel, or YouTube link
                </p>
                <div className="relative">
                  <Input
                    type="url"
                    value={socialLink}
                    onChange={(e) => setSocialLink(e.target.value)}
                    placeholder="Paste link..."
                    className={parsedVideo?.provider ? 'pr-10' : ''}
                  />
                  {parsedVideo?.provider && (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                      {getProviderIcon()}
                    </div>
                  )}
                </div>
                {parsedVideo?.provider && (
                  <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                    {getProviderIcon()}
                    <span>{getProviderDisplayName(parsedVideo.provider)} video will be embedded!</span>
                  </p>
                )}
              </div>

              {/* Adding to list indicator */}
              <div className="p-4">
                <p className="text-sm text-muted-foreground">
                  Adding to: <span className="font-medium text-foreground">{listName || 'List'}</span>
                </p>
              </div>
            </div>
          )}

          {/* Bottom Action Button */}
          {selectedMovie && (
            <div className="p-4 border-t border-border bg-background pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
              <Button
                onClick={handleAddMovie}
                disabled={isAdding}
                className="w-full h-12 text-base font-semibold"
                size="lg"
              >
                {isAdding ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-5 w-5 mr-2" />
                    Add to List
                  </>
                )}
              </Button>
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
