'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import {
  AuthCancelledError,
  shouldShowAppleButton,
  signInWithApple,
  signInWithGoogle,
} from '@/lib/native-auth';

/**
 * v3 social-auth row — Phase 0.7 Wave 7. The compact "apple · google" pills
 * from the design (005 / 006), side-by-side. Reuses `native-auth` (Capacitor
 * plugin on iOS, web popup in the browser). Apple only shows after hydration in
 * a native runtime (avoids a flash on web, where Apple Service ID isn't wired);
 * when hidden, Google spans the row. `onSuccess` runs after a successful
 * sign-in (the caller decides where to route / how to finalize onboarding).
 */
export function SocialAuthRow({ onSuccess }: { onSuccess: () => void }) {
  const auth = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);
  const [showApple, setShowApple] = useState(false);

  useEffect(() => {
    setShowApple(shouldShowAppleButton());
  }, []);

  const run = async (provider: 'google' | 'apple') => {
    if (busy) return;
    setBusy(provider);
    haptic('light');
    try {
      if (provider === 'google') await signInWithGoogle(auth);
      else await signInWithApple(auth);
      onSuccess();
    } catch (err) {
      if (!(err instanceof AuthCancelledError)) {
        toast({
          variant: 'destructive',
          title: provider === 'google' ? 'google sign-in failed' : 'apple sign-in failed',
          description: err instanceof Error ? err.message : 'Please try again.',
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const btn =
    'flex h-[52px] items-center justify-center gap-2 rounded-[16px] border border-hair bg-card font-ui text-[15px] font-semibold text-foreground shadow-press transition-all active:scale-[0.98] disabled:opacity-50';

  return (
    <div className={cn('grid gap-3', showApple ? 'grid-cols-2' : 'grid-cols-1')}>
      {showApple && (
        <button type="button" className={btn} onClick={() => run('apple')} disabled={busy !== null}>
          {busy === 'apple' ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
          ) : (
            <AppleGlyph className="h-[18px] w-[18px]" />
          )}
          apple
        </button>
      )}
      <button type="button" className={btn} onClick={() => run('google')} disabled={busy !== null}>
        {busy === 'google' ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin" />
        ) : (
          <GoogleGlyph className="h-[18px] w-[18px]" />
        )}
        google
      </button>
    </div>
  );
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.7 4.7-6.2 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.3 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.3 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.3l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.1 0-9.5-3.3-11.2-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2C40.9 35.7 44 30.3 44 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AppleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
    </svg>
  );
}
