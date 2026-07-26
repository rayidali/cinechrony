/**
 * 55 — modal-guard invariants (static source-analysis, no DOM/emulator).
 *
 * The bug class this suite exists for: the 2026-07-26 device report — presses
 * that LANDED BEHIND the "cancel movie night?" confirm (`CancelConfirmModal`
 * in `night-detail-sheet.tsx`) dismissed the movie-night DETAIL SHEET
 * underneath it, leaving the confirm dialog orphaned over whatever page the
 * drawer's dismissal revealed. Root cause: every Vaul `Drawer.Root` is built
 * on Radix's `DismissableLayer`, which listens for `pointerdown` at the
 * DOCUMENT level and closes its own drawer whenever the event target isn't
 * inside that drawer's own content node. A confirm/expander overlay rendered
 * via `createPortal(..., document.body)` OVER a still-open drawer is
 * structurally "outside" from the drawer's point of view — so a tap ANYWHERE
 * on that overlay (its dim backdrop included) silently dismissed the sheet
 * underneath while the overlay itself kept floating. Device symptom: "click
 * around" until the confirm eventually un-sticks.
 *
 * Fixed by `src/lib/modal-guard.ts`: every body-portaled overlay tags its
 * OUTERMOST node with `modalGuardProps` (`data-cc-modal-guard`); every
 * `Drawer.Content` wires `guardInteractOutside` onto BOTH
 * `onPointerDownOutside` and `onInteractOutside` so it can tell "a tap landed
 * on one of OUR OWN portaled modals" apart from "a tap landed on the real
 * outside world" and only dismiss for the latter.
 *
 * Every assertion below RE-DERIVES its counts from source (a recursive scan
 * of `src/components/**` + `src/app/**`) rather than trusting a fixed file
 * list — a NEW drawer or a NEW body-portaled overlay added tomorrow is
 * covered automatically, with no suite update required. This suite would
 * have caught the 07-26 incident the day `CancelConfirmModal` shipped without
 * the guard.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const rel = (abs: string) => relative(ROOT, abs);

// ─── recursive .ts/.tsx walk, node_modules excluded ────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // scan root doesn't exist — nothing to add
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      out.push(full);
    }
  }
  return out;
}

// Every screen + every reusable component lives under these two trees (see
// the top-level CLAUDE.md directory map) — that's also where every current
// Drawer.Content / createPortal call lives.
const SCAN_ROOTS = ['src/components', 'src/app'];
const FILES = SCAN_ROOTS.flatMap((d) => walk(join(ROOT, d)));

type FileSrc = { path: string; src: string };
const SOURCES: FileSrc[] = FILES.map((path) => ({ path, src: readFileSync(path, 'utf8') }));

// ─── invariant 1 — every Drawer.Content wires the guard on BOTH hooks ──────

test('every <Drawer.Content> wires guardInteractOutside on onPointerDownOutside AND onInteractOutside', () => {
  // Opening tags only — `<Drawer\.Content\b` never matches the closing
  // `</Drawer.Content>` because the character right after `<` is `/`, not `D`.
  const DRAWER_OPEN = /<Drawer\.Content\b/g;
  const PDO_GUARDED = /onPointerDownOutside=\{[^}]*guardInteractOutside[^}]*\}/g;
  const IO_GUARDED = /onInteractOutside=\{[^}]*guardInteractOutside[^}]*\}/g;

  const failures: string[] = [];

  for (const { path, src } of SOURCES) {
    const drawerCount = (src.match(DRAWER_OPEN) || []).length;
    if (drawerCount === 0) continue;

    const mentionsModule = /['"]@\/lib\/modal-guard['"]/.test(src);
    const mentionsGuardFn = /\bguardInteractOutside\b/.test(src);

    if (!mentionsModule || !mentionsGuardFn) {
      failures.push(
        `${rel(path)}: renders ${drawerCount} <Drawer.Content> but never imports guardInteractOutside ` +
          `from '@/lib/modal-guard'. Any body-portaled overlay (CancelConfirmModal-style) rendered above ` +
          `this drawer will silently dismiss it on tap — the 2026-07-26 "cancel movie night?" incident. ` +
          `Fix: add "import { guardInteractOutside } from '@/lib/modal-guard';" then wire it onto ` +
          `onPointerDownOutside AND onInteractOutside on every Drawer.Content in this file.`,
      );
      continue;
    }

    const pdoCount = (src.match(PDO_GUARDED) || []).length;
    const ioCount = (src.match(IO_GUARDED) || []).length;

    if (pdoCount < drawerCount) {
      failures.push(
        `${rel(path)}: ${drawerCount} <Drawer.Content> but only ${pdoCount} wired ` +
          `onPointerDownOutside={guardInteractOutside}. Without it on EVERY Drawer.Content, a tap on a ` +
          `body-portaled overlay (its dim backdrop OR its own buttons) reads as "outside" to Radix's ` +
          `DismissableLayer and dismisses this drawer out from under the overlay. Add ` +
          `onPointerDownOutside={guardInteractOutside} to the missing Drawer.Content(s).`,
      );
    }
    if (ioCount < drawerCount) {
      failures.push(
        `${rel(path)}: ${drawerCount} <Drawer.Content> but only ${ioCount} wired ` +
          `onInteractOutside={guardInteractOutside}. onPointerDownOutside alone doesn't cover ` +
          `focus-driven outside dismissal — add onInteractOutside={guardInteractOutside} to the ` +
          `missing Drawer.Content(s) too.`,
      );
    }
  }

  assert.ok(failures.length === 0, `\n\n${failures.join('\n\n')}\n`);
});

// ─── invariant 2 — every createPortal(..., document.body) root is guarded ──

/**
 * Justified exceptions to "every createPortal caller spreads modalGuardProps
 * on its root", each with a one-line reason. A file must be a REAL
 * `createPortal(` caller (call syntax, not a passing mention) to even reach
 * this list — see the CALL_SYNTAX note below.
 *
 * `src/components/body-style-watchdog.tsx` was investigated for this suite
 * because it matches a naive grep for the bare word "createPortal", and is
 * deliberately NOT listed here: it never calls createPortal at all — the
 * word appears only inside a comment explaining why the watchdog's own
 * `[role="dialog"]` detection selector ALSO matches other components'
 * portaled dialogs (ConfirmOverlay, CancelConfirmModal, etc). The call-syntax
 * regex below (`createPortal\(`) already excludes comment-only mentions, so
 * body-style-watchdog.tsx never enters the failure loop — nothing to
 * allowlist for it.
 *
 * As of 2026-07-26 every real createPortal(..., document.body) call in this
 * codebase renders a dismissable overlay and already carries modalGuardProps
 * — this list is empty. Add an entry ONLY for a portal that is PROVABLY not
 * an overlay Vaul could mistake for "outside" (e.g. it renders no
 * interactive UI, or can never be mounted while a drawer is open) — never add
 * one just to silence a real gap.
 */
