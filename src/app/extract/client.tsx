'use client';

/**
 * Phase C.2 — the film-extraction confirmation screen.
 *
 * Flow: paste/share a TikTok·Reel·Short → POST /api/v1/extractions → poll the job
 * (narrated stages) → film cards with the receipt + a per-film destination chip →
 * save (→ POST /[jobId]/save). Graceful empty + failed states; auth-gated.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from '@/lib/native-nav';
import { ChevronLeft, Link2, Loader2, X, Check, ListPlus, Sparkles, ScanLine } from 'lucide-react';
import Image from 'next/image';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { SheetMenu, SheetMenuItem, SheetMenuLabel } from '@/components/ui/sheet-menu';
import { useToast } from '@/hooks/use-toast';
import type { MovieList } from '@/lib/types';
import type { ExtractionJobView, ExtractionFilm } from '@/lib/extraction-types';

type Phase = 'input' | 'processing' | 'result' | 'failed';
type Dest = string | 'new' | 'removed'; // listId | the AI-suggested new list | removed

const STAGE_LABEL: Record<string, string> = {
  queued: 'queued…',
  fetching: 'getting the video…',
  watching: 'watching it…',
  matching: 'matching films…',
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
  const [dests, setDests] = useState<Record<number, Dest>>({});
  const [newListName, setNewListName] = useState('');
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
  const defaultListId = (lists || []).find((l) => l.isDefault)?.id || (lists || [])[0]?.id || '';

  const finalize = useCallback(
    (j: ExtractionJobView) => {
      setJob(j);
      setStage('done');
      const films = j.films || [];
      if (films.length) {
        const useNew = !!j.suggestedListName;
        setNewListName(j.suggestedListName || 'new list');
        const d: Record<number, Dest> = {};
        films.forEach((f) => { d[f.tmdbId] = useNew ? 'new' : defaultListId || 'new'; });
        setDests(d);
        haptic('success');
      }
      setPhase('result');
    },
    [defaultListId],
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
        /* transient network — keep polling */
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
          description: err instanceof ApiClientError ? err.message : 'try a TikTok, Reel, or YouTube link.',
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
  const anyNew = films.some((f) => dests[f.tmdbId] === 'new');
  const toSave = films.filter((f) => dests[f.tmdbId] && dests[f.tmdbId] !== 'removed');

  const destLabel = (d: Dest): string => {
    if (d === 'new') return newListName.trim() || 'new list';
    return (lists || []).find((l) => l.id === d)?.name || 'a list';
  };

  const save = async () => {
    if (!toSave.length || saving || !job || !user) return;
    setSaving(true);
    haptic('medium');
    try {
      const body: {
        createLists: { tempId: string; name: string }[];
        items: { tmdbId: number; mediaType: 'movie' | 'tv'; target: { tempId?: string; ownerId?: string; listId?: string } }[];
      } = { createLists: [], items: [] };
      if (anyNew) body.createLists.push({ tempId: 'new', name: newListName.trim() || 'new list' });
      for (const f of toSave) {
        const d = dests[f.tmdbId];
        body.items.push({
          tmdbId: f.tmdbId,
          mediaType: f.mediaType,
          target: d === 'new' ? { tempId: 'new' } : { ownerId: user.uid, listId: d },
        });
      }
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
          <SavedState count={saved.count} onAgain={() => { setSaved(null); setJob(null); setUrl(''); setPhase('input'); }} onLists={() => router.push('/lists')} />
        ) : phase === 'input' ? (
          <InputState url={url} setUrl={setUrl} onScan={() => start()} />
        ) : phase === 'processing' ? (
          <ProcessingState stage={stage} />
        ) : phase === 'failed' ? (
          <FailedState onRetry={() => start()} onBack={() => setPhase('input')} />
        ) : films.length === 0 ? (
          <EmptyState onAgain={() => { setJob(null); setUrl(''); setPhase('input'); }} />
        ) : (
          <ResultState
            films={films}
            dests={dests}
            setDest={(tmdbId, d) => setDests((p) => ({ ...p, [tmdbId]: d }))}
            destLabel={destLabel}
            lists={lists || []}
            anyNew={anyNew}
            newListName={newListName}
            setNewListName={setNewListName}
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
              {saving ? 'saving…' : `save ${toSave.length} ${toSave.length === 1 ? 'film' : 'films'}`}
            </button>
          </div>
        </div>
      )}
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
      <p className="mt-5 font-headline text-[20px] font-bold lowercase tracking-[-0.02em]">{STAGE_LABEL[stage] || 'working…'}</p>
      <div className="mt-6 flex items-center gap-2">
        {order.map((s) => {
          const active = order.indexOf(stage) >= order.indexOf(s);
          return <span key={s} className={`h-1.5 w-8 rounded-full transition-colors ${active ? 'bg-primary' : 'bg-hair'}`} />;
        })}
      </div>
      <p className="mt-6 max-w-xs font-body text-[14px] text-muted-foreground">
        the ai is watching the whole clip — audio, on-screen text, and footage.
      </p>
    </div>
  );
}

