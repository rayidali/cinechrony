import { apiCall } from '@/lib/api-client';

/**
 * The batched boot payload. Collapses the bookmarks + mutes + blocks provider
 * fetches (each a separate cold serverless call on launch) into ONE round trip.
 * The three providers all call `prefetchCachedAction('me-boot:{uid}', fetchBoot)`,
 * which coalesces concurrent calls onto a single request.
 */
export type BootData = {
  bookmarks: { keys: string[] };
  mutes: { mutedIds: string[] };
  blocks: { blockedIds: string[]; iBlocked: string[] };
};

export const bootCacheKey = (uid: string) => `me-boot:${uid}`;

export const fetchBoot = (): Promise<BootData> =>
  apiCall<BootData>('GET', '/api/v1/me/boot');
