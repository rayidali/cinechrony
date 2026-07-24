'use client';

import Image from 'next/image';
import { Film, Loader2, type LucideIcon } from 'lucide-react';
import type { MovieNightFilm } from '@/lib/movie-night-types';

/**
 * Movie Night — shared v3 primitives (MOVIE-NIGHT-PLAN.md § S3). Re-expressed
 * from the design handoff's `HeroCTA`/`Poster` with the app's real tokens
 * (bg-primary/bg-sunken/border-hair/shadow-fab etc — see `globals.css`), not
 * the design prototype's raw oklch values or scaffolding.
 */

/** The hero "propose it" pill — film-red, 52px, lowercase Bricolage label +
 *  leading icon, optional centered mono sub-line. Disabled = sunken/faint. */
export function NightHeroCTA({
  label,
  icon: Icon,
  disabled,
  loading,
  sub,
  onTap,
}: {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  loading?: boolean;
  sub?: string | null;
  onTap: () => void;
}) {
  const isDisabled = !!disabled || !!loading;
  return (
    <div>
      <button
        type="button"
        disabled={isDisabled}
        onClick={onTap}
        className={`flex h-[52px] w-full items-center justify-center gap-2 rounded-[15px] font-headline text-[18px] font-bold lowercase tracking-[-0.02em] transition-transform active:scale-[0.98] disabled:active:scale-100 ${
          disabled ? 'bg-sunken text-faint' : 'bg-primary text-primary-foreground shadow-fab'
        }`}
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.4} />
        ) : (
          <Icon className="h-5 w-5" strokeWidth={2.4} />
        )}
        {label}
      </button>
      {sub && <p className="mt-2.5 text-center font-mono text-[10px] leading-relaxed text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** 2:3 poster with the MN05 dashed no-poster fallback (film icon + "no poster"). */
export function NightPoster({
  film,
  rounded = 'rounded-[10px]',
  className = '',
}: {
  film: Pick<MovieNightFilm, 'title' | 'posterUrl'> | null;
  rounded?: string;
  className?: string;
}) {
  if (!film || !film.posterUrl) {
    return (
      <div
        className={`relative flex aspect-[2/3] w-full flex-col items-center justify-center gap-1.5 border border-dashed border-rule bg-sunken ${rounded} ${className}`}
      >
        <Film className="h-5 w-5 text-faint" strokeWidth={1.4} />
        <span className="font-mono text-[7px] font-bold uppercase tracking-[0.1em] text-faint">no poster</span>
      </div>
    );
  }
  return (
    <div className={`relative aspect-[2/3] w-full overflow-hidden bg-sunken shadow-photo ${rounded} ${className}`}>
      <Image src={film.posterUrl} alt="" fill className="object-cover" sizes="120px" />
    </div>
  );
}

/** `2014 · 2h 49m` / `2024 · tv` — `MovieNightFilm` carries no genre field
 *  (unlike the design mock's `year · runtime · genre`), so the meta line is
 *  year + runtime (+ "tv" for series) only. */
export function nightFilmMeta(film: MovieNightFilm): string {
  const parts: string[] = [];
  if (film.year) parts.push(film.year);
  if (film.runtime) {
    const h = Math.floor(film.runtime / 60);
    const m = film.runtime % 60;
    parts.push(h > 0 ? `${h}h ${m}m` : `${m}m`);
  }
  if (film.mediaType === 'tv') parts.push('tv');
  return parts.join(' · ');
}

/** `8:00 pm` — lowercase 12h tabular, matches the server's `formatNightTime`. */
export function formatTimeOfDay(t: { hour: number; minute: number }): string {
  const h = t.hour % 12 === 0 ? 12 : t.hour % 12;
  const ampm = t.hour >= 12 ? 'pm' : 'am';
  return `${h}:${String(t.minute).padStart(2, '0')} ${ampm}`;
}

/** The shared propose-it CTA state — same rule everywhere it's tappable
 *  (main sheet, date/time sheet, custom-time entry): no film → pick a film;
 *  no time → add a time; already past → rejected; else the calm default sub. */
export function describeNightCta(
  film: MovieNightFilm | null,
  when: Date | null,
): { disabled: boolean; sub: string } {
  if (!film) return { disabled: true, sub: 'pick a film to propose it' };
  if (!when) return { disabled: true, sub: 'add a time to propose it' };
  if (when.getTime() <= Date.now()) return { disabled: true, sub: "pick a night that hasn't happened yet" };
  return { disabled: false, sub: "your people get a ping. you'll get a reminder before showtime." };
}
