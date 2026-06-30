'use client';

/**
 * Phase C.2 — the film-extraction confirmation screen.
 *
 * Flow: paste/share a TikTok·Reel·Short → POST /api/v1/extractions → poll the job
 * (narrated stages) → film cards + a single destination picker (add to an
 * existing list OR create a new one) → save (→ POST /[jobId]/save). The share
 * extension deep-links into this same screen via `?url=`.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from '@/lib/native-nav';
import { ChevronLeft, ChevronDown, Link2, Loader2, X, Check, ListPlus, Sparkles, ScanLine } from 'lucide-react';
import Image from 'next/image';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { ListPickerSheet, type ListDestination, type PickableList } from '@/components/list-picker-sheet';
import { useToast } from '@/hooks/use-toast';
import type { MovieList } from '@/lib/types';
import type { CollaborativeListSummary } from '@/lib/lists-server';
import type { ExtractionJobView, ExtractionFilm } from '@/lib/extraction-types';

type Phase = 'input' | 'processing' | 'result' | 'failed';

const STAGE_LABEL: Record<string, string> = {
  queued: 'getting ready',
  fetching: 'getting the video',
  watching: 'watching it',
  matching: 'matching films',
  done: 'done',
  failed: 'failed',
};
const POSTER_FALLBACK = 'https://picsum.photos/seed/cc-extract/300/450';

export default function ExtractClient() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [url, setUrl] = useState(search.get('url') || '');
  const [phase, setPhase] = useState<Phase>('input');
  const [stage, setStage] = useState('queued');
  const [job, setJob] = useState<ExtractionJobView | null>(null);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [destination, setDestination] = useState<ListDestination>({ kind: 'new' });
  const [newListName, setNewListName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ count: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isUserLoading && !user) router.push('/login');
  }, [user, isUserLoading, router]);

  const listsQuery = useMemoFirebase(
    () => (user ? query(collection(firestore, 'users', user.uid, 'lists'), orderBy('updatedAt', 'desc')) : null),
    [firestore, user],
  );
  const { data: lists } = useCollection<MovieList>(listsQuery);

  // Lists shared WITH the caller (collaborator), so the picker matches the
  // add-to-list drawer and you can save extracted films into a friend's list.
  const [sharedLists, setSharedLists] = useState<CollaborativeListSummary[]>([]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiCall<{ lists: CollaborativeListSummary[] }>('GET', '/api/v1/me/collaborative-lists')
      .then((res) => { if (!cancelled) setSharedLists(res.lists ?? []); })
      .catch(() => { /* picker still works with owned lists only */ });
    return () => { cancelled = true; };
  }, [user]);

  const pickable: PickableList[] = [
    ...(lists || []).map((l) => ({
      id: l.id, name: l.name, ownerId: user?.uid || '', isPublic: l.isPublic,
      movieCount: l.movieCount, coverImageUrl: l.coverImageUrl ?? null,
    })),
    ...sharedLists.map((l) => ({
      id: l.id, name: l.name, ownerId: l.ownerId, isPublic: l.isPublic,
      coverImageUrl: l.coverImageUrl ?? null,
      sharedBy: l.ownerDisplayName || l.ownerUsername || 'a friend',
    })),
  ];

  const finalize = useCallback(
    (j: ExtractionJobView) => {
      setJob(j);
      setStage('done');
      const films = j.films || [];
      if (films.length) {
        setNewListName(j.suggestedListName || 'new films');
        // Default to the user's default list (familiar) — falling back to a new
        // list only if they have none. They can switch to either in the picker.
        const def = (lists || []).find((l) => l.isDefault) || (lists || [])[0];
        setDestination(def && user ? { kind: 'list', ownerId: user.uid, listId: def.id, name: def.name } : { kind: 'new' });
        setRemoved(new Set());
        haptic('success');
      }
      setPhase('result');
    },
    [lists, user],
  );

  const poll = useCallback((jobId: string) => {
    const startedAt = Date.now();
    let attempt = 0;
    const tick = async () => {
      attempt += 1;
      try {
        const j = await apiCall<ExtractionJobView>('GET', `/api/v1/extractions/${jobId}`);
        setStage(j.stage);
        if (j.status === 'done') return finalize(j);
        if (j.status === 'failed') return setPhase('failed');
      } catch {
        /* transient network, keep polling */
      }
      if (Date.now() - startedAt > 3 * 60 * 1000) return setPhase('failed'); // hard cap ~3 min
      // Backoff cuts Firestore read cost at scale (fast at first, then ease off).
      const delay = attempt < 6 ? 1500 : attempt < 14 ? 2500 : 4000;
      pollRef.current = setTimeout(tick, delay);
    };
    tick();
  }, [finalize]);

  const start = useCallback(
    async (rawUrl?: string) => {
      const target = (rawUrl ?? url).trim();
      if (!target || !user) return;
      setPhase('processing');
      setStage('queued');
      setJob(null);
      setSaved(null);
      haptic('medium');
      try {
        const res = await apiCall<{ jobId: string; status: string }>('POST', '/api/v1/extractions', { url: target });
        if (res.status === 'done') {
          const j = await apiCall<ExtractionJobView>('GET', `/api/v1/extractions/${res.jobId}`);
          finalize(j);
        } else {
          poll(res.jobId);
        }
      } catch (err) {
        setPhase('input');
        toast({
          variant: 'destructive',
          title: 'couldn’t scan that link',
          description: err instanceof ApiClientError ? err.message : 'try a tiktok, reel, or youtube link.',
        });
      }
    },
    [url, user, finalize, poll, toast],
  );

  // Auto-start when arriving via a share doorway (`/extract?url=…`).
  useEffect(() => {
    const u = search.get('url');
    if (u) start(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  const films = job?.films || [];
  const toSave = films.filter((f) => !removed.has(f.tmdbId));
  const destLabel = destination.kind === 'new' ? (newListName.trim() || 'new list') : destination.name;

  const resetToInput = () => { setSaved(null); setJob(null); setUrl(''); setPhase('input'); };

  const save = async () => {
    if (!toSave.length || saving || !job || !user) return;
    setSaving(true);
    haptic('medium');
    try {
      const isNew = destination.kind === 'new';
      const body = {
        createLists: isNew ? [{ tempId: 'new', name: newListName.trim() || 'new list' }] : [],
        items: toSave.map((f) => ({
          tmdbId: f.tmdbId,
          mediaType: f.mediaType,
          target: isNew ? { tempId: 'new' } : { ownerId: destination.ownerId, listId: destination.listId },
        })),
      };
      const res = await apiCall<{ results: { ok: boolean }[] }>('POST', `/api/v1/extractions/${job.jobId}/save`, body);
      const ok = res.results.filter((r) => r.ok).length;
      setSaved({ count: ok });
      haptic('success');
    } catch (err) {
      toast({ variant: 'destructive', title: 'couldn’t save', description: err instanceof ApiClientError ? err.message : 'try again.' });
    } finally {
      setSaving(false);
    }
  };

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-background font-ui text-foreground">
      <header
        className="sticky top-0 z-20 flex items-center gap-2 border-b border-hair bg-background/85 px-3 py-2.5 backdrop-blur-md"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)' }}
      >
        <button
          onClick={() => { haptic('light'); router.back(); }}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-full active:bg-foreground/5"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="font-headline text-[19px] font-bold lowercase tracking-[-0.02em]">scan a link</h1>
      </header>

      <div className="mx-auto max-w-2xl px-[18px] pb-32 pt-4">
        {saved ? (
          <SavedState count={saved.count} dest={destLabel} onAgain={resetToInput} onLists={() => router.push('/lists')} />
        ) : phase === 'input' ? (
          <InputState url={url} setUrl={setUrl} onScan={() => start()} />
        ) : phase === 'processing' ? (
          <ProcessingState stage={stage} />
        ) : phase === 'failed' ? (
          <FailedState onRetry={() => start()} onBack={() => setPhase('input')} />
        ) : films.length === 0 ? (
          <EmptyState onAgain={resetToInput} />
        ) : (
          <ResultState
            films={films}
            removed={removed}
            toggleRemove={(id) => setRemoved((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; })}
            destLabel={destLabel}
            isNew={destination.kind === 'new'}
            newListName={newListName}
            setNewListName={setNewListName}
            openPicker={() => { haptic('selection'); setPickerOpen(true); }}
          />
        )}
      </div>

      {/* sticky save bar */}
      {phase === 'result' && films.length > 0 && !saved && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t border-hair bg-background/95 px-[18px] pt-3 backdrop-blur-md"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 14px)' }}
        >
          <div className="mx-auto max-w-2xl">
            <button
              onClick={save}
              disabled={!toSave.length || saving}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-headline text-[16px] font-bold lowercase text-primary-foreground shadow-fab transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
              {saving ? 'saving' : `add ${toSave.length} ${toSave.length === 1 ? 'film' : 'films'}`}
            </button>
          </div>
        </div>
      )}

      <ListPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        lists={pickable}
        current={destination}
        onPick={setDestination}
      />
    </main>
  );
}

