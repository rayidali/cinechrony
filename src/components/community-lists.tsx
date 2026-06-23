'use client';

import { useRouter } from 'next/navigation';
import { Section, ViewAll } from '@/components/v3/section';
import { seededGradient } from '@/lib/seeded-gradient';
import { useLovedLists } from '@/components/featured-carousel';
import { haptic } from '@/lib/haptics';
import type { ListMemberAvatar } from '@/lib/lists-server';

/**
 * "from the community" — info-dense list cards (Phase 0.7 / v3, `ios-home.jsx::
 * ListsForYou`). Per the design: contributor avatars · title · a watched-progress
 * bar · `N/M watched · @author`. Real loved/community lists (the ones past the
 * featured hero). Hidden when there aren't enough to fill a second rail.
 */
export function CommunityLists({ onViewAll }: { onViewAll?: () => void }) {
  const router = useRouter();
  const { data } = useLovedLists();

  // The featured hero shows the top 3; this rail shows the rest so we never
  // repeat a list on screen.
  const lists = (data ?? []).slice(3);
  if (lists.length === 0) return null;

  return (
    <section>
      <Section
        eyebrow="lists for you"
        title="from the community"
        trailing={<ViewAll onTap={onViewAll} />}
        className="mb-3.5"
      />
      <div className="flex gap-3.5 overflow-x-auto scrollbar-hide -mx-[18px] px-[18px] pb-1">
        {lists.map((l) => {
          const cover = l.coverImageUrl && l.coverMode !== 'auto' ? l.coverImageUrl : null;
          const pct =
            l.movieCount > 0 ? Math.min(100, Math.round((l.watchedCount / l.movieCount) * 100)) : 0;
          return (
            <button
              key={l.id}
              onClick={() => {
                if (!l.ownerUsername) return;
                haptic('light');
                router.push(`/profile/${l.ownerUsername}/lists/${l.id}`);
              }}
              className="flex-shrink-0 w-[204px] text-left"
            >
              <div
                className="relative h-[174px] rounded-[20px] overflow-hidden shadow-photo"
                style={!cover ? { background: seededGradient(l.name) } : undefined}
              >
                {cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" className="absolute inset-0 w-full h-full object-cover" />
                )}
                {/* dark wash for the editorial card look + legibility */}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.42) 45%, rgba(0,0,0,0.66) 100%)',
                  }}
                />
                <div className="absolute inset-0 p-4 flex flex-col justify-between">
                  <AvatarCluster members={l.members} />
                  <div>
                    <div
                      className="font-headline font-bold lowercase text-white text-[17px] leading-[1.03] tracking-[-0.035em] line-clamp-2"
                      style={{ textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}
                    >
                      {l.name}
                    </div>
                    <div className="mt-2 h-[3px] rounded-full bg-white/25 overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1.5 truncate font-mono text-[10px] text-white/80 tabular-nums">
                      {l.watchedCount}/{l.movieCount} watched
                      {l.ownerUsername ? ` · @${l.ownerUsername}` : ''}
                    </div>
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

/** Overlapping contributor avatars (owner + collaborators), top-left of a card. */
function AvatarCluster({ members }: { members: ListMemberAvatar[] }) {
  const shown = members.slice(0, 3);
  if (shown.length === 0) return <div />;
  return (
    <div className="flex">
      {shown.map((m, i) => (
        <span
          key={i}
          className={`h-7 w-7 rounded-full overflow-hidden ring-2 ring-black/40 flex items-center justify-center ${
            i > 0 ? '-ml-2.5' : ''
          }`}
          style={{
            zIndex: 10 - i,
            background: m.photoURL ? undefined : seededGradient(m.username || `m${i}`, 140),
          }}
        >
          {m.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.photoURL} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="font-headline font-bold text-[11px] text-white">
              {(m.username || '?').charAt(0).toUpperCase()}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
