import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/firebase/admin';

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
    console.log('[API] Starting reviews backfill...');
    const db = getDb();

    // Get all reviews that don't have parentId field
    const reviewsSnapshot = await db.collection('reviews').get();

    let updated = 0;
    let skipped = 0;
    const batch = db.batch();

    for (const doc of reviewsSnapshot.docs) {
      const data = doc.data();

      // Only update if parentId is missing (not just null)
      if (data.parentId === undefined) {
        batch.update(doc.ref, {
          parentId: null,
          replyCount: data.replyCount ?? 0,
        });
        updated++;
      } else {
        skipped++;
      }

      // Firestore batches are limited to 500 operations
      if (updated > 0 && updated % 450 === 0) {
        await batch.commit();
        console.log(`[API] Committed batch of ${updated} reviews`);
      }
    }

    // Commit any remaining
    if (updated % 450 !== 0) {
      await batch.commit();
    }

    console.log(`[API] Reviews backfill complete: ${updated} updated, ${skipped} skipped`);

    return NextResponse.json({
      success: true,
      message: `Backfill complete: ${updated} reviews updated, ${skipped} already had parentId`,
      stats: { updated, skipped, total: reviewsSnapshot.size },
    });
  } catch (error) {
    console.error('[API] Backfill failed:', error);
    return NextResponse.json(
      { error: 'Backfill failed', details: String(error) },
      { status: 500 }
    );
  }
}

// Allow GET in development for convenience
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Use POST in production' }, { status: 405 });
  }
  return POST(request);
}
