import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getVerifiedUids } from '@/lib/verified-server';

/**
 * GET /api/v1/verified — the (tiny, public) set of verified account uids.
 * Optional-auth; heavily cacheable. The client loads it once for O(1)
 * `isVerified(uid)` badge lookups across the whole app.
 */
export const dynamic = 'force-dynamic';

export const GET = publicApiRoute(
  async () => ({ uids: await getVerifiedUids(Date.now()) }),
  { softFallback: { uids: [] } },
);

export const OPTIONS = optionsHandler;
