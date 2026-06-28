'use client';

/**
 * SheetMenu — a Vaul bottom-sheet replacement for Radix DropdownMenu/Select.
 *
 * WHY. Radix popovers (DropdownMenu, Select, Popover) open on `pointerdown`,
 * which the iOS Capacitor WKWebView doesn't deliver in a way Radix accepts — the
 * menu never appears natively (a plain `onClick` still fires, which is how we know
 * it's the popover, not the tap). Vaul drawers open from an explicit `onClick`
 * and are used reliably throughout the app on native, so every in-app menu is
 * built on this instead.
 *
 * Usage:
 *   <SheetMenu
 *     title="appearance"
 *     trigger={(open) => <button onClick={open}>…</button>}
 *   >
 *     {(close) => (
 *       <>
 *         <SheetMenuItem icon={Sun} onSelect={() => { setTheme('light'); close(); }}>light</SheetMenuItem>
 *         …
 *       </>
 *     )}
 *   </SheetMenu>
 */

import { Drawer } from 'vaul';
import { useState, type ReactNode, type ComponentType } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';

export function SheetMenu({
  trigger,
  children,
  title,
}: {
  trigger: (open: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {trigger(() => {
        haptic('light');
        setOpen(true);
      })}
      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[95] bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-[96] rounded-t-[22px] border-t border-border bg-card pb-[max(env(safe-area-inset-bottom),16px)] outline-none">
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
            {title ? (
              <div className="px-5 pb-1 pt-3">
                <Drawer.Title className="font-headline text-[19px] font-bold lowercase tracking-[-0.02em]">
                  {title}
                </Drawer.Title>
              </div>
            ) : (
              <Drawer.Title className="sr-only">menu</Drawer.Title>
            )}
            <div className="px-3 pb-2 pt-1">{children(() => setOpen(false))}</div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}

export function SheetMenuItem({
  icon: Icon,
  onSelect,
  active,
  destructive,
  disabled,
  children,
}: {
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  onSelect: () => void;
  active?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition-colors active:bg-secondary disabled:opacity-50',
        destructive ? 'text-destructive' : 'text-foreground',
      )}
    >
      {Icon && <Icon className="h-5 w-5" strokeWidth={2} />}
      <span className="flex-1 font-headline text-[16px] lowercase">{children}</span>
      {active && <Check className="h-5 w-5 text-primary" />}
    </button>
  );
}

/** A small uppercase mono section label inside a SheetMenu. */
export function SheetMenuLabel({ children }: { children: ReactNode }) {
  return <div className="cc-eyebrow px-3 pb-1 pt-3 text-muted-foreground">{children}</div>;
}
