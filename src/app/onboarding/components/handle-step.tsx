'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Loader2, CircleCheck } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { apiCall } from '@/lib/api-client';
import { StepShell, StepHeader, FieldCard, CtaButton, filmRedCaret } from '@/components/v3/onboarding-kit';
import { haptic } from '@/lib/haptics';

type Status = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'short';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const sanitize = (v: string) => v.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);

// Local cache mirroring the username-screen pattern (avoids re-checks).
const cache = new Map<string, boolean>();

/**
 * 004 · pick a handle (step 3 of 4) — Phase 0.7 Wave 7. The permanent @handle,
 * with a live availability check (the public `/usernames/:u/available` route)
 * and a few compliant suggestions. Local state only — the handle is reserved
 * server-side when the account is created at the email step (`/me/profile`,
 * which re-checks and 409s on a race). Note: handles are `[a-z0-9_]{3,20}` —
 * no dots — so suggestions use underscores.
 */
export function HandleStep({
  name,
  handle,
  setHandle,
  onContinue,
  onBack,
}: {
  name: string;
  handle: string;
  setHandle: (v: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<Status>('idle');

  // Seed the handle from the name the first time we land here.
  useEffect(() => {
    if (!handle && name) {
      const seed = sanitize(name.split(/\s+/)[0] || '');
      if (seed.length >= 3) setHandle(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suggestions = useMemo(() => {
    const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const first = sanitize(parts[0] || handle || 'cinephile');
    const last = sanitize(parts[1] || '');
    const out = new Set<string>();
    if (last) out.add(`${first}${last[0]}`);
    if (last) out.add(`${first}_${last}`);
    out.add(`${first}watches`);
    out.add(`${first}films`);
    return [...out].filter((s) => HANDLE_RE.test(s) && s !== handle).slice(0, 3);
  }, [name, handle]);

  const runCheck = useDebouncedCallback(async (value: string) => {
    if (cache.has(value)) {
      setStatus(cache.get(value) ? 'available' : 'taken');
      return;
    }
    setStatus('checking');
    try {
      const r = await apiCall<{ available: boolean }>(
        'GET',
        `/api/v1/usernames/${encodeURIComponent(value)}/available`,
      );
      cache.set(value, r.available);
      setStatus(r.available ? 'available' : 'taken');
    } catch {
      setStatus('idle');
    }
  }, 280);

  const apply = (value: string) => {
    const v = sanitize(value);
    setHandle(v);
    if (v.length === 0) return setStatus('idle');
    if (v.length < 3) return setStatus('short');
    if (!HANDLE_RE.test(v)) return setStatus('invalid');
    runCheck(v);
  };

  // Re-validate a seeded handle on mount.
  useEffect(() => {
    if (handle && HANDLE_RE.test(handle)) {
      setStatus('checking');
      runCheck(handle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canContinue = status === 'available';

  return (
    <StepShell
      step={3}
      total={4}
      onBack={onBack}
      header={
        <StepHeader
          eyebrow="step 3 of 4"
          title="pick a handle"
          sub="the @name your group chat will tag. lowercase, one word."
        />
      }
      footer={<CtaButton label="continue" icon={ArrowRight} onClick={onContinue} disabled={!canContinue} />}
    >
      <div className="mt-7 space-y-4">
        <FieldCard
          label="username"
          trailing={
            status === 'checking' ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : status === 'available' ? (
              <Check className="h-4 w-4 text-success" strokeWidth={3} />
            ) : null
          }
        >
          <div className="flex items-baseline font-mono text-[24px] tracking-[-0.01em] text-foreground">
            <span className="text-muted-foreground/70">@</span>
            <input
              type="text"
              value={handle}
              onChange={(e) => apply(e.target.value)}
              placeholder="riley"
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              maxLength={20}
              enterKeyHint="next"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canContinue) onContinue();
              }}
              style={filmRedCaret}
              className="min-w-0 flex-1 bg-transparent font-mono text-[24px] text-foreground outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        </FieldCard>

        {/* status line */}
        <div className="px-1 font-ui text-[14px]">
          {status === 'available' && (
            <span className="inline-flex items-center gap-1.5 text-success">
              <CircleCheck className="h-4 w-4" strokeWidth={2.5} />@{handle} is available
            </span>
          )}
          {status === 'taken' && <span className="text-destructive">@{handle} is taken</span>}
          {status === 'short' && <span className="text-muted-foreground">at least 3 characters</span>}
          {status === 'invalid' && (
            <span className="text-muted-foreground">letters, numbers + underscores only</span>
          )}
        </div>

        {/* suggestions */}
        {suggestions.length > 0 && status !== 'available' && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => {
                  haptic('selection');
                  apply(s);
                }}
                className="rounded-full border border-hair bg-card px-3.5 py-2 font-mono text-[13px] text-foreground shadow-press transition-all active:scale-[0.97]"
              >
                @{s}
              </button>
            ))}
          </div>
        )}
      </div>
    </StepShell>
  );
}
