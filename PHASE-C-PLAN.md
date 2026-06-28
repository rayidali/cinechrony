# Phase C — Hero Feature: Implementation Plan (v2 — DECIDED)

> **Status: DECIDED 2026-06-12.** Stack locked by owner: **Apify** (owner has
> a subscription) for video acquisition · **Gemini** video-native analysis ·
> per-film list assignment in the confirmation UI · source URL saved as the
> movie's existing `socialLink` field · **web-first build order** (API +
> in-app paste-link UI ship before any Swift).
>
> This file is the working tracker for Phase C. `LAUNCH.md` §C.1 is
> superseded by this doc; §C.2–C.7 (Share Extension UX, App Group token,
> Android intent, onboarding reuse) still apply as written there.
> Convention carried over from `AUDIT.md`: **every item has a Test.**

---

## The feature, in one user story

> Maya watches a TikTok: "top 5 crime films you've never seen." She taps
> **Share → Cinechrony**. A sheet slides up: *getting the video → watching
> it → matching films*, then five film cards appear — poster, year, and a
> receipt ("**#3 HEAT** — on screen at 0:34"). Each card has a list chip
> defaulting to her default watchlist; she taps the chip on two of them and
> moves those to her "with sara" list, accepts the AI-suggested new list
> "top 5 crime films" for the rest, removes one she's seen, hits **save**.
> Every saved movie carries the TikTok as its `socialLink` — so when she
> opens *Heat* in Cinechrony later, the TikTok that made her want it plays
> right there in the movie card.

Same flow, three doorways: iOS share sheet (C.3), Android share intent
(C.4), and **paste-a-link inside the app** (C.2 — ships first, works on
web + both platforms forever).

---

## Why the existing codebase makes this cheap

| Need | Already exists |
|---|---|
| Attach TikTok/Reel/Short to a movie | `socialLink` field on movie docs + `video-embed.tsx` renders it (autoplay embeds). Saving = set one field. |
| Add a movie to a list, safely | `src/lib/movies-server.ts::addMovieToList` — transactional, permission-checked (`canEditList`), denormalizes user data, bumps `movieCount`, emits activity. We call it per selection. |
| Create a list | `lists-server.ts::createList`. The "new list: *top 5 crime films*" option calls this. |
| Pick a list in UI | List-picker step already exists in `add-movie-modal.tsx` (`select-list` step). Reuse/extract it. |
| Auth from any client (incl. Swift) | Bearer ID-token auth + envelope contract on all `/api/v1/*` (Phase A). |
| Rate limiting | `src/lib/rate-limit.ts::checkRateLimit` — add an `extraction` bucket. |
| TMDB search | Server-side TMDB access already used by `/api/v1/movies/trending` etc. |

The genuinely new pieces: the **extraction pipeline** (Apify + Gemini +
TMDB grounding), the **job/cache plumbing**, the **confirmation UI**, and
(later) the **Swift Share Extension**.

---

## Architecture

```
Client (web page / Share Ext / Android)        Backend (/api/v1 on Vercel)
───────────────────────────────────────        ─────────────────────────────
POST /api/v1/extractions {url}        ───►    canonicalize → hash → cache?
        ◄── {jobId, status}                    │ hit: return done instantly
                                               │ miss: create job doc,
GET /api/v1/extractions/{jobId}                │  waitUntil(runPipeline):
  poll ~1.5s; stage drives the                 │   1 ACQUIRE  Apify actor → MP4+caption
  narrated progress UI                         │   2 WATCH    Gemini (video-native,
        ◄── {status, stage, films…}            │              structured output)
                                               │   3 GROUND   TMDB match-or-drop
POST /api/v1/extractions/{jobId}/save          │   4 PERSIST  cache + job done
  {createLists?, items[]}             ───►    create lists → addMovieToList per
        ◄── per-item results                   item with socialLink = source URL
```

### Pipeline stages (job doc `stage` field — drives the progress UI)

`queued → fetching → watching → matching → done | failed`

### Acquisition tiers (corrected for Vercel reality)