// ── sub-views ─────────────────────────────────────────────────────────────────

function InputState({ url, setUrl, onScan }: { url: string; setUrl: (s: string) => void; onScan: () => void }) {
  return (
    <div className="pt-6">
      <div className="mb-5 flex flex-col items-center text-center">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ScanLine className="h-7 w-7" strokeWidth={1.8} />
        </div>
        <h2 className="font-headline text-[24px] font-bold lowercase tracking-[-0.02em]">drop a video link</h2>
        <p className="mt-1.5 max-w-xs font-body text-[15px] text-muted-foreground">
          paste a tiktok, reel, or youtube link and we’ll pull out every film it mentions.
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-[14px] border border-hair bg-sunken px-3.5 h-12">
        <Link2 className="h-[18px] w-[18px] flex-shrink-0 text-muted-foreground" strokeWidth={2} />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onScan(); }}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://…"
          className="flex-1 bg-transparent font-ui text-[15px] outline-none placeholder:text-muted-foreground"
        />
      </div>
      <button
        onClick={onScan}
        disabled={!url.trim()}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-headline text-[16px] font-bold lowercase text-primary-foreground shadow-fab transition-transform active:scale-[0.98] disabled:opacity-50"
      >
        <Sparkles className="h-[18px] w-[18px]" /> scan for films
      </button>
    </div>
  );
}

