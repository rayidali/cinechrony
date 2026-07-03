'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { tmdbImg } from '@/lib/tmdb-image';
import { useRouter } from '@/lib/native-nav';
import Image from 'next/image';
import {
  ChevronLeft,
  Search,
  Loader2,
  X,
  ListVideo,
} from 'lucide-react';
import type { LovedListCard } from '@/lib/lists-server';
import type { TrendingMovie, RecommendationSet } from '@/lib/tmdb-server';
import {
  searchTmdbMulti,
  getNowPlayingMovies,
  getUpcomingMovies,
  discoverByVibe,
} from '@/lib/tmdb-client';
import { apiCall } from '@/lib/api-client';
import { useUser } from '@/firebase';
import { haptic } from '@/lib/haptics';
import { VIBES, type Vibe } from '@/lib/vibes';
import { ProfileAvatar } from '@/components/profile-avatar';
import { PublicMovieDetailsModal } from '@/components/public-movie-details-modal';
import { Segmented } from '@/components/v3/segmented';
import { FilmGridTile } from '@/components/v3/film-grid-tile';
import type { SearchResult, UserProfile, Movie } from '@/lib/types';

type SearchOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
};

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const PLACEHOLDER_POSTER = 'https://picsum.photos/seed/placeholder/500/750';

const posterFrom = (path: string | null) =>
  path ? `${TMDB_IMG}${path}` : PLACEHOLDER_POSTER;
const yearFrom = (releaseDate: string) =>
  releaseDate ? releaseDate.split('-')[0] : '';

/**
 * Flatten the per-basis recommendation sets into one row, round-robin across
 * bases so the first cards show variety (not all from one basis in a clump).
 */
function flattenRecs(sets: RecommendationSet[], cap = 14): TrendingMovie[] {
  const out: TrendingMovie[] = [];
  const seen = new Set<number>();
  const maxLen = sets.reduce((m, s) => Math.max(m, s.recommendations.length), 0);
  for (let i = 0; i < maxLen && out.length < cap; i++) {
    for (const set of sets) {
      const movie = set.recommendations[i];
      if (!movie || seen.has(movie.id)) continue;
      seen.add(movie.id);
      out.push(movie);
      if (out.length >= cap) break;
    }
  }
  return out;
}

/**
 * Fullscreen search + discovery — the header search bar on Home opens this.
 *
 * Three views in one surface (a fullscreen overlay, not a Vaul drawer, so the
 * keyboard never fights a focus trap):
 *   • discover (empty query) — recommended-from-your-watch-history, browse by
 *     vibe (keyword discovery), now & next (in theatres / coming soon).
 *   • results (typed query) — films + tv (TMDB), people, lists.
 *   • vibe (a vibe chip tapped) — a grid of that vibe's films.
 */
