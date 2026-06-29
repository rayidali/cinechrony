/**
 * Phase C — shared (client + server safe) types for the AI film-extraction
 * feature. Pure type declarations only — no runtime, no admin SDK — so both the
 * `/api/v1/extractions/*` route handlers AND the client confirmation UI (C.2)
 * can import them.
 *
 * The flow: client POSTs a video URL → a job is created → the pipeline (Apify
 * acquire → Gemini watch → TMDB ground) fills in `films` → client polls the job
 * → user confirms which films go to which list (→ save endpoint).
 */

export type ExtractionProvider = 'tiktok' | 'instagram' | 'youtube' | 'other';

/** Terminal-ish job status the client polls on. */
export type ExtractionStatus = 'processing' | 'done' | 'failed';

/** Fine-grained stage that drives the narrated progress UI. */
export type ExtractionStage =
  | 'queued'
  | 'fetching'   // ACQUIRE — Apify pulls the video + caption
  | 'watching'   // WATCH   — Gemini analyses it
  | 'matching'   // GROUND  — TMDB match-or-drop
  | 'done'
  | 'failed';

/** Where in the video a film was referenced (the "receipt" shown on the card). */
export type ExtractionEvidence = {
  channel: 'audio' | 'on-screen' | 'caption' | 'footage' | 'other';
  quote: string;
  timestampSec: number | null;
};

/** A single TMDB-grounded film candidate extracted from the video. */
export type ExtractionFilm = {
  tmdbId: number;
  title: string;
  year: string | null;
  mediaType: 'movie' | 'tv';
  posterUrl: string | null;
  confidence: number; // 0..1
  evidence: ExtractionEvidence | null;
  /** IMDb rating (e.g. "8.1"), grounded via OMDB. Best-effort — absent when OMDB
   *  is unconfigured / over quota / has no entry for the title. */
  imdbRating?: string | null;
};

export type ExtractionErrorCode =
  | 'UNSUPPORTED_URL'
  | 'FETCH_FAILED'
  | 'NO_FILM_CONTENT'
  | 'ANALYSIS_FAILED'
  | 'TIMEOUT'
  | 'INTERNAL';

/** The job shape returned to the client (a safe projection of the Firestore doc). */
export type ExtractionJobView = {
  jobId: string;
  status: ExtractionStatus;
  stage: ExtractionStage;
  provider: ExtractionProvider;
  sourceUrl: string;
  films?: ExtractionFilm[];
  suggestedListName?: string | null;
  isFilmContent?: boolean;
  /** Poster frame of the source clip (durable R2 url or YouTube thumb). Written
   *  onto every saved film as `socialThumbnail` so its card shows a preview. */
  videoThumbnail?: string | null;
  errorCode?: ExtractionErrorCode | null;
};
