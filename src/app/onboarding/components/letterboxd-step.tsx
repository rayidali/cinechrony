'use client';

import { useState } from 'react';
import { Download, Check, Loader2, X } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { apiCall } from '@/lib/api-client';
import { StepShell, StepHeader, FieldCard, CtaButton, filmRedCaret } from '@/components/v3/onboarding-kit';

type Preview = {
  username: string;
  found: boolean;
  verified: boolean;
  displayName: string | null;
  films: number | null;
  lists: number | null;
};

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * 003 · bring your films (step 2 of 4) — Phase 0.7 Wave 7. The user types their
 * public Letterboxd handle; a cheap, Apify-free preview (`/preview`) confirms the
 * profile and shows real-ish counts. Tapping "import" only STASHES the handle and
 * advances — the real Apify scrape+import runs after the account exists (the
 * importing screen). Skip starts a fresh diary.
 */
export function LetterboxdStep({
  lbUsername,
  setLbUsername,
  onContinue,
  onSkip,
  onBack,
}: {
  lbUsername: string;
  setLbUsername: (v: string) => void;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useDebouncedCallback(async (value: string) => {
    const u = value.trim().replace(/^@/, '').toLowerCase();
    if (!u) {
      setChecking(false);
      setPreview(null);
      return;
    }
    try {
      const result = await apiCall<Preview>('POST', '/api/v1/imports/letterboxd/preview', { username: u });
      // Ignore stale responses for an input the user has since changed.
      setPreview((prev) => (result.username === u ? result : prev));
    } catch {
      // Network / malformed — leave it optimistic; the real run is the oracle.
      setPreview({ username: u, found: true, verified: false, displayName: null, films: null, lists: null });
    } finally {
      setChecking(false);
    }
  }, 450);

  const handleChange = (raw: string) => {
    const u = raw.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    setLbUsername(u);
    setPreview(null);
    if (u) {
      setChecking(true);
      check(u);
    } else {
      setChecking(false);
    }
  };

  const notFound = preview?.found === false;
  const found = !!preview?.found && !!lbUsername;
  const canImport = lbUsername.length > 0 && !notFound;

  const ctaLabel =
    found && preview?.films != null ? `import ${fmt(preview.films)} films` : 'import my diary';

  return (
    <StepShell
      step={2}
      total={4}
      onBack={onBack}
      onSkip={onSkip}
      header={
        <StepHeader
          eyebrow="step 2 of 4"
          title="bring your films"
          sub="already keep a diary on letterboxd? pull it in. ratings, watchlist, and all."
        />
      }
      footer={<CtaButton label={ctaLabel} icon={Download} onClick={onContinue} disabled={!canImport} />}
    >
      <div className="mt-7 space-y-3">
        <FieldCard
          label="letterboxd username"
          trailing={
            checking ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null
          }
        >
          <div className="flex items-baseline font-mono text-[19px] tracking-[-0.01em] text-foreground">
            <span className="text-muted-foreground/70">letterboxd.com/</span>
            <input
              type="text"
              value={lbUsername}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="rileyp"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
              style={filmRedCaret}
              className="min-w-0 flex-1 bg-transparent font-mono text-[19px] text-foreground outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        </FieldCard>

        {/* found / not-found state */}
        {found && (
          <div className="flex items-center gap-3 rounded-[16px] border border-hair bg-card px-4 py-3.5 shadow-press">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success">
              <Check className="h-[18px] w-[18px] text-background" strokeWidth={3} />
            </div>
            <div className="min-w-0">
              <div className="font-ui text-[15px] font-semibold text-foreground">
                @{preview!.username} found
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {[
                  preview!.films != null ? `${fmt(preview!.films)} films` : null,
                  preview!.lists != null ? `${fmt(preview!.lists)} lists` : null,
                  'ready to sync',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </div>
        )}

        {notFound && (
          <div className="flex items-center gap-3 rounded-[16px] border border-hair bg-card px-4 py-3.5 shadow-press">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <X className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={3} />
            </div>
            <div className="font-ui text-[14px] text-muted-foreground">
              no public profile at that handle — check the spelling, or tap skip.
            </div>
          </div>
        )}

        <p className="px-1 pt-1 font-ui text-[13px] leading-[1.5] text-muted-foreground">
          new here? no worries. tap skip and start your diary fresh.
        </p>
      </div>
    </StepShell>
  );
}