function ProcessingState({ stage }: { stage: string }) {
  const order = ['fetching', 'watching', 'matching'];
  return (
    <div className="flex flex-col items-center pt-20 text-center">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="mt-5 font-headline text-[20px] font-bold lowercase tracking-[-0.02em]">{STAGE_LABEL[stage] || 'working'}</p>
      <div className="mt-6 flex items-center gap-2">
        {order.map((s) => {
          const active = order.indexOf(stage) >= order.indexOf(s);
          return <span key={s} className={`h-1.5 w-8 rounded-full transition-colors ${active ? 'bg-primary' : 'bg-hair'}`} />;
        })}
      </div>
      <p className="mt-6 max-w-xs font-body text-[14px] text-muted-foreground">
        the ai watches the whole clip, reading the audio, on-screen text, and footage.
      </p>
    </div>
  );
}

/** Per-film match confidence (Gemini's honesty signal). Strong matches are stated
 *  outright in the video; "double-check" ones rest on footage/poster recognition. */
function ConfidenceChip({ confidence }: { confidence: number }) {
  const c = confidence ?? 0;
  if (c >= 0.8) {
    return (
      <span className="rounded bg-success px-1.5 py-px font-mono text-[10px] font-bold uppercase tracking-wide text-success-foreground">
        strong match
      </span>
    );
  }
  if (c >= 0.6) {
    return (
      <span className="rounded bg-secondary px-1.5 py-px font-mono text-[10px] font-bold tabular-nums text-muted-foreground">
        {Math.round(c * 100)}% match
      </span>
    );
  }
  return (
    <span className="rounded bg-secondary px-1.5 py-px font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
      low · double-check
    </span>
  );
}

