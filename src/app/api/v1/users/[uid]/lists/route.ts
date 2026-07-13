/**
 * `GET /api/v1/users/[uid]/lists` — `[uid]`'s owned lists.
 * Public route, privacy-filtered: anonymous callers and other users get
 * PUBLIC lists only; the owner (valid Bearer, `auth.uid === uid`) gets all
 * of them, private included. (Private list names/covers/counts are user
 * content — the pre-2026-07 version returned them to anyone, bypassing the
 * `isPublic` gate `firestore.rules` enforces on direct client reads.)
 * Privacy of individual movies stays gated by the per-list endpoints.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getUserLists } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

type RouteParams = { uid: string };

export const GET = publicApiRoute<RouteParams>(async (_req, { params, auth }) => {
  const { lists } = await getUserLists(params.uid);
  if (auth?.uid === params.uid) return { lists };
  return { lists: lists.filter((l) => l.isPublic) };
});

export const OPTIONS = optionsHandler;
