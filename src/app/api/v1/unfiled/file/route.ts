/**
 * `POST /api/v1/unfiled/file` — move films out of the unfiled pen into a list.
 *
 * Body: `{ movieIds: string[], target: { ownerId, listId } | { newListName } }`
 * → `{ filed: string[], failed: [{ movieId, error }], listId }`
 *
 * Partial success is first-class (same posture as the extraction save): one
 * film targeting a list the caller can no longer edit fails alone.
 *
 * There is deliberately no GET counterpart. The pen lives at the deterministic
 * path `users/{uid}/lists/unfiled/movies` and is the caller's own data, so the
 * client reads it with the same real-time `useCollection` it uses for any list
 * — an endpoint would add a round trip and lose the live updates.
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { fileUnfiled, type FileTarget } from '@/lib/unfiled-server';

export const dynamic = 'force-dynamic';

type Body = { movieIds?: unknown; target?: unknown };

export const POST = apiRoute(async (req, { auth }) => {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (!Array.isArray(body?.movieIds)) throw new BadRequestError('movieIds must be an array.');

  const t = body?.target as Record<string, unknown> | undefined;
  let target: FileTarget;
  if (t && typeof t.newListName === 'string') {
    target = { newListName: t.newListName };
  } else if (t && typeof t.ownerId === 'string' && typeof t.listId === 'string') {
    target = { ownerId: t.ownerId, listId: t.listId };
  } else {
    throw new BadRequestError('target must be { ownerId, listId } or { newListName }.');
  }

  return fileUnfiled(auth.uid, body.movieIds as string[], target);
});

export const OPTIONS = optionsHandler;
