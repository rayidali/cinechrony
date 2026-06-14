'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from 'vaul';
import { MoreHorizontal, Ban, ShieldOff, Flag } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { useUserBlocksCache } from '@/contexts/user-blocks-cache';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type ProfileOverflowMenuProps = {
  targetUserId: string;
  targetUsername: string;
  /** 'glass' renders a white-on-dark-glass trigger for use over a hero image. */
  variant?: 'default' | 'glass';
};

/**
 * The ⋯ on another user's profile — block / unblock + report.
 * Blocking severs the relationship and routes home (the profile then reads as
 * unavailable). See UX_PATTERNS.md — "Other-user profile vs your own".
 */
export function ProfileOverflowMenu({ targetUserId, targetUsername, variant = 'default' }: ProfileOverflowMenuProps) {
  const { user } = useUser();
  const router = useRouter();
  const { toast } = useToast();
  const { didIBlock, setBlocked } = useUserBlocksCache();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  if (!user || user.uid === targetUserId) return null;

  const blocked = didIBlock(targetUserId);

  const handleBlock = () => {
    setOpen(false);
    const next = !blocked;
    setBlocked(targetUserId, next); // optimistic
    startTransition(async () => {
      try {
        if (next) {
          await apiCall('POST', `/api/v1/users/${targetUserId}/block`);
          toast({
            title: `you blocked @${targetUsername}.`,
            description: 'you won’t see each other. unblock anytime in settings.',
          });
          router.push('/home');
        } else {
          await apiCall('DELETE', `/api/v1/users/${targetUserId}/block`);
          toast({ title: `you unblocked @${targetUsername}.` });
        }
      } catch (err) {
        setBlocked(targetUserId, !next);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: err instanceof ApiClientError ? err.message : 'Failed to update.',
        });
      }
    });
  };

  const handleReport = () => {
    setOpen(false);
    startTransition(async () => {
      try {
        await apiCall('POST', '/api/v1/reports', {
          contentType: 'user',
          targetId: targetUserId,
          reason: `Reported user @${targetUsername}`,
        });
        toast({ title: 'reported.', description: 'thanks for flagging — we’ll take a look.' });
      } catch (err) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: err instanceof ApiClientError ? err.message : 'Failed to report.',
        });
      }
    });
  };

  return (
    <>
      {variant === 'glass' ? (
        <button
          onClick={() => setOpen(true)}
          aria-label="More"
          className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-full border border-white/20 text-white shadow-[0_2px_10px_rgba(0,0,0,0.18)] transition-transform active:scale-95"
          style={{
            background: 'rgba(22,20,18,0.30)',
            backdropFilter: 'blur(16px) saturate(160%)',
            WebkitBackdropFilter: 'blur(16px) saturate(160%)',
          }}
        >
          <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={2.1} />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="More"
          className="h-11 w-11 -mr-1 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted active:bg-muted active:scale-95 transition-all"
        >
          <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={1.8} />
        </button>
      )}

      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[60] flex flex-col rounded-t-2xl bg-card outline-none">
            <Drawer.Title className="sr-only">Profile actions</Drawer.Title>
            <div className="mx-auto mt-3 mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <div className="px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <Row
                icon={blocked ? ShieldOff : Ban}
                label={blocked ? `unblock @${targetUsername}` : `block @${targetUsername}`}
                onSelect={handleBlock}
              />
              <div className="h-px bg-border my-1 mx-2" />
              <Row icon={Flag} label="report" onSelect={handleReport} destructive />
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}

function Row({
  icon: Icon,
  label,
  onSelect,
  destructive,
}: {
  icon: typeof Ban;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-3 px-2 py-3 rounded-lg text-left transition-colors hover:bg-muted',
        destructive ? 'text-destructive' : 'text-foreground',
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
      <span className="font-serif text-[15px] lowercase">{label}</span>
    </button>
  );
}
