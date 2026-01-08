'use client';

import { useState, useEffect } from 'react';
import { Drawer } from 'vaul';
import {
  X,
  Search,
  Loader2,
  Copy,
  Check,
  Link as LinkIcon,
  UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase';
import {
  searchUsers,
  inviteToList,
  createInviteLink,
  getListPendingInvites,
} from '@/app/actions';
import type { ListMember, ListInvite, UserProfile } from '@/lib/types';

interface InviteCollaboratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  listId: string;
  listOwnerId: string;
  listName: string;
  members: ListMember[];
  onMembersUpdate?: (members: ListMember[]) => void;
}

export function InviteCollaboratorModal({
  isOpen,
  onClose,
  listId,
  listOwnerId,
  listName,
  members,
}: InviteCollaboratorModalProps) {
  const { user } = useUser();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [pendingInvites, setPendingInvites] = useState<ListInvite[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [isLoadingInvites, setIsLoadingInvites] = useState(false);

  // Load pending invites when modal opens
  useEffect(() => {
    async function loadPendingInvites() {
      if (!isOpen || !user) return;

      setIsLoadingInvites(true);
      try {
        const result = await getListPendingInvites(user.uid, listOwnerId, listId);
        setPendingInvites(result.invites || []);
      } catch (error) {
        console.error('Failed to load pending invites:', error);
      } finally {
        setIsLoadingInvites(false);
      }
    }

    loadPendingInvites();
  }, [isOpen, user, listId, listOwnerId]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSearchResults([]);
      setInviteLink(null);
      setIsCopied(false);
    }
  }, [isOpen]);

  // Search users
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!user || searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const result = await searchUsers(searchQuery, user.uid);
        // Filter out existing members and pending invites
        const memberIds = members.map(m => m.uid);
        const pendingIds = pendingInvites.map(i => i.inviteeId).filter(Boolean);
        const filtered = (result.users || []).filter(
          u => !memberIds.includes(u.uid) && !pendingIds.includes(u.uid)
        );
        setSearchResults(filtered);
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, user, members, pendingInvites]);

  const handleInviteUser = async (inviteeId: string) => {
    if (!user) return;

    setIsInviting(true);
    try {
      const result = await inviteToList(user.uid, listOwnerId, listId, inviteeId);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'Invite Sent', description: 'User has been invited to collaborate.' });
        setSearchQuery('');
        setSearchResults([]);
        // Reload pending invites
        const invitesResult = await getListPendingInvites(user.uid, listOwnerId, listId);
        setPendingInvites(invitesResult.invites || []);
      }
    } catch (error) {
      console.error('Failed to invite:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to send invite' });
    } finally {
      setIsInviting(false);
    }
  };

  const handleCreateInviteLink = async () => {
    if (!user) return;

    setIsCreatingLink(true);
    try {
      const result = await createInviteLink(user.uid, listOwnerId, listId);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else if (result.inviteCode) {
        const link = `${window.location.origin}/invite/${result.inviteCode}`;
        setInviteLink(link);
      }
    } catch (error) {
      console.error('Failed to create link:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to create invite link' });
    } finally {
      setIsCreatingLink(false);
    }
  };

  const handleCopyLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
    toast({ title: 'Link Copied', description: 'Invite link copied to clipboard.' });
  };

  const spotsLeft = 3 - members.length;

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()} modal={true}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-background border-t border-border outline-none"
          style={{ height: '75vh', maxHeight: '75vh' }}
        >
          {/* Drag handle */}
          <div className="mx-auto mt-4 h-1.5 w-12 flex-shrink-0 rounded-full bg-muted-foreground/40" />

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <button
              onClick={onClose}
              className="p-2 -ml-2 rounded-full hover:bg-secondary transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
            <Drawer.Title className="text-lg font-semibold">Invite to {listName}</Drawer.Title>
            <div className="w-9" />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto min-h-0 p-4">
            {/* Spots info */}
            <div className="mb-4 p-3 rounded-xl bg-secondary/50 text-center">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{spotsLeft}</span>
                {spotsLeft === 1 ? ' spot' : ' spots'} left
              </p>
            </div>

            {/* Search Input */}
            <div className="relative mb-4">
              <Input
                type="text"
                placeholder="Search by username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10 text-base"
                style={{ fontSize: '16px' }}
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                {isSearching ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Search className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="space-y-2 mb-6">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Search Results
                </p>
                {searchResults.map((profile) => (
                  <div
                    key={profile.uid}
                    className="flex items-center justify-between p-3 rounded-xl border border-border bg-secondary/30"
                  >
                    <div className="flex items-center gap-3">
                      <ProfileAvatar
                        photoURL={profile.photoURL}
                        displayName={profile.displayName}
                        username={profile.username}
                        size="md"
                      />
                      <div>
                        <p className="font-medium">{profile.displayName || profile.username}</p>
                        <p className="text-sm text-muted-foreground">@{profile.username}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleInviteUser(profile.uid)}
                      disabled={isInviting}
                      className="rounded-full"
                    >
                      {isInviting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4 mr-1" />
                          Invite
                        </>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No users found</p>
              </div>
            )}

            {/* Invite Link Section */}
            <div className="pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">
                Or share a link
              </p>

              {!inviteLink ? (
                <Button
                  variant="outline"
                  onClick={handleCreateInviteLink}
                  disabled={isCreatingLink}
                  className="w-full h-12 rounded-xl"
                >
                  {isCreatingLink ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <LinkIcon className="h-4 w-4 mr-2" />
                  )}
                  Create Invite Link
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={inviteLink}
                      readOnly
                      className="text-sm bg-secondary/50"
                    />
                    <Button onClick={handleCopyLink} className="rounded-xl px-4">
                      {isCopied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Link expires in 7 days
                  </p>
                </div>
              )}
            </div>

            {/* Pending Invites */}
            {pendingInvites.length > 0 && (
              <div className="pt-4 mt-4 border-t border-border">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">
                  Pending Invites
                </p>
                <div className="space-y-2">
                  {pendingInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-secondary/30"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center border-2 border-dashed border-muted-foreground/30">
                          <UserPlus className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          {invite.inviteeUsername ? (
                            <p className="font-medium">@{invite.inviteeUsername}</p>
                          ) : (
                            <p className="text-muted-foreground">Via invite link</p>
                          )}
                          <p className="text-xs text-muted-foreground">Pending</p>
                        </div>
                      </div>
                      <span className="text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded-full">
                        Waiting
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
