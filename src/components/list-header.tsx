'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Loader2, Settings2 } from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-avatar';
import { ListLikeButton } from '@/components/list-like-button';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { useListMembersCache } from '@/contexts/list-members-cache';
import type { ListMember, MovieList } from '@/lib/types';

interface ListHeaderProps {
  listId: string;
  listOwnerId: string;
  listData: MovieList | null;
  isOwner: boolean;
  isCollaborator?: boolean;
  /** Film count shown in the collaborators row ("N collaborators · N films"). */
  movieCount?: number;
}

export function ListHeader({
  listId,
  listOwnerId,
  listData,
  isOwner,
  isCollaborator,
  movieCount,
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
        const result = await apiCall<{ members: ListMember[] }>(
          'GET', `/api/v1/lists/${listOwnerId}/${listId}/members`,
        );
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

  const memberCountLabel = `${members.length > 1 ? `${members.length} collaborators · ` : ''}${movieCount ?? 0} films`;

  return (
    <div className="flex flex-col">
      {/* Description — serif italic lead */}
      {listData?.description && (
        <p className="cc-lead text-[16px] text-foreground/90 max-w-xl">
          {listData.description}
        </p>
      )}

      {/* Collaborators row — avatar stack + count + manage */}
      <div className={`flex items-center gap-3 ${listData?.description ? 'mt-4' : ''}`}>
        {isLoadingMembers ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex -space-x-2">
            {sortedMembers.slice(0, 3).map((member, index) =>
              isOwner || isCollaborator ? (
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
              ) : (
                <Link
                  key={member.uid}
                  href={`/profile/${member.username}`}
                  className="relative transition-opacity hover:opacity-80"
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
              )
            )}
          </div>
        )}
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {memberCountLabel}
        </span>
        <span className="flex-1" />
        {(isOwner || isCollaborator) && (
          <Link
            href={settingsUrl}
            prefetch
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-rule px-3 text-foreground transition-colors hover:bg-secondary"
          >
            <Settings2 className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.9} />
            <span className="font-headline text-[12.5px] font-semibold lowercase tracking-tight">
              manage
            </span>
          </Link>
        )}
      </div>

      {/* Like — read-only-ish for members; a stale like stays removable. */}
      {listData?.isPublic && (
        <div className="mt-4">
          <ListLikeButton
            listOwnerId={listOwnerId}
            listId={listId}
            collaboratorIds={listData.collaboratorIds}
            initialLikes={listData.likes ?? 0}
            initialLikedBy={listData.likedBy ?? []}
          />
        </div>
      )}
    </div>
  );
}
