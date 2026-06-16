'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Check, Loader2, ChevronLeft } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { ProfileAvatar } from '@/components/profile-avatar';
import { haptic } from '@/lib/haptics';
import type { UserProfile, TaggedUser } from '@/lib/types';

/**
 * F04 "tag friends" (also reused to manage the close-friends list).
 *
 * A FULL-SCREEN overlay — NOT a Vaul drawer — because it hosts a live search
 * input, and a typing input inside a Vaul drawer hits the iOS WKWebView
 * focus-trap bug (same reason people-sheet / search-overlay avoid Vaul). Shows
 * the caller's following with checkmarks; picked people are removable pills;
 * the done button carries a live count.
 *
 * Selection is parent-controlled (value + onChange). `onDone` commits (distinct
 * from `onClose` = cancel) so a "cancel" never persists. `seedFollowing` lets a
 * caller hand in an already-fetched following list (close-friends manage) so we
 * don't re-read it.
 */
function toTagged(u: UserProfile): TaggedUser {
  return { uid: u.uid, username: u.username, displayName: u.displayName, photoURL: u.photoURL };
}

export function TagFriendsSheet({
  isOpen,
  value,
  onClose,
  onChange,
  onDone,
  title = 'tag friends',
  seedFollowing,
}: {
  isOpen: boolean;
  value: TaggedUser[];
  onClose: () => void;
  onChange: (next: TaggedUser[]) => void;
  /** Commit (the "done" button). Defaults to onClose. onClose alone = cancel. */
  onDone?: () => void;
  /** Override the sheet title (e.g. "close friends" when managing the circle). */
  title?: string;
  /** Pre-fetched following list to avoid a duplicate read (close-friends mode). */
  seedFollowing?: UserProfile[];
}) {
  const { user } = useUser();
  const [query, setQuery] = useState('');
  const [following, setFollowing] = useState<UserProfile[]>([]);
  const [results, setResults] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedById = useMemo(() => new Map(value.map((u) => [u.uid, u])), [value]);

  // Load the caller's following once per open (unless handed in).
  useEffect(() => {
    if (!isOpen || !user?.uid) return;
    setQuery('');
    setResults([]);
    if (seedFollowing) { setFollowing(seedFollowing); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    apiCall<{ users: UserProfile[] }>('GET', `/api/v1/users/${user.uid}/following?limit=200`)
      .then((res) => { if (!cancelled) setFollowing(res.users ?? []); })
      .catch(() => { if (!cancelled) setFollowing([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, user?.uid, seedFollowing]);

  // Debounced user search when a query is present.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(() => {
      apiCall<{ users: UserProfile[] }>('GET', `/api/v1/users/search?q=${encodeURIComponent(q)}`)
        .then((res) => { if (!cancelled) setResults(res.users ?? []); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 280);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  if (!isOpen) return null;
  const list = query.trim() ? results : following;

  const toggle = (u: UserProfile) => {
    const on = selectedById.has(u.uid);
    haptic(on ? 'selection' : 'light');
    onChange(on ? value.filter((x) => x.uid !== u.uid) : [...value, toTagged(u)]);
  };

  const remove = (uid: string) => {
    haptic('selection');
    onChange(value.filter((x) => x.uid !== uid));
  };

  return (
    <div className="fixed inset-0 z-[97] flex flex-col bg-background">
      {/* header */}
      <div className="flex items-center justify-between px-4 pb-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.6rem)' }}>
        <button onClick={() => { haptic('light'); onClose(); }} className="inline-flex items-center font-ui font-semibold text-[15px] text-muted-foreground active:opacity-60">
          <ChevronLeft className="h-5 w-5 -ml-1" strokeWidth={2} /> cancel
        </button>
        <span className="font-headline font-bold text-[17px] lowercase tracking-[-0.02em]">{title}</span>
        <button onClick={() => { haptic('light'); (onDone ?? onClose)(); }} className="font-ui font-bold text-[15px] text-primary active:opacity-60">
          done{value.length > 0 ? ` · ${value.length}` : ''}
        </button>
      </div>

      {/* search */}
      <div className="px-4 pb-2">
        <div className="flex h-11 items-center gap-2.5 rounded-[14px] border border-hair bg-sunken px-3.5">
          <Search className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={2} />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search friends"
            className="w-full bg-transparent font-body text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear" className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-foreground/10 text-muted-foreground">
              <X className="h-3 w-3" strokeWidth={2.6} />
            </button>
          )}
        </div>
      </div>

      {/* picked pills */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {value.map((u) => (
            <button key={u.uid} onClick={() => remove(u.uid)} className="inline-flex items-center gap-1.5 rounded-full border border-hair bg-sunken pl-1 pr-2.5 py-1 active:opacity-70">
              <ProfileAvatar photoURL={u.photoURL} displayName={u.displayName} username={u.username} size="xs" />
              <span className="font-mono text-[12px] text-foreground">@{u.username || 'user'}</span>
              <X className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.4} />
            </button>
          ))}
        </div>
      )}

      {/* list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : list.length === 0 ? (
          <p className="font-serif italic text-[15px] text-muted-foreground py-8 text-center">
            {query.trim()
              ? (searching ? 'searching…' : `no one matching "${query.trim()}".`)
              : 'follow some people first to tag them.'}
          </p>
        ) : (
          <div>
            {list.map((u, i) => {
              const on = selectedById.has(u.uid);
              return (
                <button key={u.uid} onClick={() => toggle(u)} className="relative w-full flex items-center gap-3 py-3 text-left active:bg-foreground/[0.03]">
                  <ProfileAvatar photoURL={u.photoURL} displayName={u.displayName} username={u.username} size="md" className="flex-shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-headline font-bold text-[15.5px] lowercase tracking-[-0.02em] text-foreground">
                      {u.displayName || u.username || 'user'}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">@{u.username || 'user'}</span>
                  </span>
                  <span className={`flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center transition-colors ${on ? 'bg-primary text-primary-foreground' : 'border-2 border-hair'}`}>
                    {on ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                  </span>
                  {i < list.length - 1 && <div className="absolute bottom-0 left-[52px] right-0 h-px bg-rule" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
