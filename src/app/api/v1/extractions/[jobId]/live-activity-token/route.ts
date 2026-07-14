/**
 * `POST /api/v1/extractions/[jobId]/live-activity-token` — the app observed
 * the scan tracker activity (started by the server's push-to-start) mint its
 * UPDATE token and reports it for this job. The server stores it and
 * immediately flushes the job's freshest state at the card — including
 * resolving it on the spot if the scan already finished (read-repair; see
 * `attachExtractionLiveActivityToken`).
 *
 *   body: { activityId?, token } → { attached: true }
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { attachExtractionLiveActivityToken } from '@/lib/extraction-server';

export const dynamic = 'force-dynamic';

type RouteParams = { jobId: string };

export const POST = apiRoute<RouteParams>(async (req, { auth, params }) => {
  let body: { activityId?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  return attachExtractionLiveActivityToken(auth.uid, params.jobId, body.activityId, body.token);
});

export const OPTIONS = optionsHandler;
