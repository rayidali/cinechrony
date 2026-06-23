'use client';

import { useEffect, useState } from 'react';

/**
 * A tiny client-side signal for "the viewer's activity feed changed" — fired
 * after a write that adds or removes a `/activities` event (rate, clear-rating,
 * log-watch, remove-watch). Screens that show the activity feed (e.g. the
 * profile "recent" section) subscribe and re-fetch, so a cleared rating /
 * removed watch leaves "recent" immediately instead of lingering until a manual
 * refresh. Only MOUNTED subscribers re-fetch, so it's cheap.
 */
let version = 0;
const subscribers = new Set<(v: number) => void>();

export function notifyActivitiesChanged(): void {
  version += 1;
  subscribers.forEach((fn) => fn(version));
}

/** Re-renders the consumer (returns a bumping version) whenever activities change. */
export function useActivitiesVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => {
    const fn = (nv: number) => setV(nv);
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);
  return v;
}
