'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { haptic } from '@/lib/haptics';

/**
 * NativeTransitions — Phase 0.7 native-motion slice 2.
 *
 * Wraps the active route in the root layout and gives the app iOS-native
 * navigation feel, app-wide:
 *   • push (into a detail screen) → the new screen slides in from the right
 *   • pop  (back to a parent)     → the revealed screen slides in from the left
 *     with a subtle parallax dim
 *   • lateral (tab ↔ tab)         → instant (iOS tab bars don't slide)
 *   • interactive edge-swipe-back → drag from the left edge to pop, anywhere
 *
 * Robustness notes (why it's written this way):
 *   - It manipulates the wrapper's transform via DIRECT DOM writes (never React
 *     state), so dragging a finger never re-renders the page tree.
 *   - The transform is CLEARED to none whenever idle. A lingering transform turns
 *     descendant `position: fixed` (the bottom nav, FABs) into
 *     transform-contained — the class of bug the BodyStyleWatchdog exists for —
 *     so we only ever hold a transform during the brief (<350ms) animation or an
 *     active drag.
 *   - Direction is inferred from a pathname stack + a popstate flag.
 *   - Gated to native / coarse-pointer and disabled under prefers-reduced-motion.
 *   - Swipe-back is suppressed on tab roots (nothing to pop), on routes that own
 *     their own gesture (/movie/…/comments), and whenever a covering fixed
 *     overlay (composer, reel, search, modal) sits over the page — detected by
 *     walking up from the touch target, so no overlay needs to opt in.
 */

const DUR = 340; // enter-animation duration (ms)
const DISMISS_MS = 200; // slide-off on a committed swipe (ms)
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'; // iOS-like decelerate
const EDGE_ZONE = 24; // px from the left edge that arms the swipe
const LOCK_THRESHOLD = 12; // px to commit to horizontal vs vertical
const DISMISS_RATIO = 0.4; // fraction of viewport width to commit
const VELOCITY_THRESHOLD = 0.5; // px/ms — a fast flick commits

const TAB_ROOTS = ['/home', '/lists', '/profile'];
// Routes that manage their own back gesture / full-screen chrome.
const OWN_GESTURE_PREFIXES = ['/movie/'];

type Direction = 'push' | 'pop' | 'lateral' | 'none';

const isTabRoot = (p: string) => TAB_ROOTS.includes(p);

