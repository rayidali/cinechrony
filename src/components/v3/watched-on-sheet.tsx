'use client';

import { useEffect, useMemo, useState } from 'react';
import { Drawer } from 'vaul';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import {
  format, startOfMonth, addMonths, getDaysInMonth, getDay, isSameDay,
  isSameMonth, subDays,
} from 'date-fns';
import { haptic } from '@/lib/haptics';

/**
 * F04 "watched on" — a bottom sheet over the composer. Quick chips
 * (today / yesterday / earlier) + a full month grid. Future dates are
 * disabled (you can't have watched a film tomorrow). `done` commits the
 * highlighted date; cancel / swipe-down leaves it untouched.
 */
const WEEKDAYS = ['s', 'm', 't', 'w', 't', 'f', 's'];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function WatchedOnSheet({
  isOpen,
  value,
  movieTitle,
  onClose,
  onSelect,
}: {
  isOpen: boolean;
  value: Date | null;
  movieTitle: string;
  onClose: () => void;
  onSelect: (date: Date) => void;
}) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const yesterday = useMemo(() => subDays(today, 1), [today]);

  const [month, setMonth] = useState<Date>(startOfMonth(value ?? today));
  const [sel, setSel] = useState<Date>(value ?? today);

  // Fresh state each open.
  useEffect(() => {
    if (isOpen) {
      const base = value ? startOfDay(value) : today;
      setSel(base);
      setMonth(startOfMonth(base));
    }
  }, [isOpen, value, today]);

  const daysInMonth = getDaysInMonth(month);
  const leadingBlanks = getDay(startOfMonth(month)); // 0 = Sunday
  const atCurrentMonth = isSameMonth(month, today);

  const pick = (d: Date) => {
    if (startOfDay(d) > today) return; // no future
    haptic('selection');
    setSel(startOfDay(d));
  };

  const commit = () => {
    haptic('success');
    onSelect(sel);
    onClose();
  };

  const chip = (label: string, active: boolean, onTap: () => void, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onTap}
      className={`flex-1 h-10 rounded-full border font-headline font-bold text-[14px] lowercase tracking-[-0.02em] transition-colors active:opacity-70 disabled:opacity-40 ${
        active ? 'border-transparent bg-foreground text-background' : 'border-hair bg-card text-foreground'
      }`}
    >
      {label}
    </button>
  );

  const selIsToday = isSameDay(sel, today);
  const selIsYesterday = isSameDay(sel, yesterday);

  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[95]" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[95] flex flex-col rounded-t-[22px] bg-card outline-none max-h-[88vh]">
          <Drawer.Title className="sr-only">Watched on</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />

          {/* header */}
          <div className="flex items-center justify-between px-5 py-2.5">
            <button onClick={() => { haptic('light'); onClose(); }} className="font-ui font-semibold text-[15px] text-muted-foreground active:opacity-60">
              cancel
            </button>
            <span className="font-headline font-bold text-[18px] lowercase tracking-[-0.02em]">watched on</span>
            <button onClick={commit} className="font-ui font-bold text-[15px] text-primary active:opacity-60">
              done
            </button>
          </div>

          <div className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] overflow-y-auto">
            {/* quick chips */}
            <div className="flex gap-2.5 pt-1">
              {chip('today', selIsToday, () => { setMonth(startOfMonth(today)); pick(today); })}
              {chip('yesterday', selIsYesterday, () => { setMonth(startOfMonth(yesterday)); pick(yesterday); })}
              {chip('earlier', !selIsToday && !selIsYesterday, () => { haptic('light'); }, false)}
            </div>

            {/* month nav */}
            <div className="mt-5 mb-1 flex items-center justify-between">
              <h3 className="font-headline font-bold text-[19px] lowercase tracking-[-0.02em]">
                {format(month, 'MMMM yyyy').toLowerCase()}
              </h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => { haptic('light'); setMonth(addMonths(month, -1)); }}
                  className="h-9 w-9 rounded-full flex items-center justify-center text-foreground active:bg-foreground/5"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
                </button>
                <button
                  type="button"
                  disabled={atCurrentMonth}
                  onClick={() => { if (atCurrentMonth) return; haptic('light'); setMonth(addMonths(month, 1)); }}
                  className="h-9 w-9 rounded-full flex items-center justify-center text-foreground active:bg-foreground/5 disabled:opacity-30"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-5 w-5" strokeWidth={2.2} />
                </button>
              </div>
            </div>

            {/* weekday header */}
            <div className="grid grid-cols-7 mt-2">
              {WEEKDAYS.map((d, i) => (
                <div key={i} className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground py-1.5">
                  {d}
                </div>
              ))}
            </div>

            {/* day grid */}
            <div className="grid grid-cols-7 gap-y-1">
              {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`b${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayDate = new Date(month.getFullYear(), month.getMonth(), day);
                const isFuture = startOfDay(dayDate) > today;
                const isSel = isSameDay(dayDate, sel);
                return (
                  <div key={day} className="flex items-center justify-center py-0.5">
                    <button
                      type="button"
                      disabled={isFuture}
                      onClick={() => pick(dayDate)}
                      className={`h-10 w-10 rounded-full flex items-center justify-center font-headline text-[15px] tabular-nums transition-colors ${
                        isSel
                          ? 'bg-primary text-primary-foreground font-bold'
                          : isFuture
                            ? 'text-muted-foreground/30'
                            : 'text-foreground active:bg-foreground/5'
                      }`}
                    >
                      {day}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* footer */}
            <div className="mt-4 flex items-center justify-center gap-1.5 font-mono text-[10px] text-muted-foreground lowercase">
              <CalendarDays className="h-3 w-3" strokeWidth={2} />
              <span>logging <span className="font-bold">{movieTitle.toLowerCase()}</span> · watched {format(sel, 'MMM d, yyyy').toLowerCase()}</span>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
