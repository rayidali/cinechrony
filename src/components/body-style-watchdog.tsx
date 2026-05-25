'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

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
 * Mounted once in the root layout.
 */
export function BodyStyleWatchdog() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Defer one frame so we run AFTER React has committed the new route and
    // any drawer that's "supposed" to be open on this route has mounted its
    // marker element. If a drawer is genuinely mounted, leave the body alone.
    const id = requestAnimationFrame(() => {
      const drawerOpen = !!document.querySelector('[data-vaul-drawer]');
      if (drawerOpen) return;

      const body = document.body;
      // Only reset if we actually find stuck styles — don't churn on every
      // navigation when nothing is wrong.
      const isStuck =
        body.style.position === 'fixed' ||
        body.style.top !== '' ||
        body.style.left !== '' ||
        body.style.height === 'auto';
      if (!isStuck) return;

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
    });

    return () => cancelAnimationFrame(id);
  }, [pathname]);

  return null;
}