export function SearchOverlay({ isOpen, onClose }: SearchOverlayProps) {
  const { user } = useUser();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');

  // Results view
  const [films, setFilms] = useState<SearchResult[]>([]);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [lists, setLists] = useState<LovedListCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Discover view (loaded once per session, kept across open/close)
  const [recs, setRecs] = useState<TrendingMovie[]>([]);
  const [nowPlaying, setNowPlaying] = useState<SearchResult[]>([]);
  const [upcoming, setUpcoming] = useState<SearchResult[]>([]);
  const [nowNextTab, setNowNextTab] = useState<'now' | 'soon'>('now');
  const [discoverLoaded, setDiscoverLoaded] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  // Vibe view
  const [activeVibe, setActiveVibe] = useState<Vibe | null>(null);
  const [vibeMovies, setVibeMovies] = useState<SearchResult[]>([]);
  const [vibeLoading, setVibeLoading] = useState(false);
  const vibeCache = useRef<Map<string, SearchResult[]>>(new Map());

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

  // Reset the transient view state when the overlay closes (keep discover cache).
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setFilms([]);
      setPeople([]);
      setLists([]);
      setActiveVibe(null);
    }
  }, [isOpen]);

  // Load the discover surface once, lazily on first open.
  useEffect(() => {
    if (!isOpen || discoverLoaded) return;
    let cancelled = false;
    (async () => {
      setDiscoverLoading(true);
      // Recommendations stay server-side (they read the viewer's ratings via
      // the admin SDK). now-playing / upcoming are public TMDB data → fetched
      // client-direct so they work on web, preview, and native without an API
      // round-trip.
      const [recsRes, nowRes, soonRes] = await Promise.all([
        user
          ? apiCall<{ sets: RecommendationSet[] }>('GET', '/api/v1/recommendations').catch(
              () => ({ sets: [] as RecommendationSet[] }),
            )
          : Promise.resolve({ sets: [] as RecommendationSet[] }),
        getNowPlayingMovies().catch(() => [] as SearchResult[]),
        getUpcomingMovies().catch(() => [] as SearchResult[]),
      ]);
      if (cancelled) return;
      setRecs(flattenRecs(recsRes.sets ?? []));
      setNowPlaying(nowRes);
      setUpcoming(soonRes);
      setDiscoverLoaded(true);
      setDiscoverLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, discoverLoaded, user]);

  const runSearch = useCallback(async (q: string) => {
    setIsSearching(true);
    try {
      const [filmResults, peopleResults, listResults] = await Promise.all([
        searchTmdbMulti(q),
        apiCall<{ users: UserProfile[] }>(
          'GET',
          `/api/v1/users/search?q=${encodeURIComponent(q)}`,
        ).catch(() => ({ users: [] as UserProfile[] })),
        apiCall<{ lists: LovedListCard[] }>(
          'GET',
          `/api/v1/lists/search?q=${encodeURIComponent(q)}`,
        ).catch(() => ({ lists: [] as LovedListCard[] })),
      ]);
      setFilms(filmResults);
      setPeople(peopleResults.users ?? []);
      setLists(listResults.lists ?? []);
    } catch (error) {
      console.error('[search] failed:', error);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFilms([]);
      setPeople([]);
      setLists([]);
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

  const openTrending = (m: TrendingMovie) => {
    setSelectedMovie({
      id: `search_${m.id}`,
      title: m.title,
      year: yearFrom(m.releaseDate),
      posterUrl: posterFrom(m.posterPath),
      posterHint: 'movie poster',
      addedBy: '',
      status: 'To Watch',
      mediaType: m.mediaType,
      tmdbId: m.id,
      rating: m.voteAverage,
    });
    setIsModalOpen(true);
  };

  const openProfile = (username: string | null) => {
    if (!username) return;
    onClose();
    router.push(`/profile/${username}`);
  };

  const openList = (list: LovedListCard) => {
    if (!list.ownerUsername) return;
    onClose();
    router.push(`/profile/${list.ownerUsername}/lists/${list.id}`);
  };

  const openVibe = async (vibe: Vibe) => {
    haptic('selection');
    setActiveVibe(vibe);
    const cached = vibeCache.current.get(vibe.id);
    if (cached) {
      setVibeMovies(cached);
      return;
    }
    setVibeMovies([]);
    setVibeLoading(true);
    try {
      const movies = await discoverByVibe(vibe.id);
      vibeCache.current.set(vibe.id, movies);
      setVibeMovies(movies);
    } catch {
      setVibeMovies([]);
    } finally {
      setVibeLoading(false);
    }
  };

  const closeVibe = () => {
    haptic('light');
    setActiveVibe(null);
  };

  const handleClose = () => {
    haptic('light');
    onClose();
  };

  if (!isOpen) return null;

  const hasQuery = query.trim().length >= 2;
  const noResults = films.length === 0 && people.length === 0 && lists.length === 0;
  const isEmpty = hasQuery && !isSearching && noResults;
  const nowNextMovies = nowNextTab === 'now' ? nowPlaying : upcoming;

  // View priority: a typed query always wins, then a vibe, else discover.
  const view: 'results' | 'vibe' | 'discover' = hasQuery
    ? 'results'
    : activeVibe
      ? 'vibe'
      : 'discover';

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-background flex flex-col animate-fade-in">
        {/* Search bar + close */}
        <div
          className="flex items-center gap-2.5 px-4"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
            paddingBottom: '0.75rem',
          }}
        >
          <div className="flex-1 flex items-center gap-2.5 h-12 px-3.5 rounded-[14px] border border-hair bg-sunken">
            <Search
              className="h-[18px] w-[18px] text-muted-foreground flex-shrink-0"
              strokeWidth={2}
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                const v = e.target.value;
                setQuery(v);
                if (v.trim().length >= 2 && activeVibe) setActiveVibe(null);
              }}
              placeholder="search a title, person…"
              className="w-full bg-transparent border-0 outline-none font-body text-[15px] text-foreground placeholder:text-muted-foreground"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear"
                className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-foreground/10 text-muted-foreground"
              >
                <X className="h-3 w-3" strokeWidth={2.6} />
              </button>
            )}
          </div>
          <button
            onClick={handleClose}
            aria-label="Close search"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-transform active:scale-90"
          >
            <X className="h-[19px] w-[19px]" strokeWidth={2.2} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto pb-24">
          {view === 'results' ? (
            <ResultsView
              films={films}
              people={people}
              lists={lists}
              isSearching={isSearching}
              isEmpty={isEmpty}
              noResults={noResults}
              onOpenFilm={openFilm}
              onOpenProfile={openProfile}
              onOpenList={openList}
            />
          ) : view === 'vibe' && activeVibe ? (
            <VibeView
              vibe={activeVibe}
              movies={vibeMovies}
              loading={vibeLoading}
              onBack={closeVibe}
              onOpen={openFilm}
            />
          ) : (
            <DiscoverView
              loading={discoverLoading && !discoverLoaded}
              recs={recs}
              nowNextTab={nowNextTab}
              onNowNextTab={(t) => setNowNextTab(t as 'now' | 'soon')}
              nowNextMovies={nowNextMovies}
              onOpenRec={openTrending}
              onOpenFilm={openFilm}
              onVibe={openVibe}
            />
          )}
        </div>
      </div>

      <PublicMovieDetailsModal
        movie={selectedMovie}
        isOpen={isModalOpen}
        // The search overlay itself is z-[70]; the drawer must stack ABOVE it
        // (default z-50 would open behind the overlay → invisible).
        stackClassName="z-[80]"
        onClose={() => {
          setIsModalOpen(false);
          setSelectedMovie(null);
        }}
      />
    </>
  );
}

