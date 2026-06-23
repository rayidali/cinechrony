'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Check, Circle, Eye, EyeOff, Loader2, XCircle } from 'lucide-react';
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { useAuth } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import {
  FieldCard,
  CtaButton,
  StepHeader,
  AuthTopBar,
  filmRedCaret,
} from '@/components/v3/onboarding-kit';

const rules = (pw: string) => ({
  length: pw.length >= 8,
  number: /\d/.test(pw),
  symbol: /[^A-Za-z0-9]/.test(pw),
});

/**
 * 010 · set a new password — Phase 0.7 Wave 7. Reached from the email reset
 * link (`?oobCode=`). Live requirement chips (8 chars / number / symbol), reveal
 * toggle, then reset + auto-login → home.
 */
function ResetPasswordContent() {
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const oobCode = useSearchParams().get('oobCode');

  const [phase, setPhase] = useState<'verifying' | 'invalid' | 'form'>('verifying');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!oobCode) {
        setError('invalid or missing reset link.');
        setPhase('invalid');
        return;
      }
      try {
        const verifiedEmail = await verifyPasswordResetCode(auth, oobCode);
        if (!alive) return;
        setEmail(verifiedEmail);
        setPhase('form');
      } catch (err) {
        if (!alive) return;
        const code = (err as { code?: string })?.code;
        setError(
          code === 'auth/expired-action-code'
            ? 'this reset link has expired. request a new one.'
            : code === 'auth/invalid-action-code'
              ? 'this reset link is invalid or already used.'
              : 'something went wrong. try again.',
        );
        setPhase('invalid');
      }
    })();
    return () => {
      alive = false;
    };
  }, [auth, oobCode]);

  const r = rules(password);
  const canSubmit = r.length && r.number && r.symbol && !busy;

  const submit = async () => {
    if (!canSubmit || !oobCode) return;
    setBusy(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      // "reset & log in" — sign straight in with the new password.
      try {
        await signInWithEmailAndPassword(auth, email, password);
        haptic('success');
        router.push('/home');
      } catch {
        // Reset succeeded but auto-login failed — send them to log in manually.
        haptic('success');
        router.push('/login');
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'could not reset password',
        description:
          (err as { code?: string })?.code === 'auth/weak-password'
            ? 'choose a stronger password.'
            : 'the link may have expired. request a new one.',
      });
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'verifying') {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
        <AuthTopBar eyebrow="almost there" onBack={() => router.push('/login')} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin" />
          <span className="font-mono text-[12px] uppercase tracking-[0.14em]">verifying link…</span>
        </div>
      </div>
    );
  }

  if (phase === 'invalid') {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
        <AuthTopBar eyebrow="almost there" onBack={() => router.push('/login')} />
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <XCircle className="h-12 w-12 text-destructive" strokeWidth={1.5} />
          <p className="mt-4 max-w-[18rem] font-serif text-[15px] font-light italic text-muted-foreground">
            {error}
          </p>
          <button
            onClick={() => router.push('/forgot-password')}
            className="mt-7 flex h-[52px] w-full max-w-[20rem] items-center justify-center rounded-full bg-primary font-ui text-[15px] font-semibold text-primary-foreground shadow-fab transition-all active:scale-[0.98]"
          >
            request a new link
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <AuthTopBar eyebrow="almost there" onBack={() => router.push('/login')} />

      <div className="flex-1 overflow-y-auto px-5 pt-8">
        <StepHeader
          title="set a new password"
          sub="make it something your group chat could never guess."
        />

        <div className="mt-8 space-y-4">
          <FieldCard
            label="new password"
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
              autoFocus
              autoComplete="new-password"
              enterKeyHint="go"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) submit();
              }}
              style={filmRedCaret}
              className="w-full bg-transparent font-mono text-[20px] tracking-[-0.01em] text-foreground outline-none placeholder:text-muted-foreground/40"
            />
          </FieldCard>

          <div className="flex flex-wrap gap-2">
            <Req ok={r.length} label="at least 8 characters" />
            <Req ok={r.number} label="one number" />
            <Req ok={r.symbol} label="one symbol" />
          </div>
        </div>
      </div>

      <div className="px-5 pb-safe">
        <div className="pb-4 pt-3">
          <CtaButton label="reset & log in" icon={ArrowRight} onClick={submit} disabled={!canSubmit} loading={busy} />
        </div>
      </div>
    </div>
  );
}

function Req({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-[13px] transition-colors',
        ok ? 'border-success/30 bg-success/10 text-success' : 'border-hair bg-card text-muted-foreground',
      )}
    >
      {ok ? <Check className="h-[14px] w-[14px]" strokeWidth={3} /> : <Circle className="h-[14px] w-[14px]" />}
      {label}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-background">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
