'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Mail, MailCheck } from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useAuth } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import {
  FieldCard,
  CtaButton,
  StepHeader,
  AuthTopBar,
  IconTile,
  filmRedCaret,
} from '@/components/v3/onboarding-kit';

const RESEND_SECONDS = 42;

/**
 * 007 · forgot your password? + 008 · check your email — Phase 0.7 Wave 7.
 * Two states of one screen. AUDIT 2.10 preserved: a non-existent account is
 * indistinguishable from a success (we advance to "check your email" either way).
 */
export default function ForgotPasswordPage() {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());

  const send = async () => {
    if (!emailOk || busy) return;
    setBusy(true);
    const addr = email.trim();
    try {
      // Prefer the branded Resend email (server route). It returns
      // `method: 'firebase'` when Resend isn't configured → fall back to
      // Firebase's own reset email. Both keep AUDIT 2.10 non-disclosure.
      const res = await apiCall<{ method?: string }>(
        'POST', '/api/v1/auth/forgot-password', { email: addr }, { skipAuth: true },
      );
      if (res?.method !== 'resend') {
        await sendPasswordResetEmail(auth, addr).catch(() => {});
      }
    } catch {
      // Route unreachable → fall back to Firebase directly so reset still works.
      await sendPasswordResetEmail(auth, addr).catch(() => {});
    }
    haptic('success');
    setSent(true); // always advance (non-disclosure)
    setBusy(false);
  };

  if (sent) return <CheckYourEmail email={email.trim()} onResend={send} onBack={() => setSent(false)} />;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <AuthTopBar eyebrow="account recovery" onBack={() => router.push('/login')} />

      <div className="flex-1 overflow-y-auto px-5 pt-6">
        <IconTile icon={KeyRound} />
        <div className="mt-6">
          <StepHeader
            title="forgot your password?"
            sub="happens to the best of us. drop your email and we'll send a reset link."
          />
        </div>
        <div className="mt-8">
          <FieldCard label="email">
            <input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="riley@gmail.com"
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="email"
              spellCheck={false}
              enterKeyHint="send"
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
              }}
              style={filmRedCaret}
              className="w-full bg-transparent font-mono text-[20px] tracking-[-0.01em] text-foreground outline-none placeholder:text-muted-foreground/40"
            />
          </FieldCard>
        </div>
      </div>

      <div className="px-5 pb-safe">
        <div className="pb-4 pt-3">
          <CtaButton label="send reset link" icon={Mail} onClick={send} disabled={!emailOk} loading={busy} />
        </div>
      </div>
    </div>
  );
}

// ── 008 · check your email ───────────────────────────────────────────────────
function CheckYourEmail({
  email,
  onResend,
  onBack,
}: {
  email: string;
  onResend: () => void;
  onBack: () => void;
}) {
  const [secs, setSecs] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (secs <= 0) return;
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [secs]);

  const openMail = () => {
    haptic('light');
    // iOS Mail opens on message://; harmless no-op elsewhere.
    try {
      window.location.href = 'message://';
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <AuthTopBar onBack={onBack} />

      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <IconTile icon={MailCheck} accent className="mb-6" />
        <h1
          className="m-0 font-headline text-[30px] font-bold lowercase tracking-[-0.02em]"
          style={{ fontVariationSettings: '"wdth" 95' }}
        >
          check your email
        </h1>
        <p className="mt-2.5 font-serif text-[15px] font-light italic text-muted-foreground">
          we sent a reset link to
        </p>
        <p className="mt-1 font-mono text-[15px] text-foreground">{email}</p>

        <button
          onClick={openMail}
          className="mt-7 flex h-[52px] w-full max-w-[20rem] items-center justify-center gap-2 rounded-full border border-hair bg-card font-ui text-[15px] font-semibold text-foreground shadow-press transition-all active:scale-[0.98]"
        >
          <Mail className="h-[18px] w-[18px]" />
          open mail app
        </button>

        <div className="mt-5 font-ui text-[14px] text-muted-foreground">
          didn&apos;t get it?{' '}
          {secs > 0 ? (
            <span className="font-semibold text-primary">resend in 0:{String(secs).padStart(2, '0')}</span>
          ) : (
            <button
              onClick={() => {
                onResend();
                setSecs(RESEND_SECONDS);
              }}
              className="font-semibold text-primary"
            >
              resend
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
