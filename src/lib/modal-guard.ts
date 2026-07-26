/**
 * modal-guard — fixes the "presses register in the background" bug class.
 *
 * Radix's `DismissableLayer` (what every Vaul `Drawer.Root` is built on)
 * listens for `pointerdown` at the DOCUMENT level and dismisses its own
 * drawer whenever the event target isn't inside that drawer's own content
 * node. Our confirm/expander overlays (`CancelConfirmModal`,
 * `TimeEntrySheet`, etc.) are rendered via `createPortal(..., document.body)`
 * OVER a still-open Vaul drawer — so from the drawer's point of view, a tap
 * anywhere on that portal (dim backdrop OR its buttons) is "outside", and
 * the drawer underneath silently closes while the portal is left floating.
 * Device symptom: "clicking around" the confirm eventually un-sticks it,
 * and cancel/confirm can end up orphaned over whatever page is behind the
 * sheet.
 *
 * Fix: every body-portaled overlay tags its outermost node with
 * `modalGuardProps` (`data-cc-modal-guard`); every Vaul `Drawer.Content`
 * wires `guardInteractOutside` onto `onPointerDownOutside`/`onInteractOutside`
 * (and `onFocusOutside` for completeness) so it can tell "a tap landed on
 * one of OUR OWN portaled modals" apart from "a tap landed on the real
 * outside world" and only dismiss for the latter.
 */

export const MODAL_GUARD_ATTR = 'data-cc-modal-guard';

/** Spread onto the outermost fixed node of any `createPortal(..., document.body)` overlay. */
export const modalGuardProps = { [MODAL_GUARD_ATTR]: '' } as const;

/**
 * Wire directly onto a Vaul `Drawer.Content`'s `onPointerDownOutside` /
 * `onInteractOutside` / `onFocusOutside`. Radix dispatches these as a
 * `CustomEvent` ON the original DOM event's target (see
 * `@radix-ui/react-dismissable-layer`'s `handleAndDispatchCustomEvent`), so
 * `e.target` here IS the real click/focus target — no `e.detail` digging
 * needed.
 */
export function guardInteractOutside(e: Event): void {
  if ((e.target as Element | null)?.closest?.(`[${MODAL_GUARD_ATTR}]`)) {
    e.preventDefault();
  }
}
