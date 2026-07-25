'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDays, startOfDay } from 'date-fns';
import { CalendarCheck } from 'lucide-react';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { describeNightCta } from './night-ui';
import { DateTimeSheet, TimeEntrySheet } from './create-night-sheet';
import { formatNightDate, formatNightTime } from '@/lib/movie-night-format';
import type { MovieNightView } from '@/lib/movie-night-types';

/**
 * MN34 — "the reschedule picker": the create flow's `DateTimeSheet`/
 * `TimeEntrySheet` reused with the RESCHEDULING · new night framing + the
 * struck-through "moving from <old>" context row pinned on top
 * (MOVIE-NIGHT-PLAN.md § S4). Host-only (`PATCH .../[id]` `action:'reschedule'`
 * enforces it server-side) — every call site gates on `night.viewer.isHost`
 * before rendering this.
 *
 * Three entry points share this ONE component (the "upgrade the S3b plain
 * reuse to this framed variant" from the plan): the host's "edit time &
 * details" (MN13, `night-detail-sheet.tsx`), the didn't-happen record's
 * "pick a new night" footer (MN27), and the morning-after "it didn't happen"
 * path's "pick a new night" (MN25b, `morning-after-sheet.tsx`).
 */

type TimeOfDay = { hour: number; minute: number };

function combineDateAndTime(day: Date, t: TimeOfDay): Date {
  const d = new Date(day);
  d.setHours(t.hour, t.minute, 0, 0);
  return d;
}

export function RescheduleFlow({
  isOpen, night, onClose, onRescheduled,
}: { isOpen: boolean; night: MovieNightView; onClose: () => void; onRescheduled: (n: MovieNightView) => void }) {
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date(night.scheduledFor)));
  const [selectedTime, setSelectedTime] = useState<TimeOfDay>(() => {
    const d = new Date(night.scheduledFor);
    return { hour: d.getHours(), minute: d.getMinutes() };
  });
  const [showTimeEntry, setShowTimeEntry] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const d = new Date(night.scheduledFor);
    setSelectedDate(startOfDay(d));
    setSelectedTime({ hour: d.getHours(), minute: d.getMinutes() });
    setShowTimeEntry(false);
    setSubmitting(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, night.id]);

  const today = useMemo(() => startOfDay(new Date()), [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const fridayTarget = useMemo(() => addDays(today, (5 - today.getDay() + 7) % 7), [today]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i)), [today]);

  const scheduledFor = useMemo(() => combineDateAndTime(selectedDate, selectedTime), [selectedDate, selectedTime]);
  const isPast = scheduledFor.getTime() <= Date.now();
  const cta = describeNightCta(night.film, scheduledFor, 'reschedule');

  // "moving from thu 24.07 · 8pm" — the night's CURRENT scheduledFor (about
  // to become `previousScheduledFor`), formatted with its own tz convention.
  const movingFromLabel = `${formatNightDate(night.scheduledFor, night.tzOffsetMinutes)} · ${formatNightTime(night.scheduledFor, night.tzOffsetMinutes)}`;

  async function submit(when: Date) {
    if (submitting) return;
    if (when.getTime() <= Date.now()) { setError("pick a night that hasn't happened yet"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiCall<MovieNightView>('PATCH', `/api/v1/movie-nights/${night.id}`, {
        action: 'reschedule',
        scheduledFor: when.toISOString(),
      });
      haptic('success');
      onRescheduled(updated);
      onClose();
    } catch (err) {
      haptic('error');
      setError(err instanceof ApiClientError ? err.message : 'could not reschedule. try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DateTimeSheet
        isOpen={isOpen}
        film={night.film}
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
        onOpenFilmPicker={() => {}}
        onOpenTimeEntry={() => setShowTimeEntry(true)}
        onClose={onClose}
        onPropose={() => submit(scheduledFor)}
        hideFilmRow
        ctaLabel="reschedule it"
        ctaIcon={CalendarCheck}
        eyebrow="rescheduling"
        title="new night"
        movingFromLabel={movingFromLabel}
      />
      <TimeEntrySheet
        isOpen={isOpen && showTimeEntry}
        film={night.film}
        baseDate={selectedDate}
        initial={selectedTime}
        submitting={submitting}
        error={error}
        onDone={(t) => { setSelectedTime(t); setShowTimeEntry(false); }}
        onClose={() => setShowTimeEntry(false)}
        onSubmit={(when) => submit(when)}
        ctaLabel="reschedule it"
        ctaIcon={CalendarCheck}
        ctaSubOverride="reschedule"
      />
    </>
  );
}
