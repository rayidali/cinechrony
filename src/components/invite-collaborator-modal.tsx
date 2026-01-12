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
  ChevronLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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

type Step = 'options' | 'search';

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

  const [step, setStep] = useState<Step>('options');
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
      setStep('options');
      setSearchQuery('');
      setSearchResults([]);
      setInviteLink(null);
      setIsCopied(false);
    }
  }, [isOpen]);

  // Search users (with debounce)
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
        setStep('options');
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
    <>
      {/* Step 1: Options - Vaul Drawer */}
      <Drawer.Root
        open={isOpen && step === 'options'}
        onOpenChange={(open) => !open && step === 'options' && onClose()}
        modal={true}
      >
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

              {/* Search Button - Opens fullscreen search */}
              <Button
                variant="outline"
                onClick={() => setStep('search')}
                className="w-full h-12 rounded-xl mb-4 justify-start px-4"
              >
                <Search className="h-4 w-4 mr-3 text-muted-foreground" />
                <span className="text-muted-foreground">Search by username...</span>
              </Button>

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
                    <button
                      onClick={handleCopyLink}
                      className="w-full flex items-center gap-2 p-3 rounded-xl bg-secondary/50 hover:bg-secondary/70 transition-colors border border-border text-left"
                    >
                      <span className="flex-1 text-sm truncate text-primary">{inviteLink}</span>
                      {isCopied ? (
                        <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                      ) : (
                        <Copy className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                    </button>
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

      {/* Step 2: Search - Fullscreen (NOT Vaul - iOS Safari safe) */}
      {isOpen && step === 'search' && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in duration-150">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
            <button
              onClick={() => {
                setStep('options');
                setSearchQuery('');
                setSearchResults([]);
              }}
              className="p-2 -ml-2 rounded-full hover:bg-secondary transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Search by username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full h-10 pl-10 pr-4 rounded-full bg-secondary/50 border border-border text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                style={{ fontSize: '16px' }}
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
            {isSearching && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Search Results */}
          <div className="flex-1 overflow-y-auto p-4">
            {searchQuery.length < 2 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Type at least 2 characters to search</p>
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-2">
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
            ) : !isSearching ? (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No users found</p>
              </div>
            ) : null}
          </div>

          {/* Safe area for bottom */}
          <div
            className="flex-shrink-0"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          />
        </div>
      )}
    </>
  );
}