function ResultState({
  films, dests, setDest, destLabel, lists, anyNew, newListName, setNewListName,
}: {
  films: ExtractionFilm[];
  dests: Record<number, Dest>;
  setDest: (tmdbId: number, d: Dest) => void;
  destLabel: (d: Dest) => string;
  lists: MovieList[];
  anyNew: boolean;
  newListName: string;
  setNewListName: (s: string) => void;
}) {
  const kept = films.filter((f) => dests[f.tmdbId] !== 'removed');
  return (
    <div>
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {kept.length} {kept.length === 1 ? 'film' : 'films'} found
      </p>

      {anyNew && (
        <div className="mb-4 flex items-center gap-2 rounded-[14px] border border-primary/30 bg-primary/[0.04] px-3.5 h-12">
          <ListPlus className="h-[18px] w-[18px] flex-shrink-0 text-primary" strokeWidth={2} />
          <input
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            placeholder="new list name"
            className="flex-1 bg-transparent font-headline text-[16px] lowercase outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}

      <div className="divide-y divide-hair">
        {films.map((f) => {
          const d = dests[f.tmdbId];
          if (d === 'removed') return null;
          return (
            <div key={`${f.mediaType}_${f.tmdbId}`} className="flex items-center gap-3 py-3">
              <div className="relative h-[72px] w-12 flex-shrink-0 overflow-hidden rounded-[10px] bg-sunken">
                <Image src={f.posterUrl || POSTER_FALLBACK} alt={f.title} fill className="object-cover" sizes="48px" unoptimized />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-headline text-[16px] font-bold lowercase tracking-[-0.01em]">{f.title}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{f.year || '—'}{f.mediaType === 'tv' ? ' · tv' : ''}</p>
                {f.evidence?.quote && (
                  <p className="mt-0.5 truncate font-body text-[12.5px] italic text-muted-foreground">“{f.evidence.quote}”</p>
                )}
                {/* destination chip */}
                <SheetMenu
                  title="add to"
                  trigger={(open) => (
                    <button
                      onClick={open}
                      className="mt-1 inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-foreground active:opacity-70"
                    >
                      <ListPlus className="h-3 w-3" /> {destLabel(d)}
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <SheetMenuItem icon={ListPlus} active={d === 'new'} onSelect={() => { setDest(f.tmdbId, 'new'); close(); }}>
                        new list{newListName ? `: ${newListName}` : ''}
                      </SheetMenuItem>
                      {lists.length > 0 && <SheetMenuLabel>your lists</SheetMenuLabel>}
                      {lists.map((l) => (
                        <SheetMenuItem key={l.id} active={d === l.id} onSelect={() => { setDest(f.tmdbId, l.id); close(); }}>
                          {l.name}
                        </SheetMenuItem>
                      ))}
                    </>
                  )}
                </SheetMenu>
              </div>
              <button
                onClick={() => { haptic('light'); setDest(f.tmdbId, 'removed'); }}
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
        try a clip that names or shows movies — a “top 5”, a review, or a montage.
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

function SavedState({ count, onAgain, onLists }: { count: number; onAgain: () => void; onLists: () => void }) {
  return (
    <div className="flex flex-col items-center pt-20 text-center">
      <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Check className="h-8 w-8" strokeWidth={2.2} />
      </div>
      <h2 className="font-headline text-[24px] font-bold lowercase tracking-[-0.02em]">
        saved {count} {count === 1 ? 'film' : 'films'}
      </h2>
      <p className="mt-1.5 font-body text-[15px] text-muted-foreground">the video plays right on each film’s card.</p>
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