// ─── Poster tile (horizontal rows: recommended + now & next) ──────────────

function PosterTile({
  posterUrl,
  title,
  width,
  meta,
  onOpen,
}: {
  posterUrl: string;
  title: string;
  width: number;
  meta?: string;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      style={{ width }}
      className="flex-shrink-0 text-left group"
    >
      <div className="relative aspect-[2/3] rounded-[14px] overflow-hidden border border-border shadow-lift transition-transform duration-200 group-active:scale-[0.97]">
        <Image src={tmdbImg(posterUrl, 'w342')} alt={title} fill className="object-cover" sizes="160px" />
      </div>
      <p className="mt-2 font-headline font-semibold text-[13.5px] lowercase tracking-tight line-clamp-1">
        {title}
      </p>
      {meta ? (
        <p className="mt-0.5 cc-meta text-[10px] text-muted-foreground">{meta}</p>
      ) : null}
    </button>
  );
}

// ─── Discover view ────────────────────────────────────────────────────────

function DiscoverView({
  loading,
  recs,
  nowNextTab,
  onNowNextTab,
  nowNextMovies,
  onOpenRec,
  onOpenFilm,
  onVibe,
}: {
  loading: boolean;
  recs: TrendingMovie[];
  nowNextTab: 'now' | 'soon';
  onNowNextTab: (t: string) => void;
  nowNextMovies: SearchResult[];
  onOpenRec: (m: TrendingMovie) => void;
  onOpenFilm: (f: SearchResult) => void;
  onVibe: (v: Vibe) => void;
}) {
  if (loading) {
    return (
      <div className="flex justify-center pt-28">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-9 pt-4">
      {/* RECOMMENDED FOR YOU */}
      {recs.length > 0 && (
        <section>
          <div className="px-4">
            <div className="cc-eyebrow">recommended for you</div>
            <h2 className="mt-1 font-headline text-[22px] font-bold lowercase leading-none tracking-tight">
              from what you&apos;ve watched
            </h2>
          </div>
          <div className="mt-3.5 flex gap-3.5 overflow-x-auto scrollbar-hide px-4 pb-1">
            {recs.map((m) => (
              <PosterTile
                key={`rec_${m.id}`}
                posterUrl={posterFrom(m.posterPath)}
                title={m.title}
                width={148}
                onOpen={() => onOpenRec(m)}
              />
            ))}
          </div>
        </section>
      )}

      {/* BROWSE BY VIBE */}
      <section className="px-4">
        <div className="cc-eyebrow">browse by vibe</div>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {VIBES.map((vibe) => (
            <button
              key={vibe.id}
              onClick={() => onVibe(vibe)}
              className="rounded-full border border-hair bg-card px-4 py-2 font-serif italic text-[14px] text-foreground transition-transform active:scale-95"
            >
              {vibe.label}
            </button>
          ))}
        </div>
      </section>

      {/* NOW & NEXT */}
      <section>
        <div className="px-4">
          <div className="cc-eyebrow mb-3">now &amp; next</div>
          <Segmented
            value={nowNextTab}
            onChange={onNowNextTab}
            options={[
              { id: 'now', label: 'in theatres' },
              { id: 'soon', label: 'coming soon' },
            ]}
          />
        </div>
        {nowNextMovies.length > 0 ? (
          <div className="mt-3.5 flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-1">
            {nowNextMovies.map((m) => (
              <PosterTile
                key={`nn_${m.id}`}
                posterUrl={m.posterUrl}
                title={m.title}
                width={124}
                meta={nowNextTab === 'now' ? 'now playing' : 'coming soon'}
                onOpen={() => onOpenFilm(m)}
              />
            ))}
          </div>
        ) : (
          <p className="px-4 pt-4 font-serif text-[14px] italic text-muted-foreground">
            {nowNextTab === 'now'
              ? 'nothing in theatres right now.'
              : "nothing on the calendar yet — check back soon."}
          </p>
        )}
      </section>
    </div>
  );
}

// ─── Vibe view ──────────────────────────────────────────────────────────--

function VibeView({
  vibe,
  movies,
  loading,
  onBack,
  onOpen,
}: {
  vibe: Vibe;
  movies: SearchResult[];
  loading: boolean;
  onBack: () => void;
  onOpen: (f: SearchResult) => void;
}) {
  return (
    <div className="px-4 pt-4">
      <button
        onClick={onBack}
        className="-ml-1.5 flex items-center gap-1 text-muted-foreground transition-transform active:scale-95"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2} />
        <span className="cc-eyebrow">browse by vibe</span>
      </button>
      <h2 className="mt-2 font-headline text-[26px] font-bold lowercase leading-none tracking-tight">
        {vibe.label}
      </h2>

      {loading ? (
        <div className="flex justify-center pt-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : movies.length > 0 ? (
        <div className="mt-5 grid grid-cols-3 gap-3">
          {movies.map((m) => (
            <FilmGridTile
              key={`vibe_${m.id}`}
              posterUrl={m.posterUrl}
              title={m.title}
              year={m.year}
              isTv={m.mediaType === 'tv'}
              onOpen={() => onOpen(m)}
            />
          ))}
        </div>
      ) : (
        <p className="pt-20 text-center font-serif text-[15px] italic text-muted-foreground">
          couldn&apos;t pull that vibe together right now.
        </p>
      )}
    </div>
  );
}

