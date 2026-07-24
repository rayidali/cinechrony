'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Drawer } from 'vaul';
import {
  AlertTriangle, Bell, Calendar, CalendarDays, CalendarPlus, CalendarX,
  Check, ChevronRight, CircleHelp, Clock, Crown, Pencil, X, type LucideIcon,
} from 'lucide-react';

import { useUser } from '@/firebase';
import { apiCall, ApiClientError, apiOrigin } from '@/lib/api-client';
import { shareOrigin } from '@/lib/share';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { track, AnalyticsEvent } from '@/lib/analytics';
import { useViewportHeight } from '@/hooks/use-viewport-height';
import { ProfileAvatar } from '@/components/profile-avatar';
import { NightHeroCTA, NightPoster, nightFilmMeta } from './night-ui';
import { RescheduleFlow } from './reschedule-flow';
import {
  CompletedBlock, AttendeeRatingsRail, ShareNightRow, DidntHappenBlock, RescheduledBlock, RescheduledInBar,
} from './night-past-blocks';
import {
  formatNightDate, formatNightDateShort, formatNightTime, formatNightWeekdayFull,
} from '@/lib/movie-night-format';
import type { MovieNightInviteeView, MovieNightView, RsvpAnswer } from '@/lib/movie-night-types';

/**
 * MN10 — the movie-night detail sheet (MOVIE-NIGHT-PLAN.md § S3b). Mounted
 * once by `MovieNightProvider`, keyed on `openNightId` — fetches its own
 * data on open (the `?night=` deep link and every in-app "see the night" /
 * card tap all funnel through the same `openNight(id)` call). Slotted UNDER
 * the create sheet in the z-index ladder (z-90 — create sheet is 91+) so a
 * future "see the night" transition from create → detail can layer cleanly.
 *
 * Nested overlays (all mutually exclusive host actions, so a shared z tier
 * is safe): the reschedule flow (`reschedule-flow.tsx`) reuses S3a's
 * `DateTimeSheet`/`TimeEntrySheet` (z-93/94, unchanged) at z-92 for its own
 * wrapper-free mount; the cancel confirm and add-to-calendar sheets sit at
 * z-92 too. S4 adds the lifecycle "after" states (MN26/27/28) via
 * `night-past-blocks.tsx`.
 */

function timeSplit(label: string): [string, string] {
  const parts = label.split(' ');
  return [parts[0] ?? label, parts[1] ?? ''];
}

// ── skeleton (MN18) ─────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="flex flex-col items-center px-5 pb-4 pt-1">
      <div className="h-[138px] w-[92px] animate-pulse rounded-[13px] bg-muted" />
      <div className="mt-4 h-[22px] w-[150px] animate-pulse rounded-md bg-muted" />
      <div className="mt-2.5 h-[11px] w-[90px] animate-pulse rounded bg-muted" />
      <div className="mt-6 h-[110px] w-full animate-pulse rounded-2xl bg-muted" />
      <div className="mt-4 h-[13px] w-[160px] animate-pulse rounded bg-muted" />
      <div className="mt-6 flex w-full gap-3.5 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-shrink-0 flex-col items-center gap-2">
            <div className="h-[46px] w-[46px] animate-pulse rounded-full bg-muted" />
            <div className="h-[9px] w-[34px] animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="mt-7 h-11 w-full animate-pulse rounded-2xl bg-muted" />
      <div className="mt-6 flex w-full gap-2.5">
        <div className="h-[52px] flex-[1.4] animate-pulse rounded-[15px] bg-muted" />
        <div className="h-[52px] flex-1 animate-pulse rounded-[15px] bg-muted" />
        <div className="h-[52px] flex-1 animate-pulse rounded-[15px] bg-muted" />
      </div>
    </div>
  );
}

function DetailErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <AlertTriangle className="h-10 w-10 text-muted-foreground" strokeWidth={1.6} />
      <p className="mt-4 font-headline text-[19px] font-bold lowercase tracking-[-0.02em] text-foreground">
        can&apos;t open this night
      </p>
      <p className="mt-1.5 max-w-[240px] font-mono text-[11px] leading-relaxed text-muted-foreground">{message}</p>
    </div>
  );
}

