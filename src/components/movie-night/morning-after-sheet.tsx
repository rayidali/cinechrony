'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Drawer } from 'vaul';
import { AlertTriangle, CalendarX, Check, ChevronRight, Moon, Pencil } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { track, AnalyticsEvent } from '@/lib/analytics';
import { ProfileAvatar } from '@/components/profile-avatar';
import { DragToRate } from '@/components/v3/drag-to-rate';
import { NightPoster } from './night-ui';
import { RescheduleFlow } from './reschedule-flow';
import { formatNightDateShort, snoozeMorningAfter } from '@/lib/movie-night-format';
import type { MovieNightView } from '@/lib/movie-night-types';

/**
 * MN25/MN25a/MN25b/MN32 — the morning-after prompt, the most important
 * screen in the whole feature (MOVIE-NIGHT-PLAN.md § S4): the moment a night
 * either becomes the north-star "watched together" record or quietly closes
 * out with zero guilt. Mounted once by `MovieNightProvider`, auto-offered
 * (see there) or opened by the `?night=<id>&after=1` ticker deep link.
 *
 * A tiny internal state machine — 'prompt' (MN25/MN32) → 'watched' (MN25a,
 * a FULLSCREEN portal, matching `how-was-it-sheet.tsx`'s pattern exactly:
 * the note field needs the same keyboard-inset handling, and a Vaul drawer's
 * focus trap is the wrong tool here) or 'didnt' (MN25b, back to a Vaul
 * sheet). Reschedule ("pick a new night") reuses the shared `RescheduleFlow`
 * (MN34) — host-only, matching the server's `action:'reschedule'` gate.
 */

type Step = 'prompt' | 'watched' | 'didnt';

function DetailSkeleton() {
  return (
    <div className="flex flex-col items-center px-6 pb-4 pt-2">
      <div className="h-16 w-16 animate-pulse rounded-[12px] bg-muted" />
      <div className="mt-4 h-[11px] w-[80px] animate-pulse rounded bg-muted" />
      <div className="mt-3 h-[26px] w-[220px] animate-pulse rounded bg-muted" />
      <div className="mt-6 h-[70px] w-full animate-pulse rounded-2xl bg-muted" />
      <div className="mt-3 h-[70px] w-full animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <AlertTriangle className="h-9 w-9 text-muted-foreground" strokeWidth={1.6} />
      <p className="mt-3.5 font-headline text-[18px] font-bold lowercase tracking-[-0.02em] text-foreground">can&apos;t open this</p>
      <p className="mt-1.5 max-w-[220px] font-mono text-[11px] leading-relaxed text-muted-foreground">{message}</p>
    </div>
  );
}

// ── MN25 / MN32 — "did movie night happen?" ──────────────────────────────

