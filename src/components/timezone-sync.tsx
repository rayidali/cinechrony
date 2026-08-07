'use client';

import { useEffect, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';

const LAST_SENT_KEY = 'cc-tz-offset';

/**
 * Records the signed-in user's UTC offset (Phase D0).
 *
 * WHY IT EXISTS: the D6 notification policy promises "nothing between 10pm and
 * 9am", and the app has never known what 10pm means for a given user. Movie
 * nights carry their own `tzOffsetMinutes` per night, which is why reminders
 * work and quiet hours could not have been written.
 *
 * WHY IT IS NOT A PER-LAUNCH WRITE: this is a free-tier Firestore project (see
 * [[project_quota_read_reduction]] — quota-first is a standing constraint), and
 * a write on every boot for every user would be pure waste for a value that
 * changes maybe twice a year. `localStorage` remembers the last offset SENT, so
 * the network call fires only when the offset actually differs: once per
 * device, then once per DST shift or flight. A cleared cache costs one
 * redundant write, which is the cheap side of the trade.
 *
 * WHY IT RE-CHECKS ON RESUME: a phone that crosses a timezone while the app is
 * backgrounded never re-runs mount effects. Capacitor's `resume` (native) and
 * `visibilitychange` (web) are the only moments we learn about it.
 *
 * Failure is deliberately silent. A missing offset makes quiet hours degrade to
 * "send it" (see `getUserTimezone`) — the wrong outcome is a notification at an
 * awkward hour, not a swallowed one, so there is nothing here worth interrupting
 * someone with a toast about.
 */
export function TimezoneSync() {
  const { user } = useUser();
  const inFlight = useRef(false);

  useEffect(() => {
    if (!user) return;

    const sync = async () => {
      if (inFlight.current) return;
      // Minutes to ADD to UTC to get local time — the inverse of what
      // getTimezoneOffset() returns, and the same convention movie nights use.
      const offset = -new Date().getTimezoneOffset();
      let lastSent: string | null = null;
      try {
        lastSent = localStorage.getItem(LAST_SENT_KEY);
      } catch {
        /* private mode / storage disabled — fall through and just send */
      }
      if (lastSent === String(offset)) return;

      inFlight.current = true;
      try {
        await apiCall('PUT', '/api/v1/me/timezone', { tzOffsetMinutes: offset });
        try {
          localStorage.setItem(LAST_SENT_KEY, String(offset));
        } catch {
          /* not persisting only costs a redundant write next launch */
        }
      } catch {
        // Left unmarked on purpose: the next launch or resume retries.
      } finally {
        inFlight.current = false;
      }
    };

    void sync();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    const resume = CapApp.addListener('resume', () => void sync());

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void resume.then((h) => h.remove());
    };
  }, [user]);

  return null;
}
