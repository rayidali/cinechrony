'use client';

import { useEffect, useState } from 'react';
import { useParams } from '@/lib/native-nav';
import { Check, CircleHelp, X, CalendarPlus, Popcorn, type LucideIcon } from 'lucide-react';
import { apiCall, apiOrigin, ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { formatNightDateShort, formatNightTime } from '@/lib/movie-night-format';
import { seededGradient } from '@/lib/seeded-gradient';
import { ProfileAvatar } from '@/components/profile-avatar';
import { NightPoster } from '@/components/movie-night/night-ui';
import type { MovieNightPublicView, MovieNightStatus, RsvpAnswer } from '@/lib/movie-night-types';

/**
 * `/n/[code]` — MN31, the no-account guest web page (MOVIE-NIGHT-PLAN.md § S5,
 * locked decision 2). A friend without cinechrony lands here from a shared
 * link and can RSVP with just a first name — no signup, no app required. The
 * app is pitched as the social-layer upgrade ("see what everyone thought
 * after"), never a gate: the RSVP itself works with zero account.
 *
 * Public API only (`GET/POST /api/v1/movie-nights/shared/[code]` +
 * `.../calendar.ics`) — no Firestore client reads, fine signed out.
 */

// TODO(launch): swap for the App Store URL once cinechrony ships there (see
// CLAUDE.md "Current state" — TestFlight is the pre-launch channel). Public
// link, capped at 150 testers until Blaze.
const APP_LINK = 'https://testflight.apple.com/join/CRPFhKen';

const GUEST_ID_KEY = 'cc-guest-id';
const GUEST_NAME_KEY = 'cc-guest-name';
const answerStorageKey = (code: string) => `cc-guest-rsvp:${code}`;

function randomHex(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Create-once, reuse-forever guest identity — an 8-byte (16 hex char) id,
 *  well inside the server's 8-64 char `guestId` shape. Not tied to any
 *  account; the SAME id re-RSVPing to any night always updates its own row
 *  (`guestRsvpMovieNight` in movie-nights-server.ts). */
function getOrCreateGuestId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(GUEST_ID_KEY);
    if (existing) return existing;
    const fresh = randomHex(8);
    window.localStorage.setItem(GUEST_ID_KEY, fresh);
    return fresh;
  } catch {
    // Safari private mode / quota — still works this session, just isn't
    // remembered on a reload.
    return randomHex(8);
  }
}

function loadStoredName(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(GUEST_NAME_KEY) || '';
  } catch {
    return '';
  }
}

type StoredAnswer = { name: string; answer: RsvpAnswer };

function loadStoredAnswer(code: string): StoredAnswer | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(answerStorageKey(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAnswer>;
    if (parsed && typeof parsed.name === 'string' && (parsed.answer === 'in' || parsed.answer === 'maybe' || parsed.answer === 'out')) {
      return { name: parsed.name, answer: parsed.answer };
    }
  } catch {
    /* ignore — worst case the RSVP form shows again, which is harmless */
  }
  return null;
}

function saveGuestRsvp(code: string, name: string, answer: RsvpAnswer): void {
  try {
    window.localStorage.setItem(GUEST_NAME_KEY, name);
    window.localStorage.setItem(answerStorageKey(code), JSON.stringify({ name, answer }));
  } catch {
    /* best effort — the RSVP already succeeded server-side */
  }
}

// ── brand chrome — wordmark + the feature's one yellow moment ───────────────

function Wordmark() {
  return (
    <div className="inline-flex items-center gap-[7px]">
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px] border-2 border-foreground bg-[oklch(0.88_0.18_95)] dark:bg-[oklch(0.84_0.17_95)]">
        <Popcorn className="h-[13px] w-[13px] text-[oklch(0.22_0.05_70)]" strokeWidth={2.4} />
      </span>
      <span
        className="font-headline text-[15px] font-bold tracking-[-0.04em] text-white"
        style={{ fontVariationSettings: '"wdth" 90' }}
      >
        cinechrony
      </span>
    </div>
  );
}

function Footer() {
  return (
    <p className="mt-7 text-center font-serif text-[12.5px] italic text-faint">
      made with coffee and questionable movie taste
    </p>
  );
}

// ── MN31 hero — full-bleed gradient + ghost title + poster + eyebrow ────────