// ── MN21 — film removed notice (SKIPPED trigger — see TODO below) ───────

function FilmRemovedNotice({ title }: { title: string }) {
  return (
    <div className="mt-1 flex items-center gap-3.5 rounded-2xl border border-destructive/30 bg-destructive/10 p-3.5">
      <div className="w-[46px] flex-shrink-0"><NightPoster film={null} rounded="rounded-[8px]" /></div>
      <div className="min-w-0 flex-1">
        <div className="font-headline text-[16px] font-bold lowercase tracking-[-0.025em] text-foreground">the film&apos;s gone</div>
        <p className="mt-1 font-serif text-[13.5px] italic leading-snug text-muted-foreground">
          {title} was removed from the list. pick another before the night.
        </p>
      </div>
    </div>
  );
}

// ── WHO'S IN — invitee rail (uid invitees + name-only guests) ───────────

type RsvpRailStatus = 'in' | 'maybe' | 'out' | 'none';

const RAIL_META: Record<RsvpRailStatus, { Icon: LucideIcon; dotClass: string; textClass: string; label: string }> = {
  in: { Icon: Check, dotClass: 'bg-success', textClass: 'text-success', label: 'going' },
  maybe: { Icon: CircleHelp, dotClass: 'bg-warning', textClass: 'text-warning', label: 'maybe' },
  out: { Icon: X, dotClass: 'bg-destructive', textClass: 'text-destructive', label: "can't" },
  none: { Icon: Clock, dotClass: 'bg-faint', textClass: 'text-faint', label: 'no answer' },
};

type RailPerson = {
  key: string;
  name: string;
  status: RsvpRailStatus;
  isHost: boolean;
  isMe: boolean;
  photoURL?: string | null;
  username?: string | null;
};

function InviteeChip({ person }: { person: RailPerson }) {
  const meta = RAIL_META[person.status];
  const Icon = person.isHost ? Crown : meta.Icon;
  const dim = person.status === 'out' && !person.isHost;
  return (
    <div className="w-[62px] flex-shrink-0 text-center">
      <div className={cn('relative mx-auto h-[46px] w-[46px]', dim && 'opacity-55')}>
        <ProfileAvatar
          photoURL={person.photoURL}
          displayName={person.name}
          username={person.username}
          size="md"
          className={person.isHost || person.isMe ? 'ring-2 ring-background' : ''}
        />
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 flex h-[19px] w-[19px] items-center justify-center rounded-full border-[2.5px] border-background',
            person.isHost ? 'bg-foreground' : meta.dotClass,
          )}
        >
          <Icon className="h-[10px] w-[10px] text-background" strokeWidth={2.8} />
        </span>
      </div>
      <div className="mt-1.5 truncate font-ui text-[11.5px] font-semibold text-foreground">
        {person.isMe ? 'you' : person.name.toLowerCase()}
      </div>
      <div className={cn('mt-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em]', person.isHost ? 'text-muted-foreground' : meta.textClass)}>
        {person.isHost ? 'host' : meta.label}
      </div>
    </div>
  );
}

