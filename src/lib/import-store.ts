'use client';

/**
 * Letterboxd import store — Phase 0.7 Wave 7. A module-level singleton that owns
 * the WHOLE chunked import lifecycle (scrape → poll → film chunks → lists →
 * favourites → finalize). Because it lives outside React, it survives client-side
 * navigation: the user can tap "continue in the app" on the importing screen and
 * keep browsing while the import finishes in the background, surfaced by a slim
 * global progress pill. Both the importing screen and the pill are just VIEWS of
 * this one store (via `useImportStore`).
 *
 * Resilience: the scrape's { runId, datasetId, lbUsername } is persisted to
 * localStorage, so if the app is killed mid-import the next launch resumes from
 * the already-finished Apify dataset (no re-scrape) and re-runs the remaining
 * chunks — every write is idempotent (deterministic doc ids), so a resume can
 * safely re-cover ground.
 */

import { useSyncExternalStore } from 'react';
import { apiCall } from '@/lib/api-client';

type Phase = 'idle' | 'scraping' | 'importing' | 'done' | 'failed';

export type ImportSnapshot = {
  active: boolean; // a run is in flight or just finished (until dismissed)
  foreground: boolean; // the dedicated importing screen is mounted
  phase: Phase;
  lbUsername: string;
  found: number; // scrape items seen
  total: number; // films to import
  done: number; // films imported so far
  posters: string[]; // sample posters for the building wall
  stats: { films: number; ratings: number; lists: number };
  etaMs: number | null; // estimated time remaining (importing only)
  reviewsPending: boolean;
  completedBackground: boolean; // finished while NOT on the importing screen → pill toasts
};

const STORAGE_KEY = 'cc-import-run';
const REVIEWS_FLAG = 'cc-pending-reviews';
const CHUNK = 120;
const POLL_MS = 4000;
const MAX_POLLS = 95;
const POSTER_CAP = 25;

const initial: ImportSnapshot = {
  active: false,
  foreground: false,
  phase: 'idle',
  lbUsername: '',
  found: 0,
  total: 0,
  done: 0,
  posters: [],
  stats: { films: 0, ratings: 0, lists: 0 },
  etaMs: null,
  reviewsPending: false,
  completedBackground: false,
};

let state: ImportSnapshot = initial;
const listeners = new Set<() => void>();
let running = false;
let importStartedAt = 0;

function set(patch: Partial<ImportSnapshot>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Library = {
  films: Array<{ name: string; year: string; status: string; rating: number | null; review: string | null }>;
  lists: Array<{ name: string; description?: string; movies: Array<{ name: string; year: string }> }>;
  favorites: Array<{ name: string; year: string }>;
};

function persist(run: { runId: string; datasetId: string; lbUsername: string } | null) {
  try {
    if (run) localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
}

function flagReviewsPending() {
  try {
    localStorage.setItem(REVIEWS_FLAG, '1');
  } catch {
    /* ignore */
  }
}

/** Drive the import from a ready library (shared by fresh runs + resume). */
async function importLibrary(lbUsername: string, library: Library) {
  const films = library.films || [];
  const ratingsCount = films.filter((f) => f.rating != null).length;
  importStartedAt = Date.now();
  set({ phase: 'importing', total: films.length, done: 0, etaMs: null });

  let imported = 0;
  let posters = state.posters;
  for (let i = 0; i < films.length; i += CHUNK) {
    const r = await apiCall<{ imported: number; posters: string[] }>(
      'POST',
      '/api/v1/imports/letterboxd/scrape/import',
      { phase: 'films', films: films.slice(i, i + CHUNK) },
    );
    imported += r.imported || 0;
    if (r.posters?.length && posters.length < POSTER_CAP) {
      posters = [...posters, ...r.posters].slice(0, POSTER_CAP);
    }
    const done = Math.min(i + CHUNK, films.length);
    const elapsed = Date.now() - importStartedAt;
    const etaMs = done > 0 && done < films.length ? Math.round((elapsed / done) * (films.length - done)) : 0;
    set({ done, posters, etaMs });
  }

  for (const list of library.lists || []) {
    await apiCall('POST', '/api/v1/imports/letterboxd/scrape/import', { phase: 'list', list }).catch(() => {});
  }
  if (library.favorites?.length) {
    await apiCall('POST', '/api/v1/imports/letterboxd/scrape/import', {
      phase: 'favorites',
      favorites: library.favorites,
    }).catch(() => {});
  }
  // finalize recounts the list AND kicks the slow background reviews run.
  await apiCall('POST', '/api/v1/imports/letterboxd/scrape/import', {
    phase: 'finalize',
    username: lbUsername,
  }).catch(() => {});
  flagReviewsPending();
  persist(null);

  set({
    phase: 'done',
    etaMs: 0,
    reviewsPending: true,
    completedBackground: !state.foreground,
    stats: { films: imported, ratings: ratingsCount, lists: (library.lists || []).length },
  });
}

async function runFresh(lbUsername: string) {
  if (running) return;
  running = true;
  set({
    active: true,
    phase: 'scraping',
    lbUsername,
    found: 0,
    total: 0,
    done: 0,
    posters: [],
    etaMs: null,
    stats: { films: 0, ratings: 0, lists: 0 },
  });
  try {
    const start = await apiCall<
      { available: false } | { available: true; runId: string; datasetId: string }
    >('POST', '/api/v1/imports/letterboxd/scrape/start', { username: lbUsername });
    if (!start.available) {
      set({ phase: 'done', stats: { films: 0, ratings: 0, lists: 0 }, reviewsPending: false });
      running = false;
      return;
    }
    persist({ runId: start.runId, datasetId: start.datasetId, lbUsername });

    let library: Library | null = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_MS);
      const s = await apiCall<{ status: 'running' | 'ready' | 'failed'; itemCount: number; library?: Library }>(
        'GET',
        `/api/v1/imports/letterboxd/scrape/status?runId=${encodeURIComponent(start.runId)}&datasetId=${encodeURIComponent(start.datasetId)}`,
      );
      set({ found: s.itemCount || 0 });
      if (s.status === 'failed') throw new Error('scrape failed');
      if (s.status === 'ready') {
        library = s.library ?? { films: [], lists: [], favorites: [] };
        break;
      }
    }
    if (!library) throw new Error('scrape timed out');
    await importLibrary(lbUsername, library);
  } catch {
    set({ phase: 'failed' });
  } finally {
    running = false;
  }
}

