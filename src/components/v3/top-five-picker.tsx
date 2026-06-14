'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Search, X, Plus, Loader2, Film } from 'lucide-react';
import { searchTmdbMulti } from '@/lib/tmdb-client';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { useToast } from '@/hooks/use-toast';
import type { FavoriteMovie, SearchResult } from '@/lib/types';

/**
 * TopFivePicker — the v3 "your top 5" canon editor (design mocks 14 + 15).
 *
 * A full-screen overlay (NOT Vaul — the search input would hit the iOS
 * focus-trap bug). Two modes:
 *   • sheet  — 5 ranked slots (drag to reorder, × to remove), a status line,
 *              a search trigger, and a "suggested for you" list (trending).
 *   • search — live TMDB multi-search (all / films / tv), each result's + drops
 *              the title into the next open slot. "done" returns to the sheet.
 *
 * Stores the canonical `FavoriteMovie[]` ({ id, title, posterUrl, tmdbId }) via
 * PATCH /me — no schema change. Dedup is by tmdbId.
 */

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const PLACEHOLDER = 'https://picsum.photos/seed/cc-poster/500/750';
const MAX = 5;

type Candidate = {
  tmdbId: number;
  title: string;
  year: string;
  posterUrl: string;
  mediaType: 'movie' | 'tv';
};

type TopFivePickerProps = {
  isOpen: boolean;
  onClose: () => void;
  currentFavorites: FavoriteMovie[];
  onUpdate: (movies: FavoriteMovie[]) => void;
};

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const a = [...arr];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

