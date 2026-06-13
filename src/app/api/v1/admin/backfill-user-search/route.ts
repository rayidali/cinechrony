/**
 * `POST /api/v1/admin/backfill-user-search` — populate `usernameLower` /
 * `emailLower` / `displayNameLower` on legacy user docs so AUDIT 2.8's
 * prefix-range search picks them up. Idempotent.
 */

import { adminRoute } from '@/lib/admin-handler';
import { backfillUserSearchFields } from '@/lib/admin-backfills-server';

export const dynamic = 'force-dynamic';

export const POST = adminRoute(async () => {
  const stats = await backfillUserSearchFields();
  return { success: true, stats };
});
