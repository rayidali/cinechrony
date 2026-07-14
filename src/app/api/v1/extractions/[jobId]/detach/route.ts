/**
 * `POST /api/v1/extractions/[jobId]/detach` — the owner's live surface (the
 * share-extension drawer or `/extract`) closed while the scan was still
 * running. Clears the job's `lastPolledAt` so the live-watcher suppression in
 * the completion push stands down — "I closed the drawer" reliably converts to
 * "I get the ping", even when the pipeline finishes seconds after the close.
 *
 * → { detached: true }
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { detachExtraction } from '@/lib/extraction-server';

export const dynamic = 'force-dynamic';

type RouteParams = { jobId: string };

export const POST = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  return detachExtraction(auth.uid, params.jobId);
});

export const OPTIONS = optionsHandler;
