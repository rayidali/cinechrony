'use client';

import { useState, useTransition, useEffect, useCallback } from 'react';
import { Search, Loader2, X, Film, Tv, Instagram, Youtube, Plus, ArrowLeft, Check } from 'lucide-react';
import Image from 'next/image';
import { Drawer } from 'vaul';
import { TiktokIcon } from './icons';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import type { SearchResult, TMDBSearchResult, TMDBTVSearchResult, MovieList } from '@/lib/types';
import { addMovieToList, getUserLists } from '@/app/actions';
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

type Step = 'search' | 'preview' | 'select-list';

export function AddMovieModal({ isOpen, onClose, listId, listOwnerId, listName }: AddMovieModalProps) {
  const { user } = useUser();
  const { toast } = useToast();

  // Flow state
  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<SearchResult | null>(null);
  const [socialLink, setSocialLink] = useState('');
  const [note, setNote] = useState('');
  const [selectedListId, setSelectedListId] = useState(listId);
  const [selectedListOwnerId, setSelectedListOwnerId] = useState(listOwnerId);
  const [selectedListName, setSelectedListName] = useState(listName || '');
  const [userLists, setUserLists] = useState<MovieList[]>([]);

  const [isSearching, startSearchTransition] = useTransition();
  const [isAdding, startAddingTransition] = useTransition();
  const [isLoadingLists, setIsLoadingLists] = useState(false);

  const parsedVideo = parseVideoUrl(socialLink);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('search');
      setQuery('');
      setResults([]);
      setSelectedMovie(null);
      setSocialLink('');
      setNote('');
      setSelectedListId(listId);
      setSelectedListOwnerId(listOwnerId);
      setSelectedListName(listName || '');
    }
  }, [isOpen, listId, listOwnerId, listName]);

  // Debounced search
  useEffect(() => {
    if (!query.trim() || step !== 'search') {
      if (!query.trim()) setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      startSearchTransition(async () => {
        const searchResults = await searchAll(query);
        setResults(searchResults);
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [query, step]);

  // Load user lists when entering select-list step
  useEffect(() => {
    if (step === 'select-list' && user?.uid) {
      setIsLoadingLists(true);
      getUserLists(user.uid).then((result) => {
        if (result.lists) {
          setUserLists(result.lists);
        }
        setIsLoadingLists(false);
      });
    }
  }, [step, user?.uid]);

  const handleSelectMovie = useCallback((movie: SearchResult) => {
    setSelectedMovie(movie);
    setStep('preview');
    setQuery('');
    setResults([]);
  }, []);

  const handleBackToSearch = useCallback(() => {
    setStep('search');
    setSelectedMovie(null);
    setSocialLink('');
  }, []);

  const handleBackToPreview = useCallback(() => {
    setStep('preview');
  }, []);

  const handleProceedToListSelect = useCallback(() => {
    setStep('select-list');
  }, []);

  const handleSelectList = useCallback((list: MovieList) => {
    setSelectedListId(list.id);
    setSelectedListOwnerId(list.ownerId);
    setSelectedListName(list.name);
  }, []);

  const handleAddMovie = useCallback(async () => {
    if (!selectedMovie || !user) return;

    const formData = new FormData();
    formData.append('movieData', JSON.stringify(selectedMovie));
    formData.append('userId', user.uid);
    formData.append('listId', selectedListId);
    formData.append('listOwnerId', selectedListOwnerId);
    formData.append('status', 'To Watch');
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
          description: `${selectedMovie.title} has been added to ${selectedListName}.`,
        });
        onClose();
      }
    });
  }, [selectedMovie, user, selectedListId, selectedListOwnerId, selectedListName, socialLink, note, onClose, toast]);

  const getProviderIcon = (size: 'sm' | 'md' = 'sm') => {
    const className = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
    if (!parsedVideo?.provider) return null;
    switch (parsedVideo.provider) {
      case 'tiktok': return <TiktokIcon className={`${className} text-primary`} />;
      case 'instagram': return <Instagram className={`${className} text-primary`} />;
      case 'youtube': return <Youtube className={`${className} text-primary`} />;
      default: return null;
    }
  };

  return (
    <>
      {/* Step 1: Full-page Search */}
      <Drawer.Root open={isOpen && step === 'search'} onOpenChange={(open) => !open && onClose()}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 top-0 z-50 flex flex-col bg-background outline-none">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
              <Drawer.Title className="text-lg font-semibold">Search</Drawer.Title>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-secondary transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-border flex-shrink-0">
              <div className="relative">
                <Input
                  type="text"
                  placeholder="Search movies or TV shows..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pr-10 h-12 text-base bg-secondary/50 border-border"
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
            <div className="flex-1 overflow-y-auto min-h-0">
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
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-full flex-shrink-0">
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
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Step 2: Movie Preview Bottom Sheet */}
      <Drawer.Root open={isOpen && step === 'preview' && !!selectedMovie} onOpenChange={(open) => !open && handleBackToSearch()}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-background border-t border-border outline-none max-h-[90vh]">
            {/* Drag handle */}
            <div className="mx-auto mt-4 h-1.5 w-12 flex-shrink-0 rounded-full bg-muted-foreground/40" />

            {/* Header with back and add buttons */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
              <button
                onClick={handleBackToSearch}
                className="p-2 -ml-2 rounded-full hover:bg-secondary transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <Drawer.Title className="text-lg font-semibold">Add to List</Drawer.Title>
              <button
                onClick={handleProceedToListSelect}
                className="p-2 -mr-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>

            {selectedMovie && (
              <div className="flex-1 overflow-y-auto min-h-0">
                {/* Movie Info */}
                <div className="p-4">
                  <div className="flex gap-4">
                    <Image
                      src={selectedMovie.posterUrl}
                      alt={selectedMovie.title}
                      width={100}
                      height={150}
                      className="rounded-lg border-2 border-border shadow-md object-cover flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xl font-bold">{selectedMovie.title}</h3>
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
                      {selectedMovie.rating && selectedMovie.rating > 0 && (
                        <div className="mt-2 text-sm">
                          <span className="text-yellow-500">★</span>
                          <span className="ml-1">{selectedMovie.rating.toFixed(1)}/10</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Overview */}
                  {selectedMovie.overview && (
                    <div className="mt-4">
                      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">
                        {selectedMovie.overview}
                      </p>
                    </div>
                  )}
                </div>

                {/* Social Link Input */}
                <div className="p-4 border-t border-border">
                  <label className="text-sm font-medium mb-1 block">
                    What made you want to watch this?
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Saw a cool edit or trailer? Paste the link so others can see what got you hyped!
                  </p>
                  <div className="relative">
                    <Input
                      type="url"
                      value={socialLink}
                      onChange={(e) => setSocialLink(e.target.value)}
                      placeholder="Paste TikTok, Reel, or YouTube link..."
                      className={`bg-secondary/50 ${parsedVideo?.provider ? 'pr-10' : ''}`}
                    />
                    {parsedVideo?.provider && (
                      <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                        {getProviderIcon()}
                      </div>
                    )}
                  </div>
                  {parsedVideo?.provider ? (
                    <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                      {getProviderIcon()}
                      <span>{getProviderDisplayName(parsedVideo.provider)} video will be embedded!</span>
                    </p>
                  ) : (
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span>Works with:</span>
                      <div className="flex items-center gap-2">
                        <TiktokIcon className="h-4 w-4" />
                        <Instagram className="h-4 w-4" />
                        <Youtube className="h-4 w-4" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Bottom safe area */}
            <div className="pb-[env(safe-area-inset-bottom,0px)]" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Step 3: List Selection Bottom Sheet */}
      <Drawer.Root open={isOpen && step === 'select-list'} onOpenChange={(open) => !open && handleBackToPreview()}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[60] flex flex-col rounded-t-2xl bg-background border-t border-border outline-none max-h-[85vh]">
            {/* Drag handle */}
            <div className="mx-auto mt-4 h-1.5 w-12 flex-shrink-0 rounded-full bg-muted-foreground/40" />

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
              <button
                onClick={handleBackToPreview}
                className="p-2 -ml-2 rounded-full hover:bg-secondary transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <Drawer.Title className="text-lg font-semibold">Select List</Drawer.Title>
              <div className="w-9" /> {/* Spacer for alignment */}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {/* Note Input */}
              <div className="p-4 border-b border-border">
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Add a note (optional)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why are you adding this?"
                  rows={2}
                  maxLength={200}
                  className="w-full resize-none rounded-lg border border-border bg-secondary/50 px-4 py-2.5 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-background"
                />
              </div>

              {/* List Selection */}
              <div className="p-4">
                <p className="text-sm font-medium text-muted-foreground mb-3">Add to list</p>
                {isLoadingLists ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {userLists.map((list) => (
                      <button
                        key={list.id}
                        onClick={() => handleSelectList(list)}
                        className={`w-full text-left p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                          selectedListId === list.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50 hover:bg-secondary/50'
                        }`}
                      >
                        {/* List cover or placeholder */}
                        <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {list.coverImageUrl ? (
                            <Image
                              src={list.coverImageUrl}
                              alt={list.name}
                              width={48}
                              height={48}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Film className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{list.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {list.movieCount || 0} items
                          </p>
                        </div>
                        {selectedListId === list.id && (
                          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                            <Check className="h-4 w-4 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Save Button */}
            <div className="p-4 border-t border-border bg-background pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
              <Button
                onClick={handleAddMovie}
                disabled={isAdding || !selectedListId}
                className="w-full h-12 text-base font-semibold"
                size="lg"
              >
                {isAdding ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