export function TopFivePicker({ isOpen, onClose, currentFavorites, onUpdate }: TopFivePickerProps) {
  const { toast } = useToast();

  const [selected, setSelected] = useState<FavoriteMovie[]>(currentFavorites);
  const [mode, setMode] = useState<'sheet' | 'search'>('sheet');
  const [isSaving, setIsSaving] = useState(false);

  const [suggestions, setSuggestions] = useState<Candidate[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // drag-to-rank state
  const rowRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Re-seed on open.
  useEffect(() => {
    if (isOpen) {
      setSelected(currentFavorites);
      setMode('sheet');
      setQuery('');
      setResults([]);
      setFilter('all');
    }
  }, [isOpen, currentFavorites]);

  // Suggested for you — trending (cheap, always available). Loaded once on open.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const { movies } = await apiCall<{
          movies: { id: number; title: string; posterPath: string | null; releaseDate: string; mediaType: 'movie' | 'tv' }[];
        }>('GET', '/api/v1/movies/trending');
        if (cancelled) return;
        setSuggestions(
          (movies ?? []).map((m) => ({
            tmdbId: m.id,
            title: m.title,
            year: m.releaseDate ? m.releaseDate.slice(0, 4) : '',
            posterUrl: m.posterPath ? `${TMDB_IMG}${m.posterPath}` : PLACEHOLDER,
            mediaType: m.mediaType,
          })),
        );
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Debounced multi-search (search mode).
  useEffect(() => {
    if (mode !== 'search') return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchTmdbMulti(q, 24);
        setResults(r);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, mode]);

  if (!isOpen) return null;

  const spotsOpen = MAX - selected.length;

  const addCandidate = (c: Candidate) => {
    if (selected.some((m) => m.tmdbId === c.tmdbId)) {
      toast({ title: 'already in your canon' });
      return;
    }
    if (selected.length >= MAX) {
      toast({ title: 'your canon is full', description: 'remove one to swap it out.' });
      return;
    }
    haptic('selection');
    setSelected((prev) => [
      ...prev,
      { id: `${c.mediaType}_${c.tmdbId}`, title: c.title, posterUrl: c.posterUrl, tmdbId: c.tmdbId },
    ]);
  };

  const removeAt = (i: number) => {
    haptic('light');
    setSelected((prev) => prev.filter((_, idx) => idx !== i));
  };

  // ── drag-to-rank (pointer events; reorders within the filled prefix) ──
  const onSlotPointerDown = (e: ReactPointerEvent, i: number) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragIndex(i);
  };
  const onSlotPointerMove = (e: ReactPointerEvent) => {
    if (dragIndex === null || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    const slotW = rect.width / MAX;
    const raw = Math.floor((e.clientX - rect.left) / slotW);
    const target = Math.max(0, Math.min(selected.length - 1, raw));
    if (target !== dragIndex) {
      haptic('selection');
      setSelected((prev) => moveItem(prev, dragIndex, target));
      setDragIndex(target);
    }
  };
  const onSlotPointerUp = (e: ReactPointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be released */
    }
    setDragIndex(null);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiCall('PATCH', '/api/v1/me', { favoriteMovies: selected });
      haptic('success');
      onUpdate(selected);
      toast({ title: 'top 5 saved' });
      onClose();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof ApiClientError ? err.message : 'Failed to save your top 5.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const filteredResults = results.filter((r) =>
    filter === 'all' ? true : r.mediaType === filter,
  );

  // ════════════════════════════ SEARCH MODE ════════════════════════════
  if (mode === 'search') {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-background">
        {/* search header */}
        <div
          className="flex items-center gap-3 px-4 pb-3"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
        >
          <div className="flex h-11 flex-1 items-center gap-2.5 rounded-[13px] border border-hair bg-sunken px-3.5">
            <Search className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={2} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="films, tv, genres"
              className="w-full bg-transparent font-body text-[16px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear"
                className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-foreground/10 text-muted-foreground"
              >
                <X className="h-3 w-3" strokeWidth={2.6} />
              </button>
            )}
          </div>
          <button
            onClick={() => setMode('sheet')}
            className="font-headline text-[15px] font-bold lowercase tracking-tight text-primary transition-transform active:scale-95"
          >
            done
          </button>
        </div>

        {/* YOUR CANON mini-row */}
        <div className="flex items-center gap-2.5 px-4 pb-2">
          <span className="cc-eyebrow shrink-0">your canon</span>
          <div className="flex flex-1 gap-1.5">
            {Array.from({ length: MAX }).map((_, i) => {
              const m = selected[i];
              return (
                <div
                  key={i}
                  className={`relative h-9 w-7 overflow-hidden rounded-[5px] ${
                    m ? '' : 'border border-dashed border-rule'
                  }`}
                >
                  {m ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.posterUrl} alt="" className="h-full w-full object-cover" />
                      <span className="absolute left-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-br-[4px] bg-primary text-[8px] font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
          <span className="cc-meta shrink-0 text-[11px] text-primary">{spotsOpen} open</span>
        </div>

        {/* filter pills */}
        <div className="flex gap-2 px-4 pb-3 pt-1">
          {([
            { id: 'all', label: 'all' },
            { id: 'movie', label: 'films' },
            { id: 'tv', label: 'tv shows' },
          ] as const).map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`h-8 rounded-full px-3.5 font-headline text-[13px] font-semibold lowercase tracking-tight transition-colors ${
                  active
                    ? 'bg-foreground text-background'
                    : 'border border-border text-muted-foreground'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* results */}
        <div className="flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {isSearching && filteredResults.length === 0 ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredResults.length > 0 ? (
            <div className="overflow-hidden rounded-[18px] border border-hair bg-card">
              {filteredResults.map((r, i) => {
                const tmdbId = r.tmdbId ?? Number(r.id);
                const inCanon = selected.some((m) => m.tmdbId === tmdbId);
                return (
                  <div
                    key={`${r.mediaType}-${r.id}`}
                    className={`relative flex items-center gap-3 px-3 py-2.5 ${
                      i < filteredResults.length - 1 ? 'border-b border-rule' : ''
                    }`}
                  >
                    <div className="h-[58px] w-[42px] flex-shrink-0 overflow-hidden rounded-[7px] bg-secondary">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-headline text-[15px] font-semibold lowercase tracking-tight text-foreground">
                          {r.title}
                        </span>
                        <span className="shrink-0 rounded border border-rule px-1 font-mono text-[8.5px] uppercase tracking-wide text-muted-foreground">
                          {r.mediaType === 'tv' ? 'tv' : 'film'}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                        {r.year || '—'}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        addCandidate({
                          tmdbId,
                          title: r.title,
                          year: r.year,
                          posterUrl: r.posterUrl,
                          mediaType: r.mediaType,
                        })
                      }
                      disabled={inCanon}
                      aria-label={inCanon ? 'Already added' : `Add ${r.title}`}
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-90 disabled:opacity-40"
                    >
                      <Plus className="h-[18px] w-[18px]" strokeWidth={2.6} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : query.trim() ? (
            <p className="py-10 text-center font-serif text-[15px] italic text-muted-foreground">
              nothing found for “{query.trim()}”.
            </p>
          ) : (
            <p className="py-10 text-center font-serif text-[15px] italic text-muted-foreground">
              search for a film or show to add.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════ SHEET MODE ════════════════════════════
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      {/* header */}
      <header
        className="flex items-center justify-between border-b border-border px-4 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <button
          onClick={onClose}
          disabled={isSaving}
          className="font-headline text-[15px] lowercase tracking-tight text-muted-foreground transition-colors active:text-foreground disabled:opacity-50"
        >
          cancel
        </button>
        <h2 className="font-headline text-[17px] font-bold lowercase tracking-tight">your top 5</h2>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 font-headline text-[15px] font-bold lowercase tracking-tight text-primary transition-transform active:scale-95 disabled:opacity-50"
        >
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          save
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-4">
        <div className="mx-auto max-w-2xl">
          <p className="font-serif text-[15px] italic leading-snug text-muted-foreground">
            your five desert-island films, the ones that say who you are. drag to rank.
          </p>

          {/* 5 slots */}
          <div ref={rowRef} className="mt-4 grid grid-cols-5 gap-2.5">
            {Array.from({ length: MAX }).map((_, i) => {
              const m = selected[i];
              if (m) {
                const isDragging = dragIndex === i;
                return (
                  <div
                    key={m.id}
                    onPointerDown={(e) => onSlotPointerDown(e, i)}
                    onPointerMove={onSlotPointerMove}
                    onPointerUp={onSlotPointerUp}
                    onPointerCancel={onSlotPointerUp}
                    style={{ touchAction: 'none' }}
                    className={`relative aspect-[3/4] cursor-grab overflow-hidden rounded-[12px] border border-hair bg-secondary transition-transform ${
                      isDragging ? 'z-10 scale-105 shadow-photo' : ''
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.posterUrl} alt={m.title} className="h-full w-full object-cover" draggable={false} />
                    <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shadow">
                      {i + 1}
                    </span>
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => removeAt(i)}
                      aria-label={`Remove ${m.title}`}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform active:scale-90"
                    >
                      <X className="h-3 w-3" strokeWidth={2.6} />
                    </button>
                  </div>
                );
              }
              return (
                <button
                  key={`empty-${i}`}
                  onClick={() => setMode('search')}
                  className="relative flex aspect-[3/4] items-center justify-center rounded-[12px] border border-dashed border-rule text-muted-foreground transition-colors active:bg-foreground/[0.03]"
                >
                  <span className="absolute left-1.5 top-1 font-mono text-[11px] text-faint">{i + 1}</span>
                  <Plus className="h-5 w-5" strokeWidth={1.6} />
                </button>
              );
            })}
          </div>

          {/* status */}
          <p className="mt-3 font-mono text-[11px] tabular-nums text-muted-foreground">
            {selected.length} of {MAX} picked
            {spotsOpen > 0 ? ` · ${spotsOpen} spot${spotsOpen === 1 ? '' : 's'} open` : ' · full'}
          </p>

          {/* search trigger */}
          <button
            onClick={() => setMode('search')}
            className="mt-4 flex h-12 w-full items-center gap-2.5 rounded-[14px] border border-hair bg-sunken px-3.5 text-left transition-colors active:bg-foreground/[0.03]"
          >
            <Search className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={2} />
            <span className="font-body text-[15px] text-muted-foreground">add a film to your canon…</span>
          </button>

          {/* suggested for you */}
          <div className="mt-6">
            <div className="cc-eyebrow mb-2.5">suggested for you</div>
            {suggestions.filter((s) => !selected.some((m) => m.tmdbId === s.tmdbId)).length > 0 ? (
              <div className="overflow-hidden rounded-[18px] border border-hair bg-card">
                {suggestions
                  .filter((s) => !selected.some((m) => m.tmdbId === s.tmdbId))
                  .slice(0, 8)
                  .map((s, i, arr) => (
                    <div
                      key={`${s.mediaType}-${s.tmdbId}`}
                      className={`relative flex items-center gap-3 px-3 py-2.5 ${
                        i < arr.length - 1 ? 'border-b border-rule' : ''
                      }`}
                    >
                      <div className="h-[58px] w-[42px] flex-shrink-0 overflow-hidden rounded-[7px] bg-secondary">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-headline text-[15px] font-semibold lowercase tracking-tight text-foreground">
                          {s.title}
                        </div>
                        <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                          {s.year || '—'} · {s.mediaType === 'tv' ? 'tv' : 'film'}
                        </div>
                      </div>
                      <button
                        onClick={() => addCandidate(s)}
                        disabled={selected.length >= MAX}
                        aria-label={`Add ${s.title}`}
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-90 disabled:opacity-40"
                      >
                        <Plus className="h-[18px] w-[18px]" strokeWidth={2.6} />
                      </button>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="flex flex-col items-center rounded-[18px] border border-dashed border-rule py-10 text-muted-foreground">
                <Film className="mb-2 h-6 w-6" strokeWidth={1.4} />
                <p className="cc-lead text-[14px]">search above to build your canon.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
