'use client';

import { useRouter } from 'next/navigation';
import { Section } from '@/components/v3/section';
import { seededGradient } from '@/lib/seeded-gradient';
import { useLovedLists } from '@/components/featured-carousel';

/**
 * "from the community" — gradient list tiles (Phase 0.7 / v3,
 * `ios-home.jsx::ListsForYou`). Real loved lists (the ones past the featured
 * hero), tile cover + title + `N films · M saved`. Hidden when there aren't
 * enough lists to fill a second rail.
 */
export function CommunityLists() {
  const router = useRouter();
  const { data } = useLovedLists();

  // The featured hero shows the top 4; this rail shows the rest so we never
  // repeat a list on screen.
  const lists = (data ?? []).slice(4);
  if (lists.length === 0) return null;

  return (
    <section>
      <Section
        eyebrow="lists for you"
        title="from the community"
        trailing={<span className="font-ui font-semibold text-[13px] text-primary">view all</span>}
        className="mb-3.5"
      />
      <div className="flex gap-3.5 overflow-x-auto scrollbar-hide -mx-[18px] px-[18px] pb-1">
        {lists.map((l) => {
          const cover = l.coverImageUrl && l.coverMode !== 'auto' ? l.coverImageUrl : null;
          return (
            <button
              key={l.id}
              onClick={() => l.ownerUsername && router.push(`/profile/${l.ownerUsername}/lists/${l.id}`)}
              className="flex-shrink-0 w-[168px] text-left"
            >
              <div
                className="relative h-[168px] rounded-[20px] overflow-hidden shadow-photo"
                style={!cover ? { background: seededGradient(l.name) } : undefined}
              >
                {cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" className="absolute inset-0 w-full h-full object-cover" />
                )}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(to bottom, rgba(0,0,0,0.25), transparent 40%, rgba(0,0,0,0.7))',
                  }}
                />
                <div className="absolute left-3.5 right-3.5 bottom-3">
                  <div
                    className="font-headline font-bold lowercase text-white leading-[0.98] tracking-[-0.035em] line-clamp-2"
                    style={{ fontSize: 19, textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}
                  >
                    {l.name}
                  </div>
                  <div className="font-mono text-[10px] text-white/[0.82] mt-1.5 tabular-nums">
                    {l.movieCount} films
                    {typeof l.likes === 'number' && l.likes > 0 ? ` · ${formatSaved(l.likes)} saved` : ''}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function formatSaved(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}
