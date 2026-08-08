'use client';

/**
 * The conditional blocks of the home screen (Phase D3,
 * `../design-refs-2026-08/screens/03-05*.png`).
 *
 * THE RULE THAT DEFINES THIS FILE: every block renders only when it has
 * something to say. Home is ONE screen whose shape changes with what is
 * actually going on, not three screens (owner decision, 2026-08-07) — the deck
 * states it for unfiled ("only exists when it has something in it") and D3
 * applies it to the whole page. A block with nothing to show returns null
 * rather than an empty state, because an empty state is a thing that nags.
 *
 * THE ORDER IS THE PRODUCT ARGUMENT. Everything above the feed works with zero
 * friends on day one; the feed does not. Home used to lead with follow-graph
 * tabs and discovery rails, which is a cold-start product wearing a movie app's
 * clothes. See PHASE-D-REPOSITION.md §1.
 *
 * They live in one file because they are one screen's vocabulary and share the
 * eyebrow/rail idiom — splitting them would spread four ~40-line components
 * across four files with identical imports.
 */

import { useMemo } from 'react';
import Image from 'next/image';
import { collection, query, limit } from 'firebase/firestore';
import { ChevronRight, CalendarDays } from 'lucide-react';
import { Link, useRouter } from '@/lib/native-nav';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { seededGradient } from '@/lib/seeded-gradient';
import { haptic } from '@/lib/haptics';
import { UNFILED_LIST_ID } from '@/lib/unfiled-constants';
import { formatNightTimeLabel } from '@/lib/movie-night-format';
import type { Movie } from '@/lib/types';
import type { MovieNightView } from '@/lib/movie-night-types';

/** eyebrow + optional trailing action, shared by every block below. */
function BlockHead({
  label, count, action, onAction,
}: { label: string; count?: number; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="cc-eyebrow text-muted-foreground">
        {label}{count !== undefined ? ` · ${count}` : ''}
      </div>
      {action && (
        <button onClick={onAction} className="font-ui font-semibold text-[13px] text-primary active:opacity-60">
          {action}
        </button>
      )}
    </div>
  );
}

// ── your week ────────────────────────────────────────────────────────────

/**
 * The seven-day strip. Stands in for the tonight-hero on any day without a
 * night, so home always opens on *when*, never on a blank.
 *
 * Week starts Monday, matching the mockup and the create sheet's `weekDays`.
 */
export function YourWeek({ nights }: { nights: MovieNightView[] }) {
  const router = useRouter();
  const { days, soonest } = useMemo(() => {
    const now = new Date();
    // Monday-first: getDay() is 0=Sun, so Sunday needs to land on index 6.
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    const byDay = new Map<string, MovieNightView>();
    for (const n of nights) {
      const d = new Date(n.scheduledFor);
      byDay.set(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, n);
    }
    const out = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      return {
        date: d,
        isToday: d.toDateString() === now.toDateString(),
        night: byDay.get(key) ?? null,
      };
    });
    return { days: out, soonest: nights[0] ?? null };
  }, [nights]);

  const range = `${String(days[0].date.getDate()).padStart(2, '0')}.${String(days[0].date.getMonth() + 1).padStart(2, '0')}`
    + ` → ${String(days[6].date.getDate()).padStart(2, '0')}.${String(days[6].date.getMonth() + 1).padStart(2, '0')}`;

  return (
    <section className="mt-6">
      <BlockHead label={`your week · ${range}`} />
      <div className="mt-2.5 flex items-stretch justify-between rounded-[16px] border border-hair bg-card px-1.5 py-3">
        {days.map(({ date, isToday, night }) => (
          <div key={date.toISOString()} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="font-mono text-[10px] lowercase text-muted-foreground">
              {['m', 't', 'w', 't', 'f', 's', 's'][(date.getDay() + 6) % 7]}
            </span>
            {/* "has a night" and "is today" are composed, not exclusive. The
                first cut let a night override today entirely, and on a day that
                was BOTH — the single most likely day to care about — you could
                no longer tell which one you were standing on. */}
            <span
              className={[
                'flex h-8 w-8 items-center justify-center rounded-full font-mono text-[13px] tabular-nums',
                night ? 'bg-primary text-primary-foreground font-bold' : 'text-muted-foreground',
                isToday ? 'ring-1 ring-foreground/45 ring-offset-2 ring-offset-card' : '',
              ].join(' ')}
            >
              {date.getDate()}
            </span>
            <span className={`h-1 w-1 rounded-full ${night ? 'bg-primary' : 'bg-transparent'}`} />
          </div>
        ))}
      </div>
      {soonest && (
        <button
          onClick={() => { haptic('light'); router.push(`/home?night=${soonest.id}`); }}
          className="mt-2.5 flex w-full items-center gap-2 text-left active:opacity-60"
        >
          <CalendarDays className="h-3.5 w-3.5 flex-shrink-0 text-primary" strokeWidth={2} />
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {formatNightTimeLabel(soonest.scheduledFor, soonest.tzOffsetMinutes, soonest.timeTbd)}
            {' · '}{soonest.film.title.toLowerCase()}
          </span>
        </button>
      )}
    </section>
  );
}

