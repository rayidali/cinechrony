/**
 * Foundation smoke route — Phase A (LAUNCH.md A.2.4).
 *
 * Returns the verified caller's uid. The smallest possible end-to-end test
 * of the auth+envelope+CORS stack — every subsequent endpoint inherits the
 * same wiring. Prefixed `_whoami` (with underscore) to mark it as
 * infrastructure rather than a domain route; keeps it findable in logs.
 *
 * GET /api/v1/_whoami
 *   200 { ok: true, data: { uid } }
 *   401 { ok: false, error: { code: 'UNAUTHORIZED', message } }
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => ({ uid: auth.uid }));

export const OPTIONS = optionsHandler;
