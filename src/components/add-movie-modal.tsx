'use client';

import { useState, useTransition, useEffect, useCallback } from 'react';
import { Search, Loader2, X, Film, Tv, Instagram, Youtube, Plus, ArrowLeft, Check, Link as LinkIcon } from 'lucide-react';
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

interface ListSelection {
  listId: string;
  listOwnerId: string;
  listName: string;
  note: string;
  coverUrl?: string | null;
}

export function AddMovieModal({ isOpen, onClose, listId, listOwnerId, listName }: AddMovieModalProps) {
  const { user } = useUser();
  const { toast } = useToast();

  // Flow state
  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<SearchResult | null>(null);
  const [socialLink, setSocialLink] = useState('');
  const [userLists, setUserLists] = useState<MovieList[]>([]);

  // Multi-list selection with per-list notes
  const [selectedLists, setSelectedLists] = useState<Map<string, ListSelection>>(new Map());

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
      setSelectedLists(new Map());
      setUserLists([]);
    }
  }, [isOpen]);

  // Initialize with current list selected when opening
  useEffect(() => {
    if (isOpen && listId && listOwnerId) {
      setSelectedLists(new Map([[listId, {
        listId,
        listOwnerId,
        listName: listName || 'List',
        note: '',
        coverUrl: null,
      }]]));
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
    if (step === 'select-list' && user?.uid && userLists.length === 0) {
      setIsLoadingLists(true);
      getUserLists(user.uid).then((result) => {
        if (result.lists) {
          setUserLists(result.lists);
          // Update the current list selection with proper cover
          const currentList = result.lists.find(l => l.id === listId);
          if (currentList) {
            setSelectedLists(prev => {
              const newMap = new Map(prev);
              const existing = newMap.get(listId);
              if (existing) {
                newMap.set(listId, {
                  ...existing,
                  coverUrl: currentList.coverImageUrl,
                  listName: currentList.name,
                });
              }
              return newMap;
            });
          }
        }
        setIsLoadingLists(false);
      });
    }
  }, [step, user?.uid, userLists.length, listId]);

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

  const toggleListSelection = useCallback((list: MovieList) => {
    setSelectedLists(prev => {
      const newMap = new Map(prev);
      if (newMap.has(list.id)) {
        newMap.delete(list.id);
      } else {
        newMap.set(list.id, {
          listId: list.id,
          listOwnerId: list.ownerId,
          listName: list.name,
          note: '',
          coverUrl: list.coverImageUrl,
        });
      }
      return newMap;
    });
  }, []);

  const updateListNote = useCallback((listId: string, note: string) => {
    setSelectedLists(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(listId);
      if (existing) {
        newMap.set(listId, { ...existing, note });
      }
      return newMap;
    });
  }, []);

  const handleAddMovie = useCallback(async () => {
    if (!selectedMovie || !user || selectedLists.size === 0) return;

    startAddingTransition(async () => {
      const itemType = selectedMovie.mediaType === 'tv' ? 'TV Show' : 'Movie';
      let successCount = 0;
      let errorCount = 0;

      // Add to each selected list
      for (const selection of selectedLists.values()) {
        const formData = new FormData();
        formData.append('movieData', JSON.stringify(selectedMovie));
        formData.append('userId', user.uid);
        formData.append('listId', selection.listId);
        formData.append('listOwnerId', selection.listOwnerId);
        formData.append('status', 'To Watch');
        if (socialLink) formData.append('socialLink', socialLink);
        if (selection.note) formData.append('note', selection.note);

        const result = await addMovieToList(formData);
        if (result?.error) {
          errorCount++;
        } else {
          successCount++;
        }
      }

      if (successCount > 0) {
        toast({
          title: `${itemType} Added!`,
          description: successCount === 1
            ? `${selectedMovie.title} has been added to ${Array.from(selectedLists.values())[0].listName}.`
            : `${selectedMovie.title} has been added to ${successCount} lists.`,
        });
      }
      if (errorCount > 0) {
        toast({
          variant: 'destructive',
          title: 'Some errors occurred',
          description: `Failed to add to ${errorCount} list(s).`,
        });
      }

      onClose();
    });
  }, [selectedMovie, user, selectedLists, socialLink, onClose, toast]);

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

  const selectedCount = selectedLists.size;

  return (
    <>
      {/* Step 1: Search Bottom Sheet */}
      <Drawer.Root open={isOpen && step === 'search'} onOpenChange={(open) => !open && onClose()}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-background border-t border-border outline-none h-[95vh]">
            {/* Drag handle */}
            <div className="mx-auto mt-4 h-1.5 w-12 flex-shrink-0 rounded-full bg-muted-foreground/40" />

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
              <div className="w-9" />
              <Drawer.Title className="text-lg font-semibold">Search</Drawer.Title>
              <button
                onClick={onClose}
                className="p-2 -mr-2 rounded-full hover:bg-secondary transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 flex-shrink-0">
              <div className="relative">
                <Input
                  type="text"
                  placeholder="Search movies or TV shows..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pr-10 h-12 text-base bg-secondary/50 border-border rounded-xl"
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
                      className="w-full text-left p-4 hover:bg-secondary/50 active:bg-secondary transition-colors flex items-center gap-4"
                    >
                      <Image
                        src={movie.posterUrl}
                        alt={movie.title}
                        width={48}
                        height={72}
                        className="rounded-lg border border-border object-cover flex-shrink-0"
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

            {/* Header */}
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
                      className="rounded-xl border-2 border-border shadow-md object-cover flex-shrink-0"
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
                    <p className="mt-4 text-sm text-muted-foreground leading-relaxed line-clamp-3">
                      {selectedMovie.overview}
                    </p>
                  )}
                </div>

                {/* Social Link Input */}
                <div className="p-4 border-t border-border">
                  <label className="text-sm font-medium mb-1 block">
                    What made you want to watch this?
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Saw a cool edit or trailer? Paste the link so others can see!
                  </p>
                  <div className="relative">
                    <Input
                      type="url"
                      value={socialLink}
                      onChange={(e) => setSocialLink(e.target.value)}
                      placeholder="Paste TikTok, Reel, or YouTube link..."
                      className={`bg-secondary/50 rounded-xl ${parsedVideo?.provider ? 'pr-10' : ''}`}
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

            <div className="pb-[env(safe-area-inset-bottom,0px)]" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Step 3: Multi-List Selection Bottom Sheet */}
      <Drawer.Root open={isOpen && step === 'select-list'} onOpenChange={(open) => !open && handleBackToPreview()}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[60] flex flex-col rounded-t-2xl bg-background border-t border-border outline-none max-h-[90vh]">
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
              <Drawer.Title className="text-lg font-semibold">
                Add to {selectedCount} {selectedCount === 1 ? 'list' : 'lists'}
              </Drawer.Title>
              <div className="w-9" />
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {isLoadingLists ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {userLists.map((list) => {
                    const isSelected = selectedLists.has(list.id);
                    const selection = selectedLists.get(list.id);

                    return (
                      <div
                        key={list.id}
                        className={`rounded-2xl border-2 overflow-hidden transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border'
                        }`}
                      >
                        {/* List Card Header */}
                        <button
                          onClick={() => toggleListSelection(list)}
                          className="w-full p-3 flex items-center gap-3"
                        >
                          {/* List Cover */}
                          <div className="w-16 h-16 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0 overflow-hidden relative">
                            {list.coverImageUrl ? (
                              <Image
                                src={list.coverImageUrl}
                                alt={list.name}
                                fill
                                className="object-cover"
                              />
                            ) : (
                              <Film className="h-6 w-6 text-muted-foreground" />
                            )}
                          </div>

                          {/* List Info */}
                          <div className="flex-1 min-w-0 text-left">
                            <p className="font-semibold truncate">{list.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {list.isPublic ? 'Public' : 'Private'}
                            </p>
                          </div>

                          {/* Selection Indicator */}
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-primary'
                              : 'border-2 border-border'
                          }`}>
                            {isSelected && (
                              <Check className="h-4 w-4 text-primary-foreground" />
                            )}
                          </div>
                        </button>

                        {/* Note Input (only when selected) */}
                        {isSelected && (
                          <div className="px-3 pb-3 space-y-2">
                            <textarea
                              value={selection?.note || ''}
                              onChange={(e) => updateListNote(list.id, e.target.value)}
                              placeholder="Add a note..."
                              rows={2}
                              maxLength={200}
                              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <LinkIcon className="h-3 w-3" />
                              <span>Add a link</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Save Button */}
            <div className="p-4 border-t border-border bg-background pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
              <Button
                onClick={handleAddMovie}
                disabled={isAdding || selectedCount === 0}
                className="w-full h-12 text-base font-semibold rounded-xl"
                size="lg"
              >
                {isAdding ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Check className="h-5 w-5 mr-2" />
                    Save
                  </>
                )}
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
