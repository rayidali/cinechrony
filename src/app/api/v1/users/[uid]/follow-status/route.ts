/**
 * `GET /api/v1/users/[uid]/follow-status` — returns BOTH directions in
 * one round trip: `{ isFollowing, isFollowedBy }`. Auth-required (the
 * answer is caller-relative; the legacy two-arg `isFollowing(a, b)`
 * Server Action surface is gone, so a malicious client can no longer
 * probe arbitrary follower→following pairs).
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getFollowRelationship } from '@/lib/follows-server';

export const dynamic = 'force-dynamic';

type RouteParams = { uid: string };

export const GET = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  return getFollowRelationship(auth.uid, params.uid);
});

export const OPTIONS = optionsHandler;