// ─── Results view (typed query) ───────────────────────────────────────────

function ResultsView({
  films,
  people,
  lists,
  isSearching,
  isEmpty,
  noResults,
  onOpenFilm,
  onOpenProfile,
  onOpenList,
}: {
  films: SearchResult[];
  people: UserProfile[];
  lists: LovedListCard[];
  isSearching: boolean;
  isEmpty: boolean;
  noResults: boolean;
  onOpenFilm: (f: SearchResult) => void;
  onOpenProfile: (username: string | null) => void;
  onOpenList: (l: LovedListCard) => void;
}) {
  if (isSearching && noResults) {
    return (
      <div className="flex justify-center pt-28">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center text-center pt-28 px-8">
        <p className="cc-lead text-[15px] text-muted-foreground">
          couldn&apos;t find that one. try another title?
        </p>
      </div>
    );
  }

  return (
    <div className="px-4">
      {people.length > 0 && (
        <section className="pt-5">
          <div className="cc-eyebrow">people</div>
          <div className="h-px bg-rule mt-2.5 mb-1.5" />
          <ul>
            {people.map((profile) => (
              <li key={profile.uid}>
                <button
                  onClick={() => onOpenProfile(profile.username)}
                  className="w-full flex items-center gap-3 py-2.5 text-left active:opacity-60 transition-opacity"
                >
                  <ProfileAvatar
                    photoURL={profile.photoURL}
                    displayName={profile.displayName}
                    username={profile.username}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-headline font-semibold text-sm lowercase tracking-tight truncate">
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

      {films.length > 0 && (
        <section className="pt-7">
          <div className="cc-eyebrow">films &amp; tv</div>
          <div className="h-px bg-rule mt-2.5 mb-3.5" />
          <div className="grid grid-cols-3 gap-3">
            {films.map((film) => (
              <FilmGridTile
                key={`${film.mediaType}_${film.id}`}
                posterUrl={film.posterUrl}
                title={film.title}
                year={film.year}
                isTv={film.mediaType === 'tv'}
                onOpen={() => onOpenFilm(film)}
              />
            ))}
          </div>
        </section>
      )}

      {lists.length > 0 && (
        <section className="pt-7">
          <div className="cc-eyebrow">lists</div>
          <div className="h-px bg-rule mt-2.5 mb-1.5" />
          <ul>
            {lists.map((list) => {
              const useCustom = list.coverImageUrl && list.coverMode !== 'auto';
              const cover = useCustom ? list.coverImageUrl : list.previewPosters[0];
              return (
                <li key={list.id}>
                  <button
                    onClick={() => onOpenList(list)}
                    className="w-full flex items-center gap-3 py-2.5 text-left active:opacity-60 transition-opacity"
                  >
                    <div className="flex-shrink-0 h-11 w-11 rounded-lg overflow-hidden border border-border bg-muted flex items-center justify-center">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ListVideo className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-headline font-semibold text-sm lowercase tracking-tight truncate">
                        {list.name}
                      </p>
                      <p className="cc-meta text-[11px] text-muted-foreground truncate">
                        {list.ownerUsername ? `@${list.ownerUsername}` : 'a curator'} ·{' '}
                        {list.movieCount} {list.movieCount === 1 ? 'film' : 'films'}
                      </p>
                    </div>
                    {list.likes > 0 && (
                      <span className="cc-meta text-[10px] text-muted-foreground flex-shrink-0">
                        {list.likes} {list.likes === 1 ? 'like' : 'likes'}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
