import { NextRequest, NextResponse } from 'next/server';
import { backfillUserSearchFields } from '@/app/actions';

const ADMIN_TOKEN = process.env.ADMIN_SECRET_TOKEN;

/**
 * POST /api/admin/backfill
 * Run this once to migrate all existing users to have normalized search fields.
 *
 * Requires admin authentication via x-admin-token header.
 *
 * Example: curl -X POST http://localhost:3000/api/admin/backfill -H "x-admin-token: YOUR_SECRET"
 */
export async function POST(request: NextRequest) {
  // Check admin token
  const token = request.headers.get('x-admin-token');

  // In development, allow without token for convenience
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
    console.log('[API] Starting backfill...');
    const result = await backfillUserSearchFields();

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Backfill complete',
      migratedCount: result.migratedCount,
      skippedCount: result.skippedCount,
    });
  } catch (error) {
    console.error('[API] Backfill failed:', error);
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 });
  }
}

// GET not allowed in production - remove easy browser access
export async function GET() {
  if (process.env.NODE_ENV === 'development') {
    // Allow GET in dev for convenience
    return POST(new NextRequest('http://localhost/api/admin/backfill', { method: 'POST' }));
  }
  return NextResponse.json({ error: 'Method not allowed. Use POST with x-admin-token header.' }, { status: 405 });
}