function ResultState({
  films, removed, toggleRemove, destLabel, isNew, newListName, setNewListName, openPicker,
}: {
  films: ExtractionFilm[];
  removed: Set<number>;
  toggleRemove: (tmdbId: number) => void;
  destLabel: string;
  isNew: boolean;
  newListName: string;
  setNewListName: (s: string) => void;
  openPicker: () => void;
}) {
  const kept = films.filter((f) => !removed.has(f.tmdbId));
  return (
    <div>
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {kept.length} {kept.length === 1 ? 'film' : 'films'} found
      </p>

      {/* destination picker — add to an existing list or create a new one */}
      <button
        onClick={openPicker}
        className="mb-2 flex w-full items-center gap-3 rounded-[16px] border border-hair bg-card px-3.5 py-3 text-left transition-colors active:bg-foreground/[0.03]"
      >
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
          <ListPlus className="h-5 w-5" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">adding to</span>
          <span className="block truncate font-headline text-[16px] font-bold lowercase">{destLabel}</span>
        </span>
        <ChevronDown className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
      </button>

      {isNew && (
        <div className="mb-4 flex items-center gap-2 rounded-[14px] border border-primary/30 bg-primary/[0.04] px-3.5 h-12">
          <ListPlus className="h-[18px] w-[18px] flex-shrink-0 text-primary" strokeWidth={2} />
          <input
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            placeholder="name your new list"
            className="flex-1 bg-transparent font-headline text-[16px] lowercase outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}

      <div className="mt-1 divide-y divide-hair">
        {films.map((f) => {
          if (removed.has(f.tmdbId)) return null;
          const sub = f.year || (f.mediaType === 'tv' ? 'tv series' : 'film');
          return (
            <div key={`${f.mediaType}_${f.tmdbId}`} className="flex items-center gap-3 py-3">
              <div className="relative h-[72px] w-12 flex-shrink-0 overflow-hidden rounded-[10px] bg-sunken">
                <Image src={f.posterUrl || POSTER_FALLBACK} alt={f.title} fill className="object-cover" sizes="48px" unoptimized />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-headline text-[16px] font-bold lowercase tracking-[-0.01em]">{f.title}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-mono text-[11px] text-muted-foreground">{sub}{f.mediaType === 'tv' && f.year ? ' · tv' : ''}</p>
                  {f.imdbRating && (
                    <span className="rounded bg-warning px-1.5 py-px font-mono text-[10px] font-bold tabular-nums text-foreground">
                      IMDb {f.imdbRating}
                    </span>
                  )}
                  <ConfidenceChip confidence={f.confidence} />
                </div>
                {f.evidence?.quote && (
                  <p className="mt-0.5 truncate font-body text-[12.5px] italic text-muted-foreground">“{f.evidence.quote}”</p>
                )}
              </div>
              <button
                onClick={() => { haptic('light'); toggleRemove(f.tmdbId); }}
                aria-label={`Remove ${f.title}`}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-foreground/5"
              >
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ onAgain }: { onAgain: () => void }) {
  return (
    <div className="flex flex-col items-center pt-20 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <ScanLine className="h-7 w-7" strokeWidth={1.8} />
      </div>
      <h2 className="font-headline text-[20px] font-bold lowercase">no films found in this video</h2>
      <p className="mt-1.5 max-w-xs font-body text-[15px] text-muted-foreground">
        try a clip that names or shows movies, like a “top 5”, a review, or a montage.
      </p>
      <button onClick={onAgain} className="mt-5 h-11 rounded-full bg-secondary px-6 font-headline text-[15px] font-semibold lowercase active:scale-[0.97]">
        try another link
      </button>
    </div>
  );
}

function FailedState({ onRetry, onBack }: { onRetry: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center pt-20 text-center">
      <h2 className="font-headline text-[20px] font-bold lowercase">couldn’t scan that video</h2>
      <p className="mt-1.5 max-w-xs font-body text-[15px] text-muted-foreground">
        it might be private or unavailable. try again, or use a different link.
      </p>
      <div className="mt-5 flex gap-2">
        <button onClick={onRetry} className="h-11 rounded-full bg-primary px-6 font-headline text-[15px] font-bold lowercase text-primary-foreground active:scale-[0.97]">
          try again
        </button>
        <button onClick={onBack} className="h-11 rounded-full bg-secondary px-6 font-headline text-[15px] font-semibold lowercase active:scale-[0.97]">
          new link
        </button>
      </div>
    </div>
  );
}

function SavedState({ count, dest, onAgain, onLists }: { count: number; dest: string; onAgain: () => void; onLists: () => void }) {
  return (
    <div className="flex flex-col items-center pt-20 text-center">
      <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Check className="h-8 w-8" strokeWidth={2.2} />
      </div>
      <h2 className="font-headline text-[24px] font-bold lowercase tracking-[-0.02em]">
        added {count} {count === 1 ? 'film' : 'films'}
      </h2>
      <p className="mt-1.5 max-w-xs font-body text-[15px] text-muted-foreground">
        they’re in “{dest}”. the video plays right on each film’s card.
      </p>
      <div className="mt-6 flex gap-2">
        <button onClick={onLists} className="h-11 rounded-full bg-primary px-6 font-headline text-[15px] font-bold lowercase text-primary-foreground active:scale-[0.97]">
          go to lists
        </button>
        <button onClick={onAgain} className="h-11 rounded-full bg-secondary px-6 font-headline text-[15px] font-semibold lowercase active:scale-[0.97]">
          scan another
        </button>
      </div>
    </div>
  );
}
