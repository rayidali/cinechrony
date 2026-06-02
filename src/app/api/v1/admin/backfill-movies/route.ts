/**
 * `POST /api/v1/admin/backfill-movies` — populate denormalized addedBy*
 * + `noteAuthors` on every existing movie doc. Eliminates the N+1 fetch
 * pattern on list views. Idempotent.
 */

import { adminRoute } from '@/lib/admin-handler';
import { backfillMovieUserData } from '@/lib/admin-backfills-server';

export const dynamic = 'force-dynamic';

export const POST = adminRoute(async () => {
  const stats = await backfillMovieUserData();
  return { success: true, stats };
});
