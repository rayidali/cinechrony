'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Users,
  UserPlus,
  Crown,
  User,
  Loader2,
  X,
  Copy,
  Check,
  LogOut,
  UserMinus,
  ArrowRightLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase';
import { ProfileAvatar } from '@/components/profile-avatar';
import {
  getListMembers,
  getListPendingInvites,
  inviteToList,
  createInviteLink,
  revokeInvite,
  removeCollaborator,
  leaveList,
  transferOwnership,
  searchUsers,
} from '@/app/actions';
import type { ListMember, ListInvite, UserProfile } from '@/lib/types';

const retroButtonClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";
const retroInputClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] focus:shadow-[2px_2px_0px_0px_#000] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200";

interface ListCollaboratorsProps {
  listId: string;
  listOwnerId: string;
  listName: string;
}

export function ListCollaborators({ listId, listOwnerId, listName }: ListCollaboratorsProps) {
  const { user } = useUser();
  const router = useRouter();
  const { toast } = useToast();

  const [members, setMembers] = useState<ListMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<ListInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isLeaveOpen, setIsLeaveOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isRemoveOpen, setIsRemoveOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<ListMember | null>(null);
  const [memberToTransfer, setMemberToTransfer] = useState<ListMember | null>(null);

  // Invite state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isCreatingLink, setIsCreatingLink] = useState(false);

  const isOwner = user?.uid === listOwnerId;
  const isCollaborator = members.some(m => m.uid === user?.uid && m.role === 'collaborator');
  const canInvite = (isOwner || isCollaborator) && members.length < 3;

  useEffect(() => {
    async function loadData() {
      if (!user) return;

      setIsLoading(true);
      try {
        // First get members to check if user is collaborator
        const membersResult = await getListMembers(listOwnerId, listId);
        const membersList = membersResult.members || [];
        setMembers(membersList);

        // Check if user is owner or collaborator to load pending invites
        const userIsOwner = user.uid === listOwnerId;
        const userIsCollaborator = membersList.some(m => m.uid === user.uid && m.role === 'collaborator');
        const canSeeInvites = userIsOwner || userIsCollaborator;

        const invitesResult = canSeeInvites
          ? await getListPendingInvites(user.uid, listOwnerId, listId)
          : { invites: [] };

        setPendingInvites(invitesResult.invites || []);
      } catch (error) {
        console.error('Failed to load collaborators:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [user, listId, listOwnerId, isOwner]);

  // Search users for invite
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!user || searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const result = await searchUsers(searchQuery, user.uid);
        // Filter out existing members
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

  const handleRevokeInvite = async (inviteId: string) => {
    if (!user) return;

    try {
      const result = await revokeInvite(user.uid, inviteId);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'Invite Revoked', description: 'The invite has been cancelled.' });
        setPendingInvites(prev => prev.filter(i => i.id !== inviteId));
      }
    } catch (error) {
      console.error('Failed to revoke:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to revoke invite' });
    }
  };

  const handleRemoveCollaborator = async () => {
    if (!user || !memberToRemove) return;

    try {
      const result = await removeCollaborator(listOwnerId, listId, memberToRemove.uid);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'Collaborator Removed', description: `@${memberToRemove.username} has been removed.` });
        setMembers(prev => prev.filter(m => m.uid !== memberToRemove.uid));
      }
    } catch (error) {
      console.error('Failed to remove:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to remove collaborator' });
    } finally {
      setIsRemoveOpen(false);
      setMemberToRemove(null);
    }
  };

  const handleLeaveList = async () => {
    if (!user) return;

    try {
      const result = await leaveList(user.uid, listOwnerId, listId);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'Left List', description: 'You are no longer a collaborator.' });
        router.push('/lists');
      }
    } catch (error) {
      console.error('Failed to leave:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to leave list' });
    } finally {
      setIsLeaveOpen(false);
    }
  };

  const handleTransferOwnership = async () => {
    if (!user || !memberToTransfer) return;

    try {
      const result = await transferOwnership(user.uid, listId, memberToTransfer.uid);
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'Ownership Transferred', description: `@${memberToTransfer.username} is now the owner.` });
        // Reload the page to reflect the new ownership structure
        router.refresh();
      }
    } catch (error) {
      console.error('Failed to transfer:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to transfer ownership' });
    } finally {
      setIsTransferOpen(false);
      setMemberToTransfer(null);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-[3px] border-black shadow-[4px_4px_0px_0px_#000]">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[3px] border-black shadow-[4px_4px_0px_0px_#000]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle>Collaborators</CardTitle>
          </div>
          {canInvite && (
            <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className={retroButtonClass}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Invite
                </Button>
              </DialogTrigger>
              <DialogContent className="border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
                <DialogHeader>
                  <DialogTitle>Invite Collaborator</DialogTitle>
                  <DialogDescription>
                    Search for a user to invite or create a shareable link.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  {/* Search by username */}
                  <div className="relative">
                    <Input
                      placeholder="Search by username..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={retroInputClass}
                    />
                    {isSearching && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />
                    )}
                  </div>

                  {/* Search results */}
                  {searchResults.length > 0 && (
                    <div className="max-h-48 overflow-y-auto space-y-2">
                      {searchResults.map((profile) => (
                        <div
                          key={profile.uid}
                          className="flex items-center justify-between p-2 rounded-lg border-[2px] border-black bg-secondary"
                        >
                          <div className="flex items-center gap-2">
                            <ProfileAvatar
                              photoURL={profile.photoURL}
                              displayName={profile.displayName}
                              username={profile.username}
                              size="sm"
                            />
                            <div>
                              <p className="font-medium text-sm">{profile.displayName || profile.username}</p>
                              <p className="text-xs text-muted-foreground">@{profile.username}</p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleInviteUser(profile.uid)}
                            disabled={isInviting}
                          >
                            {isInviting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Invite'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
                    <p className="text-center text-muted-foreground text-sm py-2">
                      No users found
                    </p>
                  )}

                  {/* Divider */}
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-black" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">Or</span>
                    </div>
                  </div>

                  {/* Invite link */}
                  {!inviteLink ? (
                    <Button
                      variant="outline"
                      onClick={handleCreateInviteLink}
                      disabled={isCreatingLink}
                      className="w-full border-[2px] border-black"
                    >
                      {isCreatingLink ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Copy className="h-4 w-4 mr-2" />
                      )}
                      Create Invite Link
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input
                          value={inviteLink}
                          readOnly
                          className={`${retroInputClass} text-xs`}
                        />
                        <Button onClick={handleCopyLink} className={retroButtonClass}>
                          {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        This link expires in 7 days.
                      </p>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
        <CardDescription>
          {members.length}/3 members
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Members list */}
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.uid}
              className="flex items-center justify-between p-2 rounded-lg bg-secondary"
            >
              <div className="flex items-center gap-3">
                <ProfileAvatar
                  photoURL={member.photoURL}
                  displayName={member.displayName}
                  username={member.username}
                  size="md"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/profile/${member.username}`}
                      className="font-medium hover:underline"
                    >
                      {member.displayName || member.username}
                    </Link>
                    {member.role === 'owner' && (
                      <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                        <Crown className="h-3 w-3" />
                        Owner
                      </span>
                    )}
                    {member.uid === user?.uid && (
                      <span className="text-xs text-muted-foreground">(you)</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">@{member.username}</p>
                </div>
              </div>

              {/* Actions */}
              {isOwner && member.role === 'collaborator' && (
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    title="Transfer ownership"
                    onClick={() => {
                      setMemberToTransfer(member);
                      setIsTransferOpen(true);
                    }}
                  >
                    <ArrowRightLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    title="Remove collaborator"
                    onClick={() => {
                      setMemberToRemove(member);
                      setIsRemoveOpen(true);
                    }}
                  >
                    <UserMinus className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pending invites (owner and collaborators) */}
        {(isOwner || isCollaborator) && pendingInvites.length > 0 && (
          <div className="pt-4 border-t">
            <h4 className="text-sm font-medium mb-2">Pending Invites</h4>
            <div className="space-y-2">
              {pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted"
                >
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-muted-foreground/20 flex items-center justify-center border-[2px] border-dashed border-black">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      {invite.inviteeUsername ? (
                        <p className="text-sm">@{invite.inviteeUsername}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">Via invite link</p>
                      )}
                      <p className="text-xs text-muted-foreground">Pending</p>
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    title="Revoke invite"
                    onClick={() => handleRevokeInvite(invite.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Leave button (collaborator only) */}
        {isCollaborator && (
          <div className="pt-4 border-t">
            <Button
              variant="outline"
              className="w-full text-destructive border-destructive hover:bg-destructive/10"
              onClick={() => setIsLeaveOpen(true)}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Leave List
            </Button>
          </div>
        )}
      </CardContent>

      {/* Remove collaborator confirmation */}
      <AlertDialog open={isRemoveOpen} onOpenChange={setIsRemoveOpen}>
        <AlertDialogContent className="border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Collaborator</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove @{memberToRemove?.username} from this list?
              They will no longer be able to add or remove movies.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveCollaborator}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Leave list confirmation */}
      <AlertDialog open={isLeaveOpen} onOpenChange={setIsLeaveOpen}>
        <AlertDialogContent className="border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave List</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to leave &quot;{listName}&quot;?
              You will no longer be able to add or remove movies.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeaveList}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transfer ownership confirmation */}
      <AlertDialog open={isTransferOpen} onOpenChange={setIsTransferOpen}>
        <AlertDialogContent className="border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer Ownership</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to transfer ownership of &quot;{listName}&quot; to @{memberToTransfer?.username}?
              You will become a collaborator and they will become the owner.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleTransferOwnership}>
              Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