async function resumeRun(run: { runId: string; datasetId: string; lbUsername: string }) {
  if (running) return;
  running = true;
  set({ active: true, phase: 'scraping', lbUsername: run.lbUsername, foreground: false });
  try {
    // The Apify run already finished — re-fetch its dataset (no re-scrape).
    let library: Library | null = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      const s = await apiCall<{ status: 'running' | 'ready' | 'failed'; itemCount: number; library?: Library }>(
        'GET',
        `/api/v1/imports/letterboxd/scrape/status?runId=${encodeURIComponent(run.runId)}&datasetId=${encodeURIComponent(run.datasetId)}`,
      );
      set({ found: s.itemCount || 0 });
      if (s.status === 'failed') throw new Error('scrape failed');
      if (s.status === 'ready') {
        library = s.library ?? { films: [], lists: [], favorites: [] };
        break;
      }
      await sleep(POLL_MS);
    }
    if (!library) throw new Error('scrape unavailable');
    await importLibrary(run.lbUsername, library);
  } catch {
    set({ phase: 'failed' });
  } finally {
    running = false;
  }
}

export const importStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  snapshot: () => state,
  serverSnapshot: () => initial,
  setForeground(v: boolean) {
    set({ foreground: v });
  },
  start(lbUsername: string) {
    if (running || (state.active && state.lbUsername === lbUsername && state.phase !== 'failed')) return;
    void runFresh(lbUsername);
  },
  retry() {
    if (running) return;
    void runFresh(state.lbUsername);
  },
  dismiss() {
    set({ active: false, phase: 'idle', foreground: false });
  },
  /** Resume an interrupted import on app boot (no-op if nothing persisted). */
  resumeIfPending() {
    if (running || state.active) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const run = JSON.parse(raw) as { runId?: string; datasetId?: string; lbUsername?: string };
      if (run.runId && run.datasetId && run.lbUsername) {
        void resumeRun({ runId: run.runId, datasetId: run.datasetId, lbUsername: run.lbUsername });
      }
    } catch {
      persist(null);
    }
  },
};

export function useImportStore(): ImportSnapshot {
  return useSyncExternalStore(importStore.subscribe, importStore.snapshot, importStore.serverSnapshot);
}

/** Human ETA string from a millisecond estimate. */
export function formatEta(ms: number | null): string | null {
  if (ms == null || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `about ${Math.max(5, Math.ceil(s / 5) * 5)}s left`;
  const m = Math.round(s / 60);
  return `about ${m} min left`;
}
