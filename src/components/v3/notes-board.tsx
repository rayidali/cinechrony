'use client';

import { useMemo } from 'react';
import Image from 'next/image';
import { Pencil } from 'lucide-react';
import type { Movie } from '@/lib/types';
import { useUser } from '@/firebase';
import { ProfileAvatar } from '@/components/profile-avatar';
import { haptic } from '@/lib/haptics';

const POSTER_FALLBACK = 'https://picsum.photos/seed/cinechrony/500/750';

/** Best-effort Firestore-Timestamp | Date | string | number → Date. */
function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate();
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') { const d = new Date(v); return isNaN(+d) ? null : d; }
  if (typeof (v as { seconds?: number }).seconds === 'number') return new Date((v as { seconds: number }).seconds * 1000);
  return null;
}

/** Compact relative time — "3h", "2d", or a "dd.mm" date. Empty for unknown. */
function timeAgo(v: unknown): string {
  const d = toDate(v);
  if (!d) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const dd = Math.floor(h / 24);
  if (dd < 7) return `${dd}d`;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

type NoteEntry = {
  key: string;
  movie: Movie;
  uid: string;
  text: string;
  author: { username: string | null; displayName: string | null; photoURL: string | null } | undefined;
  time: unknown;
  mine: boolean;
};

/**
 * The "notes" tab — a chronological board of every collaborator note across the
 * list, each tied to a film via a chip. Owner/collaborator only (the parent
 * gates the tab). Reads ZERO extra docs: it flattens the movies already loaded
 * on the list page. Ordered oldest → newest (chat-style); the composer sits at
 * the bottom.
 */
export function NotesBoard({
  movies,
  query = '',
  onOpenFilm,
  onAddNote,
  onEditNote,
}: {
  movies: Movie[];
  query?: string;
  onOpenFilm: (movie: Movie) => void;
  onAddNote: () => void;
  onEditNote: (movie: Movie, text: string) => void;
}) {
  const { user } = useUser();

  const entries = useMemo<NoteEntry[]>(() => {
    const out: NoteEntry[] = [];
    for (const movie of movies) {
      const notes = movie.notes;
      if (!notes) continue;
      for (const [uid, text] of Object.entries(notes)) {
        if (!text) continue;
        out.push({
          key: `${movie.id}:${uid}`,
          movie,
          uid,
          text,
          author: movie.noteAuthors?.[uid],
          time: movie.noteUpdatedAt?.[uid],
          mine: uid === user?.uid,
        });
      }
    }
    // Oldest → newest (chat order). A just-saved own note has a PENDING
    // serverTimestamp (null over the wire for a beat) — sort it as newest
    // (Date.now()) so it lands at the bottom by the composer instead of
    // flashing at the top. Others' untimed (pre-feature) notes sort oldest.
    out.sort((a, b) => {
      const ta = toDate(a.time)?.getTime() ?? (a.mine ? Date.now() : 0);
      const tb = toDate(b.time)?.getTime() ?? (b.mine ? Date.now() : 0);
      return ta - tb;
    });
    const q = query.trim().toLowerCase();
    if (!q) return out;
    return out.filter((e) =>
      e.text.toLowerCase().includes(q) ||
      e.movie.title?.toLowerCase().includes(q) ||
      (e.author?.username || '').toLowerCase().includes(q) ||
      (e.author?.displayName || '').toLowerCase().includes(q),
    );
  }, [movies, user?.uid, query]);

  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-hair bg-secondary px-5 py-12 text-center">
          <p className="font-serif italic text-[15px] text-muted-foreground">
            the margins are blank. write something they&rsquo;ll remember.
          </p>
        </div>
      ) : (
        entries.map((e) => {
          const name = e.author?.username || e.author?.displayName || 'user';
          // Own note with a still-resolving serverTimestamp reads as "now".
          const rel = timeAgo(e.time) || (e.mine ? 'now' : '');
          return (
            <div key={e.key} className="rounded-[16px] border border-hair bg-card p-4 shadow-lift">
              {/* byline */}
              <div className="flex items-center gap-2.5">
                <ProfileAvatar
                  photoURL={e.author?.photoURL ?? null}
                  displayName={e.author?.displayName ?? null}
                  username={e.author?.username ?? null}
                  size="xs"
                />
                <span className={`font-ui text-[13px] font-bold ${e.mine ? 'text-primary' : 'text-foreground'}`}>
                  {e.mine ? 'your note' : `@${name}`}
                </span>
                {rel && <span className="font-mono text-[11px] text-muted-foreground">{rel}</span>}
                <span className="flex-1" />
                {e.mine && (
                  <button
                    onClick={() => { haptic('light'); onEditNote(e.movie, e.text); }}
                    className="font-ui text-[12px] font-semibold text-primary transition-opacity active:opacity-60"
                  >
                    edit
                  </button>
                )}
              </div>

              {/* note text */}
              <p className="mt-2.5 font-ui text-[15px] leading-[1.5] text-foreground whitespace-pre-wrap break-words">
                {e.text}
              </p>

              {/* film chip → that film's drawer */}
              <button
                onClick={() => { haptic('light'); onOpenFilm(e.movie); }}
                aria-label={`Open ${e.movie.title}`}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-hair bg-sunken py-1 pl-1 pr-3 transition-transform active:scale-95"
              >
                <span className="relative h-7 w-7 overflow-hidden rounded-full bg-background">
                  <Image src={e.movie.posterUrl || POSTER_FALLBACK} alt="" fill className="object-cover" sizes="28px" />
                </span>
                <span className="max-w-[180px] truncate font-headline text-[13px] font-bold lowercase tracking-tight">
                  {e.movie.title}
                </span>
              </button>
            </div>
          );
        })
      )}

      {/* composer pill → pick a film → note sheet */}
      <button
        onClick={() => { haptic('light'); onAddNote(); }}
        className="flex w-full items-center gap-3 rounded-[16px] border border-hair bg-card px-4 py-3.5 text-left transition-transform active:scale-[0.99]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Pencil className="h-4 w-4" strokeWidth={2} />
        </span>
        <span className="font-serif italic text-[14px] text-muted-foreground">add a note for collaborators&hellip;</span>
      </button>
    </div>
  );
}
