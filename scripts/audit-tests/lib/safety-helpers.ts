/**
 * Cross-test helpers for the safety endpoints (Phase A PR #15).
 *
 * Several existing audit tests use `blockUser` as a setup primitive to
 * exercise block-filtering elsewhere (post visibility, comment hiding,
 * notification drop, etc.). Rather than copy the route invocation into
 * each one, these helpers wrap the new /api/v1 routes with a signature
 * matching the legacy `callActionAs(viewer, blockUser, target)` shape.
 */

import { callRoute } from './route-call.ts';
import type { TestUser } from '../harness.ts';
import {
  POST as blockPost,
  DELETE as unblockDelete,
} from '@/app/api/v1/users/[uid]/block/route';
import {
  POST as mutePost,
  DELETE as unmuteDelete,
} from '@/app/api/v1/users/[uid]/mute/route';

export async function blockUserAs(viewer: TestUser, blockedUid: string) {
  return callRoute(blockPost, 'POST', {
    token: await viewer.getIdToken(),
    params: { uid: blockedUid },
  });
}

export async function unblockUserAs(viewer: TestUser, blockedUid: string) {
  return callRoute(unblockDelete, 'DELETE', {
    token: await viewer.getIdToken(),
    params: { uid: blockedUid },
  });
}

export async function muteUserAs(viewer: TestUser, mutedUid: string) {
  return callRoute(mutePost, 'POST', {
    token: await viewer.getIdToken(),
    params: { uid: mutedUid },
  });
}

export async function unmuteUserAs(viewer: TestUser, mutedUid: string) {
  return callRoute(unmuteDelete, 'DELETE', {
    token: await viewer.getIdToken(),
    params: { uid: mutedUid },
  });
}