function Hero({ film }: { film: MovieNightPublicView['film'] }) {
  return (
    <div className="relative h-[230px] w-full flex-shrink-0 overflow-hidden" style={{ background: seededGradient(film.title) }}>
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-[18px] text-center">
        <span
          className="font-headline font-bold lowercase leading-[0.86] text-white/10"
          style={{ fontSize: 58, letterSpacing: '-0.05em', fontVariationSettings: '"wdth" 88' }}
        >
          {film.title}
        </span>
      </div>
      <div
        className="absolute inset-0"
        style={{ backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.22), transparent 40%, rgba(0,0,0,0.58))' }}
      />
      <div className="absolute left-[18px] top-[calc(env(safe-area-inset-top)+16px)]"><Wordmark /></div>
      <div className="absolute bottom-4 left-5 right-5 flex items-end gap-3.5">
        <div className="w-[74px] flex-shrink-0 overflow-hidden rounded-[11px] shadow-[0_10px_28px_rgba(0,0,0,0.5)]">
          <NightPoster film={film} rounded="rounded-[11px]" />
        </div>
        <div className="min-w-0 pb-1">
          <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-white/85">movie night</div>
          <div
            className="mt-1 truncate font-headline text-[26px] font-bold lowercase leading-[0.92] tracking-[-0.04em] text-white"
            style={{ textShadow: '0 2px 10px rgba(0,0,0,0.4)' }}
          >
            {film.title}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MN35 — the loading skeleton ──────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <div className="h-[230px] w-full flex-shrink-0 animate-pulse bg-muted pt-safe" />
      <div className="px-[22px] py-6">
        <div className="mx-auto h-3 w-[120px] animate-pulse rounded bg-muted" />
        <div className="mx-auto mt-3.5 h-[44px] w-[200px] animate-pulse rounded-[10px] bg-muted" />
        <div className="mx-auto mt-3 h-[11px] w-[90px] animate-pulse rounded bg-muted" />
        <div className="mt-6 flex justify-center gap-2.5">
          {[0, 1, 2].map((i) => <div key={i} className="h-11 w-11 animate-pulse rounded-full bg-muted" />)}
        </div>
        <div className="mt-7 h-[52px] w-full animate-pulse rounded-2xl bg-muted" />
      </div>
    </div>
  );
}

// ── quiet brand states — 404 / error ─────────────────────────────────────────

function UnavailableState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 pb-safe pt-safe text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sunken">
        <Popcorn className="h-6 w-6 text-muted-foreground" strokeWidth={1.8} />
      </div>
      <h1 className="mt-5 font-headline text-[22px] font-bold lowercase tracking-[-0.03em] text-foreground">
        cinechrony
      </h1>
      <p className="mx-auto mt-2 max-w-[260px] font-serif text-[14.5px] italic leading-relaxed text-muted-foreground">
        {message}
      </p>
      <Footer />
    </div>
  );
}

// ── small pieces ──────────────────────────────────────────────────────────

