'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ChevronLeft, Eye, EyeOff } from 'lucide-react';
import { signInWithEmailAndPassword, signInWithCustomToken } from 'firebase/auth';
import { useAuth } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { apiCall } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { PosterWall } from '@/components/v3/poster-wall';
import { FieldCard, CtaButton, OrDivider, filmRedCaret } from '@/components/v3/onboarding-kit';
import { SocialAuthRow } from '@/components/v3/social-auth-row';

const APP_ICON = 'https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png';
const EMAIL_RE = /^\S+@\S+\.\S+$/;

/**
 * 006 · welcome back (log in) — Phase 0.7 Wave 7. Poster-wall hero + scrim, an
 * email-OR-@username field, password (reveal toggle), forgot-password, apple/
 * google, and the door back to signup. Username login routes through
 * `/api/v1/auth/login` (custom token); email logs in directly via the Web SDK.
 */
export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSubmit = identifier.trim().length > 0 && password.length > 0 && !busy;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const id = identifier.trim();
      if (EMAIL_RE.test(id)) {
        await signInWithEmailAndPassword(auth, id, password);
      } else {
        const { customToken } = await apiCall<{ customToken: string }>(
          'POST',
          '/api/v1/auth/login',
          { identifier: id, password },
          { skipAuth: true },
        );
        await signInWithCustomToken(auth, customToken);
      }
      haptic('success');
      router.push('/home');
    } catch {
      toast({
        variant: 'destructive',
        title: 'could not log in',
        description: 'incorrect email/username or password.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <PosterWall rows={5} cols={4} seed="welcome-back" />

      <div className="relative z-[1] px-5 pt-safe">
        <div className="pt-3">
          <button
            onClick={() => {
              haptic('light');
              router.push('/onboarding');
            }}
            aria-label="back"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/10 text-foreground backdrop-blur-md transition-opacity active:opacity-60"
          >
            <ChevronLeft className="h-[22px] w-[22px]" />
          </button>
        </div>
      </div>

      <div className="relative z-[1] flex flex-1 flex-col px-6 pb-safe">
        <div className="pt-6">
          <div className="mb-4 flex items-center gap-2.5">
            <img src={APP_ICON} alt="" className="h-8 w-8 rounded-[7px]" />
            <span className="font-headline text-[22px] font-bold lowercase tracking-[-0.02em]">
              cinechrony
            </span>
          </div>
          <h1
            className="m-0 font-headline text-[36px] font-bold leading-[1.0] tracking-[-0.03em] lowercase"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            welcome back.
          </h1>
          <p className="mt-2 font-serif text-[15px] font-light italic text-muted-foreground">
            your reel&apos;s been waiting. pick up where you left off.
          </p>
        </div>

        <form onSubmit={handleLogin} className="mt-7 space-y-3">
          <FieldCard label="email or @username">
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="riley@gmail.com"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="username"
              spellCheck={false}
              style={filmRedCaret}
              className="w-full bg-transparent font-mono text-[20px] tracking-[-0.01em] text-foreground outline-none placeholder:text-muted-foreground/40"
            />
          </FieldCard>

          <FieldCard
            label="password"
            trailing={
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? 'hide password' : 'show password'}
                className="text-muted-foreground transition-opacity active:opacity-60"
              >
                {showPw ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
            }
          >
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              enterKeyHint="go"
              style={filmRedCaret}
              className="w-full bg-transparent font-mono text-[20px] tracking-[-0.01em] text-foreground outline-none placeholder:text-muted-foreground/40"
            />
          </FieldCard>

          <div className="pb-1 text-right">
            <Link
              href="/forgot-password"
              className="font-ui text-[14px] font-semibold text-primary transition-opacity active:opacity-60"
            >
              forgot password?
            </Link>
          </div>

          <CtaButton type="submit" label="log in" icon={ArrowRight} disabled={!canSubmit} loading={busy} />
        </form>

        <div className="py-4">
          <OrDivider />
        </div>

        <SocialAuthRow onSuccess={() => router.push('/home')} />

        <p className="pt-5 text-center font-ui text-[14px] text-muted-foreground">
          new to cinechrony?{' '}
          <Link href="/onboarding?skip_splash=true" className="font-semibold text-primary">
            create an account
          </Link>
        </p>

        <div className="flex-1" />
      </div>
    </main>
  );
}
