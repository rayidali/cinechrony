'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Drawer } from 'vaul';
import { addDays, format, isSameDay, isToday, startOfDay } from 'date-fns';
import {
  Bell, Calendar, Check, ChevronDown, ClockAlert, Keyboard, Loader2, PartyPopper,
  Plus, Send, Sunrise, UserRound, X, Play, Clock,
} from 'lucide-react';

import { useUser } from '@/firebase';
import { useUserProfile } from '@/contexts/user-profile-cache';
import { useListMembersCache } from '@/contexts/list-members-cache';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { useViewportHeight } from '@/hooks/use-viewport-height';
import { ProfileAvatar } from '@/components/profile-avatar';
import { FilmPickerSheet } from '@/components/v3/film-picker-sheet';
import { NightHeroCTA, NightPoster, describeNightCta, formatTimeOfDay, nightFilmMeta } from './night-ui';
import type { MovieNightListContext, OpenCreateArgs } from './movie-night-provider';
import type { MovieNightFilm, MovieNightView, ReminderPreset } from '@/lib/movie-night-types';
import type { ListMember, SearchResult, TaggedUser, UserProfile } from '@/lib/types';

/**
 * Movie Night — MN03 the create sheet + its MN03a/b/c expanders, MN09's
 * custom time entry, and the MN04 confirmation. MOVIE-NIGHT-PLAN.md § S3.
 *
 * A single Vaul sheet (MN03) with four nested overlays that toggle open/closed
 * on top of it — the same "hoisted sibling sheets" pattern `MovieDrawer` uses
 * for `AddToListSheet`/`HowWasItSheet`/`WatchEditSheet`, rather than a single
 * sheet swapping its own content: each sub-screen animates independently and
 * "cancel" on a sub-sheet returns to the main sheet instead of exiting the
 * whole flow. Z-index ladder: main sheet 91 < sub-sheets 93 < time-entry 94 <
 * the reused `FilmPickerSheet` (95, hardcoded in that shared component) <
 * the MN04 confirm overlay 96 — high enough to clear `StoryShareProvider`
 * (96) is intentionally avoided; confirm never co-occurs with a story share.
 */

type TimeOfDay = { hour: number; minute: number };

const TIME_PRESETS: TimeOfDay[] = [
  { hour: 18, minute: 30 },
  { hour: 19, minute: 0 },
  { hour: 19, minute: 30 },
  { hour: 20, minute: 0 },
  { hour: 20, minute: 30 },
  { hour: 21, minute: 0 },
];

const REMINDER_OPTIONS: { id: ReminderPreset; label: string; icon: typeof Bell; desc: string }[] = [
  { id: '2h', label: '2 hours before', icon: Bell, desc: "a nudge while there's still time to grab snacks" },
  { id: 'morning', label: 'the morning of', icon: Sunrise, desc: "wake up knowing tonight's the night" },
  { id: 'showtime', label: 'at showtime', icon: Play, desc: 'we ping everyone the moment it starts' },
];

const REMINDER_SHORT: Record<ReminderPreset, string> = {
  '2h': '2h before',
  morning: 'the morning of',
  showtime: 'at showtime',
};

function searchResultToNightFilm(r: SearchResult): MovieNightFilm {
  return {
    tmdbId: r.tmdbId ?? (parseInt(r.id, 10) || 0),
    mediaType: r.mediaType === 'tv' ? 'tv' : 'movie',
    title: r.title,
    year: r.year && r.year !== 'N/A' ? r.year : '',
    posterUrl: r.posterUrl || null,
    runtime: null,
  };
}

function combineDateAndTime(day: Date, t: TimeOfDay): Date {
  const d = new Date(day);
  d.setHours(t.hour, t.minute, 0, 0);
  return d;
}

function dateLabelFor(d: Date): string {
  return `${format(d, 'EEE').toLowerCase()} · ${format(d, 'd MMM').toLowerCase()}`;
}

// ── shared bits used by more than one screen ────────────────────────────────

