/**
 * `GET /api/v1/../cron/home-snapshot` — optional warmer for the home-rail
 * snapshot (leaderboard + friends-watching). The snapshot ALSO rebuilds itself
 * lazily on read (stale-while-revalidate, see home-snapshot-server.ts), so this
 * is not required — but wiring an external scheduler (GitHub Actions / Vercel
 * Cron / cron-job.org) to hit it every ~30-60 min keeps it warm so no user ever
 * triggers a cold rebuild.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (same contract as weekly-digest).
 */

import { NextRequest, NextResponse } from 'next/server';
import { rebuildHomeSnapshot } from '@/lib/home-snapshot-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron] CRON_SECRET not configured — refusing to run');
    return NextResponse.json({ error: 'Server not configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await rebuildHomeSnapshot();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/home-snapshot] rebuild failed:', err);
    return NextResponse.json({ error: 'rebuild failed' }, { status: 500 });
  }
}
