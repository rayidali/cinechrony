'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { CtaButton } from '@/components/v3/onboarding-kit';

const APP_ICON = 'https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png';

const STATUS = [
  'reaching letterboxd…',
  'pulling your diary…',
  'matching films to our library…',
  'saving your ratings & lists…',
  'almost there…',
];

type Result = {
  available: boolean;
  importedCount: number;
  reviewsImported: number;
  favoritesImported: number;
  listsCreated: number;
};

/**
 * Importing-films progress — Phase 0.7 Wave 7. Runs the real Apify scrape+import
 * AFTER the account exists, keeping the request alive on this screen (a
 * backgrounded fetch would be killed on navigation). Honest status copy rather
 * than a fake counter. Graceful: no APIFY_TOKEN → proceeds silently; a failure →
 * retry / skip. Never traps the user in onboarding.
 */
export function ImportingStep({
  lbUsername,
  onDone,
  onSkip,
}: {
  lbUsername: string;
  onDone: (importedCount: number) => void;
  onSkip: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const startedRef = useRef(false);

  const run = () => {
    setFailed(false);
    apiCall<Result>('POST', '/api/v1/imports/letterboxd/scrape-import', { username: lbUsername })
      .then((r) => {
        haptic('success');
        // available:false → engine not provisioned; just move on with 0.
        onDone(r.available ? r.importedCount : 0);
      })
      .catch(() => setFailed(true));
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cycle the status copy while running
  useEffect(() => {
    if (failed) return;
    const t = setInterval(() => setStatusIdx((i) => (i + 1) % STATUS.length), 3500);
    return () => clearInterval(t);
  }, [failed]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-8 text-center text-foreground">
      <div className="relative mb-8">
        <div className="cc-pulse-ring absolute inset-0 rounded-[22px] bg-primary/20" />
        <img src={APP_ICON} alt="" className="relative h-20 w-20 rounded-[22px]" />
      </div>

      {failed ? (
        <>
          <h1
            className="font-headline text-[26px] font-bold lowercase tracking-[-0.02em]"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            couldn't finish the import
          </h1>
          <p className="mt-2.5 max-w-[18rem] font-serif text-[15px] font-light italic text-muted-foreground">
            letterboxd can be slow behind its bot wall. give it another go, or skip
            and start fresh — nothing's lost.
          </p>
          <div className="mt-8 w-full max-w-[20rem] space-y-1.5">
            <CtaButton label="try again" onClick={run} />
            <button
              onClick={() => {
                haptic('light');
                onSkip();
              }}
              className="w-full py-3 text-center font-ui text-[15px] font-semibold text-muted-foreground transition-opacity active:opacity-60"
            >
              skip for now
            </button>
          </div>
        </>
      ) : (
        <>
          <h1
            className="font-headline text-[28px] font-bold lowercase tracking-[-0.02em]"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            importing your films
          </h1>
          <p className="mt-2.5 font-serif text-[15px] font-light italic text-muted-foreground">
            pulling everything from @{lbUsername}. this can take a minute.
          </p>
          <div className="mt-7 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {STATUS[statusIdx]}
          </div>
        </>
      )}
    </div>
  );
}
