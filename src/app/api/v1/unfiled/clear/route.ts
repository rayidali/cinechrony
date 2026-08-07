/**
 * `POST /api/v1/unfiled/clear` — drop films from the pen without filing them.
 *
 * Body: `{ movieIds?: string[] }` — omit to clear everything.
 * → `{ removed: number }`
 *
 * POST rather than DELETE because it optionally carries a body naming which
 * films to drop, and DELETE-with-a-body is inconsistently supported across the
 * fetch stacks this app runs on (WKWebView included).
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { clearUnfiled } from '@/lib/unfiled-server';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req, { auth }) => {
  let body: { movieIds?: unknown } = {};
  try {
    body = (await req.json()) as { movieIds?: unknown };
  } catch {
    // An empty body is the "clear everything" call, not a malformed request.
    body = {};
  }
  if (body?.movieIds !== undefined && !Array.isArray(body.movieIds)) {
    throw new BadRequestError('movieIds must be an array when provided.');
  }
  return clearUnfiled(auth.uid, body?.movieIds as string[] | undefined);
});

export const OPTIONS = optionsHandler;
