'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { ProfileAvatar } from '@/components/profile-avatar';
import { FollowButton } from '@/components/follow-button';
import { Segmented } from '@/components/v3/segmented';
import { tapKeyDown } from '@/components/movie-cell';
import type { UserProfile } from '@/lib/types';

/**
 * PeopleSheet — the v3 "your people" sheet (design mocks 17 + 18). A
 * full-screen overlay (NOT Vaul — the search input would hit the iOS focus-trap
 * bug) showing a subject's followers + following with per-row follow / unfollow
 * / follow-back and tap-to-profile.
 *
 * Robustness: every row's FollowButton is pre-resolved from the VIEWER's own
 * follower/following sets (loaded once), so there are ZERO per-row status
 * fetches. On the owner's own profile those sets ARE the subject's lists — no
 * extra calls at all.
 */
type PeopleTab = 'followers' | 'following';

type PeopleSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Whose followers/following to show. */
  subjectUid: string;
  /** Subject handle, for the eyebrow. */
  subjectUsername: string | null;
  followersCount: number;
  followingCount: number;
  initialTab: PeopleTab;
};

export function PeopleSheet({
  isOpen,
  onClose,
  subjectUid,
  subjectUsername,
  followersCount,
  followingCount,
  initialTab,
}: PeopleSheetProps) {
  const router = useRouter();
  const { user } = useUser();

  const [tab, setTab] = useState<PeopleTab>(initialTab);
  const [query, setQuery] = useState('');
  const [followers, setFollowers] = useState<UserProfile[]>([]);
  const [following, setFollowing] = useState<UserProfile[]>([]);
  const [myFollowing, setMyFollowing] = useState<Set<string>>(new Set());
  const [myFollowers, setMyFollowers] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  const viewerUid = user?.uid;

  useEffect(() => {
    if (!isOpen) return;
    setTab(initialTab);
    setQuery('');
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const [fr, fg] = await Promise.all([
          apiCall<{ users: UserProfile[] }>('GET', `/api/v1/users/${subjectUid}/followers`),
          apiCall<{ users: UserProfile[] }>('GET', `/api/v1/users/${subjectUid}/following`),
        ]);
        if (cancelled) return;
        const followersList = fr.users ?? [];
        const followingList = fg.users ?? [];
        setFollowers(followersList);
        setFollowing(followingList);

        // Viewer relationship sets — drive every row's button with no per-row
        // fetch. If the viewer IS the subject, the subject's lists already are
        // the viewer's sets (no extra calls).
        if (viewerUid && viewerUid === subjectUid) {
          setMyFollowing(new Set(followingList.map((u) => u.uid)));
          setMyFollowers(new Set(followersList.map((u) => u.uid)));
        } else if (viewerUid) {
          const [mfg, mfr] = await Promise.all([
            apiCall<{ users: UserProfile[] }>('GET', `/api/v1/users/${viewerUid}/following`),
            apiCall<{ users: UserProfile[] }>('GET', `/api/v1/users/${viewerUid}/followers`),
          ]);
          if (cancelled) return;
          setMyFollowing(new Set((mfg.users ?? []).map((u) => u.uid)));
          setMyFollowers(new Set((mfr.users ?? []).map((u) => u.uid)));
        } else {
          setMyFollowing(new Set());
          setMyFollowers(new Set());
        }
      } catch (error) {
        console.error('Failed to load people:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, subjectUid, initialTab, viewerUid]);

  const list = tab === 'followers' ? followers : following;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (u) =>
        (u.displayName || '').toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q),
    );
  }, [list, query]);

  if (!isOpen) return null;

  const openProfile = (username: string | null) => {
    if (!username) return;
    onClose();
    router.push(`/profile/${username}`);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      {/* grabber */}
      <div className="flex justify-center pt-2" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
        <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
      </div>

      {/* header */}
      <div className="flex items-start justify-between px-4 pb-3 pt-2">
        <div className="min-w-0">
          <div className="cc-eyebrow">@{subjectUsername || '…'}</div>
          <h2 className="mt-0.5 font-headline text-[26px] font-bold lowercase leading-none tracking-tight">
            your people
          </h2>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-transform active:scale-90"
        >
          <X className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </div>

      {/* segmented */}
      <div className="px-4 pb-3">
        <Segmented
          value={tab}
          onChange={(v) => {
            setTab(v as PeopleTab);
            setQuery('');
          }}
          options={[
            { id: 'followers', label: `followers ${followersCount}` },
            { id: 'following', label: `following ${followingCount}` },
          ]}
        />
      </div>

      {/* search */}
      <div className="px-4 pb-2">
        <div className="flex h-12 items-center gap-2.5 rounded-[14px] border border-hair bg-sunken px-3.5">
          <Search className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`search ${tab}`}
            className="w-full bg-transparent font-body text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
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
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        {isLoading ? (
          <div className="space-y-4 pt-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-11 w-11 flex-shrink-0 rounded-full bg-secondary animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-1/3 rounded bg-secondary animate-pulse" />
                  <div className="h-2.5 w-1/4 rounded bg-secondary animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <div>
            {filtered.map((person, i) => (
              <div
                key={person.uid}
                role="button"
                tabIndex={0}
                onClick={() => openProfile(person.username)}
                onKeyDown={tapKeyDown(() => openProfile(person.username))}
                aria-label={`View ${person.displayName || person.username}'s profile`}
                className="relative flex cursor-pointer items-center gap-3 py-3 transition-colors active:bg-foreground/[0.03]"
              >
                <ProfileAvatar
                  photoURL={person.photoURL}
                  displayName={person.displayName}
                  username={person.username}
                  size="md"
                  className="flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-headline text-[15px] font-semibold lowercase tracking-tight text-foreground">
                    {person.displayName || person.username}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    @{person.username}
                  </div>
                  {person.bio && (
                    <div className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{person.bio}</div>
                  )}
                </div>
                <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
                  <FollowButton
                    targetUserId={person.uid}
                    targetUsername={person.username || ''}
                    initialIsFollowing={myFollowing.has(person.uid)}
                    initialIsFollowedByTarget={myFollowers.has(person.uid)}
                    size="sm"
                  />
                </div>
                {i < filtered.length - 1 && (
                  <div className="absolute bottom-0 left-[56px] right-0 h-px bg-rule" />
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="py-12 text-center font-serif text-[15px] italic text-muted-foreground">
            {query.trim()
              ? `no one matching “${query.trim()}”.`
              : tab === 'followers'
                ? 'no followers yet.'
                : 'not following anyone yet.'}
          </p>
        )}
      </div>
    </div>
  );
}
