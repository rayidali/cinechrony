/**
 * `POST /api/v1/reports` — submit a content report.
 *
 * Body: `{ contentType, targetId, reason }`. `contentType` ∈ `'review' |
 * 'user' | 'list' | 'post' | 'post_comment'`. Rate-limited via the
 * `report` bucket (AUDIT.md 3.8) to prevent spam / harassment-by-mass-
 * report. Reports land in the server-only `/reports` collection for the
 * developer to review.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import { reportContent, ReportValidationError } from '@/lib/reports-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type Body = { contentType?: unknown; targetId?: unknown; reason?: unknown };

export const POST = apiRoute(async (req, { auth }) => {
  const rl = await checkRateLimit(auth.uid, 'report');
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: rl.error } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  try {
    await reportContent(auth.uid, body.contentType, body.targetId, body.reason);
    return { success: true };
  } catch (err) {
    if (err instanceof ReportValidationError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
