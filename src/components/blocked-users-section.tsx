'use client';

import { useEffect, useState, useTransition } from 'react';
import { Ban, Loader2 } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useUserBlocksCache } from '@/contexts/user-blocks-cache';
import type { UserProfile } from '@/lib/types';

/**
 * Settings → Blocked users. Lists everyone the viewer has blocked, with an
 * unblock control. The LAUNCH 0.5.5 management surface.
 */
export function BlockedUsersSection() {
  const { user } = useUser();
  const { setBlocked } = useUserBlocksCache();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiCall<{ users: UserProfile[] }>('GET', '/api/v1/me/blocked-users')
      .then((res) => {
        if (!cancelled) setUsers(res.users ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleUnblock = (uid: string) => {
    setUnblockingId(uid);
    startTransition(async () => {
      try {
        await apiCall('DELETE', `/api/v1/users/${uid}/block`);
        setUsers((prev) => prev.filter((u) => u.uid !== uid));
        setBlocked(uid, false);
      } catch {
        /* keep in list on failure */
      } finally {
        setUnblockingId(null);
      }
    });
  };

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Ban className="h-[18px] w-[18px] text-muted-foreground" />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          blocked
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : users.length === 0 ? (
        <p className="font-ui text-[13px] text-muted-foreground">you haven&apos;t blocked anyone.</p>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li
              key={u.uid}
              className="flex items-center gap-3 rounded-[16px] border border-hair bg-card px-4 py-3"
            >
              <ProfileAvatar photoURL={u.photoURL} displayName={u.displayName} username={u.username} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-ui text-[15px] font-semibold text-foreground">
                  {u.displayName || u.username}
                </p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">@{u.username}</p>
              </div>
              <button
                onClick={() => handleUnblock(u.uid)}
                disabled={unblockingId === u.uid}
                className="rounded-full border border-hair bg-card px-3.5 py-1.5 font-ui text-[13px] font-semibold text-foreground transition-all active:scale-[0.97] disabled:opacity-50"
              >
                {unblockingId === u.uid ? <Loader2 className="h-4 w-4 animate-spin" /> : 'unblock'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
