'use client';

import { Drawer } from 'vaul';
import { Globe, Users, Star, Lock, Check } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import type { PostVisibility } from '@/lib/types';

/**
 * F04 "visible to" — a bottom sheet audience radio. everyone / friends /
 * close friends / only me, each with a one-line description. Selecting a row
 * commits immediately (radios don't need a separate apply); done just closes.
 * When "close friends" is the choice, a small "edit list" affordance lets the
 * author curate their inner circle (reuses the friend picker via onManage).
 */
type Option = {
  id: PostVisibility;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  desc: string;
};

export function VisibleToSheet({
  isOpen,
  value,
  closeFriendCount,
  onClose,
  onChange,
  onManageCloseFriends,
}: {
  isOpen: boolean;
  value: PostVisibility;
  closeFriendCount: number;
  onClose: () => void;
  onChange: (v: PostVisibility) => void;
  onManageCloseFriends?: () => void;
}) {
  const options: Option[] = [
    { id: 'everyone', icon: Globe, label: 'everyone', desc: 'anyone on cinechrony can see this post' },
    { id: 'friends', icon: Users, label: 'friends', desc: 'only people you follow back' },
    {
      id: 'close_friends', icon: Star, label: 'close friends',
      desc: `your inner circle · ${closeFriendCount} ${closeFriendCount === 1 ? 'person' : 'people'}`,
    },
    { id: 'only_me', icon: Lock, label: 'only me', desc: 'a private log — nobody else sees it' },
  ];

  const choose = (v: PostVisibility) => {
    haptic('light');
    onChange(v);
  };

  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[95]" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[95] flex flex-col rounded-t-[22px] bg-card outline-none max-h-[88vh]">
          <Drawer.Title className="sr-only">Visible to</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />

          {/* header */}
          <div className="flex items-center justify-between px-5 py-2.5">
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui font-semibold text-[15px] text-muted-foreground active:opacity-60">
              cancel
            </button>
            <span className="font-headline font-bold text-[18px] lowercase tracking-[-0.02em]">visible to</span>
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui font-bold text-[15px] text-primary active:opacity-60">
              done
            </button>
          </div>

          <div className="px-5 pt-1 pb-[calc(1.5rem+env(safe-area-inset-bottom))] overflow-y-auto space-y-2.5">
            {options.map((o) => {
              const on = value === o.id;
              const Icon = o.icon;
              return (
                <button
                  key={o.id}
                  onClick={() => choose(o.id)}
                  className={`w-full flex items-center gap-3.5 rounded-2xl border p-3.5 text-left transition-colors ${
                    on ? 'border-primary bg-primary/[0.06]' : 'border-hair bg-card active:bg-foreground/[0.03]'
                  }`}
                >
                  <span className={`flex-shrink-0 h-11 w-11 rounded-full flex items-center justify-center ${on ? 'bg-primary text-primary-foreground' : 'bg-sunken text-muted-foreground'}`}>
                    <Icon className="h-5 w-5" strokeWidth={1.9} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-headline font-bold text-[16px] lowercase tracking-[-0.02em] text-foreground">{o.label}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground leading-snug mt-0.5">{o.desc}</span>
                    {o.id === 'close_friends' && on && onManageCloseFriends && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); haptic('light'); onManageCloseFriends(); }}
                        className="inline-block mt-1.5 font-ui font-semibold text-[12px] text-primary active:opacity-60"
                      >
                        edit list
                      </span>
                    )}
                  </span>
                  <span className={`flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center transition-colors ${on ? 'bg-primary text-primary-foreground' : 'border-2 border-hair'}`}>
                    {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
