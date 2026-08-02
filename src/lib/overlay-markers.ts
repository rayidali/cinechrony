/**
 * The one selector that answers "is a drawer / dialog currently mounted?".
 *
 * Two separate safety mechanisms depend on this exact question and MUST agree,
 * because they are the prevention and the cure for the same failure:
 *
 *   - `back-swipe-guard.tsx` suspends WebKit's back-forward gesture while an
 *     overlay is up, so a native swipe can't pop the route out from under an
 *     open sheet and strand Vaul's `body { position: fixed }` scroll lock.
 *   - `body-style-watchdog.tsx` refuses to scrub that scroll lock while an
 *     overlay is up, because a genuinely-open drawer is supposed to hold it.
 *
 * If those two ever disagreed about what counts as "open", the guard would let
 * the gesture fire on a sheet the watchdog then declines to clean up after —
 * which is precisely the blank-page bug. Hence one constant, imported by both.
 *
 * `[data-vaul-drawer]` catches every Vaul sheet (open OR mid-close, via Radix
 * `Presence` — deliberately inclusive), `[data-vaul-overlay]` its scrim, and
 * the `role` selectors catch the movie-night family's `createPortal` dialogs
 * plus any Radix Dialog/AlertDialog elsewhere.
 */
export const OVERLAY_MARKER_SELECTOR =
  '[data-vaul-drawer], [data-vaul-overlay], [role="dialog"], [role="alertdialog"]';

/** True if any drawer/dialog is currently mounted. */
export function isOverlayMounted(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector(OVERLAY_MARKER_SELECTOR) !== null;
}
