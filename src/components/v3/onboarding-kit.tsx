'use client';

import type { ComponentType, ReactNode } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';

// ── auth top bar (back chevron + optional centered eyebrow) ──────────────────
export function AuthTopBar({ eyebrow, onBack }: { eyebrow?: string; onBack: () => void }) {
  return (
    <div className="px-5 pt-safe">
      <div className="relative flex items-center pt-3">
        <button
          onClick={() => {
            haptic('light');
            onBack();
          }}
          aria-label="back"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.07] text-foreground transition-opacity active:opacity-60"
        >
          <ChevronLeft className="h-[22px] w-[22px]" />
        </button>
        {eyebrow && (
          <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            {eyebrow}
          </span>
        )}
      </div>
    </div>
  );
}

// ── rounded icon tile (key / mail-check) ─────────────────────────────────────
export function IconTile({
  icon: Icon,
  accent,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-[60px] w-[60px] items-center justify-center rounded-[18px]',
        accent
          ? 'bg-primary text-primary-foreground shadow-fab'
          : 'border border-hair bg-card text-primary shadow-press',
        className,
      )}
    >
      <Icon className="h-7 w-7" />
    </div>
  );
}

/** Film-red caret matching the design's blinking cursor. */
const CARET = { caretColor: 'oklch(var(--primary))' } as const;
export const filmRedCaret = CARET;

/**
 * Onboarding / auth kit — Phase 0.7 Wave 7. The shared chrome behind the welcome
 * + 4-step signup + auth screens (001–010): the step shell (progress · back ·
 * skip · sticky CTA), the editorial header, the labelled field card, and the
 * primary CTA pill. Built to the v3 sizing standard (bigger, not timid) and
 * theme-aware via semantic tokens.
 */

// ── progress bar (STEP n OF 4) ──────────────────────────────────────────────
export function OnboardingProgress({ step, total = 4 }: { step: number; total?: number }) {
  return (
    <div className="flex flex-1 items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-[3px] flex-1 rounded-full transition-colors duration-300',
            i < step ? 'bg-primary' : 'bg-foreground/10',
          )}
        />
      ))}
    </div>
  );
}

// ── editorial step header (eyebrow → lowercase title → serif sub) ────────────
export function StepHeader({
  eyebrow,
  title,
  sub,
  eyebrowClassName,
  titleClassName,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  eyebrowClassName?: string;
  titleClassName?: string;
}) {
  return (
    <div>
      {eyebrow && (
        <div
          className={cn(
            'mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-primary',
            eyebrowClassName,
          )}
        >
          {eyebrow}
        </div>
      )}
      <h1
        className={cn(
          'm-0 font-headline text-[30px] font-bold leading-[1.05] tracking-[-0.02em] lowercase text-foreground',
          titleClassName,
        )}
        style={{ fontVariationSettings: '"wdth" 95' }}
      >
        {title}
      </h1>
      {sub && (
        <p className="mt-2.5 font-serif text-[15px] font-light italic leading-[1.5] text-muted-foreground">
          {sub}
        </p>
      )}
    </div>
  );
}

// ── labelled field card ──────────────────────────────────────────────────────
export function FieldCard({
  label,
  children,
  trailing,
  className,
}: {
  label: string;
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[18px] border border-hair bg-card px-4 py-3.5 shadow-press',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
        {trailing}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

// ── primary CTA pill (film-red) ──────────────────────────────────────────────
export function CtaButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  loading,
  type = 'button',
  className,
}: {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={() => {
        if (disabled || loading) return;
        haptic('medium');
        onClick?.();
      }}
      disabled={disabled || loading}
      className={cn(
        'flex h-[54px] w-full items-center justify-center gap-2 rounded-full bg-primary font-ui text-[16px] font-semibold text-primary-foreground shadow-fab transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none',
        className,
      )}
    >
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : Icon ? (
        <Icon className="h-[18px] w-[18px]" />
      ) : null}
      {label}
    </button>
  );
}

// ── "OR CONTINUE WITH" divider ───────────────────────────────────────────────
export function OrDivider({ label = 'or continue with' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-foreground/10" />
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <div className="h-px flex-1 bg-foreground/10" />
    </div>
  );
}

// ── the full step shell ──────────────────────────────────────────────────────
export function StepShell({
  step,
  total,
  onBack,
  onSkip,
  header,
  children,
  footer,
  bodyClassName,
}: {
  step?: number;
  total?: number;
  onBack?: () => void;
  onSkip?: () => void;
  header?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      {/* top chrome: back · progress · skip */}
      <div className="px-5 pt-safe">
        <div className="flex items-center gap-3 pt-3">
          {onBack ? (
            <button
              onClick={() => {
                haptic('light');
                onBack();
              }}
              aria-label="back"
              className="-ml-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition-opacity active:opacity-60"
            >
              <ChevronLeft className="h-[22px] w-[22px]" />
            </button>
          ) : (
            <span className="h-9 w-1.5 shrink-0" />
          )}
          {typeof step === 'number' && <OnboardingProgress step={step} total={total} />}
          {onSkip ? (
            <button
              onClick={() => {
                haptic('light');
                onSkip();
              }}
              className="shrink-0 font-ui text-[14px] font-medium text-muted-foreground transition-opacity active:opacity-60"
            >
              skip
            </button>
          ) : typeof step === 'number' ? (
            <span className="w-7 shrink-0" />
          ) : null}
        </div>
      </div>

      {/* body */}
      <div className={cn('flex-1 overflow-y-auto px-5 pb-6 pt-8', bodyClassName)}>
        {header}
        {children}
      </div>

      {/* sticky footer CTA */}
      <div className="px-5 pb-safe">
        <div className="pb-4 pt-3">{footer}</div>
      </div>
    </div>
  );
}
