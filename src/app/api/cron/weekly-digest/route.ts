import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { getDb } from '@/firebase/admin';

// Configure web-push with VAPID keys
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:support@cinechrony.com', // Contact email
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

// Weekly digest messages - rotates based on what activity there is
function getDigestMessage(stats: {
  unreadNotifications: number;
  newFollowers: number;
  likesReceived: number;
  toWatchCount: number;
}): { title: string; body: string } | null {
  const { unreadNotifications, newFollowers, likesReceived, toWatchCount } = stats;

  // Priority: unread notifications > new followers > likes > watchlist reminder
  if (unreadNotifications > 0) {
    if (newFollowers > 0 && likesReceived > 0) {
      return {
        title: 'Your weekly update',
        body: `${unreadNotifications} notifications, ${newFollowers} new follower${newFollowers > 1 ? 's' : ''}, and ${likesReceived} like${likesReceived > 1 ? 's' : ''} this week!`,
      };
    }
    if (newFollowers > 0) {
      return {
        title: 'You have new followers!',
        body: `${newFollowers} new follower${newFollowers > 1 ? 's' : ''} and ${unreadNotifications} unread notification${unreadNotifications > 1 ? 's' : ''} waiting.`,
      };
    }
    return {
      title: `${unreadNotifications} unread notification${unreadNotifications > 1 ? 's' : ''}`,
      body: 'Check out what your friends have been up to!',
    };
  }

  if (newFollowers > 0) {
    return {
      title: `${newFollowers} new follower${newFollowers > 1 ? 's' : ''} this week!`,
      body: 'Someone new is interested in your movie taste.',
    };
  }

  if (likesReceived > 0) {
    return {
      title: `Your reviews got ${likesReceived} like${likesReceived > 1 ? 's' : ''}!`,
      body: 'People are enjoying your movie takes.',
    };
  }

  if (toWatchCount > 5) {
    return {
      title: `${toWatchCount} movies waiting`,
      body: 'Time for movie night? Your watchlist is growing!',
    };
  }

  // No activity - skip notification
  return null;
}

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel adds this automatically for cron jobs)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In production, verify the cron secret
  if (process.env.NODE_ENV === 'production' && cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 });
  }

  const db = getDb();
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  let usersProcessed = 0;
  let notificationsSent = 0;
  let errors = 0;

  try {
    // Get all users with push enabled
    const usersSnapshot = await db
      .collection('users')
      .where('pushEnabled', '==', true)
      .get();

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;

      try {
        // Get user's push subscriptions
        const subscriptionsSnapshot = await db
          .collection('users')
          .doc(userId)
          .collection('pushSubscriptions')
          .get();

        if (subscriptionsSnapshot.empty) continue;

        // Gather stats for this user
        // 1. Unread notifications count
        const unreadSnapshot = await db
          .collection('notifications')
          .where('userId', '==', userId)
          .where('read', '==', false)
          .count()
          .get();
        const unreadNotifications = unreadSnapshot.data().count;

        // 2. New followers this week (check followers subcollection)
        const followersSnapshot = await db
          .collection('users')
          .doc(userId)
          .collection('followers')
          .where('createdAt', '>=', oneWeekAgo)
          .count()
          .get();
        const newFollowers = followersSnapshot.data().count;

        // 3. Likes received on reviews this week
        const reviewsSnapshot = await db
          .collection('reviews')
          .where('userId', '==', userId)
          .get();

        let likesReceived = 0;
        // Note: This is simplified - ideally we'd track likes with timestamps
        // For now, we just count current likes on recent reviews
        for (const review of reviewsSnapshot.docs) {
          const reviewData = review.data();
          if (reviewData.createdAt?.toDate() >= oneWeekAgo) {
            likesReceived += reviewData.likes || 0;
          }
        }

        // 4. To Watch count (from default list)
        const listsSnapshot = await db
          .collection('users')
          .doc(userId)
          .collection('lists')
          .where('isDefault', '==', true)
          .limit(1)
          .get();

        let toWatchCount = 0;
        if (!listsSnapshot.empty) {
          const listId = listsSnapshot.docs[0].id;
          const moviesSnapshot = await db
            .collection('users')
            .doc(userId)
            .collection('lists')
            .doc(listId)
            .collection('movies')
            .where('status', '==', 'To Watch')
            .count()
            .get();
          toWatchCount = moviesSnapshot.data().count;
        }

        // Get message based on stats
        const message = getDigestMessage({
          unreadNotifications,
          newFollowers,
          likesReceived,
          toWatchCount,
        });

        // Skip if no meaningful activity
        if (!message) continue;

        // Send push to all user's subscriptions
        for (const subDoc of subscriptionsSnapshot.docs) {
          const subscription = subDoc.data();

          try {
            await webpush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: subscription.keys,
              },
              JSON.stringify({
                title: message.title,
                body: message.body,
                tag: 'weekly-digest',
                url: '/notifications',
              })
            );
            notificationsSent++;
          } catch (pushError: any) {
            // If subscription is invalid (410 Gone), remove it
            if (pushError.statusCode === 410) {
              await subDoc.ref.delete();
            }
            errors++;
          }
        }

        usersProcessed++;
      } catch (userError) {
        console.error(`Error processing user ${userId}:`, userError);
        errors++;
      }
    }

    return NextResponse.json({
      success: true,
      usersProcessed,
      notificationsSent,
      errors,
    });
  } catch (error) {
    console.error('[weekly-digest] Failed:', error);
    return NextResponse.json({ error: 'Failed to send digests' }, { status: 500 });
  }
}
