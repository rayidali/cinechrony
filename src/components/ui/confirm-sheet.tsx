'use client';

import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';

/**
 * v3 confirmation sheet (Vaul) — the brand-consistent, native-reliable
 * replacement for shadcn AlertDialog for destructive confirms. Works identically
 * on web (PWA) and inside the Capacitor WebView.
 */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'confirm',
  cancelLabel = 'cancel',
  destructive = false,
  loading = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o); }}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/45" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-[70] rounded-t-[24px] border-t border-hair bg-card outline-none">
          <div className="mx-auto mt-3 h-1 w-9 rounded-full bg-foreground/15" />
          <div className="px-5 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            <Drawer.Title className="font-headline text-[20px] font-bold lowercase tracking-[-0.02em]">
              {title}
            </Drawer.Title>
            {description && (
              <Drawer.Description className="mt-1.5 font-ui text-[14.5px] leading-snug text-muted-foreground">
                {description}
              </Drawer.Description>
            )}
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => { haptic(destructive ? 'warning' : 'medium'); onConfirm(); }}
                disabled={loading}
                className={cn(
                  'flex h-12 items-center justify-center rounded-full font-headline text-[16px] font-bold lowercase transition-transform active:scale-[0.98] disabled:opacity-60',
                  destructive ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground',
                )}
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : confirmLabel}
              </button>
              <button
                onClick={() => { haptic('light'); onOpenChange(false); }}
                disabled={loading}
                className="flex h-12 items-center justify-center rounded-full bg-secondary font-headline text-[16px] font-semibold lowercase text-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {cancelLabel}
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
