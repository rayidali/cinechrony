'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Loader2, Pencil } from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useUser } from '@/firebase';
import { getListMembers } from '@/app/actions';
import { useListMembersCache } from '@/contexts/list-members-cache';
import type { ListMember, MovieList } from '@/lib/types';

interface ListHeaderProps {
  listId: string;
  listOwnerId: string;
  listData: MovieList | null;
  isOwner: boolean;
  isCollaborator?: boolean;
}

export function ListHeader({
  listId,
  listOwnerId,
  listData,
  isOwner,
  isCollaborator,
}: ListHeaderProps) {
  // Build settings URL with owner param for collaborators
  const settingsUrl = isOwner
    ? `/lists/${listId}/settings`
    : `/lists/${listId}/settings?owner=${listOwnerId}`;
  const { user } = useUser();
  const { getMembers, setMembers: cacheMembers, invalidate } = useListMembersCache();
  const [members, setMembers] = useState<ListMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);

  // Track collaboratorIds to detect changes (for real-time updates when someone accepts an invite)
  const collaboratorIdsRef = useRef<string[] | undefined>(listData?.collaboratorIds);
  const collaboratorIdsKey = listData?.collaboratorIds?.sort().join(',') || '';

  // Load members for avatar bar (check cache first, but refetch if collaboratorIds changed)
  useEffect(() => {
    async function loadMembers() {
      if (!user) return;

      // Check if collaboratorIds changed (someone joined/left)
      const prevIds = collaboratorIdsRef.current?.sort().join(',') || '';
      const currentIds = listData?.collaboratorIds?.sort().join(',') || '';
      const collaboratorIdsChanged = prevIds !== currentIds;

      if (collaboratorIdsChanged) {
        // Invalidate cache when members change
        invalidate(listOwnerId, listId);
        collaboratorIdsRef.current = listData?.collaboratorIds;
      }

      // Check cache first (only if collaboratorIds didn't change)
      if (!collaboratorIdsChanged) {
        const cachedMembers = getMembers(listOwnerId, listId);
        if (cachedMembers) {
          setMembers(cachedMembers);
          setIsLoadingMembers(false);
          return;
        }
      }

      setIsLoadingMembers(true);
      try {
        const result = await getListMembers(listOwnerId, listId);
        const loadedMembers = result.members || [];
        setMembers(loadedMembers);
        // Cache for later use (e.g., settings page)
        cacheMembers(listOwnerId, listId, loadedMembers);
      } catch (error) {
        console.error('Failed to load members:', error);
      } finally {
        setIsLoadingMembers(false);
      }
    }

    loadMembers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, listId, listOwnerId, collaboratorIdsKey, getMembers, cacheMembers, invalidate]);

  // Sort members: owner first, then collaborators
  const sortedMembers = [...members].sort((a, b) => {
    if (a.role === 'owner') return -1;
    if (b.role === 'owner') return 1;
    return 0;
  });

  return (
    <div className="flex flex-col items-center">
      {/* List name */}
      <div className="flex items-center gap-3 mb-1">
        <img
          src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png"
          alt="Cinechrony"
          className="h-8 w-8 md:h-10 md:w-10"
        />
        <h1 className="text-3xl md:text-5xl font-headline font-bold text-center tracking-tighter">
          {listData?.name || 'List'}
        </h1>
        {(isOwner || isCollaborator) && (
          <Link
            href={settingsUrl}
            prefetch={true}
            className="p-2 rounded-full hover:bg-secondary transition-colors"
            title="Edit list settings"
          >
            <Pencil className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
          </Link>
        )}
      </div>

      {/* List description if present */}
      {listData?.description ? (
        <p className="text-sm text-muted-foreground italic text-center mb-3 max-w-md">
          {listData.description}
        </p>
      ) : (
        <div className="mb-2" />
      )}

      {/* Tappable Collaborator Bar */}
      {(isOwner || isCollaborator) ? (
        <Link
          href={settingsUrl}
          prefetch={true}
          className="flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-secondary/50 transition-colors hover:bg-secondary"
        >
          {/* Avatar stack */}
          {isLoadingMembers ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="flex -space-x-2">
              {sortedMembers.slice(0, 3).map((member, index) => (
                <div
                  key={member.uid}
                  className="relative"
                  style={{ zIndex: sortedMembers.length - index }}
                >
                  <ProfileAvatar
                    photoURL={member.photoURL}
                    displayName={member.displayName}
                    username={member.username}
                    size="sm"
                    className="ring-2 ring-background"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Collaborate text */}
          <span className="text-sm font-medium">
            {members.length > 1 ? `${members.length} collaborators` : 'collaborate'}
          </span>
        </Link>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-secondary/50">
          {/* Avatar stack - clickable to profiles */}
          {isLoadingMembers ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="flex -space-x-2">
              {sortedMembers.slice(0, 3).map((member, index) => (
                <Link
                  key={member.uid}
                  href={`/profile/${member.username}`}
                  className="relative hover:opacity-80 transition-opacity"
                  style={{ zIndex: sortedMembers.length - index }}
                >
                  <ProfileAvatar
                    photoURL={member.photoURL}
                    displayName={member.displayName}
                    username={member.username}
                    size="sm"
                    className="ring-2 ring-background"
                  />
                </Link>
              ))}
            </div>
          )}

          {/* Collaborator count text */}
          <span className="text-sm font-medium">
            {members.length > 1 ? `${members.length} collaborators` : 'collaborate'}
          </span>
        </div>
      )}
    </div>
  );
}
