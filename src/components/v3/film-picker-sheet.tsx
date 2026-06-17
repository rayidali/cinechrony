'use client';

import { useEffect, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import { Search, X, ChevronRight, Loader2 } from 'lucide-react';
import { searchTmdbMulti, getNowPlayingMovies } from '@/lib/tmdb-client';
import { apiCall } from '@/lib/api-client';
import { useViewportHeight } from '@/hooks/use-viewport-height';
import { seededGradient } from '@/lib/seeded-gradient';
import { haptic } from '@/lib/haptics';
import type { SearchResult } from '@/lib/types';

/**
 * F04 "pick a film" — a Vaul bottom sheet over the composer. A search field
 * (browse-first — no autofocus, so the keyboard doesn't fight the drawer on
 * open), a "recently watched" poster rail, and an "all films" list (trending by
 * default, TMDB search when typing). Tapping a film fills the composer.
 *
 * Sized to the home-search's confidence — h-12 search, generous posters/titles.
 */
type RecentFilm = { tmdbId: number; mediaType: 'movie' | 'tv'; title: string; posterUrl: string | null };

function recentToResult(f: RecentFilm): SearchResult {
  return { id: String(f.tmdbId), title: f.title, year: '', posterUrl: f.posterUrl ?? '', posterHint: '', mediaType: f.mediaType, tmdbId: f.tmdbId };
}

/** A poster image with a filmic-gradient + title fallback (matches the mock). */
function Poster({ url, title, className }: { url: string | null | undefined; title: string; className?: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`w-full h-full object-cover ${className ?? ''}`} />;
  }
  return (
    <span className={`flex h-full w-full items-end p-1.5 ${className ?? ''}`} style={{ background: seededGradient(title) }}>
      <span className="font-headline font-bold text-[11px] lowercase leading-tight text-white/90 line-clamp-2">{title}</span>
    </span>
  );
}

export function FilmPickerSheet({
  isOpen,
  onClose,
  onPick,
}: {
  isOpen: boolean;
  onClose: () => void;
  onPick: (r: SearchResult) => void;
}) {
  const height = useViewportHeight(88);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<RecentFilm[]>([]);
  const [browse, setBrowse] = useState<SearchResult[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load recents + a default browse list once per open.
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setResults([]);
    apiCall<{ films: RecentFilm[] }>('GET', '/api/v1/watches/recent')
      .then((r) => setRecent(r.films ?? []))
      .catch(() => setRecent([]));
    if (browse.length === 0) {
      getNowPlayingMovies(20).then(setBrowse).catch(() => setBrowse([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Debounced TMDB search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(() => {
      searchTmdbMulti(q, 18)
        .then((r) => { if (!cancelled) setResults(r); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 280);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const pick = (r: SearchResult) => { haptic('light'); onPick(r); };
  const heightStyle = height > 0 ? `${height}px` : 'calc(88 * var(--dvh, 1vh))';
  const searching2 = query.trim().length >= 2;
  const allFilms = searching2 ? results : browse;

  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[95]" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-[95] flex flex-col rounded-t-[22px] bg-card outline-none overflow-hidden"
          style={{ height: heightStyle, maxHeight: heightStyle }}
        >
          <Drawer.Title className="sr-only">Pick a film</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />

          {/* header */}
          <div className="flex items-center px-5 py-2.5">
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui font-semibold text-[15px] text-muted-foreground active:opacity-60">cancel</button>
            <span className="flex-1 text-center font-headline font-bold text-[19px] lowercase tracking-[-0.02em]">pick a film</span>
            <span className="w-[44px]" aria-hidden />
          </div>

          {/* search */}
          <div className="px-5 pb-1">
            <div className="flex h-12 items-center gap-2.5 rounded-[14px] border border-hair bg-sunken px-3.5">
              <Search className="h-[18px] w-[18px] text-muted-foreground flex-shrink-0" strokeWidth={2} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="films, tv, directors…"
                className="w-full bg-transparent border-0 outline-none font-body text-[15px] text-foreground placeholder:text-muted-foreground"
                autoComplete="off" autoCorrect="off" spellCheck={false}
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Clear" className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-foreground/10 text-muted-foreground">
                  <X className="h-3 w-3" strokeWidth={2.6} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            {/* recently watched (only when not searching) */}
            {!searching2 && recent.length > 0 && (
              <div className="mt-3">
                <div className="cc-eyebrow px-5 mb-2.5">recently watched</div>
                <div className="flex gap-3 overflow-x-auto scrollbar-hide px-5 pb-1">
                  {recent.map((f) => (
                    <button key={f.tmdbId} onClick={() => pick(recentToResult(f))} className="w-[108px] flex-shrink-0 text-left active:opacity-70">
                      <span className="block relative w-[108px] h-[162px] rounded-[14px] overflow-hidden bg-sunken shadow-lift">
                        <Poster url={f.posterUrl} title={f.title} />
                      </span>
                      <span className="block mt-1.5 font-headline font-bold text-[13px] lowercase tracking-[-0.02em] truncate">{f.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* all films / results */}
            <div className="cc-eyebrow px-5 mt-4 mb-1">{searching2 ? 'results' : 'all films'}</div>
            {searching2 && searching && allFilms.length === 0 ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : allFilms.length === 0 ? (
              <p className="font-serif italic text-[15px] text-muted-foreground py-8 text-center">
                {searching2 ? 'no matches.' : 'nothing to browse right now.'}
              </p>
            ) : (
              <div className="px-5">
                {allFilms.map((r) => (
                  <button key={`${r.mediaType}_${r.id}`} onClick={() => pick(r)} className="relative w-full flex items-center gap-3.5 py-2.5 text-left active:opacity-60">
                    <span className="relative w-12 h-[72px] flex-shrink-0 rounded-[10px] overflow-hidden bg-sunken">
                      <Poster url={r.posterUrl} title={r.title} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-headline font-bold text-[17px] lowercase tracking-[-0.02em] truncate">{r.title}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground mt-0.5 truncate">
                        {[r.year && r.year !== 'N/A' ? r.year : null, r.mediaType === 'tv' ? 'tv' : 'film'].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" strokeWidth={2} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
