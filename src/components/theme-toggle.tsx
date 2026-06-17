'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Moon, Sun, Monitor, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { haptic } from '@/lib/haptics';

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

/**
 * ThemeToggle — the sun/moon switcher that opens a light · dark · system menu.
 *
 * `variant="default"` is a bordered icon button for the frosted top bars
 * (home + lists). `variant="glass"` is a translucent dark-glass circle for use
 * OVER imagery (the profile hero), matching <GlassBtn>. Reachable from every
 * tab's top-right.
 */
export function ThemeToggle({ variant = 'default' }: { variant?: 'default' | 'glass' }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch on the active-theme checkmark (next-themes only
  // resolves the chosen theme after mount). The icon swap itself is pure CSS
  // (`dark:` classes), so the trigger shape is correct on the server too.
  useEffect(() => setMounted(true), []);

  const glass = variant === 'glass';

  const Trigger = glass ? (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => haptic('light')}
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
      onClick={() => haptic('light')}
      className="relative h-9 w-9 border border-border dark:border-white rounded-lg"
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );

  // Pre-mount: render the trigger shape (no menu yet) so there's no layout
  // shift and no hydration mismatch.
  if (!mounted) return Trigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{Trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border border-border dark:border-white">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <DropdownMenuItem key={opt.value} onClick={() => setTheme(opt.value)}>
              <Icon className="mr-2 h-4 w-4" />
              <span className="flex-1">{opt.label}</span>
              {theme === opt.value && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
