#!/usr/bin/env bash
# Phase A PR #17 — static export build.
#
# Next.js 15's `output: 'export'` does not co-exist with route handlers —
# Next tries to pre-render them at build time and fails on anything using
# request headers / dynamic data (everything in `/api/v1/*` does). The
# workaround is to move the `src/app/api/` tree out of the build context,
# run the export, then move it back. The Vercel deploy continues to ship
# the route handlers normally (default build, no BUILD_TARGET set).
#
# This script is idempotent: if `src/app/.api-static-build-aside/` already
# exists from a prior failed run, we restore first.

set -euo pipefail

cd "$(dirname "$0")/.."

API_DIR="src/app/api"
ASIDE_DIR="src/.api-static-build-aside"

restore() {
  if [ -d "$ASIDE_DIR" ]; then
    echo "[static-build] restoring src/app/api from $ASIDE_DIR"
    mv "$ASIDE_DIR" "$API_DIR"
  fi
}

# Always restore on exit (success OR failure) so a failed build doesn't
# leave the repo with a missing src/app/api/ tree.
trap restore EXIT

# Safety: if a prior run left an orphan aside dir without restoring, the
# current src/app/api would be a fresh-with-current-changes copy and the
# aside dir would be stale. Bail loudly so the user can investigate.
if [ -d "$ASIDE_DIR" ] && [ -d "$API_DIR" ]; then
  echo "[static-build] ERROR: both $API_DIR and $ASIDE_DIR exist." >&2
  echo "[static-build] A prior build crashed without restoring. Inspect them" >&2
  echo "[static-build] and remove whichever is stale before re-running." >&2
  exit 1
fi

echo "[static-build] moving $API_DIR → $ASIDE_DIR"
mv "$API_DIR" "$ASIDE_DIR"

# A stale .next/ from a prior Vercel build trips Next.js's worker on the
# static export (it tries to require chunks compiled for a different target).
echo "[static-build] clearing .next/ to avoid cross-target chunk reuse"
rm -rf .next

echo "[static-build] running next build with BUILD_TARGET=static"
BUILD_TARGET=static next build

echo "[static-build] static export complete. Output: ./out/"
# `restore` runs via the EXIT trap.
