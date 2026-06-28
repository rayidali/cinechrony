/**
 * `POST /api/v1/extractions/[jobId]/save` — save confirmed films from a DONE
 * extraction into lists. Phase C.1d.
 *
 * Body:
 *   {
 *     createLists?: [{ tempId: "new1", name: "interstellar moments" }],
 *     items: [
 *       { tmdbId: 157336, mediaType: "movie", target: { tempId: "new1" } },
 *       { tmdbId: 680,    mediaType: "movie", target: { ownerId, listId } },
 *     ]
 *   }
 * → { results: [{ tmdbId, ok, listId?, deduped?, error? }], createdLists: { tempId: listId } }
 *
 * Per-item isolation: a forged/unauthorized target fails THAT item (403 via
 * canEditList inside addMovieToList) while the rest succeed. Films are resolved
 * from the job's grounded results only; idempotent; ≤25 items / ≤5 new lists.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { saveExtraction } from '@/lib/extraction-server';

export const dynamic = 'force-dynamic';

type RouteParams = { jobId: string };

export const POST = apiRoute<RouteParams>(async (req, { auth, params }) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return saveExtraction(auth.uid, params.jobId, body);
});

export const OPTIONS = optionsHandler;