function InviteeRail({ people }: { people: RailPerson[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto px-5 pb-1 scrollbar-hide">
      {people.map((p) => <InviteeChip key={p.key} person={p} />)}
    </div>
  );
}

function railPeopleFor(night: MovieNightView, viewerUid: string | undefined): RailPerson[] {
  const invitees: RailPerson[] = night.invitees.map((inv: MovieNightInviteeView) => ({
    key: `u_${inv.uid}`,
    name: inv.displayName || inv.username || 'friend',
    status: inv.isHost ? 'in' : (inv.answer ?? 'none'),
    isHost: inv.isHost,
    isMe: inv.uid === viewerUid,
    photoURL: inv.photoURL,
    username: inv.username,
  }));
  const guests: RailPerson[] = night.guestRsvps.map((g) => ({
    key: `g_${g.guestId}`,
    name: g.name,
    status: g.answer,
    isHost: false,
    isMe: false,
  }));
  return [...invitees, ...guests];
}

/** Mirrors the design's MN19/MN20 edge copy — derived honestly from the real
 *  counts rather than a separate hardcoded "variant" flag. */
function tallyText(counts: MovieNightView['counts'], total: number): { text: string; faint: boolean } {
  if (total <= 1) return { text: 'just you for now', faint: true };
  if (counts.going === 1 && counts.maybe === 0 && counts.waiting === 0 && counts.out === total - 1) {
    return { text: `everyone's out · just ${counts.going} in`, faint: false };
  }
  if (counts.going === 1 && counts.maybe === 0 && counts.out === 0 && counts.waiting === total - 1) {
    return { text: "nobody's answered yet", faint: true };
  }
  return { text: `${counts.going} going · ${counts.maybe} maybe · ${counts.out} can't · ${counts.waiting} waiting`, faint: false };
}

// ── MN11 / MN11a — the RSVP choice + press feedback ──────────────────────

function RsvpButtons({ submittingAnswer, onPick }: { submittingAnswer: RsvpAnswer | null; onPick: (a: RsvpAnswer) => void }) {
  const busy = submittingAnswer !== null;
  const btn = (label: string, kind: RsvpAnswer) => {
    const primary = kind === 'in';
    const pressed = submittingAnswer === kind;
    const dimmed = busy && !pressed;
    return (
      <button
        key={kind}
        type="button"
        disabled={busy}
        onClick={() => onPick(kind)}
        className={cn(
          'flex h-[52px] items-center justify-center gap-1.5 rounded-[15px] font-headline lowercase tracking-[-0.02em] transition-all duration-150',
          primary ? 'flex-[1.4] text-[17px] font-bold bg-primary text-primary-foreground' : 'flex-1 border border-border text-[14.5px] font-bold text-foreground',
          primary && !pressed && 'shadow-fab',
          pressed && 'scale-[0.96]',
          dimmed && 'opacity-50',
        )}
      >
        {primary && <Check className="h-[19px] w-[19px]" strokeWidth={2.6} />}
        {label}
      </button>
    );
  };
  return <div className="flex gap-2.5">{btn("i'm in", 'in')}{btn('maybe', 'maybe')}{btn("can't", 'out')}</div>;
}

// ── MN12 — settled bar ────────────────────────────────────────────────────

const SETTLED_TINT: Record<RsvpAnswer, string> = {
  in: 'border-success bg-success/10',
  maybe: 'border-warning bg-warning/10',
  out: 'border-destructive bg-destructive/10',
};
const SETTLED_DOT: Record<RsvpAnswer, string> = {
  in: 'bg-success', maybe: 'bg-warning', out: 'bg-destructive',
};
const SETTLED_LABEL: Record<RsvpAnswer, string> = {
  in: "you're in", maybe: "you're a maybe", out: "you're out",
};
const SETTLED_SUB: Record<RsvpAnswer, string> = {
  in: "we'll remind you before showtime",
  maybe: "we'll nudge you again closer to the night",
  out: 'no worries. you can still change your mind',
};

function SettledBar({ answer, onChangeAnswer }: { answer: RsvpAnswer; onChangeAnswer: () => void }) {
  const Icon = answer === 'in' ? Check : answer === 'maybe' ? CircleHelp : X;
  return (
    <div>
      <div className={cn('flex h-[52px] items-center gap-3 rounded-[15px] border px-4', SETTLED_TINT[answer])}>
        <span className={cn('flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full', SETTLED_DOT[answer])}>
          <Icon className="h-4 w-4 text-white" strokeWidth={2.8} />
        </span>
        <span className="flex-1 font-headline text-[18px] font-bold lowercase tracking-[-0.03em] text-foreground">{SETTLED_LABEL[answer]}</span>
        <button
          type="button"
          onClick={() => { haptic('light'); onChangeAnswer(); }}
          className="flex h-11 flex-shrink-0 items-center font-ui text-[13.5px] font-semibold text-primary active:opacity-60"
        >
          change my answer
        </button>
      </div>
      <p className="mt-2 text-center font-mono text-[10px] text-muted-foreground">{SETTLED_SUB[answer]}</p>
    </div>
  );
}

// ── MN13 — host footer ────────────────────────────────────────────────────

function HostFooter({ onEdit, onCancel }: { onEdit: () => void; onCancel: () => void }) {
  return (
    <div>
      <button
        type="button"
        onClick={() => { haptic('light'); onEdit(); }}
        className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[15px] bg-primary font-headline text-[17px] font-bold lowercase tracking-[-0.02em] text-primary-foreground shadow-fab active:scale-[0.98]"
      >
        <Pencil className="h-[18px] w-[18px]" strokeWidth={2.2} />
        edit time &amp; details
      </button>
      <div className="mt-1 flex min-h-11 items-center justify-center gap-4">
        <span className="inline-flex items-center gap-1.5 font-ui text-[13.5px] font-semibold text-muted-foreground opacity-70">
          <Bell className="h-[15px] w-[15px]" strokeWidth={2} />
          nudge the group
          <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-faint">coming soon</span>
        </span>
        <span className="h-[3px] w-[3px] flex-shrink-0 rounded-full bg-faint" aria-hidden />
        <button
          type="button"
          onClick={() => { haptic('light'); onCancel(); }}
          className="flex h-11 flex-shrink-0 items-center gap-1.5 font-ui text-[13.5px] font-semibold text-destructive active:opacity-60"
        >
          <X className="h-[15px] w-[15px]" strokeWidth={2.2} />
          cancel
        </button>
      </div>
    </div>
  );
}

// ── MN13a — host cancel confirmation ──────────────────────────────────────

function cancelBlurb(night: MovieNightView): string {
  const others = night.invitees.filter((i) => !i.isHost).map((i) => i.displayName || i.username || 'them');
  const names = [...others, ...night.guestRsvps.map((g) => g.name)];
  if (names.length === 0) return "this can't be undone.";
  if (names.length === 1) return `we'll let ${names[0]} know. this can't be undone.`;
  if (names.length === 2) return `we'll let ${names[0]} and ${names[1]} know. this can't be undone.`;
  return `we'll let ${names[0]}, ${names[1]} and everyone else know. this can't be undone.`;
}

function CancelConfirmModal({
  isOpen, night, submitting, error, onConfirm, onKeep,
}: {
  isOpen: boolean;
  night: MovieNightView | null;
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!isOpen || !mounted || !night) return null;

  return createPortal(
    <div className="fixed inset-0 z-[92] flex items-center justify-center bg-black/50 px-6" role="dialog" aria-label="cancel movie night?">
      <div className="w-full max-w-[340px] rounded-[24px] border border-hair bg-background p-6 pb-5 shadow-lift">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <CalendarX className="h-[26px] w-[26px] text-destructive" strokeWidth={2} />
        </div>
        <div className="mt-4 text-center">
          <div className="font-headline text-[24px] font-bold lowercase leading-[0.98] tracking-[-0.035em] text-foreground">cancel movie night?</div>
          <p className="mx-auto mt-2.5 max-w-[250px] font-serif text-[15px] italic leading-snug text-muted-foreground">{cancelBlurb(night)}</p>
        </div>
        <button
          type="button"
          disabled={submitting}
          onClick={() => { haptic('medium'); onConfirm(); }}
          className="mt-5 h-[50px] w-full rounded-2xl bg-destructive font-headline text-[16px] font-bold lowercase tracking-[-0.02em] text-destructive-foreground active:scale-[0.98] disabled:opacity-60"
        >
          {submitting ? 'cancelling…' : 'cancel the night'}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => { haptic('light'); onKeep(); }}
          className="mt-2 h-12 w-full rounded-2xl border border-border font-ui text-[15px] font-semibold text-foreground active:opacity-70"
        >
          keep it
        </button>
        {error && <p className="mt-3 text-center font-mono text-[10px] text-destructive">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}

// ── MN17 — add to calendar ────────────────────────────────────────────────

function CalendarOptionRow({
  label, icon: Icon, desc, onTap,
}: { label: string; icon: LucideIcon; desc: string; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-center gap-3.5 rounded-2xl border border-hair bg-card px-4 py-3.5 text-left active:scale-[0.99]"
    >
      <span className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-xl bg-sunken">
        <Icon className="h-5 w-5 text-foreground" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-headline text-[15.5px] font-bold lowercase tracking-[-0.02em] text-foreground">{label}</span>
        <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{desc}</span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] flex-shrink-0 text-faint" strokeWidth={1.8} />
    </button>
  );
}

function toGCalUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function AddToCalendarSheet({ isOpen, night, onClose }: { isOpen: boolean; night: MovieNightView | null; onClose: () => void }) {
  const dateLabel = night ? formatNightDate(night.scheduledFor, night.tzOffsetMinutes) : '';
  const timeLabel = night ? formatNightTime(night.scheduledFor, night.tzOffsetMinutes) : '';
  const runtimeLabel = night?.film.runtime
    ? (() => {
        const h = Math.floor(night.film.runtime! / 60);
        const m = night.film.runtime! % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
      })()
    : null;

  function handleApple() {
    if (!night?.shareCode) return;
    haptic('light');
    window.open(`${apiOrigin()}/api/v1/movie-nights/shared/${night.shareCode}/calendar.ics`, '_blank');
  }

  function handleGoogle() {
    if (!night) return;
    haptic('light');
    const start = new Date(night.scheduledFor);
    const durationMinutes = night.film.runtime ? night.film.runtime + 30 : 180;
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    const shareUrl = night.shareCode ? `${shareOrigin()}/n/${night.shareCode}` : shareOrigin();
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `movie night: ${night.film.title}`,
      dates: `${toGCalUtc(start)}/${toGCalUtc(end)}`,
      details: `hosted on cinechrony. rsvp and details: ${shareUrl}`,
    });
    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank');
  }

  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[92] bg-black/60" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[92] flex max-h-[56vh] flex-col rounded-t-[22px] bg-background outline-none">
          <Drawer.Title className="sr-only">add to calendar</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center justify-between px-5 py-2.5">
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui text-[15px] font-semibold text-muted-foreground active:opacity-60">cancel</button>
            <span className="font-headline text-[19px] font-bold lowercase tracking-[-0.02em] text-foreground">add to calendar</span>
            <span className="w-[52px]" aria-hidden />
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {night && (
              <div className="flex items-center gap-3 pb-4">
                <div className="w-[38px] flex-shrink-0"><NightPoster film={night.film} rounded="rounded-[7px]" /></div>
                <div className="min-w-0">
                  <div className="truncate font-headline text-[16px] font-bold lowercase tracking-[-0.025em] text-foreground">{night.film.title}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {dateLabel} · {timeLabel}{runtimeLabel ? ` · ${runtimeLabel}` : ''}
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              <CalendarOptionRow label="apple calendar" icon={Calendar} desc="adds to your default apple calendar" onTap={handleApple} />
              <CalendarOptionRow label="google calendar" icon={CalendarDays} desc="opens google calendar to confirm" onTap={handleGoogle} />
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ── MN10 — the detail sheet (root) ────────────────────────────────────────

function applyOptimisticRsvp(night: MovieNightView, viewerUid: string, answer: RsvpAnswer): MovieNightView {
  const nowIso = new Date().toISOString();
  const invitees = night.invitees.map((inv) => (inv.uid === viewerUid ? { ...inv, answer, respondedAt: nowIso } : inv));
  const counts = { going: 0, maybe: 0, out: 0, waiting: 0 };
  for (const inv of invitees) {
    if (inv.answer === 'in') counts.going++;
    else if (inv.answer === 'maybe') counts.maybe++;
    else if (inv.answer === 'out') counts.out++;
    else counts.waiting++;
  }
  for (const g of night.guestRsvps) {
    if (g.answer === 'in') counts.going++;
    else if (g.answer === 'maybe') counts.maybe++;
    else counts.out++;
  }
  return { ...night, invitees, counts, viewer: { ...night.viewer, answer } };
}

export function NightDetailSheet({
  nightId, onClose, onMutated,
}: { nightId: string | null; onClose: () => void; onMutated?: () => void }) {
  const { user } = useUser();
  const isOpen = !!nightId;
  const height = useViewportHeight(95);
  const heightStyle = height > 0 ? `${height}px` : 'calc(95 * var(--dvh, 1vh))';

  const [night, setNight] = useState<MovieNightView | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [submittingAnswer, setSubmittingAnswer] = useState<RsvpAnswer | null>(null);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [forceShowButtons, setForceShowButtons] = useState(false);

  const [showAddCalendar, setShowAddCalendar] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const lastFetchedId = useRef<string | null>(null);

  // Fetch on open (and on every distinct nightId — including a re-open of
  // the same id after it closed, since RSVPs elsewhere may have changed it).
  useEffect(() => {
    if (!nightId) {
      lastFetchedId.current = null;
      return;
    }
    if (lastFetchedId.current === nightId && night) return;
    lastFetchedId.current = nightId;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setNight(null);
    setForceShowButtons(false);
    setRsvpError(null);
    setShowAddCalendar(false);
    setShowReschedule(false);
    setShowCancelConfirm(false);
    setCancelError(null);
    (async () => {
      try {
        const view = await apiCall<MovieNightView>('GET', `/api/v1/movie-nights/${nightId}`);
        if (cancelled) return;
        setNight(view);
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiClientError
            ? (err.code === 'FORBIDDEN' ? "you don't have access to this movie night." : err.message)
            : 'could not load this movie night.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nightId]);

  async function handleRsvp(answer: RsvpAnswer) {
    if (!night || submittingAnswer || !user?.uid) return;
    const snapshot = night;
    haptic('light');
    setSubmittingAnswer(answer);
    setRsvpError(null);
    setForceShowButtons(false);
    setNight(applyOptimisticRsvp(night, user.uid, answer));
    try {
      const updated = await apiCall<MovieNightView>('POST', `/api/v1/movie-nights/${night.id}/rsvp`, { answer });
      haptic('success');
      setNight(updated);
      track(AnalyticsEvent.MovieNightRsvp, { answer, surface: 'detail' });
      onMutated?.();
    } catch (err) {
      haptic('error');
      setNight(snapshot);
      setRsvpError(err instanceof ApiClientError ? err.message : 'could not save your answer. try again.');
    } finally {
      setSubmittingAnswer(null);
    }
  }

  async function handleCancel() {
    if (!night) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const updated = await apiCall<MovieNightView>('PATCH', `/api/v1/movie-nights/${night.id}`, { action: 'cancel' });
      haptic('success');
      setNight(updated);
      onMutated?.();
      setShowCancelConfirm(false);
      onClose();
    } catch (err) {
      haptic('error');
      setCancelError(err instanceof ApiClientError ? err.message : 'could not cancel. try again.');
    } finally {
      setCancelling(false);
    }
  }

  const railPeople = useMemo(() => (night ? railPeopleFor(night, user?.uid) : []), [night, user?.uid]);
  const peopleCount = night ? night.invitees.length + night.guestRsvps.length : 0;
  const tally = night ? tallyText(night.counts, peopleCount) : null;

  const hostInvitee = night?.invitees.find((i) => i.isHost) ?? null;
  const hostLabel = night?.viewer.isHost
    ? 'you'
    : hostInvitee?.username
      ? `@${hostInvitee.username}`
      : hostInvitee?.displayName || 'the host';
  const listSuffix = night?.listName ? ` · ${night.listName.toLowerCase()}` : '';

  // TODO(future slice): once the server tracks a film being removed from the
  // night's underlying list, plumb `filmRemoved` onto `MovieNightView` and
  // drop this defensive cast — S1's wire contract doesn't carry it today, so
  // this can never actually be true yet. Built honestly per the plan: the
  // visual exists, the (currently impossible) trigger doesn't.
  const filmRemoved = night ? (night as unknown as { filmRemoved?: boolean }).filmRemoved === true : false;

  const isActive = night?.status === 'proposed';
  const isCompleted = night?.status === 'completed';
  const isDidntHappen = night?.status === 'didnt_happen';
  // MN28 — still active, but the host moved it. RSVPs survive a reschedule
  // ("same crew"), so an invitee who was already 'in' gets the friendly
  // re-confirm bar instead of the plain settled bar.
  const justRescheduled = isActive && !!night?.previousScheduledFor;
  const [timeMain, timeAmpm] = night ? timeSplit(formatNightTime(night.scheduledFor, night.tzOffsetMinutes)) : ['', ''];

  let footer: React.ReactNode = null;
  if (night && isActive) {
    if (night.viewer.isHost) {
      footer = <HostFooter onEdit={() => { haptic('light'); setShowReschedule(true); }} onCancel={() => { haptic('light'); setShowCancelConfirm(true); }} />;
    } else if (justRescheduled && night.viewer.answer === 'in' && !forceShowButtons) {
      footer = <RescheduledInBar submitting={submittingAnswer !== null} onConfirm={() => handleRsvp('in')} onChangeAnswer={() => setForceShowButtons(true)} />;
    } else if (night.viewer.answer && !forceShowButtons) {
      footer = <SettledBar answer={night.viewer.answer} onChangeAnswer={() => setForceShowButtons(true)} />;
    } else {
      footer = <RsvpButtons submittingAnswer={submittingAnswer} onPick={handleRsvp} />;
    }
  } else if (night && isCompleted) {
    footer = <ShareNightRow />;
  } else if (night && isDidntHappen) {
    footer = night.viewer.isHost ? (
      <NightHeroCTA
        label="pick a new night"
        icon={CalendarPlus}
        onTap={() => { haptic('light'); setShowReschedule(true); }}
      />
    ) : (
      <div className="rounded-2xl border border-hair bg-sunken px-4 py-3.5 text-center">
        <p className="font-mono text-[11px] text-muted-foreground">waiting on {hostLabel} to pick a new night.</p>
      </div>
    );
  } else if (night) {
    // cancelled — the only status with no dedicated S4 lifecycle screen.
    footer = (
      <div className="rounded-2xl border border-hair bg-sunken px-4 py-3.5 text-center">
        <p className="font-mono text-[11px] text-muted-foreground">this movie night was cancelled.</p>
      </div>
    );
  }

  return (
    <>
      <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[90] bg-black/55" />
          <Drawer.Content
            className="fixed bottom-0 left-0 right-0 z-[90] flex flex-col rounded-t-[22px] bg-background outline-none"
            style={{ height: heightStyle, maxHeight: heightStyle }}
          >
            <Drawer.Title className="sr-only">movie night</Drawer.Title>
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <div className="flex items-center justify-between px-5 py-2.5">
              <button onClick={() => { haptic('light'); onClose(); }} className="font-ui text-[15px] font-semibold text-muted-foreground active:opacity-60">close</button>
              <span className="font-headline text-[19px] font-bold lowercase tracking-[-0.02em] text-foreground">movie night</span>
              <span className="w-[52px]" aria-hidden />
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading || !night ? (
                loadError ? <DetailErrorState message={loadError} /> : <DetailSkeleton />
              ) : (
                <div className="px-5 pb-5">
                  {filmRemoved ? (
                    <FilmRemovedNotice title={night.film.title} />
                  ) : (
                    <div className="flex flex-col items-center pb-0.5 pt-1 text-center">
                      <div className="w-24"><NightPoster film={night.film} rounded="rounded-[13px]" /></div>
                      <div className="mt-3.5 font-headline text-[24px] font-bold lowercase leading-[0.95] tracking-[-0.04em] text-foreground">{night.film.title}</div>
                      {nightFilmMeta(night.film) && (
                        <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">{nightFilmMeta(night.film)}</div>
                      )}
                    </div>
                  )}

                  {/* MN26 — watched together (completed) / MN27 — didn't happen record.
                      Both REPLACE the big date/time hero (the block itself carries the
                      date); MN28's rescheduled notice is additive and shown further
                      down, since the night is still active and the hero above still
                      shows the correct (new) date/time. */}
                  {isCompleted ? (
                    <CompletedBlock night={night} />
                  ) : isDidntHappen ? (
                    <DidntHappenBlock night={night} />
                  ) : (
                    <div className="my-5 border-y border-hair py-5 text-center">
                      <div className="font-mono text-[10.5px] font-bold uppercase tracking-[0.22em] text-primary">
                        {formatNightWeekdayFull(night.scheduledFor, night.tzOffsetMinutes)}
                      </div>
                      <div className="mt-2 flex items-baseline justify-center gap-2.5">
                        <span className="font-headline text-[62px] font-bold leading-[0.9] tracking-[-0.04em] tabular-nums text-foreground">{timeMain}</span>
                        <span className="font-mono text-[24px] font-bold text-muted-foreground">{timeAmpm}</span>
                      </div>
                      <div className="mt-1.5 font-mono text-[12.5px] font-bold tracking-[0.04em] tabular-nums text-muted-foreground">
                        {formatNightDateShort(night.scheduledFor, night.tzOffsetMinutes)}
                      </div>
                    </div>
                  )}

                  {/* host attribution */}
                  <div className="flex items-center justify-center gap-2.5">
                    <ProfileAvatar photoURL={hostInvitee?.photoURL} displayName={hostInvitee?.displayName} username={hostInvitee?.username} size="sm" />
                    <span className="font-ui text-[13.5px] font-semibold text-muted-foreground">
                      hosted by <b className="font-bold text-foreground">{hostLabel}</b>{listSuffix}
                    </span>
                  </div>

                  {/* MN28 — the amber "rescheduled" notice, additive on an active night */}
                  {justRescheduled && (
                    <div className="mt-5"><RescheduledBlock night={night} /></div>
                  )}

                  {/* who's in / how you rated it / who was invited */}
                  <div className={cn('mb-3 flex items-baseline justify-between px-0', justRescheduled ? 'mt-0' : 'mt-6')}>
                    <span className="cc-eyebrow text-muted-foreground">
                      {isCompleted ? 'how you rated it' : isDidntHappen ? 'who was invited' : "who's in"}
                    </span>
                    {!isCompleted && <span className="font-mono text-[9.5px] text-muted-foreground">{peopleCount} invited</span>}
                  </div>
                  {isCompleted ? (
                    <AttendeeRatingsRail night={night} viewerUid={user?.uid} />
                  ) : (
                    <>
                      <div className="-mx-5"><InviteeRail people={railPeople} /></div>
                      {tally && (
                        <p className={cn('mt-3 text-center font-mono text-[10.5px]', tally.faint ? 'text-faint' : 'text-muted-foreground')}>{tally.text}</p>
                      )}
                    </>
                  )}

                  {/* add to calendar */}
                  {isActive && (
                    <button
                      type="button"
                      onClick={() => { haptic('light'); setShowAddCalendar(true); }}
                      className="mt-5 flex w-full items-center gap-3.5 rounded-2xl border border-hair bg-card px-4 py-3.5 text-left active:scale-[0.99]"
                    >
                      <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] bg-sunken">
                        <CalendarPlus className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={2} />
                      </span>
                      <span className="flex-1 font-ui text-[15px] font-semibold text-foreground">add to calendar</span>
                      <ChevronRight className="h-[18px] w-[18px] flex-shrink-0 text-faint" strokeWidth={1.8} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {footer && (
              <div className="flex-shrink-0 border-t border-hair px-5 pt-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                {footer}
                {rsvpError && <p className="mt-2 text-center font-mono text-[10px] text-destructive">{rsvpError}</p>}
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {night && (
        <>
          <AddToCalendarSheet isOpen={showAddCalendar} night={night} onClose={() => setShowAddCalendar(false)} />

          {night.viewer.isHost && (
            <RescheduleFlow
              isOpen={showReschedule}
              night={night}
              onClose={() => setShowReschedule(false)}
              onRescheduled={(updated) => { setNight(updated); onMutated?.(); }}
            />
          )}

          <CancelConfirmModal
            isOpen={showCancelConfirm}
            night={night}
            submitting={cancelling}
            error={cancelError}
            onConfirm={handleCancel}
            onKeep={() => setShowCancelConfirm(false)}
          />
        </>
      )}
    </>
  );
}
