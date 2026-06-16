'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { type DigInCategory } from '@/lib/tmdb-client';
import { useDigIn } from '@/components/dig-in';
import { getRatingStyle } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { DetailScreen } from '@/components/v3/detail-screen';
import { PublicMovieDetailsModal } from '@/components/public-movie-details-modal';
import type { SearchResult, Movie } from '@/lib/types';

/**
 * F15 — "dig in › all". The category grid behind the home dig-in rail's
 * "view all". new / trending / popular / lowkey tabs over a 2-up poster grid;
 * tapping a poster opens the movie drawer. All **client-direct TMDB** (one
 * cached `getDigIn(20)` fetch — zero Firestore reads, per free-tier discipline).
 * "logged by N friends" is deferred (no fake data) until a cheap social-proof
 * source exists.
 */
const TABS: { key: DigInCategory; label: string; sub: string }[] = [
  { key: 'new', label: 'new', sub: 'fresh logs' },
  { key: 'trending', label: 'trending', sub: "everyone's watching" },
  { key: 'popular', label: 'popular', sub: 'all-time loved' },
  { key: 'lowkey', label: 'lowkey', sub: 'hidden gems' },
];

export function DigInAll({
  isOpen,
  onClose,
  initialTab,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: DigInCategory;
}) {
  const [tab, setTab] = useState<DigInCategory>(initialTab ?? 'trending');
  const [selected, setSelected] = useState<Movie | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Open on the category the user tapped (a dig-in tile or "view all").
  useEffect(() => {
    if (isOpen && initialTab) setTab(initialTab);
  }, [isOpen, initialTab]);

  // Shared session cache with the home rail — one fetch, no double read.
  const { data, isLoading } = useDigIn();

  const films = data?.[tab] ?? [];
  const active = TABS.find((t) => t.key === tab)!;

  const openFilm = (f: SearchResult) => {
    haptic('light');
    setSelected({
      id: `digin_${f.tmdbId ?? f.id}`,
      title: f.title,
      year: f.year === 'N/A' ? '' : f.year,
      posterUrl: f.posterUrl,
      posterHint: f.posterHint,
      addedBy: '',
      status: 'To Watch',
      mediaType: f.mediaType,
      tmdbId: f.tmdbId ?? Number(f.id),
      overview: f.overview,
      rating: f.rating,
    });
    setModalOpen(true);
  };

  return (
    <>
      <DetailScreen isOpen={isOpen} onClose={onClose} title="dig in">
        <div className="px-[18px] pt-3 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
          {/* category tabs */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-[18px] px-[18px]">
            {TABS.map((t) => {
              const on = t.key === tab;
              return (
                <button
                  key={t.key}
                  onClick={() => {
                    haptic('selection');
                    setTab(t.key);
                  }}
                  className={`flex-shrink-0 rounded-full px-4 py-2 font-headline font-bold text-[15px] lowercase tracking-[-0.02em] transition-colors ${
                    on ? 'bg-foreground text-background' : 'border border-hair text-muted-foreground'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* sub + count */}
          <p className="mt-3.5 font-mono text-[11px] text-muted-foreground tabular-nums">
            {active.sub} · {films.length} films
          </p>

          {/* grid */}
          {isLoading && !data ? (
            <GridSkeleton />
          ) : films.length === 0 ? (
            <p className="pt-20 text-center font-serif italic text-[15px] text-muted-foreground">
              nothing to dig into here right now.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3.5">
              {films.map((f) => (
                <FilmTile key={f.id} film={f} onOpen={() => openFilm(f)} />
              ))}
            </div>
          )}
        </div>
      </DetailScreen>

      <PublicMovieDetailsModal
        movie={selected}
        isOpen={modalOpen}
        stackClassName="z-[80]"
        onClose={() => {
          setModalOpen(false);
          setSelected(null);
        }}
      />
    </>
  );
}

function FilmTile({ film, onOpen }: { film: SearchResult; onOpen: () => void }) {
  const rating = typeof film.rating === 'number' && film.rating > 0 ? film.rating : null;
  const style = rating ? getRatingStyle(rating) : null;
  return (
    <button onClick={onOpen} className="text-left group">
      <div className="relative aspect-[2/3] rounded-[15px] overflow-hidden bg-sunken shadow-lift transition-transform duration-200 group-active:scale-[0.97]">
        <Image src={film.posterUrl} alt={film.title} fill className="object-cover" sizes="50vw" />
        {style && (
          <span
            className="absolute top-2 right-2 px-2 py-0.5 rounded-full font-mono text-[10px] font-bold tabular-nums"
            style={{ ...style.background, ...style.textOnBg }}
          >
            {rating!.toFixed(1)}
          </span>
        )}
      </div>
      <p className="mt-2 font-headline font-bold text-[15px] lowercase tracking-[-0.02em] line-clamp-1">
        {film.title}
      </p>
    </button>
  );
}

function GridSkeleton() {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] rounded-[15px] bg-muted animate-pulse" />
          <div className="mt-2 h-4 w-2/3 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  );
}