export function NativeTransitions({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  // Per-instance mutable nav state (no re-renders).
  const stackRef = useRef<string[]>([]);
  const popFlagRef = useRef(false);
  const enabledRef = useRef(false);
  const cleanupAnimRef = useRef<(() => void) | null>(null);

  // Resolve capabilities once on the client.
  useEffect(() => {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    const native = cap?.isNativePlatform?.() === true;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    enabledRef.current = !reduced && (native || coarse);
  }, []);

  // OS / browser back sets a one-shot pop flag the direction classifier reads.
  useEffect(() => {
    const onPop = () => {
      popFlagRef.current = true;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Classify + play the enter animation on every committed route change.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const dir = classify(pathname, stackRef.current, popFlagRef.current);
    popFlagRef.current = false;
    applyStack(pathname, dir, stackRef.current);

    // Always start from a clean slate (kills any in-flight anim / drag transform).
    cleanupAnimRef.current?.();
    el.style.transition = 'none';
    el.style.transform = '';
    el.style.filter = '';
    el.style.willChange = '';

    if (!enabledRef.current || dir === 'none' || dir === 'lateral') return;

    const startX = dir === 'push' ? '100%' : '-22%';
    el.style.transform = `translate3d(${startX}, 0, 0)`;
    if (dir === 'pop') el.style.filter = 'brightness(0.92)';
    el.style.willChange = 'transform';
    // Force a reflow so the start state paints before we animate to rest.
    void el.offsetWidth;

    el.style.transition = `transform ${DUR}ms ${EASE}, filter ${DUR}ms ease-out`;
    el.style.transform = 'translate3d(0, 0, 0)';
    el.style.filter = '';

    const done = () => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.filter = '';
      el.style.willChange = '';
      el.removeEventListener('transitionend', done);
      cleanupAnimRef.current = null;
    };
    el.addEventListener('transitionend', done);
    // Safety net if transitionend never fires (interrupted paint).
    const t = window.setTimeout(done, DUR + 80);
    cleanupAnimRef.current = () => {
      window.clearTimeout(t);
      el.removeEventListener('transitionend', done);
    };
  }, [pathname]);

  // Interactive edge-swipe-back. Direct-DOM only; never sets React state.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let lock: 'h' | 'v' | null = null;
    let active = false;
    let liveDx = 0;
    let committing = false;

    const swipeAllowed = (target: EventTarget | null): boolean => {
      if (!enabledRef.current || committing) return false;
      const path = pathname;
      if (isTabRoot(path)) return false; // nothing to pop on a root tab
      if (OWN_GESTURE_PREFIXES.some((p) => path.startsWith(p))) return false;
      if (typeof window !== 'undefined' && window.history.length <= 1) return false;
      // Suppress when a covering fixed overlay sits over the page.
      if (coveredByFixedOverlay(target as Node | null, el)) return false;
      return true;
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || t.clientX > EDGE_ZONE) return;
      if (!swipeAllowed(e.target)) return;
      startX = t.clientX;
      startY = t.clientY;
      startT = e.timeStamp || performance.now();
      lock = null;
      active = true;
      liveDx = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!lock && (Math.abs(dx) > LOCK_THRESHOLD || Math.abs(dy) > LOCK_THRESHOLD)) {
        lock = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
      if (lock !== 'h') return;
      const clamped = Math.max(0, dx);
      liveDx = clamped;
      if (e.cancelable) e.preventDefault(); // stop the WebView from also scrolling
      el.style.transition = 'none';
      el.style.transform = `translate3d(${clamped}px, 0, 0)`;
      el.style.boxShadow = '-12px 0 32px rgba(0,0,0,0.22)';
      el.style.willChange = 'transform';
    };

    const finish = () => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.boxShadow = '';
      el.style.willChange = '';
    };

    const onEnd = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      if (lock !== 'h') return;

      const width = window.innerWidth || 375;
      const elapsed = Math.max((e.timeStamp || performance.now()) - startT, 1);
      const velocity = liveDx / elapsed;
      const commit = liveDx > width * DISMISS_RATIO || velocity > VELOCITY_THRESHOLD;

      if (commit) {
        committing = true;
        haptic('light');
        el.style.transition = `transform ${DISMISS_MS}ms ${EASE}, box-shadow ${DISMISS_MS}ms ease-out`;
        el.style.transform = `translate3d(${width}px, 0, 0)`;
        el.style.boxShadow = '';
        window.setTimeout(() => {
          committing = false;
          // The pop enter-animation (from the left) takes over once the route
          // changes; finish() clears the off-screen transform first so there's
          // no flash of the old, slid-off content.
          finish();
          router.back();
        }, DISMISS_MS);
      } else {
        // Spring back to rest, then clear the transform entirely.
        el.style.transition = `transform ${DISMISS_MS}ms ${EASE}, box-shadow ${DISMISS_MS}ms ease-out`;
        el.style.transform = 'translate3d(0, 0, 0)';
        el.style.boxShadow = '';
        window.setTimeout(finish, DISMISS_MS);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
    // Re-bind when the path changes so swipeAllowed() reads the current route.
  }, [pathname, router]);

  return <div ref={ref}>{children}</div>;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function classify(next: string, stack: string[], popFlag: boolean): Direction {
  if (stack.length === 0) return 'none'; // first paint / deep link
  const current = stack[stack.length - 1];
  if (next === current) return 'none';
  // Tab ↔ tab is lateral (no slide).
  if (isTabRoot(next) && isTabRoot(current)) return 'lateral';
  // Going back to the entry just beneath us → pop.
  if (popFlag || stack[stack.length - 2] === next) return 'pop';
  return 'push';
}

function applyStack(next: string, dir: Direction, stack: string[]) {
  if (stack.length === 0) {
    stack.push(next);
    return;
  }
  if (dir === 'none') return;
  if (dir === 'pop') {
    stack.pop();
    if (stack[stack.length - 1] !== next) stack[stack.length - 1] = next;
  } else if (dir === 'lateral') {
    stack[stack.length - 1] = next;
  } else {
    stack.push(next);
  }
  if (stack.length > 50) stack.splice(0, stack.length - 50);
}

/** True if a covering, position:fixed ancestor sits between the touch target and
 *  the transition wrapper (i.e. a full-screen overlay is open over the page). */
function coveredByFixedOverlay(target: Node | null, wrapper: HTMLElement): boolean {
  let el = target instanceof Element ? target : null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  while (el && el !== wrapper && el !== document.body) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') {
      const r = el.getBoundingClientRect();
      if (r.width >= vw * 0.9 && r.height >= vh * 0.7) return true;
    }
    el = el.parentElement;
  }
  return false;
}
