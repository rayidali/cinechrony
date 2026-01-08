'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Settings, UserPlus, Crown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProfileAvatar } from '@/components/profile-avatar';
import { ListSettingsModal } from '@/components/list-settings-modal';
import { InviteCollaboratorModal } from '@/components/invite-collaborator-modal';
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
  const [members, setMembers] = useState<ListMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  const canEdit = isOwner || isCollaborator;
  const canInvite = canEdit && members.length < 3;

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

  const handleMembersUpdate = (updatedMembers: ListMember[]) => {
    setMembers(updatedMembers);
  };

  // Sort members: owner first, then collaborators
  const sortedMembers = [...members].sort((a, b) => {
    if (a.role === 'owner') return -1;
    if (b.role === 'owner') return 1;
    return 0;
  });

  return (
    <>
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

        {/* Avatar bar + action buttons */}
        <div className="flex items-center gap-4">
          {/* Avatar bar */}
          <div className="flex items-center">
            {isLoadingMembers ? (
              <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center border-2 border-black">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex -space-x-3">
                {sortedMembers.map((member, index) => (
                  <Link
                    key={member.uid}
                    href={`/profile/${member.username}`}
                    className="relative hover:z-10 transition-transform hover:scale-110"
                    style={{ zIndex: sortedMembers.length - index }}
                    title={`${member.displayName || member.username}${member.role === 'owner' ? ' (Owner)' : ''}`}
                  >
                    <div className="relative">
                      <ProfileAvatar
                        photoURL={member.photoURL}
                        displayName={member.displayName}
                        username={member.username}
                        size="md"
                        className="ring-2 ring-background"
                      />
                      {member.role === 'owner' && (
                        <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-amber-400 border-2 border-black flex items-center justify-center">
                          <Crown className="h-3 w-3 text-amber-900" />
                        </div>
                      )}
                    </div>
                  </Link>
                ))}

                {/* Invite button as part of avatar row */}
                {canInvite && (
                  <button
                    onClick={() => setIsInviteOpen(true)}
                    className="relative h-10 w-10 rounded-full bg-secondary border-2 border-dashed border-black flex items-center justify-center hover:bg-secondary/80 transition-colors hover:scale-110"
                    style={{ zIndex: 0 }}
                    title="Invite collaborator"
                  >
                    <UserPlus className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Settings button */}
          {isOwner && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSettingsOpen(true)}
              className="h-10 w-10 rounded-full"
              title="List settings"
            >
              <Settings className="h-5 w-5" />
            </Button>
          )}
        </div>

        {/* Visibility badge */}
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span className={`px-2 py-0.5 rounded-full text-xs ${
            listData?.isPublic
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-secondary text-muted-foreground'
          }`}>
            {listData?.isPublic ? 'Public' : 'Private'}
          </span>
          {members.length > 1 && (
            <span className="text-xs">
              {members.length} members
            </span>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {isOwner && listData && (
        <ListSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          listId={listId}
          listOwnerId={listOwnerId}
          listData={listData}
        />
      )}

      {/* Invite Modal */}
      <InviteCollaboratorModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        listId={listId}
        listOwnerId={listOwnerId}
        listName={listData?.name || 'List'}
        members={members}
        onMembersUpdate={handleMembersUpdate}
      />
    </>
  );
}
