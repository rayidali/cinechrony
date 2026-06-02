/**
 * `POST /api/v1/admin/backfill-reviews` — add `parentId: null` +
 * `replyCount` to legacy review docs so the threading queries work.
 * Idempotent.
 */

import { adminRoute } from '@/lib/admin-handler';
import { backfillReviewsThreading } from '@/lib/admin-backfills-server';

export const dynamic = 'force-dynamic';

export const POST = adminRoute(async () => {
  const stats = await backfillReviewsThreading();
  return { success: true, stats };
});
