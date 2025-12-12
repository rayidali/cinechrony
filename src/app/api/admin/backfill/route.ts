import { NextResponse } from 'next/server';
import { backfillUserSearchFields } from '@/app/actions';

/**
 * POST /api/admin/backfill
 * Run this once to migrate all existing users to have normalized search fields.
 *
 * Example: curl -X POST http://localhost:3000/api/admin/backfill
 */
export async function POST() {
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

// Also support GET for easy browser access
export async function GET() {
  return POST();
}