function CtaFooter({
  cta,
  submitting,
  error,
  onPropose,
}: {
  cta: { disabled: boolean; sub: string };
  submitting: boolean;
  error: string | null;
  onPropose: () => void;
}) {
  return (
    <div className="flex-shrink-0 border-t border-hair px-5 pt-2.5" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
      <NightHeroCTA label="propose it" icon={PartyPopper} disabled={cta.disabled} loading={submitting} sub={cta.sub} onTap={onPropose} />
      {error && <p className="mt-2 text-center font-mono text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

function FilmCard({ film, onChange }: { film: MovieNightFilm | null; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex w-full items-center gap-3.5 rounded-2xl border border-hair bg-card p-3.5 text-left transition-transform active:scale-[0.99]"
    >
      <div className="w-[46px] flex-shrink-0"><NightPoster film={film} rounded="rounded-[8px]" /></div>
      {film ? (
        <div className="min-w-0 flex-1">
          <div className="truncate font-headline text-[17px] font-bold lowercase tracking-[-0.025em] text-foreground">{film.title}</div>
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{nightFilmMeta(film) || ' '}</div>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="font-headline text-[17px] font-bold lowercase tracking-[-0.025em] text-muted-foreground">pick a film</div>
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">what are you watching?</div>
        </div>
      )}
      <span className="flex-shrink-0 font-ui text-[13px] font-semibold text-primary">{film ? 'change' : 'pick'}</span>
    </button>
  );
}

function WhenRow({
  icon: Icon, label, value, faint, onTap,
}: { icon: typeof Calendar; label: string; value: string | null; faint?: boolean; onTap: () => void }) {
  return (
    <button type="button" onClick={onTap} className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left">
      <Icon className="h-[18px] w-[18px] flex-shrink-0 text-muted-foreground" strokeWidth={2} />
      <span className="flex-1 font-ui text-[15px] font-semibold text-foreground">{label}</span>
      <span className={`font-mono text-[13px] font-bold tabular-nums ${faint || !value ? 'text-faint' : 'text-foreground'}`}>
        {value ?? (label === 'date' ? 'pick a date' : 'pick a time')}
      </span>
      <ChevronDown className="h-4 w-4 flex-shrink-0 text-faint" strokeWidth={2.2} />
    </button>
  );
}

// ── MN03a — date & time expanded ────────────────────────────────────────────

function DateTimeSheet({
  isOpen, film, selectedDate, selectedTime, isPast, cta, submitting, error,
  today, fridayTarget, weekDays,
  onPickDate, onPickTime, onOpenFilmPicker, onOpenTimeEntry, onClose, onPropose,
}: {
  isOpen: boolean;
  film: MovieNightFilm | null;
  selectedDate: Date | null;
  selectedTime: TimeOfDay | null;
  isPast: boolean;
  cta: { disabled: boolean; sub: string };
  submitting: boolean;
  error: string | null;
  today: Date;
  fridayTarget: Date;
  weekDays: Date[];
  onPickDate: (d: Date) => void;
  onPickTime: (t: TimeOfDay) => void;
  onOpenFilmPicker: () => void;
  onOpenTimeEntry: () => void;
  onClose: () => void;
  onPropose: () => void;
}) {
  const height = useViewportHeight(92);
  const heightStyle = height > 0 ? `${height}px` : 'calc(92 * var(--dvh, 1vh))';
  const dayStripRef = useRef<HTMLDivElement>(null);

  const matchesPreset = selectedTime ? TIME_PRESETS.some((t) => t.hour === selectedTime.hour && t.minute === selectedTime.minute) : false;

  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[93] bg-black/60" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-[93] flex flex-col rounded-t-[22px] bg-background outline-none"
          style={{ height: heightStyle, maxHeight: heightStyle }}
        >
          <Drawer.Title className="sr-only">date &amp; time</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center justify-between px-5 py-2.5">
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui text-[15px] font-semibold text-muted-foreground active:opacity-60">cancel</button>
            <div className="text-center">
              <div className="cc-eyebrow text-muted-foreground">date night</div>
              <div className="mt-0.5 font-headline text-[19px] font-bold lowercase tracking-[-0.02em] text-foreground">movie night</div>
            </div>
            <span className="w-[52px]" aria-hidden />
          </div>

          <div className="flex-1 overflow-y-auto px-5">
            {film && (
              <button type="button" onClick={() => { haptic('light'); onOpenFilmPicker(); }} className="flex w-full items-center gap-3 pb-1 pt-0.5 text-left">
                <div className="w-[38px] flex-shrink-0"><NightPoster film={film} rounded="rounded-[7px]" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-headline text-[16px] font-bold lowercase tracking-[-0.025em] text-foreground">{film.title}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{nightFilmMeta(film)}</div>
                </div>
                <span className="flex-shrink-0 font-ui text-[13px] font-semibold text-primary">change</span>
              </button>
            )}

            {/* quick picks */}
            <div className="mt-4 flex gap-2">
              {(() => {
                const tonightActive = !!selectedDate && isToday(selectedDate);
                const fridayActive = !!selectedDate && !tonightActive && isSameDay(selectedDate, fridayTarget);
                const items: { label: string; active: boolean; onTap: () => void }[] = [
                  { label: 'tonight', active: tonightActive, onTap: () => onPickDate(today) },
                  { label: 'this friday', active: fridayActive, onTap: () => onPickDate(fridayTarget) },
                  {
                    label: 'pick a date',
                    active: false,
                    onTap: () => dayStripRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
                  },
                ];
                return items.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={q.onTap}
                    className={`h-11 flex-1 rounded-[11px] font-ui text-[13.5px] font-semibold lowercase transition-colors ${
                      q.active ? 'bg-foreground text-background' : 'border border-border text-muted-foreground'
                    }`}
                  >
                    {q.label}
                  </button>
                ));
              })()}
            </div>

            {/* this week strip */}
            <div className="mt-5"><span className="cc-eyebrow text-muted-foreground">this week</span></div>
            <div ref={dayStripRef} className="mt-2.5 flex gap-[7px] overflow-x-auto pb-1 scrollbar-hide">
              {weekDays.map((d) => {
                const selected = !!selectedDate && isSameDay(d, selectedDate);
                const bad = selected && isToday(d) && isPast;
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => onPickDate(d)}
                    className={`flex h-[66px] w-[46px] flex-shrink-0 flex-col items-center justify-center gap-0.5 rounded-[14px] transition-colors ${
                      bad ? 'bg-destructive' : selected ? 'bg-primary' : 'border border-border'
                    }`}
                  >
                    <span className={`font-mono text-[9px] font-bold uppercase tracking-[0.08em] ${
                      bad ? 'text-destructive-foreground' : selected ? 'text-primary-foreground' : 'text-muted-foreground'
                    }`}>
                      {format(d, 'EEE').toLowerCase()}
                    </span>
                    <span className={`font-headline text-[21px] font-bold tabular-nums tracking-[-0.03em] ${
                      bad ? 'text-destructive-foreground' : selected ? 'text-primary-foreground' : 'text-foreground'
                    }`}>
                      {format(d, 'd')}
                    </span>
                  </button>
                );
              })}
            </div>

            {isPast && (
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3">
                <ClockAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" strokeWidth={2} />
                <p className="font-serif text-[14px] italic leading-snug text-foreground">
                  that night&rsquo;s already come and gone. pick one coming up.
                </p>
              </div>
            )}

            {/* showtime chips */}
            <div className="mt-5"><span className="cc-eyebrow text-muted-foreground">showtime</span></div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {TIME_PRESETS.map((t) => {
                const sel = !!selectedTime && selectedTime.hour === t.hour && selectedTime.minute === t.minute;
                const label = formatTimeOfDay(t);
                const [hm, ampm] = label.split(' ');
                return (
                  <button
                    key={`${t.hour}:${t.minute}`}
                    type="button"
                    onClick={() => onPickTime(t)}
                    className={`inline-flex h-11 items-baseline gap-1 rounded-[11px] px-4 transition-colors ${sel ? 'bg-primary' : 'border border-border'}`}
                  >
                    <span className={`font-mono text-[15px] font-bold tabular-nums ${sel ? 'text-primary-foreground' : 'text-foreground'}`}>{hm}</span>
                    <span className={`font-mono text-[10px] font-bold ${sel ? 'text-primary-foreground' : 'text-muted-foreground'}`}>{ampm}</span>
                  </button>
                );
              })}
              {selectedTime && !matchesPreset && (() => {
                const label = formatTimeOfDay(selectedTime);
                const [hm, ampm] = label.split(' ');
                return (
                  <span className="inline-flex h-[42px] items-baseline gap-1 rounded-[11px] bg-primary px-4">
                    <span className="font-mono text-[15px] font-bold tabular-nums text-primary-foreground">{hm}</span>
                    <span className="font-mono text-[10px] font-bold text-primary-foreground">{ampm}</span>
                  </span>
                );
              })()}
              <button
                type="button"
                onClick={() => { haptic('light'); onOpenTimeEntry(); }}
                className="inline-flex h-11 items-center gap-1.5 rounded-[11px] border border-dashed border-rule px-4"
              >
                <Keyboard className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={2} />
                <span className="font-ui text-[13px] font-semibold text-muted-foreground">type it</span>
              </button>
            </div>
            <div className="h-6" />
          </div>

          <CtaFooter cta={cta} submitting={submitting} error={error} onPropose={onPropose} />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ── MN03b — who's coming expanded ───────────────────────────────────────────

