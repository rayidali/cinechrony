'use client';

/**
 * Live Activity bridge (iOS 17.2+, Capacitor) — the JS half of the
 * lock-screen scan tracker (LIVE-ACTIVITY-PLAN.md). The native side
 * (`ios/App/App/LiveActivityPlugin.swift`, a local plugin registered in
 * `AppViewController.capacitorDidLoad`) observes ActivityKit's two token
 * streams; this module ships them to the backend:
 *
 *   - push-to-start token (per device)   → POST /api/v1/me/live-activity-token
 *     lets the extraction pipeline START the activity via APNs while the
 *     app never opens (the whole point — the share flow lives in IG).
 *   - update token (per started activity) → POST /api/v1/extractions/{jobId}/
 *     live-activity-token — lets the pipeline narrate stages + resolve the
 *     card. The server flushes the freshest state the moment this lands.
 *
 * Plus READ-REPAIR on foreground: any activity still saying "scanning" for a
 * job Firestore says is finished gets ended locally — a dropped APNs end push
 * can dangle a card, and the lock screen must never lie forever.
 *
 * No-op on web / Android / iOS < 17.2. Never throws.
 */

import { registerPlugin } from '@capacitor/core';
import { apiCall } from '@/lib/api-client';
import type { ExtractionJobView } from '@/lib/extraction-types';

type LaEndInput = {
  jobId: string;
  stage: number;
  label: string;
  detail: string | null;
  state: 'working' | 'done' | 'zero' | 'failed';
};

type LiveActivityPlugin = {
  watch(): Promise<{ supported: boolean; token?: string }>;
  getActive(): Promise<{ activities: Array<{ jobId: string; activityId: string; state: string }> }>;
  end(options: LaEndInput): Promise<{ ended: boolean }>;
  addListener(
    event: 'pushToStartToken',
    cb: (data: { token: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: 'updateToken',
    cb: (data: { jobId: string; activityId: string; token: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
};

const LiveActivity = registerPlugin<LiveActivityPlugin>('LiveActivity');

let initialized = false;

/** A stable per-install id — the laTokens doc key, so a rotating token
 *  REPLACES this device's lease instead of accumulating siblings. */
function deviceId(): string {
  const KEY = 'cc-la-device-id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'device-unknown';
  }
}

/** Unacked tokens are retried on every app foreground — a failed POST (bad
 *  network, server hiccup) must never orphan a token until the next launch. */
const pending = {
  pushToStart: null as string | null,
  updates: new Map<string, { activityId: string; token: string }>(),
};

async function savePushToStartToken(token: string): Promise<void> {
  pending.pushToStart = token;
  try {
    await apiCall('POST', '/api/v1/me/live-activity-token', { deviceId: deviceId(), token });
    if (pending.pushToStart === token) pending.pushToStart = null;
  } catch (err) {
    console.warn('[live-activity] push-to-start token save failed (will retry on foreground):', err);
  }
}

async function saveUpdateToken(jobId: string, activityId: string, token: string): Promise<void> {
  pending.updates.set(jobId, { activityId, token });
  try {
    await apiCall('POST', `/api/v1/extractions/${jobId}/live-activity-token`, { activityId, token });
    if (pending.updates.get(jobId)?.token === token) pending.updates.delete(jobId);
  } catch (err) {
    console.warn('[live-activity] update token save failed (will retry on foreground):', err);
  }
}

async function retryPendingTokens(): Promise<void> {
  if (pending.pushToStart) void savePushToStartToken(pending.pushToStart);
  for (const [jobId, u] of [...pending.updates]) {
    void saveUpdateToken(jobId, u.activityId, u.token);
  }
}

/** The terminal card content for a finished job — mirrors the server's
 *  `laEndStateFor` so a locally-repaired card reads identically. */
function endStateForJob(jobId: string, job: ExtractionJobView | null): LaEndInput {
  if (!job || job.status === 'failed') {
    return job
      ? { jobId, stage: 4, label: 'that reel put up a fight', detail: 'tap to run it back', state: 'failed' }
      : { jobId, stage: 4, label: 'that scan expired', detail: 'share the reel again anytime', state: 'failed' };
  }
  const films = job.films ?? [];
  if (!films.length) {
    return { jobId, stage: 4, label: 'no films in this one', detail: 'just vibes, apparently', state: 'zero' };
  }
  const first = films[0];
  const year = first.year ? ` (${first.year})` : '';
  const imdb = first.imdbRating ? ` · imdb ${first.imdbRating}` : '';
  const more = films.length > 1 ? ` and ${films.length - 1} more` : '';
  return {
    jobId,
    stage: 4,
    label: `${films.length} ${films.length === 1 ? 'film' : 'films'} found`,
    detail: `${first.title}${year}${imdb}${more}`,
    state: 'done',
  };
}

/** End any activity whose job Firestore says is already terminal. */
async function reconcileActivities(): Promise<void> {
  try {
    const { activities } = await LiveActivity.getActive();
    for (const activity of activities ?? []) {
      if (activity.state !== 'working') continue; // resolved cards age out on their own
      try {
        const job = await apiCall<ExtractionJobView>('GET', `/api/v1/extractions/${activity.jobId}`);
        if (job.status === 'done' || job.status === 'failed') {
          await LiveActivity.end(endStateForJob(activity.jobId, job));
        }
      } catch {
        // 404/403 → the job doc is gone (TTL) — resolve the card so it can't dangle.
        await LiveActivity.end(endStateForJob(activity.jobId, null)).catch(() => {});
      }
    }
  } catch {
    /* plugin absent (old build) — nothing to repair */
  }
}

/**
 * Idempotent init — call once per authenticated session (native-push
 * registration does). Wires both token listeners BEFORE starting the native
 * observers so nothing is emitted into the void, then read-repairs now and
 * on every foreground.
 */
export async function initLiveActivityBridge(): Promise<void> {
  if (initialized || typeof window === 'undefined') return;
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  if (cap?.isNativePlatform?.() !== true || cap.getPlatform?.() !== 'ios') return;
  initialized = true;

  try {
    await LiveActivity.addListener('pushToStartToken', ({ token }) => {
      if (token) void savePushToStartToken(token);
    });
    await LiveActivity.addListener('updateToken', ({ jobId, activityId, token }) => {
      if (jobId && token) void saveUpdateToken(jobId, activityId ?? '', token);
    });

    const res = await LiveActivity.watch();
    if (!res?.supported) return; // iOS < 17.2 or activities disabled — outcome pushes cover it
    if (res.token) void savePushToStartToken(res.token);

    void reconcileActivities();
    const { App } = await import('@capacitor/app');
    await App.addListener('resume', () => {
      void retryPendingTokens();
      void reconcileActivities();
    });
  } catch (err) {
    // An older installed native build won't have the plugin — fine, the
    // outcome-push fallback ladder covers those devices entirely.
    console.info('[live-activity] bridge unavailable:', err);
  }
}
