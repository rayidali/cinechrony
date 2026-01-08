'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useUser } from '@/firebase';
import { getListMembers } from '@/app/actions';
import type { ListMember, MovieList } from '@/lib/types';

interface ListHeaderProps {
  listId: string;
  listOwnerId: string;
  listData: MovieList | null;
  isOwner: boolean;
  isCollaborator: boolean;
}

export function ListHeader({
  listId,
  listOwnerId,
  listData,
  isOwner,
  isCollaborator,
}: ListHeaderProps) {
  const { user } = useUser();
  const router = useRouter();
  const [members, setMembers] = useState<ListMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);

  const canEdit = isOwner || isCollaborator;

  // Load members for avatar bar
  useEffect(() => {
    async function loadMembers() {
      if (!user) return;

      setIsLoadingMembers(true);
      try {
        const result = await getListMembers(listOwnerId, listId);
        setMembers(result.members || []);
      } catch (error) {
        console.error('Failed to load members:', error);
      } finally {
        setIsLoadingMembers(false);
      }
    }

    loadMembers();
  }, [user, listId, listOwnerId]);

  // Sort members: owner first, then collaborators
  const sortedMembers = [...members].sort((a, b) => {
    if (a.role === 'owner') return -1;
    if (b.role === 'owner') return 1;
    return 0;
  });

  const handleCollaborateClick = () => {
    if (isOwner) {
      router.push(`/lists/${listId}/settings`);
    }
  };

  return (
    <div className="flex flex-col items-center">
      {/* List name */}
      <div className="flex items-center gap-3 mb-3">
        <img
          src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png"
          alt="Cinechrony"
          className="h-8 w-8 md:h-10 md:w-10"
        />
        <h1 className="text-3xl md:text-5xl font-headline font-bold text-center tracking-tighter">
          {listData?.name || 'List'}
        </h1>
      </div>

      {/* Tappable Collaborator Bar */}
      <button
        onClick={handleCollaborateClick}
        disabled={!isOwner}
        className={`flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-secondary/50 transition-colors ${
          isOwner ? 'hover:bg-secondary cursor-pointer' : 'cursor-default'
        }`}
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
      </button>

      {/* Stats row */}
      <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
        <span>{listData?.movieCount || 0} movies</span>
        <span>•</span>
        <span className={`${
          listData?.isPublic
            ? 'text-green-600 dark:text-green-400'
            : ''
        }`}>
          {listData?.isPublic ? 'Public' : 'Private'}
        </span>
      </div>
    </div>
  );
}
