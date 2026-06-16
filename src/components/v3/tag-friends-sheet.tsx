'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import { Search, X, Check, Loader2 } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useViewportHeight } from '@/hooks/use-viewport-height';
import { haptic } from '@/lib/haptics';
import type { UserProfile, TaggedUser } from '@/lib/types';

/**
 * F04 "tag friends" (also reused to manage the close-friends list). A bottom
 * sheet: search + the caller's following with checkmarks, picked people shown as
 * removable pills, and a live count in the done button. Selection is controlled
 * by the parent (value + onChange) so the composer keeps the source of truth.
 */
function toTagged(u: UserProfile): TaggedUser {
  return { uid: u.uid, username: u.username, displayName: u.displayName, photoURL: u.photoURL };
}

export function TagFriendsSheet({
  isOpen,
  value,
  onClose,
  onChange,
  title = 'tag friends',
}: {
  isOpen: boolean;
  value: TaggedUser[];
  onClose: () => void;
  onChange: (next: TaggedUser[]) => void;
  /** Override the sheet title (e.g. "close friends" when managing the circle). */
  title?: string;
}) {
  const { user } = useUser();
  const height = useViewportHeight(86);
  const [query, setQuery] = useState('');
  const [following, setFollowing] = useState<UserProfile[]>([]);
  const [results, setResults] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedById = useMemo(() => new Map(value.map((u) => [u.uid, u])), [value]);

  // Load the caller's following once per open.
  useEffect(() => {
    if (!isOpen || !user?.uid) return;
    let cancelled = false;
    setQuery('');
    setResults([]);
    setLoading(true);
    apiCall<{ users: UserProfile[] }>('GET', `/api/v1/users/${user.uid}/following?limit=200`)
      .then((res) => { if (!cancelled) setFollowing(res.users ?? []); })
      .catch(() => { if (!cancelled) setFollowing([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, user?.uid]);

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

  const heightStyle = height > 0 ? `${height}px` : 'calc(86 * var(--dvh, 1vh))';

  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[95]" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-[95] flex flex-col rounded-t-[22px] bg-card outline-none overflow-hidden"
          style={{ height: heightStyle, maxHeight: heightStyle }}
        >
          <Drawer.Title className="sr-only">{title}</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />

          {/* header */}
          <div className="flex items-center justify-between px-5 py-2.5">
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui font-semibold text-[15px] text-muted-foreground active:opacity-60">
              cancel
            </button>
            <span className="font-headline font-bold text-[18px] lowercase tracking-[-0.02em]">{title}</span>
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui font-bold text-[15px] text-primary active:opacity-60">
              done{value.length > 0 ? ` · ${value.length}` : ''}
            </button>
          </div>

          {/* search */}
          <div className="px-5 pb-2">
            <div className="flex h-11 items-center gap-2.5 rounded-[14px] border border-hair bg-sunken px-3.5">
              <Search className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={2} />
              <input
                ref={inputRef}
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
            <div className="flex flex-wrap gap-2 px-5 pb-2">
              {value.map((u) => (
                <button
                  key={u.uid}
                  onClick={() => remove(u.uid)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-hair bg-sunken pl-1 pr-2.5 py-1 active:opacity-70"
                >
                  <ProfileAvatar photoURL={u.photoURL} displayName={u.displayName} username={u.username} size="xs" />
                  <span className="font-mono text-[12px] text-foreground">@{u.username || 'user'}</span>
                  <X className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.4} />
                </button>
              ))}
            </div>
          )}

          {/* list */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
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
                    <button
                      key={u.uid}
                      onClick={() => toggle(u)}
                      className="relative w-full flex items-center gap-3 py-3 text-left active:bg-foreground/[0.03]"
                    >
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
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
