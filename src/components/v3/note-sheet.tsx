'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { ChevronLeft, Search } from 'lucide-react';
import type { Movie } from '@/lib/types';
import { haptic } from '@/lib/haptics';

const POSTER_FALLBACK = 'https://picsum.photos/seed/cinechrony/500/750';

/**
 * F (notes) — "note on this film". The composer/editor for a collaborator note,
 * attached to a film in a list. Rendered through a PORTAL to `document.body`
 * (z-[95]) for the same reason as `how-was-it-sheet`: it's mounted from inside
 * the list page (under PullToRefresh's transformed container) and contains a
 * textarea, so a plain `fixed` overlay would be trapped and the iOS keyboard
 * would fight a Vaul focus-trap. A full-screen, `visualViewport`-pinned page
 * sidesteps both.
 *
 * Two modes:
 *  - a film is already chosen (edit your note, or "add a note" from a film's
 *    drawer) → straight to the editor;
 *  - no film chosen (the board's "add a note for collaborators…" composer) →
 *    pick a film from THIS list first, then the editor.
 */
export function NoteSheet({
  isOpen,
  films,
  movie,
  initialText = '',
  listName,
  currentUserId,
  saving = false,
  onSave,
  onClose,
}: {
  isOpen: boolean;
  /** The list's films — the picker source when no film is preselected. */
  films: Movie[];
  /** Preselected film (edit / from a drawer). When null the picker shows first. */
  movie?: Movie | null;
  initialText?: string;
  listName?: string;
  /** Used to prefill an existing note when a film is picked from the list. */
  currentUserId?: string;
  saving?: boolean;
  onSave: (movieId: string, text: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Movie | null>(movie ?? null);
  const [text, setText] = useState(initialText);
  const [pickQuery, setPickQuery] = useState('');
  const [kbInset, setKbInset] = useState(0);
  const [mounted, setMounted] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (isOpen) {
      setSelected(movie ?? null);
      setText(initialText);
      setPickQuery('');
      setKbInset(0);
    }
  }, [isOpen, movie, initialText]);

  // Lock body scroll + track the keyboard inset so the textarea clears it.
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    const vv = window.visualViewport;
    const onResize = () => { if (vv) setKbInset(Math.max(0, window.innerHeight - vv.height)); };
    onResize();
    vv?.addEventListener('resize', onResize);
    vv?.addEventListener('scroll', onResize);
    return () => {
      document.body.style.overflow = '';
      vv?.removeEventListener('resize', onResize);
      vv?.removeEventListener('scroll', onResize);
    };
  }, [isOpen]);

  // Grow the textarea to fit prefilled text on open / film-pick (edit mode) —
  // onChange only fires on keystroke, so a long existing note would clip to
  // rows={4} until the first keypress otherwise.
  useEffect(() => {
    const el = textRef.current;
    if (!isOpen || !selected || !el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [isOpen, selected, text]);

  if (!isOpen || !mounted) return null;

  const picking = !selected;
  const q = pickQuery.trim().toLowerCase();
  const pickList = q
    ? films.filter((f) => f.title?.toLowerCase().includes(q))
    : films;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex flex-col bg-background" role="dialog" aria-label="note on this film">
      {/* header — cancel/back · title · save */}
      <header
        className="flex flex-shrink-0 items-center justify-between border-b border-hair px-4 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.625rem)' }}
      >
        <button
          onClick={() => {
            haptic('light');
            // From the editor (reached via the picker) → back to the picker;
            // otherwise close.
            if (!movie && selected) { setSelected(null); setText(''); }
            else onClose();
          }}
          disabled={saving}
          aria-label={!movie && selected ? 'Back to film picker' : 'Cancel'}
          className="flex h-9 items-center -ml-1.5 rounded-full px-1.5 text-primary transition-transform active:scale-90 disabled:opacity-50"
        >
          {!movie && selected ? <ChevronLeft className="h-6 w-6" strokeWidth={2.2} /> : <span className="font-ui text-[16px]">cancel</span>}
        </button>
        <span className="font-headline text-[18px] font-bold lowercase tracking-[-0.02em]">
          {picking ? 'pick a film' : 'note on this film'}
        </span>
        {picking ? (
          <span className="w-12" />
        ) : (
          <button
            onClick={() => { haptic('success'); onSave(selected!.id, text); }}
            disabled={saving}
            className="font-ui text-[16px] font-bold text-primary transition-transform active:scale-95 disabled:opacity-50"
          >
            save
          </button>
        )}
      </header>

      {picking ? (
        /* ── film picker ── */
        <div className="flex-1 overflow-y-auto px-4 pt-4" style={{ paddingBottom: Math.max(24, kbInset + 24) }}>
          <div className="mb-3 flex h-12 items-center gap-2 rounded-[14px] border border-hair bg-sunken px-3.5">
            <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.8} />
            <input
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              placeholder="which film is this note about…"
              autoComplete="off"
              className="flex-1 border-0 bg-transparent font-body text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="space-y-1">
            {pickList.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  haptic('selection');
                  setSelected(f);
                  // Picking a film you've already noted = edit that note.
                  setText((currentUserId && f.notes?.[currentUserId]) || '');
                }}
                className="flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors active:bg-secondary"
              >
                <div className="relative h-[60px] w-10 flex-shrink-0 overflow-hidden rounded-[8px] bg-sunken">
                  <Image src={f.posterUrl || POSTER_FALLBACK} alt="" fill className="object-cover" sizes="40px" />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-headline text-[15px] font-bold lowercase tracking-tight">{f.title}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{f.year}</div>
                </div>
              </button>
            ))}
            {pickList.length === 0 && (
              <p className="py-10 text-center font-mono text-[12px] text-muted-foreground lowercase">no films match</p>
            )}
          </div>
        </div>
      ) : (
        /* ── note editor ── */
        <div className="flex-1 overflow-y-auto px-5 pt-4" style={{ paddingBottom: Math.max(24, kbInset + 24) }}>
          {/* film chip */}
          <div className="flex items-center gap-3.5">
            <div className="relative h-[68px] w-[46px] flex-shrink-0 overflow-hidden rounded-[10px] bg-sunken shadow-photo">
              <Image src={selected!.posterUrl || POSTER_FALLBACK} alt="" fill className="object-cover" sizes="46px" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-headline text-[20px] font-bold lowercase tracking-tight">{selected!.title}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground lowercase">
                your note{listName ? ` · in ${listName.toLowerCase()}` : ''}
              </div>
            </div>
          </div>

          {/* textarea */}
          <div className="mt-5 rounded-2xl border border-hair bg-card p-4 shadow-press">
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 280)}px`;
              }}
              maxLength={500}
              rows={4}
              autoFocus
              placeholder="what should your collaborators know…"
              className="w-full resize-none bg-transparent font-ui text-[16.5px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground/55 caret-primary"
            />
          </div>

          <p className="mt-4 text-center font-mono text-[10.5px] leading-relaxed text-muted-foreground lowercase">
            visible to everyone on this list
          </p>
        </div>
      )}
    </div>,
    document.body,
  );
}