| Tier | What | Notes |
|---|---|---|
| 1 | **Apify actor** (owner's subscription) — multi-platform video downloader | Config-driven: `APIFY_ACTOR_ID` env, called via `run-sync-get-dataset-items`. Must return a direct MP4 URL + caption. C.0 verifies the chosen actor against the eval corpus. |
| 1b | **YouTube: no download at all** — Gemini ingests YouTube URLs directly (`fileData.fileUri`) | Skips acquisition entirely for YT/Shorts. |
| 2 | Second Apify actor (different author) as failover | Same interface; circuit breaker picks. |
| 3 | **Metadata-only degraded mode**: TikTok oEmbed / YouTube Data API caption+title → text-only Gemini extraction | The old v1 pipeline, demoted to a fallback. |
| 4 | User-facing floor: "couldn't fetch this video — share a screenshot instead?" → image path | Screenshot path = same Gemini call with an image instead of video. |

> Self-hosted yt-dlp was dropped from the tier list: Vercel functions can't
> run the yt-dlp binary. If we ever add a worker box, it can return as tier 2½.

### Caps & guards

- Video duration cap **≤ 10 min** for download+watch (covers every TikTok/
  Reel/Short). Longer YouTube videos → tier 3 (captions/description text).
- Download size cap ~100 MB; abort → tier fallthrough.
- Per-user rate limit: `extraction` bucket — 5/min burst, 50/day.
- Pipeline hard timeout 120s → job `failed` with a friendly error code.
  (Vercel function limit is 300s; `waitUntil` keeps work alive after the
  POST response returns.)

---

## Data model (new, all server-only in `firestore.rules`)

```
/extraction_jobs/{jobId}            # per-request, uid-scoped
  uid, sourceUrl, canonicalUrl, urlHash, provider ('tiktok'|'instagram'|'youtube'|'other')
  status ('processing'|'done'|'failed'), stage, errorCode?
  films[]?, suggestedListName?            # copied from cache on completion
  createdAt, updatedAt

/extraction_cache/{urlHash}         # shared across users — results only,
  canonicalUrl, provider              # nothing user-specific in here
  films[]: { tmdbId, title, year, mediaType, posterUrl, confidence,
             evidence: { channel, quote, timestampSec } }
  suggestedListName?, isFilmContent
  analyzedBy ('gemini-video'|'gemini-text'|'image'), createdAt   # ~30-day TTL
```

Rules: explicit `allow read, write: if false;` for both (same pattern as
`/reviews`, `/reports`). All access via Admin SDK.

---

## API contract (new routes)

### `POST /api/v1/extractions`
Auth required. Rate-limited (`extraction`). Body `{ url: string }`.
- Canonicalize (follow `vm.tiktok.com` redirects, strip tracking params).
- Cache hit → create job doc already `done` (copies cached result) →
  `200 { jobId, status: 'done' }`.
- Miss → create job `processing`, `waitUntil(runExtractionPipeline(jobId))`,
  → `202 { jobId, status: 'processing' }`.
- Invalid/unsupported URL → `400 { error: { code: 'UNSUPPORTED_URL' } }`.

### `GET /api/v1/extractions/[jobId]`
Auth required; **403 unless `job.uid === caller.uid`**.
→ `{ status, stage, films?, suggestedListName?, errorCode? }`.

### `POST /api/v1/extractions/[jobId]/save`
Auth required; job must be `done` and owned by caller. Body:
```jsonc
{
  "createLists": [{ "tempId": "new1", "name": "top 5 crime films" }],
  "items": [
    { "tmdbId": 949,  "mediaType": "movie", "target": { "tempId": "new1" } },
    { "tmdbId": 680,  "mediaType": "movie", "target": { "ownerId": "u_abc", "listId": "l_xyz" } }
  ]
}
```
- Creates lists first (caller-owned), then per item calls
  `addMovieToList(..., { socialLink: job.canonicalUrl })`.
- **Every item runs through `canEditList`** — a forged `target` pointing at
  someone else's list → that item fails with 403 semantics in the per-item
  result; others proceed. Response: `{ results: [{ tmdbId, ok, listId, error? }] }`.
- Items capped at 25/request. Duplicate-in-list → `ok: true, deduped: true`
  (addMovieToList is already idempotent).

---

## Gemini integration (`src/lib/gemini-server.ts`)

- Env: `GEMINI_API_KEY`, `GEMINI_MODEL` (default a current Flash-tier model —
  config-driven so we can hop models without code changes).
- Video path: Files API upload (resumable) → poll until `state === 'ACTIVE'`
  → `generateContent` with `fileData: { fileUri, mimeType }` + the caption in
  the text prompt + `responseMimeType: 'application/json'` + `responseSchema`
  (the films schema above). YouTube path: pass the YouTube URL directly as
  `fileUri` — no upload.
- Prompt contract (sketch): *"You are watching a short social video. Extract
  every movie or TV show referenced by ANY channel: spoken audio, text shown
  on screen, the caption, or recognizable footage. For each, give title,
  release year if determinable, mediaType, confidence 0–1, and evidence
  (channel, short quote, timestamp). If the video is a curated list, suggest
  a lowercase list name. If no films: films: [], isFilmContent: false."*
- Text/degraded path: same schema, text-only prompt from caption+title.
- Cost note: ~258 tokens/sec of video → 60s ≈ ~17K tokens ≈ well under 3¢
  on Flash-tier. Whisper is **dropped from the plan** — Gemini hears the
  audio track itself.

## TMDB grounding (`extraction-server.ts`)

For each candidate: TMDB `search/multi` (title, year hint) → normalize
(lowercase, strip punctuation/articles) → accept if best result's title
similarity ≥ threshold AND year within ±1 (when both known). Attach
`tmdbId`, `posterUrl`, canonical title/year from TMDB. **No TMDB match →
dropped.** The model cannot save a film that doesn't exist.

---

## Confirmation UI (web-first — `C.2`)

Entry points:
1. **Paste-link surface**: the add flow's existing "Paste TikTok, Reel, or
   YouTube link…" affordance gains an "extract films from this video"
   action (plus a dedicated `/extract?url=` route the native doorways
   deep-link into).
2. Later: Share Extension (iOS) renders its own SwiftUI version of the same
   screen against the same endpoints; Android share intent just deep-links
   to `/extract?url=`.

Screen spec (editorial v2 language, lowercase headline):
- Progress phase: eyebrow `THE EXTRACTOR` → narrated stages from `job.stage`.
- Result phase: film cards — poster · title · year · evidence line
  (`on screen at 0:34 — "#3 HEAT"`) · remove (×) · **list chip**.
  - List chip defaults to the user's default list; tapping opens the list
    picker (reused from add-movie-modal) — per-card assignment.
  - Top row option: `+ new list: "top 5 crime films"` (AI-suggested name,
    editable) — selecting it assigns that card (or "apply to all").
  - A search-to-add row for films the AI missed (existing TMDB search).
- Save → `POST .../save` → success state shows per-list summary
  ("3 saved to *top 5 crime films* · 2 to *with sara*").
- Empty result → "couldn't find any films in this video" + screenshot-
  fallback CTA. Failed job → friendly error + retry.

---

## Build phases & checklists

### C.0 — Prerequisites (OWNER — nothing builds until these exist)

- [ ] **C.0.1** Merge Phase A + B to `main` (squash off
  `feat/phase-b-capacitor-wrap`). Phase C branches off `main`.
- [ ] **C.0.2** Gemini API key (aistudio.google.com → Get API key). Add
  `GEMINI_API_KEY` to Vercel env + local `.env.local`.
- [ ] **C.0.3** Pick the Apify actor: from your Apify console, choose the
  multi-platform video-downloader actor; note its **actor ID** and your
  **API token** → `APIFY_TOKEN`, `APIFY_ACTOR_ID` env vars. Acceptance:
  given a TikTok URL it returns a watermark-free MP4 URL + caption.
- [ ] **C.0.4** (parallel, for C.3 later) Apple Developer enrollment +
  Xcode download started — see PHASE-B-HANDOFF.md §0–§2.
- [ ] **C.0.5 — Test:** `curl` the Apify actor with 3 sample URLs (TikTok,
  Reel, Short); confirm MP4 + caption fields in the response. (Owner + Claude
  pair on this — it decides the tier-1 adapter's field mapping.)

### C.1 — Extraction backend (Claude, ~4 small PRs)

- [x] **C.1a** ✅ DONE (2026-06-27, branch `feat/phase-c-extraction`). Job
  scaffolding: routes (`POST /extractions`, `GET /[jobId]`),
  `src/lib/extraction-server.ts` + `extraction-types.ts`, URL canonicalizer +
  provider classification, `extraction_jobs` + `extraction_cache` collections +
  deny rules, `extraction` (5/min) + `extractionDaily` (50/day) rate buckets,
  `next/server` `after()` wiring (inline fallback gated off under the test
  emulator). Pipeline stubbed (3 fixture TMDB films + suggestedListName, writes
  the shared cache). **Test `44-extractions-auth.test.ts`: 10/10 green** (unauth
  401, foreign jobId 403, missing 404, bad/unsupported URL 400, rate-limit 429,
  cache-hit done). typecheck + vercel build clean; full audit 470/470.
- [x] **C.1b** ✅ DONE — Acquisition: Apify adapter (+ failover slot + circuit-breaker
  counter), oEmbed/YouTube-metadata degraded tier, provider classification.
  **Test:** adapter unit tests with recorded fixtures; tier fallthrough on
  simulated provider failure; duration/size caps enforced.
- [x] **C.1c** ✅ DONE — Analysis + grounding: `gemini-server.ts` (video, text, image
  paths, structured output), TMDB grounding with match-or-drop.
  **Test:** grounding unit tests (fuzzy-match table incl. "the dark knight"
  vs "Dark Knight", year-off-by-one, garbage title dropped); Gemini calls
  mocked in audit suite (live calls live in the eval harness, not CI).
- [x] **C.1d** ✅ DONE — Save endpoint: `POST /[jobId]/save` with createLists +
  per-item targets + `socialLink` attach.
  **Test:** `45-extraction-save.test.ts` — forged target list → per-item
  403, others succeed; new-list creation owned by caller; socialLink lands
  on the movie doc; movieCount increments (reuses 09-moviecount invariants);
  duplicate dedupes; 25-item cap.

### C.2 — Confirmation UI, web-first (Claude)

- [x] **C.2.1** ✅ DONE — `/extract` client route + paste-link entry point in the add
  flow; polling hook (`useExtractionJob`), narrated progress.
- [x] **C.2.2** ✅ DONE — Film cards with evidence + per-card list chip + new-list row
  (AI name pre-filled) + search-to-add + save flow + success/empty/failed
  states.
- [x] **C.2.3 (manual web test pending) — — Test:** manual walkthrough on `npm run dev` with 5 real URLs
  (the mini-corpus); typecheck + `npm run build` + full audit suite green.

### C.E — Eval harness (Claude, overlaps C.1c)

- [ ] **C.E.1** `scripts/eval/extraction-eval.ts` + `corpus.json` (~40 real
  URLs labeled with expected films): voiceover countdowns, **silent
  text-overlay montages**, footage-only montages, single-film reviews,
  no-film controls, private/deleted links, one long YouTube essay.
  Runs the live pipeline, prints per-category precision/recall.
  **Ship gate: ≥90% recall on curated-list formats, 0 false positives on
  no-film controls.** Not part of `audit:test` (needs network + paid keys);
  run before C.3 ships and after any prompt/model/actor change.

### C.3 — iOS Share Extension (Claude writes Swift; owner drives Xcode)

- [ ] **C.3.1** App Group (`group.com.cinechrony.shared`) + token relay:
  main app writes the Firebase ID token (+ refresh) to shared storage
  (LAUNCH.md C.2 as spec'd).
- [ ] **C.3.2** Share Extension target: accepts URLs (+ images for the
  screenshot fallback); SwiftUI two-phase UI (progress → confirm) calling
  the same three endpoints; logged-out + no-films states.
- [ ] **C.3.3 — Test:** LAUNCH.md C.3.5's device matrix (real iPhone,
  TikTok/Reel/Short shares, empty, private, screenshot path).

### C.4 — Android share intent (Claude)

- [ ] **C.4.1** `ACTION_SEND` intent-filter (text/URL) → DeepLinkHandler →
  `/extract?url=`. (The whole feature is the web UI from C.2 — this is a
  routing change.) **Test:** share from TikTok Android → confirm screen.

### C.5 — Polish & launch wiring

- [ ] **C.5.1** Haptics + branded save confirmation (LAUNCH.md C.4).
- [ ] **C.5.2** Onboarding "try before signup" reuse (LAUNCH.md C.7) — uses
  this same backend, deferred until after C.3 ships.
- [ ] **C.5.3** Docs: update CLAUDE.md (routes + data model), HANDOFF.md.

---

## Failure UX matrix

| Failure | User sees |
|---|---|
| Private/deleted/region-locked video | "this video isn't accessible — try a screenshot?" |
| All acquisition tiers fail | same as above (tier 4 floor) |
| Video has no films | "no films found in this video" + screenshot CTA |
| Gemini down | keyframe/image+text fallback; if all fail → friendly retry |
| Rate limited | "you've hit today's extraction limit" (envelope `RATE_LIMITED`) |
| Save target not editable | that card shows the error; other saves succeed |

## Cost model (per fresh extraction)

Apify actor run ~$0.002–0.01 · Gemini Flash video ~$0.005–0.03 · TMDB free
→ **≤ ~4¢ worst case**, $0 on cache hits. 50/day/user cap bounds abuse.

## New env vars

`GEMINI_API_KEY` · `GEMINI_MODEL` · `APIFY_TOKEN` · `APIFY_ACTOR_ID`
(+ optional `APIFY_ACTOR_ID_FALLBACK`). Server-side only — never `NEXT_PUBLIC_*`.

---

*Decision history: v1 text-only pipeline spec'd in LAUNCH.md §C.1
(2026-05-25) · redesigned to video-native after research (2026-06-10) ·
stack + UX locked by owner (2026-06-12, this doc).*
