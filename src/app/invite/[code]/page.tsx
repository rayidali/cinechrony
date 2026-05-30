'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Check, X, Users, List } from 'lucide-react';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { invalidateCachedAction } from '@/lib/use-cached-action';
import type { ListInvite } from '@/lib/types';

const retroButtonClass = "border border-border rounded-full shadow-lift transition-all duration-200";

export default function InvitePage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const params = useParams();
  const inviteCode = params.code as string;
  const { toast } = useToast();

  const [invite, setInvite] = useState<ListInvite | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    async function loadInvite() {
      if (!inviteCode) {
        setError('Invalid invite link');
        setIsLoading(false);
        return;
      }
      // AUDIT.md 2.9: invite preview now requires auth. If the user isn't
      // signed in yet, don't load — the "Sign in to view invite" gate below
      // handles that case. We re-run this effect once the user is set.
      if (isUserLoading) return;
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        const { invite: previewInvite } = await apiCall<{ invite: ListInvite }>(
          'GET',
          `/api/v1/invites/by-code/${encodeURIComponent(inviteCode)}`,
        );
        setInvite(previewInvite);
      } catch (err) {
        console.error('Failed to load invite:', err);
        setError(err instanceof ApiClientError ? err.message : 'Failed to load invite');
      } finally {
        setIsLoading(false);
      }
    }

    loadInvite();
  }, [inviteCode, user, isUserLoading]);

  const handleAccept = async () => {
    if (!user || !invite) return;

    setIsAccepting(true);
    try {
      const result = await apiCall<{ listId: string; listOwnerId: string }>(
        'POST',
        '/api/v1/invites/accept',
        { inviteCode },
      );
      toast({
        title: 'Invite Accepted!',
        description: `You are now a collaborator on "${invite.listName}"`,
      });
      // The collaborative-lists cache is now stale.
      invalidateCachedAction(`collab-lists:${user.uid}`);
      router.push(`/lists/${result.listId}?owner=${result.listOwnerId}`);
    } catch (err) {
      console.error('Failed to accept invite:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof ApiClientError ? err.message : 'Failed to accept invite',
      });
    } finally {
      setIsAccepting(false);
    }
  };

  if (isLoading || isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  // AUDIT.md 2.9: unauthenticated users see the sign-in gate, NOT the
  // error screen — the lack of invite data here is by design.
  if (!user) {
    return (
      <main className="min-h-screen font-body text-foreground">
        <div className="container mx-auto p-4 md:p-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <Card className="w-full max-w-md border border-border rounded-2xl shadow-photo">
              <CardHeader className="text-center">
                <div className="mx-auto h-16 w-16 rounded-full bg-primary flex items-center justify-center mb-4 border border-border">
                  <Users className="h-8 w-8 text-primary-foreground" />
                </div>
                <CardTitle className="text-2xl font-headline">You&apos;re Invited!</CardTitle>
                <CardDescription>
                  Sign in to view and accept this invite.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Link href={`/login?redirect=/invite/${inviteCode}`} className="block">
                  <Button className={`${retroButtonClass} w-full bg-primary text-primary-foreground font-bold`}>
                    Sign In to View Invite
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    );
  }

  if (error || !invite) {
    return (
      <main className="min-h-screen font-body text-foreground">
        <div className="container mx-auto p-4 md:p-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4 border border-border">
              <X className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="text-2xl font-headline font-bold mb-2">Invalid Invite</h1>
            <p className="text-muted-foreground mb-4 text-center">
              {error || 'This invite link is invalid or has expired.'}
            </p>
            <Link href="/lists">
              <Button className={`${retroButtonClass} bg-primary text-primary-foreground font-bold`}>Go to My Lists</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen font-body text-foreground">
      <div className="container mx-auto p-4 md:p-8">
        <div className="flex flex-col items-center justify-center min-h-[50vh]">
          <Card className="w-full max-w-md border border-border rounded-2xl shadow-photo">
            <CardHeader className="text-center">
              <div className="mx-auto h-16 w-16 rounded-full bg-primary flex items-center justify-center mb-4 border border-border">
                <Users className="h-8 w-8 text-primary-foreground" />
              </div>
              <CardTitle className="text-2xl font-headline">You&apos;re Invited!</CardTitle>
              <CardDescription>
                @{invite.inviterUsername} has invited you to collaborate on
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-secondary rounded-2xl border border-border">
                <List className="h-6 w-6 text-primary" />
                <span className="font-bold text-lg">{invite.listName}</span>
              </div>
              <p className="text-center text-sm text-muted-foreground">
                As a collaborator, you&apos;ll be able to add and remove movies from this list.
              </p>
              <div className="flex gap-3">
                <Link href="/lists" className="flex-1">
                  <Button variant="outline" className="w-full border border-border rounded-full">
                    Decline
                  </Button>
                </Link>
                <Button
                  onClick={handleAccept}
                  disabled={isAccepting}
                  className={`${retroButtonClass} flex-1 bg-primary text-primary-foreground font-bold`}
                >
                  {isAccepting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Accept
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
