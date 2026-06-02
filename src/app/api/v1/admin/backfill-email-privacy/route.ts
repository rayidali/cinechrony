/**
 * `POST /api/v1/admin/backfill-email-privacy` — move `email` /
 * `emailLower` from `/users/{uid}` (public) to `/users_private/{uid}`
 * (owner-only). One-shot migration tied to AUDIT 1.9; idempotent on
 * re-run.
 */

import { adminRoute } from '@/lib/admin-handler';
import { backfillEmailPrivacy } from '@/lib/admin-backfills-server';

export const dynamic = 'force-dynamic';

export const POST = adminRoute(async () => {
  const stats = await backfillEmailPrivacy();
  return { success: true, stats };
});
