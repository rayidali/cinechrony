'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ChevronLeft, Search, Loader2, X, Film, Tv } from 'lucide-react';
import { searchUsers } from '@/app/actions';
import { searchTmdbMulti } from '@/lib/tmdb-client';
import { useUser } from '@/firebase';
import { ProfileAvatar } from '@/components/profile-avatar';
import { PublicMovieDetailsModal } from '@/components/public-movie-details-modal';
import type { SearchResult, UserProfile, Movie } from '@/lib/types';

type SearchOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
};

/**
 * Fullscreen search — the header search icon on Home opens this.
 *
 * Searches films + TV (TMDB) and people (`searchUsers`) in one surface. A
 * fullscreen overlay rather than a Vaul drawer so the keyboard never fights a
 * focus trap (the same reasoning behind `FullscreenTextInput`). List search
 * folds in with the loved-lists showcase (Phase 3).
 */
export function SearchOverlay({ isOpen, onClose }: SearchOverlayProps) {
  const { user } = useUser();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [films, setFilms] = useState<SearchResult[]>([]);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Film detail modal
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Focus the input + lock body scroll while the overlay is open.
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Reset state when the overlay closes.
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setFilms([]);
      setPeople([]);
    }
  }, [isOpen]);

  const runSearch = useCallback(
    async (q: string) => {
      setIsSearching(true);
      try {
        const [filmResults, peopleResults] = await Promise.all([
          searchTmdbMulti(q),
          user ? searchUsers(q, user.uid) : Promise.resolve({ users: [] as UserProfile[] }),
        ]);
        setFilms(filmResults);
        setPeople(peopleResults.users ?? []);
      } catch (error) {
        console.error('[search] failed:', error);
      } finally {
        setIsSearching(false);
      }
    },
    [user],
  );

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFilms([]);
      setPeople([]);
      setIsSearching(false);
      return;
    }
    const timer = setTimeout(() => runSearch(q), 320);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const openFilm = (film: SearchResult) => {
    setSelectedMovie({
      id: `search_${film.id}`,
      title: film.title,
      year: film.year === 'N/A' ? '' : film.year,
      posterUrl: film.posterUrl,
      posterHint: film.posterHint,
      addedBy: '',
      status: 'To Watch',
      mediaType: film.mediaType,
      tmdbId: film.tmdbId ?? Number(film.id),
      overview: film.overview,
      rating: film.rating,
    });
    setIsModalOpen(true);
  };

  const openProfile = (username: string | null) => {
    if (!username) return;
    onClose();
    router.push(`/profile/${username}`);
  };

  if (!isOpen) return null;

  const hasQuery = query.trim().length >= 2;
  const isEmpty = hasQuery && !isSearching && films.length === 0 && people.length === 0;

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-background flex flex-col animate-fade-in">
        {/* Search bar */}
        <div
          className="flex items-center gap-2 px-4 border-b border-border"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)', paddingBottom: '0.75rem' }}
        >
          <button
            onClick={onClose}
            aria-label="Close search"
            className="flex-shrink-0 h-9 w-9 -ml-1.5 rounded-full flex items-center justify-center text-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>
          <div className="flex-1 flex items-center gap-2 h-10 px-3.5 bg-card border border-border rounded-full shadow-press">
            <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" strokeWidth={1.8} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="films, tv, friends…"
              className="flex-1 bg-transparent border-0 outline-none font-serif italic text-sm text-foreground placeholder:text-muted-foreground"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear"
                className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-4 pb-24">
          {!hasQuery ? (
            <div className="flex flex-col items-center justify-center text-center pt-28 px-8">
              <Search className="h-8 w-8 text-muted-foreground/50 mb-4" strokeWidth={1.4} />
              <p className="cc-lead text-[15px] text-muted-foreground">
                find a film, a show, or someone to follow.
              </p>
            </div>
          ) : isSearching && films.length === 0 && people.length === 0 ? (
            <div className="flex justify-center pt-28">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center text-center pt-28 px-8">
              <p className="cc-lead text-[15px] text-muted-foreground">
                couldn&apos;t find that one. try another title?
              </p>
            </div>
          ) : (
            <>
              {films.length > 0 && (
                <section className="pt-5">
                  <div className="cc-eyebrow">films &amp; tv</div>
                  <div className="h-px bg-border mt-2.5 mb-3.5" />
                  <div className="grid grid-cols-3 gap-3">
                    {films.map((film) => (
                      <button
                        key={`${film.mediaType}_${film.id}`}
                        onClick={() => openFilm(film)}
                        className="text-left group"
                      >
                        <div className="relative aspect-[2/3] rounded-[10px] overflow-hidden border border-border shadow-lift transition-all duration-200 group-active:scale-[0.97]">
                          <Image
                            src={film.posterUrl}
                            alt={film.title}
                            fill
                            className="object-cover"
                            sizes="33vw"
                          />
                          <div className="absolute top-1 right-1 h-5 w-5 rounded-md bg-black/55 backdrop-blur-sm flex items-center justify-center text-white">
                            {film.mediaType === 'tv' ? (
                              <Tv className="h-3 w-3" strokeWidth={2} />
                            ) : (
                              <Film className="h-3 w-3" strokeWidth={2} />
                            )}
                          </div>
                        </div>
                        <p className="mt-1.5 font-headline font-semibold text-[12px] lowercase tracking-tight line-clamp-1">
                          {film.title}
                        </p>
                        {film.year && film.year !== 'N/A' && (
                          <p className="cc-meta text-[10px] text-muted-foreground">{film.year}</p>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {people.length > 0 && (
                <section className="pt-7">
                  <div className="cc-eyebrow">people</div>
                  <div className="h-px bg-border mt-2.5 mb-1.5" />
                  <ul>
                    {people.map((profile) => (
                      <li key={profile.uid}>
                        <button
                          onClick={() => openProfile(profile.username)}
                          className="w-full flex items-center gap-3 py-2.5 text-left active:opacity-60 transition-opacity"
                        >
                          <ProfileAvatar
                            photoURL={profile.photoURL}
                            displayName={profile.displayName}
                            username={profile.username}
                            size="md"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-headline font-semibold text-sm tracking-tight truncate">
                              {profile.displayName || profile.username}
                            </p>
                            <p className="cc-meta text-[11px] text-muted-foreground truncate">
                              @{profile.username}
                            </p>
                          </div>
                          <span className="cc-meta text-[10px] text-muted-foreground flex-shrink-0">
                            {profile.followersCount || 0} followers
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <PublicMovieDetailsModal
        movie={selectedMovie}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedMovie(null);
        }}
      />
    </>
  );
}
