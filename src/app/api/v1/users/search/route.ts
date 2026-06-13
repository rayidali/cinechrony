/**
 * `GET /api/v1/users/search?q=...` — prefix search across users.
 *
 * Public (no token required) but auth-aware: when the viewer presents a
 * Bearer token, the viewer is excluded from results and viewer-relative
 * blocks are filtered out. Without a token, returns the unfiltered match
 * set (no self-exclusion possible). Closes AUDIT.md 2.8 end-to-end (the
 * prefix-range query optimization was applied earlier; this surfaces it
 * through a typed route with token-derived identity).
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { searchUsersForViewer } from '@/lib/search-server';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute(async (req, { auth }) => {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  return searchUsersForViewer(q, auth?.uid ?? null);
});

export const OPTIONS = optionsHandler;