function PromptSheet({
  isOpen, night, loading, loadError, onlyHost, othersCount, onNotNow, onWatched, onDidnt,
}: {
  isOpen: boolean;
  night: MovieNightView | null;
  loading: boolean;
  loadError: string | null;
  onlyHost: boolean;
  othersCount: number;
  onNotNow: () => void;
  onWatched: () => void;
  onDidnt: () => void;
}) {
  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onNotNow()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[90] bg-black/55" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[90] flex max-h-[80vh] flex-col rounded-t-[22px] bg-background outline-none">
          <Drawer.Title className="sr-only">last night</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center justify-between px-5 py-2.5">
            <button onClick={() => { haptic('light'); onNotNow(); }} className="font-ui text-[15px] font-semibold text-muted-foreground active:opacity-60">not now</button>
            <span className="font-headline text-[19px] font-bold lowercase tracking-[-0.02em] text-foreground">last night</span>
            <span className="w-[52px]" aria-hidden />
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {loading || !night ? (
              loadError ? <ErrorState message={loadError} /> : <DetailSkeleton />
            ) : (
              <>
                <div className="flex flex-col items-center pt-1 text-center">
                  <div className="w-16"><NightPoster film={night.film} rounded="rounded-[12px]" /></div>
                  <div className="mt-3 cc-eyebrow text-primary">{onlyHost ? 'you set it up' : 'date night'}</div>
                  <div className="mt-2.5 font-headline text-[28px] font-bold leading-[0.95] lowercase tracking-[-0.04em] text-foreground">
                    did movie night<br />happen?
                  </div>
                  <p className="mx-auto mt-3 max-w-[270px] font-serif text-[15px] italic leading-snug text-muted-foreground">
                    {onlyHost
                      ? `looks like it was just you on ${night.film.title.toLowerCase()} last night. all good either way.`
                      : `you and ${othersCount} other${othersCount === 1 ? '' : 's'} were down for ${night.film.title.toLowerCase()} last night.`}
                  </p>
                </div>

                <div className="mt-6 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => { haptic('light'); onWatched(); }}
                    className="flex w-full items-center gap-3.5 rounded-2xl bg-primary p-4 text-left shadow-fab active:scale-[0.99]"
                  >
                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] bg-white/20">
                      <Check className="h-[22px] w-[22px] text-primary-foreground" strokeWidth={2.6} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-headline text-[18px] font-bold lowercase tracking-[-0.025em] text-primary-foreground">we watched it</span>
                      <span className="mt-0.5 block font-ui text-[12.5px] font-medium text-primary-foreground/80">
                        {onlyHost ? 'mark it watched + rate it' : 'mark it watched for everyone + rate it'}
                      </span>
                    </span>
                    <ChevronRight className="h-5 w-5 flex-shrink-0 text-primary-foreground" strokeWidth={2.2} />
                  </button>

                  <button
                    type="button"
                    onClick={() => { haptic('light'); onDidnt(); }}
                    className="flex w-full items-center gap-3.5 rounded-2xl border border-hair bg-card p-4 text-left active:scale-[0.99]"
                  >
                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] bg-sunken">
                      <CalendarX className="h-[21px] w-[21px] text-muted-foreground" strokeWidth={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-headline text-[18px] font-bold lowercase tracking-[-0.025em] text-foreground">it didn&apos;t happen</span>
                      <span className="mt-0.5 block font-ui text-[12.5px] font-medium text-muted-foreground">no worries · pick a new night</span>
                    </span>
                    <ChevronRight className="h-5 w-5 flex-shrink-0 text-faint" strokeWidth={2.2} />
                  </button>
                </div>
              </>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ── MN25a — "how was it?" (fullscreen, matches how-was-it-sheet.tsx) ─────

function WatchedMomentSheet({
  isOpen, night, viewerUid, submitting, error, onClose, onSave,
}: {
  isOpen: boolean;
  night: MovieNightView;
  viewerUid: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (attendeeUids: string[], rating: number | null, note: string) => void;
}) {
  const defaultAttendees = useMemo(() => new Set<string>([
    viewerUid,
    ...night.invitees.filter((i) => i.answer === 'in' || i.answer === 'maybe').map((i) => i.uid),
  ]), [night.invitees, viewerUid]);

  const [attendees, setAttendees] = useState<Set<string>>(defaultAttendees);
  const [editingAttendees, setEditingAttendees] = useState(false);
  const [rating, setRating] = useState<number | null>(8);
  const [note, setNote] = useState('');
  const [kbInset, setKbInset] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isOpen) return;
    setAttendees(defaultAttendees);
    setEditingAttendees(false);
    setRating(8);
    setNote('');
    setKbInset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, night.id]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    const vv = window.visualViewport;
    const onResize = () => { if (vv) setKbInset(Math.max(0, window.innerHeight - vv.height)); };
    onResize();
    vv?.addEventListener('resize', onResize);
    vv?.addEventListener('scroll', onResize);
    return () => {
      document.body.style.overflow = '';
      vv?.removeEventListener('resize', onResize);
      vv?.removeEventListener('scroll', onResize);
    };
  }, [isOpen]);

  if (!isOpen || !mounted) return null;

  function toggleAttendee(uid: string) {
    if (uid === viewerUid) return; // the caller always attends their own completion
    setAttendees((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  }

  const attendeeList = Array.from(attendees);
  const overlapPeople = night.invitees.filter((i) => attendees.has(i.uid));
  const dateLabel = formatNightDateShort(night.scheduledFor, night.tzOffsetMinutes);

  return createPortal(
    <div className="fixed inset-0 z-[95] flex flex-col bg-background" role="dialog" aria-label="how was it?">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-hair px-5 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.625rem)' }}>
        <button onClick={() => { haptic('light'); onClose(); }} className="font-ui text-[15px] font-semibold text-muted-foreground active:opacity-60">skip</button>
        <span className="font-headline text-[18px] font-bold lowercase tracking-[-0.02em]">how was it?</span>
        <button
          disabled={submitting}
          onClick={() => { haptic('success'); onSave(attendeeList, rating, note); }}
          className="font-ui text-[15px] font-bold text-primary active:opacity-60 disabled:opacity-40"
        >
          save
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pt-4" style={{ paddingBottom: Math.max(24, kbInset + 24) }}>
        <div className="flex items-center gap-3.5">
          <div className="w-[44px] flex-shrink-0"><NightPoster film={night.film} rounded="rounded-[10px]" /></div>
          <div className="min-w-0">
            <div className="truncate font-headline text-[20px] font-bold lowercase tracking-tight">{night.film.title}</div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground lowercase">
              marking watched{night.listName ? ` · in ${night.listName.toLowerCase()}` : ''}
            </div>
          </div>
        </div>

        {/* who was there */}
        <div className="mt-5 mb-2 flex items-center justify-between">
          <div className="cc-eyebrow text-muted-foreground">who was there</div>
        </div>
        {editingAttendees ? (
          <div className="rounded-2xl border border-hair bg-card p-2">
            {/* F8 — the toggle list itself only offers invitees the server
             *  will actually accept: 'in'/'maybe' answers, plus the viewer
             *  (always allowed, regardless of their own answer). An 'out'
             *  invitee never appears here to toggle on in the first place. */}
            {night.invitees
              .filter((inv) => inv.uid === viewerUid || inv.answer === 'in' || inv.answer === 'maybe')
              .map((inv) => {
              const on = attendees.has(inv.uid);
              const locked = inv.uid === viewerUid;
              return (
                <button
                  key={inv.uid}
                  type="button"
                  disabled={locked}
                  onClick={() => toggleAttendee(inv.uid)}
                  className="flex w-full items-center gap-3 px-2 py-2.5 text-left disabled:opacity-70"
                >
                  <ProfileAvatar photoURL={inv.photoURL} displayName={inv.displayName} username={inv.username} size="sm" />
                  <span className="min-w-0 flex-1 font-ui text-[14px] font-semibold text-foreground">
                    {locked ? 'you' : (inv.displayName || inv.username || 'friend').toLowerCase()}
                  </span>
                  <span className={`flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full ${on ? 'bg-primary' : 'border-2 border-hair'}`}>
                    {on && <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => { haptic('light'); setEditingAttendees(false); }}
              className="mt-1 flex h-10 w-full items-center justify-center font-ui text-[13.5px] font-bold text-primary active:opacity-60"
            >
              done
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-2xl border border-hair bg-card px-3.5 py-3">
            <div className="flex">
              {overlapPeople.slice(0, 5).map((p, i) => (
                <span key={p.uid} className="rounded-full ring-2 ring-card" style={{ marginLeft: i ? -9 : 0 }}>
                  <ProfileAvatar photoURL={p.photoURL} displayName={p.displayName} username={p.username} size="sm" />
                </span>
              ))}
            </div>
            <span className="flex-1 font-ui text-[13.5px] font-semibold text-foreground">
              {attendees.size === 1 ? 'just you' : `the ${attendees.size} of you`}
            </span>
            <button
              type="button"
              onClick={() => { haptic('light'); setEditingAttendees(true); }}
              className="font-ui text-[13px] font-semibold text-primary active:opacity-60"
            >
              edit
            </button>
          </div>
        )}

        {/* your rating */}
        <div className="mt-5 mb-2">
          <div className="cc-eyebrow text-muted-foreground">your rating</div>
        </div>
        <div className="rounded-2xl border border-hair bg-card p-4 shadow-press">
          <DragToRate value={rating} onChangeComplete={setRating} framed={false} />
        </div>

        {/* optional note */}
        <div className="mt-5">
          <div className="cc-eyebrow text-muted-foreground mb-2">add a note · optional</div>
          <div className="rounded-2xl border border-hair bg-card p-4 shadow-press">
            <textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 220)}px`;
              }}
              maxLength={500}
              rows={3}
              placeholder="worth every one of the minutes…"
              className="w-full resize-none bg-transparent font-serif text-[15.5px] italic leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground/55 caret-primary"
            />
          </div>
        </div>

        {error && <p className="mt-4 text-center font-mono text-[10px] text-destructive">{error}</p>}

        <button
          disabled={submitting}
          onClick={() => { haptic('success'); onSave(attendeeList, rating, note); }}
          className="mt-6 flex h-[52px] w-full items-center justify-center gap-2 rounded-[15px] bg-primary font-headline text-[18px] font-bold lowercase tracking-[-0.02em] text-primary-foreground shadow-fab transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          <Check className="h-5 w-5" strokeWidth={2.4} />
          save it for everyone
        </button>
        <p className="mt-2.5 text-center font-mono text-[10px] leading-relaxed text-muted-foreground">
          adds {night.film.title.toLowerCase()} to all {attendeeList.length} diar{attendeeList.length === 1 ? 'y' : 'ies'} · watched {dateLabel}
        </p>
      </div>
    </div>,
    document.body,
  );
}

// ── MN25b — "that's okay" (didn't happen, zero-guilt) ────────────────────

function DidntHappenSheet({
  isOpen, night, submitting, error, onClose, onPickNewNight, onCloseItOut,
}: {
  isOpen: boolean;
  night: MovieNightView | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onPickNewNight: () => void;
  onCloseItOut: () => void;
}) {
  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[90] bg-black/55" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[90] flex max-h-[64vh] flex-col rounded-t-[22px] bg-background outline-none">
          <Drawer.Title className="sr-only">that&apos;s okay</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center justify-between px-5 py-2.5">
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui text-[15px] font-semibold text-muted-foreground active:opacity-60">close</button>
            <span className="font-headline text-[19px] font-bold lowercase tracking-[-0.02em] text-foreground">that&apos;s okay</span>
            <span className="w-[52px]" aria-hidden />
          </div>
          {night && (
            <div className="flex-1 overflow-y-auto px-6" style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
              <div className="flex flex-col items-center pt-1 text-center">
                <div className="flex h-[66px] w-[66px] items-center justify-center rounded-full border border-hair bg-card">
                  <Moon className="h-7 w-7 text-muted-foreground" strokeWidth={1.7} />
                </div>
                <div className="mt-4.5 font-headline text-[26px] font-bold lowercase leading-[0.98] tracking-[-0.04em] text-foreground">these things happen</div>
                <p className="mx-auto mt-3 max-w-[280px] font-serif text-[15.5px] italic leading-relaxed text-muted-foreground">
                  {night.film.title.toLowerCase()} will keep. no guilt, no missed-plans badge. want to line up another night while you&apos;re thinking about it?
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-2.5">
                {night.viewer.isHost ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => { haptic('light'); onPickNewNight(); }}
                    className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[15px] bg-primary font-headline text-[17px] font-bold lowercase tracking-[-0.02em] text-primary-foreground shadow-fab active:scale-[0.98] disabled:opacity-60"
                  >
                    <Pencil className="h-[18px] w-[18px]" strokeWidth={2.2} />
                    pick a new night
                  </button>
                ) : (
                  <p className="text-center font-mono text-[10.5px] text-muted-foreground">
                    only {night.invitees.find((i) => i.isHost)?.displayName || night.invitees.find((i) => i.isHost)?.username || 'the host'} can pick a new night.
                  </p>
                )}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => { haptic('light'); onCloseItOut(); }}
                  className="flex h-11 w-full items-center justify-center font-ui text-[14px] font-semibold text-muted-foreground active:opacity-60 disabled:opacity-40"
                >
                  {submitting ? 'closing it out…' : 'just close it out'}
                </button>
                {error && <p className="text-center font-mono text-[10px] text-destructive">{error}</p>}
              </div>
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ── root ───────────────────────────────────────────────────────────────

export function MorningAfterFlow({
  nightId, onClose, onOpenNight, onMutated,
}: {
  nightId: string | null;
  onClose: () => void;
  onOpenNight: (id: string) => void;
  onMutated?: () => void;
}) {
  const { user } = useUser();
  const isOpen = !!nightId;
  const [night, setNight] = useState<MovieNightView | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('prompt');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);

  const lastFetchedId = useRef<string | null>(null);

  useEffect(() => {
    if (!nightId) {
      lastFetchedId.current = null;
      return;
    }
    if (lastFetchedId.current === nightId) return;
    lastFetchedId.current = nightId;
    setStep('prompt');
    setError(null);
    setShowReschedule(false);
    setNight(null);
    setLoading(true);
    setLoadError(null);
    let cancelled = false;
    (async () => {
      try {
        const view = await apiCall<MovieNightView>('GET', `/api/v1/movie-nights/${nightId}`);
        if (cancelled) return;
        setNight(view);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof ApiClientError ? err.message : 'could not load this movie night.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [nightId]);

  function closeAll() {
    setStep('prompt');
    onClose();
  }

  function handleNotNow() {
    if (nightId) snoozeMorningAfter(nightId);
    closeAll();
  }

  async function handleSave(attendeeUids: string[], rating: number | null, note: string) {
    if (!night || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiCall('POST', `/api/v1/movie-nights/${night.id}/complete`, {
        attendeeUids,
        rating: rating ?? undefined,
        note: note.trim() || undefined,
      });
      haptic('success');
      track(AnalyticsEvent.MovieNightCompleted, { attendees: attendeeUids.length });
      onMutated?.();
      const id = night.id;
      closeAll();
      onOpenNight(id); // → MN26, the completed detail state
    } catch (err) {
      haptic('error');
      setError(err instanceof ApiClientError ? err.message : 'could not save. try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCloseItOut() {
    if (!night || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiCall('PATCH', `/api/v1/movie-nights/${night.id}`, { action: 'didnt_happen' });
      haptic('light');
      track(AnalyticsEvent.MovieNightMissed, {});
      if (nightId) snoozeMorningAfter(nightId);
      onMutated?.();
      closeAll();
    } catch (err) {
      haptic('error');
      setError(err instanceof ApiClientError ? err.message : 'could not close this out. try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const viewerUid = user?.uid;
  const othersCount = night
    ? night.invitees.filter((i) => i.uid !== viewerUid && (i.answer === 'in' || i.answer === 'maybe')).length
    : 0;
  const onlyHost = !!night
    && night.viewer.isHost
    && night.invitees.filter((i) => i.uid !== viewerUid).every((i) => i.answer === 'out');

  return (
    <>
      <PromptSheet
        isOpen={isOpen && step === 'prompt'}
        night={night}
        loading={loading}
        loadError={loadError}
        onlyHost={onlyHost}
        othersCount={othersCount}
        onNotNow={handleNotNow}
        onWatched={() => setStep('watched')}
        onDidnt={() => setStep('didnt')}
      />

      {night && viewerUid && (
        <WatchedMomentSheet
          isOpen={isOpen && step === 'watched'}
          night={night}
          viewerUid={viewerUid}
          submitting={submitting}
          error={error}
          onClose={() => setStep('prompt')}
          onSave={handleSave}
        />
      )}

      <DidntHappenSheet
        isOpen={isOpen && step === 'didnt'}
        night={night}
        submitting={submitting}
        error={error}
        onClose={() => setStep('prompt')}
        onPickNewNight={() => setShowReschedule(true)}
        onCloseItOut={handleCloseItOut}
      />

      {night && night.viewer.isHost && (
        <RescheduleFlow
          isOpen={showReschedule}
          night={night}
          onClose={() => setShowReschedule(false)}
          onRescheduled={() => {
            onMutated?.();
            const id = night.id;
            setShowReschedule(false);
            closeAll();
            onOpenNight(id); // → the (now active again) detail sheet
          }}
        />
      )}
    </>
  );
}
