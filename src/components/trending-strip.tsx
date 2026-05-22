'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Film } from 'lucide-react';
import {
  getTrendingMovies,
  getLovedLists,
  type TrendingMovie,
  type LovedListCard,
} from '@/app/actions';
import { PublicMovieDetailsModal } from '@/components/public-movie-details-modal';
import { getRatingStyle } from '@/lib/utils';
import type { Movie } from '@/lib/types';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

/**
 * The home discovery rows — two distinct editorial sections:
 *  · TRENDING NOW — trending films (TMDB trending/day).
 *  · THE COLLECTION — the loved-lists showcase (LAUNCH 0.5.2, cold-start gated).
 *
 * Films and lists are different kinds of object, so they get their own row +
 * header rather than one mixed scroll — it reads cleaner and scans faster.
 */
export function TrendingStrip() {
  const router = useRouter();
  const [films, setFilms] = useState<TrendingMovie[]>([]);
  const [lists, setLists] = useState<LovedListCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getTrendingMovies(), getLovedLists()])
      .then(([trending, loved]) => {
        if (cancelled) return;
        if (!trending.error) setFilms(trending.movies ?? []);
        setLists(loved.lists ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openFilm = (film: TrendingMovie) => {
    setSelectedMovie({
      id: `trending_${film.id}`,
      title: film.title,
      year: film.releaseDate ? new Date(film.releaseDate).getFullYear().toString() : '',
      posterUrl: film.posterPath
        ? `https://image.tmdb.org/t/p/w500${film.posterPath}`
        : '/placeholder-poster.png',
      posterHint: `${film.title} poster`,
      addedBy: '',
      status: 'To Watch',
      mediaType: film.mediaType,
      tmdbId: film.id,
    });
    setIsModalOpen(true);
  };

  const openList = (list: LovedListCard) => {
    if (!list.ownerUsername) return;
    router.push(`/profile/${list.ownerUsername}/lists/${list.id}`);
  };

  if (isLoading) {
    return (
      <section className="mb-7">
        <div className="cc-eyebrow">trending now</div>
        <div className="h-px bg-border mt-2.5 mb-3.5" />
        <div className="flex gap-2.5 overflow-hidden -mx-4 px-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-shrink-0 w-[88px]">
              <div className="aspect-[2/3] rounded-[10px] bg-muted animate-pulse" />
              <div className="mt-1.5 h-3 w-3/4 bg-muted rounded animate-pulse" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (films.length === 0 && lists.length === 0) return null;

  return (
    <>
      {/* TRENDING NOW — films */}
      {films.length > 0 && (
        <section className="mb-7">
          <div className="cc-eyebrow">trending now</div>
          <div className="h-px bg-border mt-2.5 mb-3.5" />
          <div className="flex gap-2.5 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1">
            {films.map((film) => (
              <FilmCard key={`film_${film.id}`} film={film} onSelect={() => openFilm(film)} />
            ))}
          </div>
        </section>
      )}

      {/* THE COLLECTION — loved lists, their own row */}
      {lists.length > 0 && (
        <section className="mb-7">
          <div className="cc-eyebrow">the collection</div>
          <div className="h-px bg-border mt-2.5 mb-3.5" />
          <div className="flex gap-2.5 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1">
            {lists.map((list) => (
              <ListMiniCard
                key={`list_${list.id}`}
                list={list}
                onSelect={() => openList(list)}
              />
            ))}
          </div>
        </section>
      )}

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

/** A trending film — small poster with a 3-bucket rating chip. */
function FilmCard({ film, onSelect }: { film: TrendingMovie; onSelect: () => void }) {
  const posterUrl = film.posterPath
    ? `${TMDB_IMAGE_BASE}${film.posterPath}`
    : '/placeholder-poster.png';
  const year = film.releaseDate ? new Date(film.releaseDate).getFullYear() : '';
  const ratingNum = film.imdbRating ? parseFloat(film.imdbRating) : film.voteAverage;
  const hasRating = typeof ratingNum === 'number' && ratingNum > 0;
  const ratingStyle = getRatingStyle(ratingNum);

  return (
    <button onClick={onSelect} className="flex-shrink-0 w-[88px] text-left group">
      <div className="relative aspect-[2/3] rounded-[10px] overflow-hidden border border-border shadow-lift transition-transform duration-200 group-active:scale-[0.97]">
        <Image src={posterUrl} alt={film.title} fill className="object-cover" sizes="88px" />
        {hasRating && (
          <span
            className="absolute top-1 left-1 px-1.5 py-0.5 rounded font-headline font-bold text-[10px] tabular-nums"
            style={{ ...ratingStyle.background, ...ratingStyle.textOnBg }}
          >
            {ratingNum.toFixed(1)}
          </span>
        )}
      </div>
      <p className="mt-1.5 font-headline font-semibold text-[12px] lowercase tracking-tight line-clamp-1">
        {film.title}
      </p>
      {year && <p className="cc-meta text-[10px] text-muted-foreground">{year}</p>}
    </button>
  );
}

/** A loved list — 2-up poster mosaic + curator eyebrow. */
function ListMiniCard({ list, onSelect }: { list: LovedListCard; onSelect: () => void }) {
  const [big, ...rest] = list.previewPosters;
  const curator = list.ownerUsername
    ? `@${list.ownerUsername.toUpperCase()}`
    : 'CURATED';

  return (
    <button
      onClick={onSelect}
      className="flex-shrink-0 w-[132px] text-left bg-card border border-border rounded-[12px] overflow-hidden shadow-lift transition-transform duration-200 active:scale-[0.97]"
    >
      <div className="aspect-[4/3] overflow-hidden bg-border">
        {/* v3: `coverMode === 'auto'` flips us back to the mosaic even when
            an old coverImageUrl is still on the doc. */}
        {list.coverImageUrl && list.coverMode !== 'auto' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={list.coverImageUrl} alt="" className="w-full h-full object-cover" />
        ) : list.previewPosters.length > 0 ? (
          <div className="w-full h-full grid grid-cols-[2fr_1fr] gap-px">
            <MosaicTile src={big} />
            <div className="grid grid-rows-2 gap-px">
              <MosaicTile src={rest[0]} />
              <MosaicTile src={rest[1]} />
            </div>
          </div>
        ) : (
          <div className="w-full h-full bg-muted flex items-center justify-center">
            <Film className="h-5 w-5 text-muted-foreground/50" strokeWidth={1.4} />
          </div>
        )}
      </div>
      <div className="px-2.5 py-2">
        <div className="cc-eyebrow text-[8px] truncate">
          {curator} · {list.movieCount} {list.movieCount === 1 ? 'film' : 'films'}
        </div>
        <div className="mt-1 font-headline font-bold text-[11px] lowercase tracking-tight leading-tight line-clamp-1">
          {list.name}
        </div>
      </div>
    </button>
  );
}

function MosaicTile({ src }: { src?: string }) {
  if (!src) {
    return (
      <div className="bg-muted flex items-center justify-center">
        <Film className="h-3.5 w-3.5 text-muted-foreground/50" strokeWidth={1.4} />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="w-full h-full object-cover" />;
}