const CREATE_PORTAL_ALLOWLIST: Record<string, string> = {
  // (intentionally empty — see comment above)
};

test('every createPortal(..., document.body) overlay root spreads {...modalGuardProps}', () => {
  const PORTAL_CALL = /\bcreatePortal\(/g;
  const GUARDED_ROOT = /\{\.\.\.modalGuardProps\}/g;

  const failures: string[] = [];

  for (const { path, src } of SOURCES) {
    const portalCount = (src.match(PORTAL_CALL) || []).length;
    if (portalCount === 0) continue;

    const r = rel(path);
    if (r in CREATE_PORTAL_ALLOWLIST) continue;

    const mentionsModule = /['"]@\/lib\/modal-guard['"]/.test(src);
    const mentionsProps = /\bmodalGuardProps\b/.test(src);

    if (!mentionsModule || !mentionsProps) {
      failures.push(
        `${r}: calls createPortal ${portalCount}x but never imports modalGuardProps from ` +
          `'@/lib/modal-guard'. Any Vaul drawer open underneath this portal can be silently dismissed ` +
          `by a tap on it — same class as the 2026-07-26 "cancel movie night?" incident. Fix: add ` +
          `"import { modalGuardProps } from '@/lib/modal-guard';" then spread {...modalGuardProps} ` +
          `onto the outermost fixed node passed to createPortal.`,
      );
      continue;
    }

    const guardedCount = (src.match(GUARDED_ROOT) || []).length;
    if (guardedCount < portalCount) {
      failures.push(
        `${r}: ${portalCount} createPortal call(s) but only ${guardedCount} root(s) spread ` +
          `{...modalGuardProps}. Spread {...modalGuardProps} onto the outermost fixed node of EVERY ` +
          `body-portaled overlay in this file — an unguarded root is invisible to any Drawer.Content's ` +
          `onPointerDownOutside/onInteractOutside check, so a tap on it (even on its own buttons) falls ` +
          `through as "outside" and dismisses the drawer underneath instead of registering. If this ` +
          `portal is genuinely not an overlay Vaul could mistake for "outside", add it to ` +
          `CREATE_PORTAL_ALLOWLIST in this test file with a one-line reason — do not add ` +
          `modalGuardProps as a no-op just to pass this check.`,
      );
    }
  }

  assert.ok(failures.length === 0, `\n\n${failures.join('\n\n')}\n`);
});

// ─── invariant 3 — modal-guard.ts keeps its own contract ───────────────────

const MODAL_GUARD_PATH = join(ROOT, 'src/lib/modal-guard.ts');
const MODAL_GUARD_SRC = readFileSync(MODAL_GUARD_PATH, 'utf8');

test('modal-guard.ts exports MODAL_GUARD_ATTR + modalGuardProps (derived from it) + guardInteractOutside', () => {
  assert.match(
    MODAL_GUARD_SRC,
    /export const MODAL_GUARD_ATTR\s*=\s*['"][^'"]+['"]/,
    'MODAL_GUARD_ATTR must stay a plain exported string constant — every guarded overlay root and ' +
      'every Drawer.Content check in 55-modal-guard.test.ts is keyed off this one attribute name.',
  );
  assert.match(
    MODAL_GUARD_SRC,
    /export const modalGuardProps\s*=/,
    'modalGuardProps must stay exported — it is the props object every createPortal(..., document.body) ' +
      'overlay root spreads onto itself.',
  );
  assert.match(
    MODAL_GUARD_SRC,
    /modalGuardProps\s*=\s*\{\s*\[MODAL_GUARD_ATTR\]/,
    'modalGuardProps must be DERIVED from MODAL_GUARD_ATTR via a computed property ' +
      '(`{ [MODAL_GUARD_ATTR]: ... }`), not a second hardcoded copy of the attribute string — two ' +
      'independent copies of "data-cc-modal-guard" WILL drift apart the next time one of them is edited.',
  );
  assert.match(
    MODAL_GUARD_SRC,
    /export function guardInteractOutside\s*\(/,
    'guardInteractOutside must stay an exported function — it is wired directly onto every ' +
      'Drawer.Content\'s onPointerDownOutside/onInteractOutside props.',
  );
});

test('guardInteractOutside calls preventDefault() and matches on the MODAL_GUARD_ATTR constant', () => {
  // guardInteractOutside is the last export in the file, so slicing to EOF
  // from its declaration is a safe way to isolate "its body" without a real parser.
  const fnStart = MODAL_GUARD_SRC.indexOf('export function guardInteractOutside');
  assert.ok(fnStart !== -1, 'guardInteractOutside function declaration not found in modal-guard.ts');
  const fnBody = MODAL_GUARD_SRC.slice(fnStart);

  assert.match(
    fnBody,
    /\.preventDefault\(\)/,
    'guardInteractOutside must call e.preventDefault() when the real target is one of our own guarded ' +
      'portals — that IS the fix: it tells Radix\'s DismissableLayer "this outside tap was actually one ' +
      'of OUR OWN portaled modals, do not dismiss the drawer." Without the preventDefault() call, wiring ' +
      'this function onto onPointerDownOutside/onInteractOutside is a no-op and the 07-26 bug is back.',
  );
  assert.match(
    fnBody,
    /MODAL_GUARD_ATTR/,
    'guardInteractOutside must match against the MODAL_GUARD_ATTR constant (e.g. via ' +
      '.closest(`[${MODAL_GUARD_ATTR}]`)), not a hardcoded duplicate of the attribute string — a ' +
      'hardcoded copy can silently stop matching the moment MODAL_GUARD_ATTR (or modalGuardProps) changes.',
  );
});
