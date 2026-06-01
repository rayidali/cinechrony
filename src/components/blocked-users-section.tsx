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
    <section className="mb-8 pt-8 border-t border-border">
      <div className="flex items-center gap-3 mb-4">
        <Ban className="h-6 w-6 text-muted-foreground" />
        <h2 className="text-xl font-headline font-bold">Blocked Users</h2>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You haven&apos;t blocked anyone.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
          {users.map((u) => (
            <li key={u.uid} className="flex items-center gap-3 p-3">
              <ProfileAvatar
                photoURL={u.photoURL}
                displayName={u.displayName}
                username={u.username}
                size="md"
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{u.displayName || u.username}</p>
                <p className="text-sm text-muted-foreground truncate">@{u.username}</p>
              </div>
              <button
                onClick={() => handleUnblock(u.uid)}
                disabled={unblockingId === u.uid}
                className="px-3 py-1.5 text-sm font-medium rounded-full border border-border hover:bg-secondary transition-colors disabled:opacity-50"
              >
                {unblockingId === u.uid ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Unblock'
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
