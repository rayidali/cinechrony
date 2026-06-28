'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Drawer } from 'vaul';
import { Moon, Sun, Monitor, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { haptic } from '@/lib/haptics';

const OPTIONS = [
  { value: 'light', label: 'light', icon: Sun },
  { value: 'dark', label: 'dark', icon: Moon },
  { value: 'system', label: 'system', icon: Monitor },
] as const;

/**
 * ThemeToggle — the sun/moon switcher that opens a light · dark · system sheet.
 *
 * Uses a Vaul bottom sheet (NOT a Radix DropdownMenu): Radix poppers open on
 * `pointerdown`, which the iOS WKWebView doesn't deliver in a way Radix accepts,
 * so the menu never appeared in the native app. A plain `onClick` (which DOES
 * fire natively — the haptic proved it) opening a Vaul sheet is reliable on web
 * and native alike.
 *
 * `variant="default"` is a bordered icon button for the frosted top bars
 * (home + lists). `variant="glass"` is a translucent dark-glass circle for use
 * OVER imagery (the profile hero), matching <GlassBtn>.
 */
export function ThemeToggle({ variant = 'default' }: { variant?: 'default' | 'glass' }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  // The active-theme checkmark only resolves after mount (next-themes). The
  // sun/moon icon swap itself is pure CSS (`dark:`), correct on the server too.
  useEffect(() => setMounted(true), []);

  const glass = variant === 'glass';

  const openSheet = () => {
    haptic('light');
    setOpen(true);
  };

  const Trigger = glass ? (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={openSheet}
      className="relative inline-flex h-[38px] w-[38px] items-center justify-center rounded-full border border-white/20 text-white shadow-[0_2px_10px_rgba(0,0,0,0.18)] transition-transform active:scale-95"
      style={{
        background: 'rgba(22,20,18,0.30)',
        backdropFilter: 'blur(16px) saturate(160%)',
        WebkitBackdropFilter: 'blur(16px) saturate(160%)',
      }}
    >
      <Sun className="h-[18px] w-[18px] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" strokeWidth={2.1} />
      <Moon className="absolute h-[18px] w-[18px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" strokeWidth={2.1} />
      <span className="sr-only">Toggle theme</span>
    </button>
  ) : (
    <Button
      variant="ghost"
      size="icon"
      onClick={openSheet}
      className="relative h-10 w-10 border border-border rounded-lg"
    >
      <Sun className="h-[18px] w-[18px] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[18px] w-[18px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );

  return (
    <>
      {Trigger}
      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[95] bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-[96] rounded-t-[22px] border-t border-border bg-card pb-[max(env(safe-area-inset-bottom),16px)] outline-none">
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
            <div className="px-5 pb-1 pt-3">
              <Drawer.Title className="font-headline text-[19px] font-bold lowercase tracking-[-0.02em]">
                appearance
              </Drawer.Title>
            </div>
            <div className="px-3 pb-2">
              {OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = mounted && theme === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      haptic('light');
                      setTheme(opt.value);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition-colors active:bg-secondary"
                  >
                    <Icon className="h-5 w-5" strokeWidth={2} />
                    <span className="flex-1 font-headline text-[16px] lowercase">{opt.label}</span>
                    {active && <Check className="h-5 w-5 text-primary" />}
                  </button>
                );
              })}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
