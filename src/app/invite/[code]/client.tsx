'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Check, X, Users, ListPlus } from 'lucide-react';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { invalidateCachedAction } from '@/lib/use-cached-action';
import { haptic } from '@/lib/haptics';
import { PosterWall } from '@/components/v3/poster-wall';
import { CtaButton, IconTile } from '@/components/v3/onboarding-kit';
import type { ListInvite } from '@/lib/types';

const APP_ICON = 'https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png';

/**
 * Invite acceptance — v3 (Phase 0.7 Wave 7). Cinematic poster-wall hero + the
 * collaboration ask. All logic preserved: AUDIT 2.9 auth-gated preview, accept →
 * collab-cache invalidation → list. Light + dark via tokens.
 */
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
      // AUDIT.md 2.9: invite preview requires auth. If not signed in, don't load —
      // the sign-in gate handles it. Re-runs once the user is set.
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
      haptic('success');
      toast({ title: 'invite accepted', description: `you're now a collaborator on "${invite.listName}".` });
      invalidateCachedAction(`collab-lists:${user.uid}`);
      router.push(`/lists/${result.listId}?owner=${result.listOwnerId}`);
    } catch (err) {
      console.error('Failed to accept invite:', err);
      toast({
        variant: 'destructive',
        title: 'could not accept',
        description: err instanceof ApiClientError ? err.message : 'failed to accept invite',
      });
    } finally {
      setIsAccepting(false);
    }
  };

  if (isLoading || isUserLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <img src={APP_ICON} alt="Loading" className="h-12 w-12 animate-pulse" />
      </div>
    );
  }

  // ── sign-in gate (AUDIT 2.9) ──
  if (!user) {
    return (
      <Shell>
        <IconTile icon={Users} accent className="mb-6" />
        <Headline title="you're invited" sub="sign in to view and accept this collaboration." />
        <div className="mt-8 w-full max-w-[20rem]">
          <Link href={`/login?redirect=/invite/${inviteCode}`}>
            <CtaButton label="sign in to view" />
          </Link>
        </div>
      </Shell>
    );
  }

  // ── invalid / expired ──
  if (error || !invite) {
    return (
      <Shell muted>
        <IconTile icon={X} className="mb-6" />
        <Headline title="invite unavailable" sub={error || 'this invite link is invalid or has expired.'} />
        <div className="mt-8 w-full max-w-[20rem]">
          <Link href="/lists">
            <CtaButton label="go to my lists" />
          </Link>
        </div>
      </Shell>
    );
  }

  // ── the invite ──
  return (
    <Shell>
      <IconTile icon={Users} accent className="mb-6" />
      <Headline title="you're invited" sub={`@${invite.inviterUsername} wants you on a shared watchlist.`} />

      <div className="mt-7 flex w-full max-w-[20rem] items-center gap-3 rounded-[18px] border border-hair bg-card px-4 py-3.5 shadow-press">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-primary/12 text-primary">
          <ListPlus className="h-[20px] w-[20px]" />
        </div>
        <div className="min-w-0 text-left">
          <div className="truncate font-headline text-[17px] font-bold lowercase text-foreground">
            {invite.listName}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">you can add &amp; remove films</div>
        </div>
      </div>

      <div className="mt-7 w-full max-w-[20rem] space-y-1.5">
        <CtaButton label="accept invite" icon={Check} onClick={handleAccept} loading={isAccepting} />
        <Link href="/lists" className="block">
          <button className="w-full py-3 text-center font-ui text-[15px] font-semibold text-muted-foreground transition-opacity active:opacity-60">
            decline
          </button>
        </Link>
      </div>
    </Shell>
  );
}

function Shell({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-background px-6 text-center text-foreground">
      {!muted && <PosterWall rows={5} cols={4} seed="invite" />}
      <div className="relative z-[1] flex w-full flex-col items-center pb-safe pt-safe">{children}</div>
    </main>
  );
}

function Headline({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h1
        className="m-0 font-headline text-[32px] font-bold leading-[1.04] tracking-[-0.02em] lowercase text-foreground"
        style={{ fontVariationSettings: '"wdth" 95' }}
      >
        {title}
      </h1>
      <p className="mt-2.5 max-w-[20rem] font-serif text-[15px] font-light italic leading-[1.5] text-muted-foreground">
        {sub}
      </p>
    </>
  );
}
