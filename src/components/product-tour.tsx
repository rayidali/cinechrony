'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@/firebase';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';

/**
 * First-run product tour — a spotlight "step N/6" walkthrough of the app, shown
 * once per user on their first landing on /home. Works identically on the web
 * PWA and inside the Capacitor WKWebView (pure DOM + fixed positioning — no
 * fragile native-only APIs).
 *
 * How it anchors: each step optionally targets an element by a `data-tour="…"`
 * attribute. We measure that element's rect and cut a "spotlight" hole in a
 * dimmed backdrop over it, then float an explainer card beside it. A step whose
 * anchor isn't on the page degrades to a centered card, so a missing element can
 * never break the tour. The anchored targets (the 3 tab-bar items, the scan
 * button, the compose FAB) are persistent/fixed on /home, so they're reliable.
 *
 * Replayable: any surface can dispatch `window.dispatchEvent(new Event(
 * 'cc-start-tour'))` (e.g. a "replay tour" row in settings) to run it again.
 */

type TourStep = {
  id: string;
  /** data-tour value of the element to spotlight; omit for a centered step. */
  anchor?: string;
  title: string;
  body: string;
};

const STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'welcome to cinechrony',
    body: 'your friends’ movie taste, in one place — what they’re watching, rating, and loving. a quick tour so you know your way around.',
  },
  {
    id: 'scan',
    anchor: 'scan',
    title: 'turn any clip into a list',
    body: 'saw a “top 10 thrillers” tiktok or reel? tap scan, paste the link, and we pull every film out of it — ready to save.',
  },
  {
    id: 'feed',
    anchor: 'tab-home',
    title: 'the reel',
    body: 'your home feed is a living diary of what your circle is watching right now. pull down any time to refresh.',
  },
  {
    id: 'lists',
    anchor: 'tab-lists',
    title: 'your watchlists',
    body: 'build lists solo or with friends — everyone can add, rate, and leave notes on the same list.',
  },
  {
    id: 'profile',
    anchor: 'tab-profile',
    title: 'your taste, tracked',
    body: 'your history, ratings, and top five live here. import your whole letterboxd library in settings.',
  },
  {
    id: 'compose',
    anchor: 'compose',
    title: 'share a take',
    body: 'tap here to post a thought on a film. that’s it — go explore.',
  },
];

const seenKey = (uid: string) => `cc-tour-seen:${uid}`;
const GAP = 12; // px between the spotlight and the card
const PAD = 8; // spotlight padding around the target

type Rect = { top: number; left: number; width: number; height: number };

export function ProductTour() {
  const pathname = usePathname();
  const { user, isUserLoading } = useUser();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const current = STEPS[step];

  const finish = useCallback(
    (uid?: string) => {
      setActive(false);
      setStep(0);
      const id = uid ?? user?.uid;
      if (id) {
        try { localStorage.setItem(seenKey(id), '1'); } catch { /* private mode */ }
      }
    },
    [user?.uid],
  );

  // First-run trigger: on /home, once auth resolves, if this user hasn't seen it.
  // Re-checks `seen` on every /home entry (no session ref), so clearing the flag
  // and returning to /home — the "replay tour" path — starts it again.
  useEffect(() => {
    if (active) return;
    if (isUserLoading || !user?.uid) return;
    if (pathname !== '/home') return;
    let seen = false;
    try { seen = localStorage.getItem(seenKey(user.uid)) === '1'; } catch { seen = false; }
    if (seen) return;
    // Let the home content paint first so the anchors exist + it doesn't fight
    // the entrance animation.
    const t = window.setTimeout(() => setActive(true), 650);
    return () => window.clearTimeout(t);
  }, [pathname, user?.uid, isUserLoading, active]);

  // Manual replay (e.g. from settings).
  useEffect(() => {
    const replay = () => { setStep(0); setActive(true); };
    window.addEventListener('cc-start-tour', replay);
    return () => window.removeEventListener('cc-start-tour', replay);
  }, []);

  // Measure the current step's anchor (and keep it fresh on resize/scroll).
  useEffect(() => {
    if (!active) return;
    if (!current?.anchor) { setRect(null); return; }
    const measure = () => {
      const el = document.querySelector(`[data-tour="${current.anchor}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, current?.anchor, step]);

  if (!active || !current) return null;

  const isLast = step === STEPS.length - 1;
  const next = () => {
    haptic('selection');
    if (isLast) finish();
    else setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => { haptic('light'); setStep((s) => Math.max(s - 1, 0)); };

  // Spotlight box (padded around the target).
  const spot = rect
    ? {
        top: Math.max(rect.top - PAD, 4),
        left: Math.max(rect.left - PAD, 4),
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  // Card placement: below the spotlight if it's in the top half, else above;
  // centered when there's no anchor.
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let cardStyle: React.CSSProperties;
  if (spot) {
    const below = spot.top + spot.height < vh * 0.5;
    cardStyle = below
      ? { top: spot.top + spot.height + GAP, left: '50%', transform: 'translateX(-50%)' }
      : { bottom: vh - spot.top + GAP, left: '50%', transform: 'translateX(-50%)' };
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="app tour">
      {/* Backdrop. With a spotlight we dim via the box-shadow trick so the target
          stays bright; otherwise a plain scrim. Tapping the backdrop advances. */}
      {spot ? (
        <div
          onClick={next}
          className="absolute rounded-[14px] ring-2 ring-primary transition-all duration-300"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.72)',
          }}
        />
      ) : (
        <div onClick={next} className="absolute inset-0 bg-black/72" />
      )}

      {/* Explainer card */}
      <div
        className="absolute w-[min(360px,90vw)] rounded-[20px] border border-white/10 bg-card p-5 shadow-[0_12px_40px_rgba(0,0,0,0.4)]"
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
            step {step + 1} / {STEPS.length}
          </span>
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === step ? 'w-4 bg-primary' : 'w-1.5 bg-foreground/20',
                )}
              />
            ))}
          </div>
        </div>

        <h2 className="mt-3 font-headline text-[22px] font-bold lowercase leading-tight tracking-[-0.02em] text-foreground">
          {current.title}
        </h2>
        <p className="mt-2 font-body text-[15px] leading-relaxed text-muted-foreground">
          {current.body}
        </p>

        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={() => { haptic('light'); finish(); }}
            className="font-ui text-[13px] font-medium text-muted-foreground transition-colors active:text-foreground"
          >
            skip
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={back}
                className="h-10 rounded-full px-4 font-headline text-[14px] font-semibold lowercase text-foreground transition-transform active:scale-95"
              >
                back
              </button>
            )}
            <button
              onClick={next}
              className="h-10 rounded-full bg-primary px-5 font-headline text-[14px] font-semibold lowercase text-primary-foreground shadow-fab transition-transform active:scale-95"
            >
              {isLast ? 'start exploring' : 'next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
