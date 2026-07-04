'use client';

import { useState } from 'react';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { useAuth } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { track, AnalyticsEvent } from '@/lib/analytics';
import {
  StepShell,
  StepHeader,
  FieldCard,
  CtaButton,
  OrDivider,
  filmRedCaret,
} from '@/components/v3/onboarding-kit';
import { SocialAuthRow } from '@/components/v3/social-auth-row';

/**
 * 005 · last thing (step 4 of 4) — Phase 0.7 Wave 7. The account is created HERE
 * (onboarding is account-last): email + password, or apple/google. Immediately
 * after auth we provision the profile with the name + handle collected earlier
 * (`POST /api/v1/me/profile`, which re-checks the handle and 409s on a race →
 * we bounce back to the handle step). Then the parent routes to the import
 * screen (if a letterboxd handle was stashed) or to find-your-people.
 *
 * Design note: the mock shows only an email field, but a Firebase email account
 * needs a password (and the login/reset screens are password-based), so a
 * password field rides directly beneath email.
 */
export function AccountStep({
  name,
  handle,
  email,
  setEmail,
  onProvisioned,
  onHandleTaken,
  onBack,
}: {
  name: string;
  handle: string;
  email: string;
  setEmail: (v: string) => void;
  onProvisioned: () => void;
  onHandleTaken: () => void;
  onBack: () => void;
}) {
  const auth = useAuth();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const canCreate = emailOk && password.length >= 8 && !busy;

  // Provision profile + reserve the handle. Shared by email + social paths.
  const provision = async () => {
    try {
      await apiCall('POST', '/api/v1/me/profile', {
        email: auth.currentUser?.email || email.trim(),
        username: handle,
        displayName: name.trim() || null,
      });
      haptic('success');
      track(AnalyticsEvent.SignupCompleted);
      onProvisioned();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'CONFLICT') {
        toast({
          variant: 'destructive',
          title: 'that handle just got taken',
          description: 'pick another one.',
        });
        onHandleTaken();
        return;
      }
      toast({
        variant: 'destructive',
        title: 'something went wrong',
        description: err instanceof Error ? err.message : 'please try again.',
      });
    }
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
      await provision();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const description =
        code === 'auth/email-already-in-use'
          ? 'this email is already registered. try logging in instead.'
          : code === 'auth/weak-password'
            ? 'password should be at least 8 characters.'
            : code === 'auth/invalid-email'
              ? 'please enter a valid email address.'
              : 'please try again.';
      toast({ variant: 'destructive', title: 'could not create account', description });
    } finally {
      setBusy(false);
    }
  };

  // Social: the provider has already signed the user in by the time onSuccess
  // fires — just provision the profile, then route.
  const handleSocialSuccess = () => {
    setBusy(true);
    void provision().finally(() => setBusy(false));
  };

  return (
    <StepShell
      step={4}
      total={4}
      onBack={onBack}
      header={
        <StepHeader
          eyebrow="step 4 of 4"
          title="last thing"
          sub="where we send your reset link and the occasional 'your friends are watching' nudge."
        />
      }
      footer={
        <CtaButton
          label="create account"
          icon={ArrowRight}
          onClick={handleCreate}
          disabled={!canCreate}
          loading={busy}
        />
      }
    >
      <div className="mt-7 space-y-3">
        <FieldCard label="email">
          <input
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="riley@gmail.com"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="email"
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
            placeholder="at least 8 characters"
            autoCapitalize="off"
            autoComplete="new-password"
            enterKeyHint="go"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCreate) handleCreate();
            }}
            style={filmRedCaret}
            className="w-full bg-transparent font-mono text-[20px] tracking-[-0.01em] text-foreground outline-none placeholder:text-muted-foreground/40"
          />
        </FieldCard>

        <div className="py-3">
          <OrDivider />
        </div>

        <SocialAuthRow onSuccess={handleSocialSuccess} />

        <p className="pt-3 text-center font-ui text-[12px] leading-[1.5] text-muted-foreground">
          by continuing you agree to our terms &amp; privacy policy.
        </p>
      </div>
    </StepShell>
  );
}
