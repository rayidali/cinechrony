'use client';

import { ArrowRight } from 'lucide-react';
import { StepShell, StepHeader, FieldCard, CtaButton, filmRedCaret } from '@/components/v3/onboarding-kit';

/**
 * 002 · your name (step 1 of 4) — Phase 0.7 Wave 7. A single big editorial name
 * field. Local state only — nothing hits the server until the account is created
 * at the email step (onboarding is account-last).
 */
export function NameStep({
  name,
  setName,
  onContinue,
  onBack,
}: {
  name: string;
  setName: (v: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const canContinue = name.trim().length > 0;

  return (
    <StepShell
      step={1}
      total={4}
      onBack={onBack}
      header={
        <StepHeader
          eyebrow="step 1 of 4"
          title="first, your name"
          sub="just so your friends know who's adding them to lists."
        />
      }
      footer={
        <CtaButton label="continue" icon={ArrowRight} onClick={onContinue} disabled={!canContinue} />
      }
    >
      <div className="mt-8">
        <FieldCard label="your name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="riley park"
            autoFocus
            autoCapitalize="words"
            autoComplete="name"
            enterKeyHint="next"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canContinue) onContinue();
            }}
            style={filmRedCaret}
            className="w-full bg-transparent font-headline text-[26px] font-bold tracking-[-0.01em] text-foreground outline-none placeholder:text-muted-foreground/40"
          />
        </FieldCard>
      </div>
    </StepShell>
  );
}
