/**
 * `GET /api/v1/extractions/[jobId]` — poll an extraction job.
 *
 * Auth required; 403 unless the job belongs to the caller, 404 if it doesn't
 * exist. Returns the job view (`status`, `stage`, `films?`, `suggestedListName?`,
 * `errorCode?`) so the client can drive the narrated progress UI and then the
 * confirmation screen. Phase C.1a.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getExtraction } from '@/lib/extraction-server';

export const dynamic = 'force-dynamic';

type RouteParams = { jobId: string };

export const GET = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  return getExtraction(auth.uid, params.jobId);
});

export const OPTIONS = optionsHandler;