function PeopleSheet({
  isOpen, list, listMembers, invitees, hostUid, onToggle, onClose,
}: {
  isOpen: boolean;
  list: MovieNightListContext | null;
  listMembers: ListMember[];
  invitees: TaggedUser[];
  hostUid: string;
  onToggle: (u: TaggedUser) => void;
  onClose: () => void;
}) {
  const height = useViewportHeight(90);
  const heightStyle = height > 0 ? `${height}px` : 'calc(90 * var(--dvh, 1vh))';
  const { user } = useUser();
  const [query, setQuery] = useState('');
  const [follows, setFollows] = useState<UserProfile[]>([]);
  const [mutualIds, setMutualIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) { setQuery(''); return; }
    if (!user?.uid) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiCall<{ users: UserProfile[] }>('GET', `/api/v1/users/${user.uid}/following?limit=200`),
      apiCall<{ users: UserProfile[] }>('GET', `/api/v1/users/${user.uid}/followers?limit=200`),
    ])
      .then(([followingRes, followersRes]) => {
        if (cancelled) return;
        setFollows(followingRes.users ?? []);
        setMutualIds(new Set((followersRes.users ?? []).map((u) => u.uid)));
      })
      .catch(() => { if (!cancelled) { setFollows([]); setMutualIds(new Set()); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, user?.uid]);

  const otherMembers = useMemo(() => listMembers.filter((m) => m.uid !== hostUid), [listMembers, hostUid]);
  const listMemberIds = useMemo(() => new Set(otherMembers.map((m) => m.uid)), [otherMembers]);
  const followRows = useMemo(
    () => follows.filter((u) => !listMemberIds.has(u.uid) && u.uid !== hostUid),
    [follows, listMemberIds, hostUid],
  );

  const q = query.trim().toLowerCase();
  const filteredMembers = q
    ? otherMembers.filter((m) => (m.displayName || '').toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q))
    : otherMembers;
  const filteredFollows = q
    ? followRows.filter((u) => (u.displayName || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q))
    : followRows;

  const selectedIds = useMemo(() => new Set(invitees.map((u) => u.uid)), [invitees]);
  const atCap = invitees.length >= 9;
  const solo = otherMembers.length === 0;

  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[93] bg-black/60" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-[93] flex flex-col rounded-t-[22px] bg-background outline-none"
          style={{ height: heightStyle, maxHeight: heightStyle }}
        >
          <Drawer.Title className="sr-only">who&apos;s coming</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center justify-between px-5 py-2.5">
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui text-[15px] font-semibold text-muted-foreground active:opacity-60">cancel</button>
            <span className="font-headline text-[19px] font-bold lowercase tracking-[-0.02em] text-foreground">who&apos;s coming</span>
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui text-[15px] font-bold text-primary active:opacity-60">
              done{invitees.length > 0 ? ` · ${invitees.length}` : ''}
            </button>
          </div>

          <div className="px-5 pb-2">
            <div className="flex h-11 items-center gap-2.5 rounded-[13px] border border-hair bg-sunken px-3.5">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search people"
                className="w-full bg-transparent font-body text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="clear" className="flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center rounded-full bg-foreground/10 text-muted-foreground">
                  <X className="h-3 w-3" strokeWidth={2.6} />
                </button>
              )}
            </div>
          </div>

          {/* picked pills */}
          <div className="flex flex-wrap gap-2 px-5 pb-1">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-hair bg-card pl-1 pr-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 font-headline text-[10px] font-bold text-primary">you</span>
              <span className="font-ui text-[12.5px] font-bold text-foreground">you · host</span>
            </span>
            {invitees.map((u) => (
              <button
                key={u.uid}
                type="button"
                onClick={() => { haptic('selection'); onToggle(u); }}
                className="inline-flex h-11 items-center gap-1.5 rounded-full border border-hair bg-card pl-1 pr-2.5 active:opacity-70"
              >
                <ProfileAvatar photoURL={u.photoURL} displayName={u.displayName} username={u.username} size="xs" />
                <span className="font-ui text-[12.5px] font-semibold text-foreground">{(u.displayName || u.username || 'friend').toLowerCase()}</span>
                <X className="h-3 w-3 text-muted-foreground" strokeWidth={2.6} />
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            {solo ? (
              <div className="px-1 py-6 text-center">
                <div className="mx-auto flex h-[58px] w-[58px] items-center justify-center rounded-full border border-hair bg-card">
                  <UserRound className="h-6 w-6 text-muted-foreground" strokeWidth={1.7} />
                </div>
                <div className="mt-3.5 font-headline text-[20px] font-bold lowercase tracking-[-0.03em] text-foreground">it&rsquo;s just you here</div>
                <p className="mx-auto mt-2 max-w-[250px] font-serif text-[15px] italic leading-snug text-muted-foreground">
                  {list
                    ? 'no one else is on this list yet. invite someone and it becomes a night.'
                    : 'invite someone you follow and it becomes a night.'}
                </p>
              </div>
            ) : (
              <>
                <div className="mb-1 mt-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">on this list</div>
                {filteredMembers.length === 0 && q && (
                  <p className="py-3 font-serif text-[14px] italic text-muted-foreground">no one matching &ldquo;{query.trim()}&rdquo;.</p>
                )}
                {filteredMembers.map((m) => {
                  const on = selectedIds.has(m.uid);
                  const disabled = !on && atCap;
                  return (
                    <button
                      key={m.uid}
                      type="button"
                      disabled={disabled}
                      onClick={() => { haptic(on ? 'selection' : 'light'); onToggle({ uid: m.uid, username: m.username, displayName: m.displayName, photoURL: m.photoURL }); }}
                      className="flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-40"
                    >
                      <ProfileAvatar photoURL={m.photoURL} displayName={m.displayName} username={m.username} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-ui text-[15px] font-bold text-foreground">{(m.displayName || m.username || 'user').toLowerCase()}</span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">@{m.username || 'user'} · on the list</span>
                      </span>
                      <span className={`flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full ${on ? 'bg-primary' : 'border-2 border-hair'}`}>
                        {on && <Check className="h-4 w-4 text-primary-foreground" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            <div className="mb-1 mt-4 font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">add friends you follow</div>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : filteredFollows.length === 0 ? (
              <p className="py-3 font-serif text-[14px] italic text-muted-foreground">
                {q ? `no one matching "${query.trim()}".` : 'follow some people first to invite them.'}
              </p>
            ) : (
              filteredFollows.map((u) => {
                const on = selectedIds.has(u.uid);
                const disabled = !on && atCap;
                const sub = mutualIds.has(u.uid) ? 'mutual' : 'following';
                return (
                  <button
                    key={u.uid}
                    type="button"
                    disabled={disabled}
                    onClick={() => { haptic(on ? 'selection' : 'light'); onToggle({ uid: u.uid, username: u.username, displayName: u.displayName, photoURL: u.photoURL }); }}
                    className="flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-40"
                  >
                    <ProfileAvatar photoURL={u.photoURL} displayName={u.displayName} username={u.username} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-ui text-[15px] font-bold text-foreground">{(u.displayName || u.username || 'user').toLowerCase()}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">@{u.username || 'user'} · {sub}</span>
                    </span>
                    {solo ? (
                      <span className="flex h-8 flex-shrink-0 items-center rounded-full bg-primary px-4 font-ui text-[12.5px] font-bold text-primary-foreground">
                        {on ? 'invited' : 'invite'}
                      </span>
                    ) : (
                      <span className={`flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full ${on ? 'bg-primary' : 'border-2 border-hair'}`}>
                        {on && <Check className="h-4 w-4 text-primary-foreground" strokeWidth={3} />}
                      </span>
                    )}
                  </button>
                );
              })
            )}

            {atCap && (
              <p className="mt-3 text-center font-mono text-[10px] text-muted-foreground">you&rsquo;ve got your 9 · that&rsquo;s the max for one night</p>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ── MN03c — reminder presets ─────────────────────────────────────────────────

function ReminderSheet({
  isOpen, value, onChange, onClose,
}: { isOpen: boolean; value: ReminderPreset; onChange: (v: ReminderPreset) => void; onClose: () => void }) {
  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[93] bg-black/60" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[93] flex max-h-[64vh] flex-col rounded-t-[22px] bg-background outline-none">
          <Drawer.Title className="sr-only">remind me</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center justify-between px-5 py-2.5">
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui text-[15px] font-semibold text-muted-foreground active:opacity-60">cancel</button>
            <span className="font-headline text-[19px] font-bold lowercase tracking-[-0.02em] text-foreground">remind me</span>
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui text-[15px] font-bold text-primary active:opacity-60">done</button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <div className="flex flex-col gap-2.5 pt-1">
              {REMINDER_OPTIONS.map((opt) => {
                const active = value === opt.id;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { haptic('selection'); onChange(opt.id); }}
                    className={`flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-left ${active ? 'border-[1.5px] border-primary bg-primary/[0.06]' : 'border border-hair bg-card'}`}
                  >
                    <span className={`flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-xl ${active ? 'bg-primary' : 'bg-sunken'}`}>
                      <Icon className={`h-5 w-5 ${active ? 'text-primary-foreground' : 'text-muted-foreground'}`} strokeWidth={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-headline text-[17px] font-bold lowercase tracking-[-0.025em] text-foreground">{opt.label}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{opt.desc}</span>
                    </span>
                    <span className={`flex h-[23px] w-[23px] flex-shrink-0 items-center justify-center rounded-full ${active ? 'bg-primary' : 'border-[1.5px] border-border'}`}>
                      {active && <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
              <p className="mt-1 text-center font-mono text-[10px] text-muted-foreground">just the one reminder. we keep it quiet.</p>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ── MN09 — custom time entry (real keyboard, kb-inset pattern) ─────────────

function TimeEntrySheet({
  isOpen, film, baseDate, initial, submitting, error, onDone, onClose, onSubmit,
}: {
  isOpen: boolean;
  film: MovieNightFilm | null;
  baseDate: Date;
  initial: TimeOfDay | null;
  submitting: boolean;
  error: string | null;
  onDone: (t: TimeOfDay) => void;
  onClose: () => void;
  onSubmit: (when: Date) => void;
}) {
  const [hourStr, setHourStr] = useState('');
  const [minuteStr, setMinuteStr] = useState('');
  const [ampm, setAmpm] = useState<'am' | 'pm'>('pm');
  const [kbInset, setKbInset] = useState(0);
  const [mounted, setMounted] = useState(false);
  const hourRef = useRef<HTMLInputElement>(null);
  const minuteRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isOpen) return;
    if (initial) {
      const h12 = initial.hour % 12 === 0 ? 12 : initial.hour % 12;
      setHourStr(String(h12));
      setMinuteStr(String(initial.minute).padStart(2, '0'));
      setAmpm(initial.hour >= 12 ? 'pm' : 'am');
    } else {
      setHourStr('');
      setMinuteStr('');
      setAmpm('pm');
    }
    const t = setTimeout(() => hourRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [isOpen, initial]);

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

  const hourNum = Math.min(12, Math.max(0, parseInt(hourStr, 10) || 0));
  const minuteNum = Math.min(59, Math.max(0, parseInt(minuteStr, 10) || 0));
  const valid = hourStr !== '' && hourNum >= 1 && hourNum <= 12 && minuteStr.length > 0;
  const time: TimeOfDay | null = valid ? { hour: (hourNum % 12) + (ampm === 'pm' ? 12 : 0), minute: minuteNum } : null;
  const when = time ? combineDateAndTime(baseDate, time) : null;
  const cta = describeNightCta(film, when);

  return createPortal(
    <div className="fixed inset-0 z-[94] flex flex-col bg-background" role="dialog" aria-label="set a time">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-hair px-5 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.625rem)' }}>
        <button onClick={() => { haptic('light'); onClose(); }} className="font-ui text-[15px] font-semibold text-muted-foreground active:opacity-60">cancel</button>
        <span className="font-headline text-[18px] font-bold lowercase tracking-[-0.02em]">set a time</span>
        <button
          onClick={() => { if (!time) return; haptic('light'); onDone(time); }}
          disabled={!valid}
          className="font-ui text-[15px] font-bold text-primary active:opacity-60 disabled:opacity-30"
        >
          done
        </button>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{dateLabelFor(baseDate)}</p>
        <div className="mt-3 flex items-baseline gap-1.5">
          <input
            ref={hourRef}
            value={hourStr}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 2);
              setHourStr(v);
              if (v.length === 2) minuteRef.current?.focus();
            }}
            inputMode="numeric"
            maxLength={2}
            placeholder="8"
            aria-label="hour"
            className="w-[70px] bg-transparent text-right font-mono text-[56px] font-bold tabular-nums leading-none text-foreground caret-primary outline-none placeholder:text-faint"
          />
          <span className="font-mono text-[56px] font-bold leading-none text-foreground">:</span>
          <input
            ref={minuteRef}
            value={minuteStr}
            onChange={(e) => setMinuteStr(e.target.value.replace(/\D/g, '').slice(0, 2))}
            inputMode="numeric"
            maxLength={2}
            placeholder="00"
            aria-label="minute"
            className="w-[70px] bg-transparent font-mono text-[56px] font-bold tabular-nums leading-none text-foreground caret-primary outline-none placeholder:text-faint"
          />
        </div>
        <div className="mt-5 flex gap-2">
          {(['am', 'pm'] as const).map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => { haptic('selection'); setAmpm(x); }}
              className={`h-11 rounded-full px-5 font-ui text-[13.5px] font-bold lowercase transition-colors ${
                ampm === x ? 'bg-foreground text-background' : 'border border-border text-muted-foreground'
              }`}
            >
              {x}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-hair px-5 pt-2.5" style={{ paddingBottom: Math.max(16, kbInset + 16) }}>
        <NightHeroCTA
          label="propose it"
          icon={PartyPopper}
          disabled={cta.disabled}
          loading={submitting}
          sub={valid ? cta.sub : 'finish typing a time to propose it'}
          onTap={() => {
            if (!time || !when) return;
            haptic('light');
            onDone(time);
            onSubmit(when);
          }}
        />
        {error && <p className="mt-2 text-center font-mono text-[10px] text-destructive">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}

// ── MN04 — propose it → confirmed ───────────────────────────────────────────

function ConfirmOverlay({
  night, list, onSeeNight, onDismiss,
}: { night: MovieNightView; list: MovieNightListContext | null; onSeeNight: () => void; onDismiss: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const when = new Date(night.scheduledFor);
  const dateLabel = `${format(when, 'EEE').toLowerCase()} ${format(when, 'd.MM')}`;
  const timeLabel = format(when, 'h:mm a').toLowerCase();

  return createPortal(
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/55 px-6" role="dialog" aria-label="your night's proposed">
      <div className="w-full max-w-[340px] rounded-[26px] border border-hair bg-background p-6 pb-5 shadow-lift">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success" style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
          <Check className="h-7 w-7 text-white" strokeWidth={2.6} />
        </div>
        <div className="mt-4 text-center">
          <div className="cc-eyebrow text-primary">it&rsquo;s on</div>
          <div className="mt-2 font-headline text-[28px] font-bold leading-[0.95] lowercase tracking-[-0.04em] text-foreground">
            your night&rsquo;s<br />proposed
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-hair bg-card p-3">
          <div className="w-10 flex-shrink-0"><NightPoster film={night.film} rounded="rounded-[7px]" /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-headline text-[16px] font-bold lowercase tracking-[-0.025em] text-foreground">{night.film.title}</div>
            <div className="mt-0.5 font-mono text-[11px] text-foreground">{dateLabel} · {timeLabel}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg bg-sunken"><Send className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={2} /></span>
            <p className="font-serif text-[15px] italic leading-snug text-foreground">your people get a ping</p>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg bg-sunken"><Bell className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={2} /></span>
            <p className="font-serif text-[15px] italic leading-snug text-foreground">you&rsquo;ll get a reminder before showtime</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { haptic('light'); onSeeNight(); }}
          className="mt-5 h-[50px] w-full rounded-2xl bg-foreground font-headline text-[16.5px] font-bold lowercase tracking-[-0.02em] text-background"
        >
          see the night
        </button>
        <button type="button" onClick={() => { haptic('light'); onDismiss(); }} className="mt-2 flex h-11 w-full items-center justify-center text-center font-ui text-[14px] font-semibold text-muted-foreground active:opacity-60">
          {list ? `back to ${list.name.toLowerCase()}` : 'done'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ── MN03 — the create sheet (root) ──────────────────────────────────────────

export function CreateNightSheet({
  args,
  onClose,
  onOpenNight,
}: {
  args: OpenCreateArgs | null;
  onClose: () => void;
  onOpenNight: (id: string) => void;
}) {
  const isOpen = args !== null;
  const { user } = useUser();
  const hostProfile = useUserProfile(user?.uid);
  const { getMembers, setMembers } = useListMembersCache();

  const [film, setFilm] = useState<MovieNightFilm | null>(null);
  const [list, setList] = useState<MovieNightListContext | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<TimeOfDay | null>(null);
  const [reminderPreset, setReminderPreset] = useState<ReminderPreset>('2h');
  const [invitees, setInvitees] = useState<TaggedUser[]>([]);
  const [listMembers, setListMembers] = useState<ListMember[]>([]);

  const [showFilmPicker, setShowFilmPicker] = useState(false);
  const [showDateTime, setShowDateTime] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [showTimeEntry, setShowTimeEntry] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdNight, setCreatedNight] = useState<MovieNightView | null>(null);

  const hasSeededInviteesRef = useRef(false);
  const hasAutoOpenedPickerRef = useRef(false);

  const height = useViewportHeight(90);
  const heightStyle = height > 0 ? `${height}px` : 'calc(90 * var(--dvh, 1vh))';

  const today = useMemo(() => startOfDay(new Date()), [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const fridayTarget = useMemo(() => {
    const diff = (5 - today.getDay() + 7) % 7;
    return addDays(today, diff);
  }, [today]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i)), [today]);

  // Reset the whole flow every time the sheet opens (a fresh `args` object).
  useEffect(() => {
    if (!isOpen) return;
    setFilm(args?.film ?? null);
    setList(args?.list ?? null);
    setSelectedDate(startOfDay(new Date()));
    setSelectedTime(null);
    setReminderPreset('2h');
    setInvitees([]);
    setListMembers(args?.list ? getMembers(args.list.ownerId, args.list.id) ?? [] : []);
    setShowFilmPicker(false);
    setShowDateTime(false);
    setShowPeople(false);
    setShowReminder(false);
    setShowTimeEntry(false);
    setSubmitting(false);
    setError(null);
    setCreatedNight(null);
    hasSeededInviteesRef.current = false;
    hasAutoOpenedPickerRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, args]);

  // Fresh member list for the given list (cache is a fast first paint; this
  // keeps WHO'S COMING honest if someone joined/left since the cache warmed).
  useEffect(() => {
    if (!isOpen || !list) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiCall<{ members: ListMember[] }>('GET', `/api/v1/lists/${list.ownerId}/${list.id}/members`);
        if (cancelled) return;
        setListMembers(res.members ?? []);
        setMembers(list.ownerId, list.id, res.members ?? []);
      } catch {
        /* non-critical — the sheet still works with the cached/empty member list */
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, list, setMembers]);

  // MN03b default: every other list member is preselected as an invitee.
  useEffect(() => {
    if (!isOpen || hasSeededInviteesRef.current) return;
    if (!list) { hasSeededInviteesRef.current = true; return; }
    if (listMembers.length === 0) return;
    const others = listMembers.filter((m) => m.uid !== user?.uid);
    setInvitees(others.map((m) => ({ uid: m.uid, username: m.username, displayName: m.displayName, photoURL: m.photoURL })));
    hasSeededInviteesRef.current = true;
  }, [isOpen, list, listMembers, user?.uid]);

  // MN02 film-first path: no film on open → prompt the picker immediately.
  useEffect(() => {
    if (!isOpen || hasAutoOpenedPickerRef.current) return;
    hasAutoOpenedPickerRef.current = true;
    if (!film) setShowFilmPicker(true);
  }, [isOpen, film]);

  const scheduledFor = useMemo(
    () => (selectedDate && selectedTime ? combineDateAndTime(selectedDate, selectedTime) : null),
    [selectedDate, selectedTime],
  );
  const isPast = !!scheduledFor && scheduledFor.getTime() <= Date.now();
  const cta = describeNightCta(film, scheduledFor);

  const dateLabel = selectedDate ? dateLabelFor(selectedDate) : null;
  const timeLabel = selectedTime ? formatTimeOfDay(selectedTime) : null;

  function toggleInvitee(u: TaggedUser) {
    setInvitees((prev) => {
      const already = prev.some((i) => i.uid === u.uid);
      if (already) return prev.filter((i) => i.uid !== u.uid);
      if (prev.length >= 9) return prev;
      return [...prev, u];
    });
  }

  async function submitNight(when: Date) {
    if (!film || submitting) return;
    if (when.getTime() <= Date.now()) {
      setError("pick a night that hasn't happened yet");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        film,
        scheduledFor: when.toISOString(),
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
        reminderPreset,
        inviteeUids: invitees.map((u) => u.uid),
      };
      if (list) {
        body.listId = list.id;
        body.listOwnerId = list.ownerId;
      }
      const night = await apiCall<MovieNightView>('POST', '/api/v1/movie-nights', body);
      haptic('success');
      setCreatedNight(night);
      setShowDateTime(false);
      setShowTimeEntry(false);
      setShowPeople(false);
      setShowReminder(false);
      setShowFilmPicker(false);
    } catch (err) {
      haptic('error');
      setError(err instanceof ApiClientError ? err.message : 'could not propose the night. try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const hostDisplayName = hostProfile?.displayName ?? user?.displayName ?? null;
  const hostPhotoURL = hostProfile?.photoURL ?? user?.photoURL ?? null;
  const hostUsername = hostProfile?.username ?? null;

  return (
    <>
      <Drawer.Root open={isOpen} onOpenChange={(o) => { if (!o && !createdNight) onClose(); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[91] bg-black/55" />
          <Drawer.Content
            className="fixed bottom-0 left-0 right-0 z-[91] flex flex-col rounded-t-[22px] bg-background outline-none"
            style={{ height: heightStyle, maxHeight: heightStyle }}
          >
            <Drawer.Title className="sr-only">movie night</Drawer.Title>
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <div className="flex items-center justify-between px-5 py-2.5">
              <button onClick={() => { haptic('light'); onClose(); }} className="font-ui text-[15px] font-semibold text-muted-foreground active:opacity-60">cancel</button>
              <div className="text-center">
                <div className="cc-eyebrow text-muted-foreground">date night</div>
                <div className="mt-0.5 font-headline text-[19px] font-bold lowercase tracking-[-0.02em] text-foreground">movie night</div>
              </div>
              <span className="w-[52px]" aria-hidden />
            </div>

            <div className="flex-1 overflow-y-auto px-5">
              <FilmCard film={film} onChange={() => { haptic('light'); setShowFilmPicker(true); }} />

              <div className="mt-5"><span className="cc-eyebrow text-muted-foreground">when</span></div>
              <div className="mt-2.5 overflow-hidden rounded-2xl border border-hair bg-card">
                <WhenRow icon={Calendar} label="date" value={dateLabel} onTap={() => { haptic('light'); setShowDateTime(true); }} />
                <div className="ml-[47px] h-px bg-rule" />
                <WhenRow icon={Clock} label="time" value={timeLabel} faint={!timeLabel} onTap={() => { haptic('light'); setShowDateTime(true); }} />
              </div>

              <div className="mt-5 flex items-baseline justify-between">
                <span className="cc-eyebrow text-muted-foreground">who&apos;s coming</span>
                <span className="font-mono text-[9.5px] text-muted-foreground">host + up to 9</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-hair bg-card pl-1 pr-3">
                  <ProfileAvatar photoURL={hostPhotoURL} displayName={hostDisplayName} username={hostUsername} size="xs" />
                  <span className="font-ui text-[13px] font-bold text-foreground">you</span>
                  <span className="font-mono text-[8px] font-bold uppercase tracking-[0.08em] text-muted-foreground">host</span>
                </span>
                {invitees.map((u) => (
                  <button
                    key={u.uid}
                    type="button"
                    onClick={() => { haptic('selection'); toggleInvitee(u); }}
                    className="inline-flex h-11 items-center gap-1.5 rounded-full border border-hair bg-card pl-1 pr-2.5 active:opacity-70"
                  >
                    <ProfileAvatar photoURL={u.photoURL} displayName={u.displayName} username={u.username} size="xs" />
                    <span className="font-ui text-[13px] font-semibold text-foreground">{(u.displayName || u.username || 'friend').toLowerCase()}</span>
                    <X className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.6} />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { haptic('light'); setShowPeople(true); }}
                  className="inline-flex h-11 items-center gap-1.5 rounded-full border border-dashed border-rule px-3 text-primary active:opacity-70"
                >
                  <Plus className="h-[15px] w-[15px]" strokeWidth={2.4} />
                  <span className="font-ui text-[13px] font-semibold">add</span>
                </button>
              </div>

              <div className="mt-5"><span className="cc-eyebrow text-muted-foreground">reminder</span></div>
              <div className="mt-2.5 overflow-hidden rounded-2xl border border-hair bg-card">
                <WhenRow icon={Bell} label="remind everyone" value={REMINDER_SHORT[reminderPreset]} onTap={() => { haptic('light'); setShowReminder(true); }} />
              </div>

              <div className="h-6" />
            </div>

            <CtaFooter cta={cta} submitting={submitting} error={error} onPropose={() => scheduledFor && submitNight(scheduledFor)} />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <FilmPickerSheet
        isOpen={isOpen && showFilmPicker}
        onClose={() => setShowFilmPicker(false)}
        onPick={(r) => { setFilm(searchResultToNightFilm(r)); setShowFilmPicker(false); }}
      />

      <DateTimeSheet
        isOpen={isOpen && showDateTime}
        film={film}
        selectedDate={selectedDate}
        selectedTime={selectedTime}
        isPast={isPast}
        cta={cta}
        submitting={submitting}
        error={error}
        today={today}
        fridayTarget={fridayTarget}
        weekDays={weekDays}
        onPickDate={(d) => { haptic('selection'); setSelectedDate(d); }}
        onPickTime={(t) => { haptic('selection'); setSelectedTime(t); }}
        onOpenFilmPicker={() => setShowFilmPicker(true)}
        onOpenTimeEntry={() => setShowTimeEntry(true)}
        onClose={() => setShowDateTime(false)}
        onPropose={() => scheduledFor && submitNight(scheduledFor)}
      />

      <PeopleSheet
        isOpen={isOpen && showPeople}
        list={list}
        listMembers={listMembers}
        invitees={invitees}
        hostUid={user?.uid ?? ''}
        onToggle={toggleInvitee}
        onClose={() => setShowPeople(false)}
      />

      <ReminderSheet
        isOpen={isOpen && showReminder}
        value={reminderPreset}
        onChange={setReminderPreset}
        onClose={() => setShowReminder(false)}
      />

      <TimeEntrySheet
        isOpen={isOpen && showTimeEntry}
        film={film}
        baseDate={selectedDate ?? today}
        initial={selectedTime}
        submitting={submitting}
        error={error}
        onDone={(t) => { setSelectedTime(t); setShowTimeEntry(false); }}
        onClose={() => setShowTimeEntry(false)}
        onSubmit={(when) => submitNight(when)}
      />

      {createdNight && (
        <ConfirmOverlay
          night={createdNight}
          list={list}
          onSeeNight={() => { onOpenNight(createdNight.id); onClose(); }}
          onDismiss={() => onClose()}
        />
      )}
    </>
  );
}