// ── needs you ────────────────────────────────────────────────────────────

export type NeedsYouItem = {
  id: string;
  kind: 'movie-night' | 'list-invite' | 'unfiled';
  eyebrow: string;
  title: string;
  meta?: string;
  cta: string;
  onPress: () => void;
};

/**
 * The pending-actions rail. Aggregated on the CLIENT from data home already
 * holds — an endpoint would have re-read three things that are each already in
 * a cache on this screen, which on a free-tier project is the wrong trade.
 */
export function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  if (!items.length) return null;
  return (
    <section className="mt-7">
      <BlockHead label="needs you" count={items.length} />
      <div className="-mx-[18px] mt-2.5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-[18px] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => { haptic('light'); it.onPress(); }}
            className="w-[248px] flex-shrink-0 snap-start rounded-[16px] border border-hair bg-card p-3.5 text-left active:opacity-70 transition-opacity"
          >
            <div className="cc-eyebrow text-muted-foreground">{it.eyebrow}</div>
            <div className="mt-1.5 font-headline font-bold text-[17px] lowercase leading-tight truncate">
              {it.title}
            </div>
            {it.meta && (
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground truncate">{it.meta}</div>
            )}
            <div className="mt-2.5 inline-flex items-center gap-1 font-ui font-semibold text-[13px] text-primary">
              {it.cta}<ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

// ── unfiled ──────────────────────────────────────────────────────────────

/**
 * The poster row for films waiting in the pen, and the only entry point to
 * `/unfiled`. Renders nothing when the pen is empty, which is the deck's rule
 * and the reason there is no permanent bucket in the tab bar.
 *
 * Reads the pen directly — the id is deterministic, so this costs one live
 * listener and no round trip. Returns the count so home can decide layout.
 */
export function useUnfiledFilms(): Movie[] {
  const firestore = useFirestore();
  const { user } = useUser();
  const q = useMemoFirebase(() => {
    if (!user) return null;
    return query(
      collection(firestore, 'users', user.uid, 'lists', UNFILED_LIST_ID, 'movies'),
      limit(12),
    );
  }, [firestore, user]);
  const { data } = useCollection<Movie>(q);
  return data ?? [];
}

export function UnfiledStrip({ films }: { films: Movie[] }) {
  const router = useRouter();
  if (!films.length) return null;
  return (
    <section className="mt-7">
      <BlockHead
        label="unfiled" count={films.length}
        action="file all →" onAction={() => { haptic('light'); router.push('/unfiled'); }}
      />
      <div className="-mx-[18px] mt-2.5 flex gap-2.5 overflow-x-auto px-[18px] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {films.map((f) => (
          <button
            key={f.id}
            onClick={() => { haptic('light'); router.push('/unfiled'); }}
            className="relative h-[132px] w-[88px] flex-shrink-0 overflow-hidden rounded-[12px] bg-sunken active:opacity-80"
          >
            {f.posterUrl ? (
              <Image src={f.posterUrl} alt="" fill className="object-cover" sizes="88px" unoptimized />
            ) : (
              <>
                <div className="absolute inset-0" style={{ background: seededGradient(f.id) }} />
                <span className="absolute inset-0 flex items-end p-2 font-headline text-[12px] font-bold lowercase leading-tight text-white/90">
                  {f.title}
                </span>
              </>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

// ── your lists ───────────────────────────────────────────────────────────

export type HomeList = {
  id: string;
  name: string;
  movieCount: number;
  coverImageUrl: string | null;
};

export function YourLists({ lists, total }: { lists: HomeList[]; total: number }) {
  if (!lists.length) return null;
  return (
    <section className="mt-7">
      <BlockHead label="your lists" count={total} />
      <div className="-mx-[18px] mt-2.5 flex gap-3 overflow-x-auto px-[18px] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {lists.map((l) => (
          <Link
            key={l.id}
            href={`/lists/${l.id}`}
            onClick={() => haptic('light')}
            className="w-[148px] flex-shrink-0 active:opacity-70"
          >
            <div className="relative h-[100px] w-full overflow-hidden rounded-[14px] bg-sunken">
              {l.coverImageUrl ? (
                <Image src={l.coverImageUrl} alt="" fill className="object-cover" sizes="148px" unoptimized />
              ) : (
                <div className="absolute inset-0" style={{ background: seededGradient(l.id) }} />
              )}
            </div>
            <div className="mt-1.5 truncate font-headline text-[15px] font-bold lowercase">{l.name}</div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {l.movieCount} film{l.movieCount === 1 ? '' : 's'}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
