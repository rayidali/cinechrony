'use client';

import { useState, useTransition, useEffect, useCallback } from 'react';
import { Search, Loader2, X, Film, Instagram, Youtube, ChevronLeft, Check } from 'lucide-react';
import Image from 'next/image';
import { Drawer } from 'vaul';
import { TiktokIcon } from './icons';
import { FilmGridTile } from '@/components/v3/film-grid-tile';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import type { SearchResult, TMDBSearchResult, TMDBTVSearchResult, MovieList } from '@/lib/types';
import { apiCall } from '@/lib/api-client';
import type { ListSummary, CollaborativeListSummary } from '@/lib/lists-server';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase';
import { FullscreenTextInput } from '@/components/fullscreen-text-input';
import { seededGradient } from '@/lib/seeded-gradient';
import { getRatingStyle } from '@/lib/utils';
import { haptic } from '@/lib/haptics';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';

async function tmdbFetch(path: string, params: Record<string, string> = {}) {
  const accessToken = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  if (!accessToken) return null;
  const url = new URL(`${TMDB_API_BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url.toString(), {
      headers: { accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function formatMovieSearchResult(result: TMDBSearchResult): SearchResult {
  return {
    id: result.id.toString(),
    title: result.title,
    year: result.release_date ? result.release_date.split('-')[0] : 'N/A',
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
  return {
    id: result.id.toString(),
    title: result.name,
    year: result.first_air_date ? result.first_air_date.split('-')[0] : 'N/A',
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

type Step = 'search' | 'preview' | 'select-list' | 'edit-link';

interface ListWithMeta extends MovieList {
  isShared?: boolean;
  ownerDisplayName?: string;
}

interface ListSelection {
  listId: string;
  listOwnerId: string;
  listName: string;
  note: string;
}

const SHEET = 'fixed bottom-0 left-0 right-0 flex flex-col rounded-t-[22px] bg-card outline-none';
const HANDLE = 'mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30';

export function AddMovieModal({ isOpen, onClose, listId, listOwnerId, listName }: AddMovieModalProps) {
  const { user } = useUser();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<SearchResult | null>(null);
  const [socialLink, setSocialLink] = useState('');
  const [allLists, setAllLists] = useState<ListWithMeta[]>([]);
  const [selectedLists, setSelectedLists] = useState<Map<string, ListSelection>>(new Map());

  const [isSearching, startSearchTransition] = useTransition();
  const [isAdding, startAddingTransition] = useTransition();
  const [isLoadingLists, setIsLoadingLists] = useState(false);
  // Keyboard inset so a per-list note textarea low in the select-list drawer
  // clears the iOS keyboard (Keyboard resize:'none').
  const [kbInset, setKbInset] = useState(0);

  const parsedVideo = parseVideoUrl(socialLink);

  // Track the keyboard inset while the select-list step is open.
  useEffect(() => {
    if (!isOpen || step !== 'select-list') return;
    const vv = window.visualViewport;
    const onResize = () => { if (vv) setKbInset(Math.max(0, window.innerHeight - vv.height)); };
    onResize();
    vv?.addEventListener('resize', onResize);
    vv?.addEventListener('scroll', onResize);
    return () => {
      vv?.removeEventListener('resize', onResize);
      vv?.removeEventListener('scroll', onResize);
    };
  }, [isOpen, step]);

  // Reset on close.
  useEffect(() => {
    if (!isOpen) {
      setStep('search');
      setQuery('');
      setResults([]);
      setSelectedMovie(null);
      setSocialLink('');
      setSelectedLists(new Map());
      setAllLists([]);
    }
  }, [isOpen]);

  // Pre-select the current list when opening from inside one.
  useEffect(() => {
    if (isOpen && listId && listOwnerId) {
      setSelectedLists(new Map([[listId, {
        listId, listOwnerId, listName: listName || 'list', note: '',
      }]]));
    }
  }, [isOpen, listId, listOwnerId, listName]);

  // Debounced search.
  useEffect(() => {
    if (!query.trim() || step !== 'search') {
      if (!query.trim()) setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      startSearchTransition(async () => setResults(await searchAll(query)));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, step]);

  // Load own + collaborative lists when entering the select step (no per-list
  // preview fetch — cover-or-gradient like F05, which also saves N reads).
  useEffect(() => {
    if (step !== 'select-list' || !user?.uid || allLists.length > 0) return;
    setIsLoadingLists(true);
    Promise.all([
      apiCall<{ lists: ListSummary[] }>('GET', `/api/v1/users/${user.uid}/lists`),
      apiCall<{ lists: CollaborativeListSummary[] }>('GET', '/api/v1/me/collaborative-lists'),
    ])
      .then(([userResult, collabResult]) => {
        const ownLists: ListWithMeta[] = (userResult.lists || []).map((l) => ({
          ...(l as unknown as MovieList), isShared: false,
        }));
        const sharedLists: ListWithMeta[] = (collabResult.lists || []).map((l) => ({
          ...(l as unknown as MovieList & { ownerDisplayName?: string }),
          isShared: true,
          ownerDisplayName: (l as { ownerDisplayName?: string }).ownerDisplayName || 'a friend',
        }));
        setAllLists([...ownLists, ...sharedLists]);
      })
      .finally(() => setIsLoadingLists(false));
  }, [step, user?.uid, allLists.length]);

  const handleSelectMovie = useCallback((movie: SearchResult) => {
    haptic('light');
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

  const handleBackToPreview = useCallback(() => setStep('preview'), []);
  const handleProceedToListSelect = useCallback(() => { haptic('light'); setStep('select-list'); }, []);

  const toggleListSelection = useCallback((list: ListWithMeta) => {
    haptic('selection');
    setSelectedLists((prev) => {
      const next = new Map(prev);
      if (next.has(list.id)) next.delete(list.id);
      else next.set(list.id, { listId: list.id, listOwnerId: list.ownerId, listName: list.name, note: '' });
      return next;
    });
  }, []);

  const updateListNote = useCallback((id: string, note: string) => {
    setSelectedLists((prev) => {
      const next = new Map(prev);
      const existing = next.get(id);
      if (existing) next.set(id, { ...existing, note });
      return next;
    });
  }, []);

  const handleAddMovie = useCallback(async () => {
    if (!selectedMovie || !user || selectedLists.size === 0) return;
    startAddingTransition(async () => {
      const itemType = selectedMovie.mediaType === 'tv' ? 'show' : 'film';
      let successCount = 0;
      let errorCount = 0;
      for (const selection of selectedLists.values()) {
        try {
          await apiCall('POST', `/api/v1/lists/${selection.listOwnerId}/${selection.listId}/movies`, {
            movieData: selectedMovie,
            status: 'To Watch',
            socialLink: socialLink || undefined,
            note: selection.note || undefined,
          });
          successCount++;
        } catch (err) {
          console.error('[add-movie-modal] add failed:', err);
          errorCount++;
        }
      }
      if (successCount > 0) {
        const first = Array.from(selectedLists.values())[0];
        toast({
          title: `${itemType} added`,
          description: successCount === 1
            ? `${selectedMovie.title} → ${first.listName}`
            : `${selectedMovie.title} → ${successCount} lists`,
        });
      }
      if (errorCount > 0) {
        toast({ variant: 'destructive', title: 'Some errors occurred', description: `failed on ${errorCount} list(s).` });
      }
      onClose();
    });
  }, [selectedMovie, user, selectedLists, socialLink, onClose, toast]);

  const providerIcon = (cls = 'h-4 w-4') => {
    if (!parsedVideo?.provider) return null;
    switch (parsedVideo.provider) {
      case 'tiktok': return <TiktokIcon className={`${cls} text-primary`} />;
      case 'instagram': return <Instagram className={`${cls} text-primary`} />;
      case 'youtube': return <Youtube className={`${cls} text-primary`} />;
      default: return null;
    }
  };

  const selectedCount = selectedLists.size;
  const ratingStyle = selectedMovie?.rating && selectedMovie.rating > 0 ? getRatingStyle(selectedMovie.rating) : null;

  if (!isOpen) return null;

  return (
    <>
      {/* Step 1 — search. Mirrors the home search overlay (search bar + close,
          then a 3-up poster grid) so it reads as the same confident surface.
          Full-screen overlay (not Vaul) keeps a stable height for the keyboard. */}
      {step === 'search' && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in">
          <div
            className="flex items-center gap-2.5 px-4"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)', paddingBottom: '0.75rem' }}
          >
            <div className="flex-1 flex items-center gap-2.5 h-12 px-3.5 rounded-[14px] border border-hair bg-sunken">
              <Search className="h-[18px] w-[18px] text-muted-foreground flex-shrink-0" strokeWidth={2} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search a film to add…"
                className="w-full bg-transparent border-0 outline-none font-body text-[15px] text-foreground placeholder:text-muted-foreground"
                style={{ fontSize: '16px' }}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
              {isSearching ? (
                <Loader2 className="h-[18px] w-[18px] flex-shrink-0 animate-spin text-muted-foreground" />
              ) : query ? (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear"
                  className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-foreground/10 text-muted-foreground"
                >
                  <X className="h-3 w-3" strokeWidth={2.6} />
                </button>
              ) : null}
            </div>
            <button
              onClick={() => { haptic('light'); onClose(); }}
              aria-label="Close"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-transform active:scale-90"
            >
              <X className="h-[19px] w-[19px]" strokeWidth={2.2} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-24">
            {results.length === 0 ? (
              <p className="pt-24 text-center font-serif italic text-[15px] text-muted-foreground px-8">
                {query && !isSearching ? "couldn't find that one. try another title?" : 'search for a film or show to add to your list.'}
              </p>
            ) : (
              <section className="pt-2">
                <div className="cc-eyebrow">films &amp; tv</div>
                <div className="h-px bg-rule mt-2.5 mb-3.5" />
                <div className="grid grid-cols-3 gap-3">
                  {results.map((movie) => (
                    <FilmGridTile
                      key={`${movie.mediaType}-${movie.id}`}
                      posterUrl={movie.posterUrl}
                      title={movie.title}
                      year={movie.year}
                      isTv={movie.mediaType === 'tv'}
                      onOpen={() => handleSelectMovie(movie)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {/* Step 2 — preview the picked film + attach a clip */}
      <Drawer.Root
        open={step === 'preview' && !!selectedMovie}
        onOpenChange={(open) => { if (!open && step === 'preview') handleBackToSearch(); }}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50" />
          <Drawer.Content className={`${SHEET} z-50`} style={{ height: '85vh', maxHeight: '85vh' }}>
            <div className={HANDLE} />
            <div className="flex items-center justify-between px-5 py-2.5">
              <button onClick={handleBackToSearch} className="-ml-1 p-1 text-foreground active:opacity-60" aria-label="Back">
                <ChevronLeft className="h-6 w-6" strokeWidth={2} />
              </button>
              <Drawer.Title className="font-headline font-bold text-[18px] lowercase tracking-[-0.02em]">add to list</Drawer.Title>
              <button onClick={handleProceedToListSelect} className="font-ui font-bold text-[15px] text-primary active:opacity-60">
                next
              </button>
            </div>

            {selectedMovie && (
              <div className="flex-1 overflow-y-auto min-h-0 px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
                <div className="flex gap-4 mt-1">
                  <div className="relative h-[132px] w-[88px] flex-shrink-0 rounded-2xl overflow-hidden bg-sunken shadow-photo">
                    <Image src={selectedMovie.posterUrl} alt={selectedMovie.title} fill className="object-cover" sizes="88px" />
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <h3 className="font-headline font-bold text-[22px] lowercase tracking-[-0.02em] leading-[1.02]">{selectedMovie.title}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {ratingStyle && (
                        <span className="px-2 py-0.5 rounded-md font-mono text-[11px] font-bold tabular-nums" style={{ ...ratingStyle.background, ...ratingStyle.textOnBg }}>
                          {selectedMovie.rating!.toFixed(1)}
                        </span>
                      )}
                      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                        {selectedMovie.year !== 'N/A' ? selectedMovie.year : ''}{selectedMovie.year !== 'N/A' ? ' · ' : ''}{selectedMovie.mediaType === 'tv' ? 'tv' : 'film'}
                      </span>
                    </div>
                    {selectedMovie.overview && (
                      <p className="mt-3 font-serif italic text-[14px] leading-snug text-foreground/85 line-clamp-4">{selectedMovie.overview}</p>
                    )}
                  </div>
                </div>

                <div className="mt-7">
                  <div className="cc-eyebrow text-muted-foreground mb-2">what made you want to watch this?</div>
                  <button
                    type="button"
                    onClick={() => setStep('edit-link')}
                    className="w-full flex items-center justify-between gap-2 rounded-2xl border border-hair bg-background/60 px-4 py-3 text-left active:opacity-60 transition-opacity"
                  >
                    <span className={`truncate font-serif italic text-[15px] ${socialLink ? 'text-foreground' : 'text-muted-foreground/70'}`}>
                      {socialLink || 'paste a tiktok, reel, or youtube link…'}
                    </span>
                    {parsedVideo?.provider && <span className="flex-shrink-0">{providerIcon()}</span>}
                  </button>
                  {parsedVideo?.provider ? (
                    <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] text-success lowercase">
                      {providerIcon('h-3.5 w-3.5')}
                      <span>{getProviderDisplayName(parsedVideo.provider).toLowerCase()} clip will embed</span>
                    </p>
                  ) : (
                    <div className="mt-2 flex items-center gap-2.5 font-mono text-[10px] text-muted-foreground lowercase">
                      <span>works with</span>
                      <TiktokIcon className="h-3.5 w-3.5" />
                      <Instagram className="h-3.5 w-3.5" strokeWidth={1.8} />
                      <Youtube className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Step 3 — choose which lists */}
      <Drawer.Root open={step === 'select-list'} onOpenChange={(open) => !open && handleBackToPreview()}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
          <Drawer.Content className={`${SHEET} z-[60]`} style={{ height: '85vh', maxHeight: '85vh' }}>
            <div className={HANDLE} />
            <div className="flex items-center justify-between px-5 py-2.5">
              <button onClick={handleBackToPreview} className="-ml-1 p-1 text-foreground active:opacity-60" aria-label="Back">
                <ChevronLeft className="h-6 w-6" strokeWidth={2} />
              </button>
              <Drawer.Title className="font-headline font-bold text-[18px] lowercase tracking-[-0.02em]">
                {selectedCount > 0 ? `add to ${selectedCount} ${selectedCount === 1 ? 'list' : 'lists'}` : 'add to list'}
              </Drawer.Title>
              <span className="w-6" />
            </div>

            <div
              className="flex-1 overflow-y-auto min-h-0 px-5"
              style={{ paddingBottom: kbInset ? kbInset + 16 : undefined }}
            >
              {isLoadingLists ? (
                <div className="flex justify-center py-14"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : allLists.length === 0 ? (
                <p className="pt-14 text-center font-serif italic text-[15px] text-muted-foreground">no lists yet — make one first.</p>
              ) : (
                <div className="rounded-2xl border border-hair bg-card divide-y divide-hair overflow-hidden">
                  {allLists.map((list) => {
                    const on = selectedLists.has(list.id);
                    const selection = selectedLists.get(list.id);
                    const cover = list.coverImageUrl || null;
                    return (
                      <div key={list.id}>
                        <button onClick={() => toggleListSelection(list)} className="w-full flex items-center gap-3.5 p-3.5 text-left active:bg-foreground/5 transition-colors">
                          <span
                            className="relative h-[52px] w-[52px] flex-shrink-0 rounded-[14px] overflow-hidden flex items-center justify-center"
                            style={!cover ? { background: seededGradient(list.name) } : undefined}
                          >
                            {cover ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={cover} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Film className="h-5 w-5 text-white/80" strokeWidth={1.8} />
                            )}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block font-headline font-bold text-[16.5px] lowercase tracking-[-0.02em] truncate">{list.name}</span>
                            <span className="block font-mono text-[11px] text-muted-foreground lowercase truncate mt-0.5">
                              {list.isShared ? `shared by ${list.ownerDisplayName}` : (list.isPublic ? 'public' : 'private')}
                            </span>
                          </span>
                          <span className={`flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center transition-colors ${on ? 'bg-primary text-white' : 'border-2 border-hair'}`}>
                            {on && <Check className="h-4 w-4" strokeWidth={3} />}
                          </span>
                        </button>
                        {on && (
                          <div className="px-3 pb-3 -mt-0.5">
                            <textarea
                              value={selection?.note || ''}
                              onChange={(e) => updateListNote(list.id, e.target.value)}
                              placeholder="add a note for this list…"
                              rows={2}
                              maxLength={200}
                              className="w-full resize-none rounded-xl border border-hair bg-background/60 px-3 py-2 font-serif italic text-[14px] text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-foreground/30 transition-colors"
                              style={{ fontSize: '16px' }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex-shrink-0 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              <button
                onClick={handleAddMovie}
                disabled={isAdding || selectedCount === 0}
                className="w-full h-12 rounded-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground font-headline font-bold text-[15px] lowercase tracking-[-0.02em] shadow-fab transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {isAdding ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-[17px] w-[17px]" strokeWidth={2.5} />add</>}
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* social-link editor — renders when the drawer is CLOSED (iOS keyboard-safe) */}
      <FullscreenTextInput
        isOpen={step === 'edit-link'}
        onClose={() => setStep('preview')}
        onSave={async (text) => { setSocialLink(text); }}
        initialValue={socialLink}
        title="add link"
        subtitle={selectedMovie?.title}
        placeholder="paste tiktok, reel, or youtube link…"
        singleLine
        inputType="url"
        maxLength={500}
      />
    </>
  );
}
