import { NextRequest, NextResponse } from 'next/server';
import { backfillReviewsThreading } from '@/app/actions';

const ADMIN_TOKEN = process.env.ADMIN_SECRET_TOKEN;

/**
 * POST /api/admin/backfill-reviews
 * Run this once to add parentId and replyCount fields to existing reviews.
 *
 * In development: GET also works for convenience
 * In production: Requires x-admin-token header
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get('x-admin-token');
  const isDev = process.env.NODE_ENV === 'development';

  if (!isDev) {
    if (!ADMIN_TOKEN) {
      console.error('[API] ADMIN_SECRET_TOKEN not configured');
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    if (!token || token !== ADMIN_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    console.log('[API] Starting reviews threading backfill...');
    const result = await backfillReviewsThreading();

    if (result.error) {
      return NextResponse.json({
        error: result.error,
        details: 'details' in result ? result.details : undefined,
        stats: result.stats
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      stats: result.stats,
    });
  } catch (error) {
    console.error('[API] Reviews backfill failed:', error);
    return NextResponse.json({ error: 'Backfill failed', details: String(error) }, { status: 500 });
  }
}

// GET allowed in development for convenience
export async function GET() {
  if (process.env.NODE_ENV === 'development') {
    return POST(new NextRequest('http://localhost/api/admin/backfill-reviews', { method: 'POST' }));
  }
  return NextResponse.json({ error: 'Method not allowed. Use POST with x-admin-token header.' }, { status: 405 });
}