function Eyebrow({ children, tone = 'primary' }: { children: React.ReactNode; tone?: 'primary' | 'muted' }) {
  return (
    <div
      className={cn(
        'font-mono text-[10.5px] font-bold uppercase tracking-[0.22em]',
        tone === 'primary' ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      {children}
    </div>
  );
}

function BigDateTime({ iso, tzOffsetMinutes }: { iso: string; tzOffsetMinutes: number }) {
  const time = formatNightTime(iso, tzOffsetMinutes);
  const [timeMain, timeAmpm] = time.split(' ');
  return (
    <div className="mt-3.5">
      <div className="flex items-baseline justify-center gap-2.5">
        <span className="font-headline text-[52px] font-bold leading-[0.9] tracking-[-0.04em] tabular-nums text-foreground">{timeMain}</span>
        <span className="font-mono text-[20px] font-bold text-muted-foreground">{timeAmpm}</span>
      </div>
      <div className="mt-1.5 font-mono text-[12.5px] font-bold tracking-[0.04em] tabular-nums text-muted-foreground">
        {formatNightDateShort(iso, tzOffsetMinutes)}
      </div>
    </div>
  );
}

const RSVP_META: Record<RsvpAnswer, { label: string; Icon: LucideIcon; tint: string; dot: string }> = {
  in: { label: "you're in", Icon: Check, tint: 'border-success bg-success/10', dot: 'bg-success' },
  maybe: { label: "you're a maybe", Icon: CircleHelp, tint: 'border-warning bg-warning/10', dot: 'bg-warning' },
  out: { label: "you're out", Icon: X, tint: 'border-destructive bg-destructive/10', dot: 'bg-destructive' },
};

function SettledRow({ answer, name, onChangeAnswer }: { answer: RsvpAnswer; name: string; onChangeAnswer: () => void }) {
  const meta = RSVP_META[answer];
  return (
    <div className={cn('flex h-[52px] items-center gap-3 rounded-[15px] border px-4', meta.tint)}>
      <span className={cn('flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full', meta.dot)}>
        <meta.Icon className="h-4 w-4 text-white" strokeWidth={2.8} />
      </span>
      <span className="flex-1 truncate text-left font-headline text-[16px] font-bold lowercase tracking-[-0.02em] text-foreground">
        {meta.label}{name ? `, ${name}` : ''}
      </span>
      <button
        type="button"
        onClick={onChangeAnswer}
        className="flex h-11 flex-shrink-0 items-center font-ui text-[13px] font-semibold text-primary active:opacity-60"
      >
        change my answer
      </button>
    </div>
  );
}

function RsvpButtons({ submitting, onPick }: { submitting: RsvpAnswer | null; onPick: (a: RsvpAnswer) => void }) {
  const busy = submitting !== null;
  const btn = (label: string, kind: RsvpAnswer) => {
    const primary = kind === 'in';
    const pressed = submitting === kind;
    return (
      <button
        key={kind}
        type="button"
        disabled={busy}
        onClick={() => onPick(kind)}
        className={cn(
          'flex h-[52px] items-center justify-center gap-1.5 rounded-[15px] font-headline lowercase tracking-[-0.02em] transition-all duration-150',
          primary
            ? 'flex-[1.4] bg-primary text-[17px] font-bold text-primary-foreground shadow-fab'
            : 'flex-1 border border-border text-[14.5px] font-bold text-foreground',
          pressed && 'scale-[0.96]',
          busy && !pressed && 'opacity-50',
        )}
      >
        {primary && <Check className="h-[19px] w-[19px]" strokeWidth={2.6} />}
        {label}
      </button>
    );
  };
  return <div className="flex gap-2.5">{btn("i'm in", 'in')}{btn('maybe', 'maybe')}{btn("can't", 'out')}</div>;
}

const STATUS_COPY: Partial<Record<MovieNightStatus, string>> = {
  cancelled: 'this movie night was cancelled.',
  completed: 'this movie night already happened.',
  didnt_happen: "this one didn't end up happening. it happens.",
};

// ── the page ─────────────────────────────────────────────────────────────

type Phase = 'loading' | 'ready' | 'notfound' | 'error';

export default function ClientPage() {
  const params = useParams();
  const code = typeof params?.code === 'string' ? params.code : '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [night, setNight] = useState<MovieNightPublicView | null>(null);

  const [guestId, setGuestId] = useState('');
  const [name, setName] = useState('');
  const [settledAnswer, setSettledAnswer] = useState<RsvpAnswer | null>(null);
  const [editingAnswer, setEditingAnswer] = useState(false);
  const [submitting, setSubmitting] = useState<RsvpAnswer | null>(null);
  const [rsvpError, setRsvpError] = useState<string | null>(null);

  useEffect(() => {
    setGuestId(getOrCreateGuestId());
    setName(loadStoredName());
  }, []);

  useEffect(() => {
    if (!code || code === '_') {
      setPhase('notfound');
      return;
    }
    let cancelled = false;
    setPhase('loading');
    (async () => {
      try {
        const view = await apiCall<MovieNightPublicView>(
          'GET',
          `/api/v1/movie-nights/shared/${encodeURIComponent(code)}`,
          undefined,
          { skipAuth: true },
        );
        if (cancelled) return;
        setNight(view);
        setPhase('ready');
        const stored = loadStoredAnswer(code);
        if (stored) {
          setSettledAnswer(stored.answer);
          setName((prev) => prev || stored.name);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.code === 'NOT_FOUND') {
          setPhase('notfound');
        } else {
          setPhase('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  async function handleRsvp(answer: RsvpAnswer) {
    if (!night || submitting) return;
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) {
      setRsvpError('tell us what to call you first.');
      return;
    }
    setSubmitting(answer);
    setRsvpError(null);
    try {
      const updated = await apiCall<MovieNightPublicView>(
        'POST',
        `/api/v1/movie-nights/shared/${encodeURIComponent(code)}/rsvp`,
        { guestId, name: trimmed, answer },
        { skipAuth: true },
      );
      setNight(updated);
      setSettledAnswer(answer);
      setEditingAnswer(false);
      saveGuestRsvp(code, trimmed, answer);
    } catch (err) {
      setRsvpError(err instanceof ApiClientError ? err.message : 'could not save your answer. try again.');
    } finally {
      setSubmitting(null);
    }
  }

  if (phase === 'loading') return <Skeleton />;
  if (phase === 'notfound') {
    return <UnavailableState message="we couldn't find this movie night. the link may be old, or the plan got cancelled." />;
  }
  if (phase === 'error' || !night) {
    return <UnavailableState message="something went wrong loading this movie night. try again in a moment." />;
  }

  const isOpen = night.status === 'proposed';
  const hostHandle = night.hostUsername ? `@${night.hostUsername}` : night.hostName;
  const goingCount = night.counts.going;
  const showSettled = isOpen && settledAnswer && !editingAnswer;
  const icsUrl = `${apiOrigin()}/api/v1/movie-nights/shared/${encodeURIComponent(code)}/calendar.ics`;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <Hero film={night.film} />
      <div className="flex-1 px-[22px] pb-safe pt-6 text-center">
        {isOpen ? (
          <Eyebrow>you&apos;re invited</Eyebrow>
        ) : (
          <Eyebrow tone="muted">movie night</Eyebrow>
        )}
        <BigDateTime iso={night.scheduledFor} tzOffsetMinutes={night.tzOffsetMinutes} />

        <div className="mt-5 flex items-center justify-center gap-2.5">
          {night.going.length > 0 && (
            <div className="flex">
              {night.going.slice(0, 5).map((g, i) => (
                <div key={i} className="rounded-full ring-2 ring-background" style={i ? { marginLeft: -10 } : undefined}>
                  <ProfileAvatar photoURL={g.photoURL} displayName={g.name} size="sm" />
                </div>
              ))}
            </div>
          )}
          <span className="font-ui text-[14px] font-semibold text-muted-foreground">
            {goingCount > 0 ? `${goingCount} going · ` : ''}hosted by <b className="font-bold text-foreground">{hostHandle}</b>
          </span>
        </div>

        {isOpen ? (
          <p className="mx-auto mt-5 max-w-[280px] font-serif text-[15.5px] italic leading-[1.5] text-muted-foreground">
            {night.hostName} wants to watch {night.film.title.toLowerCase()} with you.
          </p>
        ) : (
          <p className="mx-auto mt-5 max-w-[280px] font-serif text-[15.5px] italic leading-[1.5] text-muted-foreground">
            {STATUS_COPY[night.status]}
          </p>
        )}

        {isOpen && (
          <div className="mt-6">
            {showSettled && settledAnswer ? (
              <SettledRow answer={settledAnswer} name={name} onChangeAnswer={() => setEditingAnswer(true)} />
            ) : (
              <div className="text-left">
                <label htmlFor="guest-name" className="cc-eyebrow block text-center text-muted-foreground">
                  what should we call you
                </label>
                <input
                  id="guest-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 30))}
                  maxLength={30}
                  placeholder="your name"
                  autoComplete="name"
                  className="mt-2 h-12 w-full rounded-[14px] border border-hair bg-sunken px-3.5 text-center font-body text-[15px] text-foreground placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <div className="mt-3.5">
                  <RsvpButtons submitting={submitting} onPick={handleRsvp} />
                </div>
                {rsvpError && <p className="mt-2.5 text-center font-mono text-[11px] text-destructive">{rsvpError}</p>}
              </div>
            )}
          </div>
        )}

        {showSettled && (
          <div className="mt-5 space-y-3">
            <a
              href={icsUrl}
              className="flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl border border-hair bg-card font-ui text-[14.5px] font-semibold text-foreground active:scale-[0.99]"
            >
              <CalendarPlus className="h-[17px] w-[17px] text-muted-foreground" strokeWidth={2} />
              add to calendar
            </a>
            <a
              href={APP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-center py-2.5 text-center font-ui text-[13.5px] font-semibold text-primary active:opacity-60"
            >
              see what everyone thought after · get cinechrony
            </a>
          </div>
        )}

        {!isOpen && (
          <div className="mt-6">
            <a
              href={APP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-center py-2.5 text-center font-ui text-[13.5px] font-semibold text-primary active:opacity-60"
            >
              get cinechrony
            </a>
          </div>
        )}

        <Footer />
      </div>
    </div>
  );
}
