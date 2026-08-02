'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isOverlayMounted } from '@/lib/overlay-markers';

/**
 * Body-style watchdog.
 *
 * Vaul (and any iOS-style drawer that scroll-locks the underlying page) sets
 * `body.style.position: fixed; top: -<scrollY>px` while a drawer is open and
 * restores it on close. That restore runs in a `useEffect` cleanup, which is
 * vulnerable to two iOS-PWA round-trip races:
 *
 *   1. Drawer A opens on `/home`, user navigates to `/movie/.../comments`
 *      before the close-state effect runs; the drawer unmounts mid-route
 *      transition. On the way back, body styles can be left applied.
 *   2. Vaul's standalone-PWA detection (`matchMedia('(display-mode: standalone)')`)
 *      is correct in iOS PWA, but the cleanup path still depends on Safari
 *      detection and `previousBodyPosition` matching. A torn-down/restored
 *      pair can leak when the route changes during the animation window.
 *
 * Symptom: bottom nav + FAB visible (they're `position: fixed` and children
 * of `<body>` via the layout — but `position: fixed` is computed against the
 * viewport, and Vaul writes `top: -Ypx` onto `<body>` which doesn't affect
 * fixed children since they ignore body offset transforms), while the rest of
 * the page appears to "scroll up out of view".
 *
 * This watchdog resets the body styles on every route change AS LONG AS no
 * drawer is currently mounted. It's safe — if a Vaul drawer is open at the
 * moment of route change, we leave its styles alone; otherwise we reset.
 *
 * 2026-07-25 — extended for the movie-night interaction-surface bug class:
 * TWO STACKED Vaul `Drawer.Root`s (the movie-night create sheet opening a
 * nested expander, or one sheet closing at the exact instant another opens —
 * see `movie-night/create-night-sheet.tsx` "F3" / `morning-after-sheet.tsx")
 * can leave `body.style.pointerEvents: 'none'` stuck (Radix's
 * `@radix-ui/react-dismissable-layer`, which Vaul's overlay stacking relies
 * on, captures/restores an "original" pointer-events value per layer — two
 * layers unmounting/mounting in overlapping ticks can restore the WRONG
 * layer's captured value). That doesn't wait for a route change to surface,
 * so this now ALSO runs on a 1500ms interval and on every `touchend` — a
 * route change is just the third trigger, not the only one.
 */
function scrubBodyIfStuck(): void {
  if (typeof document === 'undefined') return;

  // Conservative gate: never touch the body while ANYTHING that looks like
  // an open drawer/dialog is in the DOM — `[data-vaul-drawer]` catches every
  // Vaul sheet (open OR mid-close-animation, via Radix's `Presence`;
  // deliberately inclusive — a closing drawer is still "there"),
  // `[data-vaul-overlay]` catches its scrim, and `[role="dialog"]` /
  // `[role="alertdialog"]` catch the movie-night family's own `createPortal`
  // dialogs (ConfirmOverlay, CancelConfirmModal, TimeEntrySheet,
  // WatchedMomentSheet all carry `role="dialog"`) plus any Radix
  // Dialog/AlertDialog elsewhere in the app (e.g. the settings delete-account
  // modal).
  // Shared with `back-swipe-guard.tsx` (see `overlay-markers.ts`): that guard
  // is the PREVENTION for the same failure this function is the CURE for, and
  // if the two ever disagreed about what counts as "open", the gesture would
  // fire on a sheet this then declines to clean up after.
  if (isOverlayMounted()) return;

  const body = document.body;

  const stuckPointerEvents = body.style.pointerEvents === 'none';
  // Vaul's OWN scroll-lock signature in THIS codebase is `position: fixed` +
  // `top`/`left` offsets (verified — no other component sets `body.style.
  // position`). `overflow: hidden` is deliberately NOT part of this check:
  // several legitimate fullscreen surfaces (`post-composer.tsx`,
  // `fullscreen-text-input.tsx`, and others) set `body.style.overflow =
  // 'hidden'` while genuinely open WITHOUT a marker this watchdog can see —
  // scrubbing on overflow alone would rip their scroll lock out mid-use.
  const stuckScrollLock =
    body.style.position === 'fixed' ||
    body.style.top !== '' ||
    body.style.left !== '' ||
    body.style.height === 'auto';

  if (!stuckPointerEvents && !stuckScrollLock) return;

  if (stuckPointerEvents) body.style.removeProperty('pointer-events');

  if (stuckScrollLock) {
    // Recover the scroll position Vaul encoded as `top: -<Ypx>` so the page
    // lands where the user was when the drawer opened (or 0 if it's missing).
    const stuckTop = body.style.top;
    const recoveredY = stuckTop ? -parseInt(stuckTop, 10) || 0 : 0;

    body.style.removeProperty('position');
    body.style.removeProperty('top');
    body.style.removeProperty('left');
    body.style.removeProperty('right');
    body.style.removeProperty('height');

    if (recoveredY > 0) {
      // Don't fight an in-progress route transition's own scroll restore;
      // a single jump-to is enough.
      window.scrollTo(0, recoveredY);
    }
  }

  console.warn('[body-style-watchdog] scrubbed stuck body styles', { stuckPointerEvents, stuckScrollLock });
}

export function BodyStyleWatchdog() {
  const pathname = usePathname();

  // Trigger 1 — route change. Deferred one frame so we run AFTER React has
  // committed the new route and any drawer that's "supposed" to be open on
  // this route has mounted its marker element.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const id = requestAnimationFrame(scrubBodyIfStuck);
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  // Trigger 2 — a standing 1500ms poll, and trigger 3 — every touch ending
  // (the moment a stuck `pointer-events: none` would otherwise show up as
  // "nothing happens" to the user). Mounted once for the app's lifetime,
  // independent of route changes.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const interval = setInterval(scrubBodyIfStuck, 1500);
    const onTouchEnd = () => scrubBodyIfStuck();
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      clearInterval(interval);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return null;
}
