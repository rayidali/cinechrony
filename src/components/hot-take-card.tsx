'use client';

import { Link } from '@/lib/native-nav';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useMovieModal } from '@/contexts/movie-modal-context';
import { seededGradient } from '@/lib/seeded-gradient';
import { haptic } from '@/lib/haptics';
import type { Movie } from '@/lib/types';
import type { HotTake } from '@/lib/reviews-server';

/**
 * HotTakeCard — the "hot take" green quote card (Phase 0.7.5.4, `ios-home.jsx`).
 *
 * A vivid, theme-independent colored card interleaved into the home reel: a big
 * pull-quote of a short, glowing review + the author + the film. Seeded color
 * from the design package palette (`seededGradient`), so it reads the same on
 * paper + projection-room themes (like the reel viewer). Tap the card → the
 * film's drawer (its "conversation" surfaces the full review); tap the handle →
 * the author's profile.
 *
 * Universal: pure client component, semantic-token-free (white-on-color), so it
 * behaves identically in the Capacitor iOS WebView.
 */
function takeToMovie(take: HotTake): Movie {
  return {
    id: `${take.mediaType}_${take.tmdbId}`,
    title: take.movieTitle,
    year: '',
    posterUrl: take.moviePosterUrl || '/placeholder-poster.png',
    posterHint: `${take.movieTitle} poster`,
    addedBy: '',
    status: 'To Watch',
    mediaType: take.mediaType,
    tmdbId: take.tmdbId,
  };
}

export function HotTakeCard({ take }: { take: HotTake }) {
  const { openMovie } = useMovieModal();

  const open = () => {
    haptic('light');
    openMovie(takeToMovie(take));
  };

  const handle = take.author.username
    ? `@${take.author.username}`
    : take.author.displayName || 'someone';

  return (
    <div className="py-2">
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        aria-label={`Open ${take.movieTitle}`}
        className="relative cursor-pointer overflow-hidden rounded-[22px] p-5 text-white shadow-photo transition-transform active:scale-[0.99]"
        style={{ background: seededGradient(take.reviewId) }}
      >
        {/* opening quote mark — big filled serif glyph, top-left */}
        <span
          aria-hidden
          className="block select-none font-serif text-[46px] font-bold leading-[0.55] text-white/25"
        >
          &ldquo;
        </span>

        <p className="mt-2 font-headline text-[22px] font-bold leading-[1.3] tracking-[-0.01em] text-white">
          {take.text}
        </p>

        <div className="mt-4 flex items-center gap-2.5">
          {/* avatar + handle together go to the profile; the rest of the card
              opens the film. */}
          {take.author.username ? (
            <Link
              href={`/profile/${take.author.username}`}
              onClick={(e) => e.stopPropagation()}
              className="flex min-w-0 flex-shrink-0 items-center gap-2 hover:underline"
            >
              <ProfileAvatar
                photoURL={take.author.photoURL}
                displayName={take.author.displayName}
                username={take.author.username}
                size="sm"
              />
              <span className="font-mono text-[12.5px] font-bold text-white">{handle}</span>
            </Link>
          ) : (
            <div className="flex min-w-0 flex-shrink-0 items-center gap-2">
              <ProfileAvatar
                photoURL={take.author.photoURL}
                displayName={take.author.displayName}
                username={take.author.username}
                size="sm"
              />
              <span className="font-mono text-[12.5px] font-bold text-white">{handle}</span>
            </div>
          )}
          {take.movieTitle && (
            <span className="truncate font-mono text-[11px] text-white/60">
              on {take.movieTitle.toLowerCase()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
