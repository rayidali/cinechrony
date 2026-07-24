'use client';

import { useEffect } from 'react';
import { Popcorn } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

/**
 * MN33 — the reminder push arriving mid-scroll becomes a soft in-app toast
 * instead of a dead system banner (MOVIE-NIGHT-PLAN.md § S4). There is no
 * existing foreground-push listener anywhere in the codebase (`native-push.ts`
 * wires token rotation + notification-TAP routing only — nothing handles a
 * push arriving while the app is already open) — this narrowly adds ONE for
 * `@capacitor-firebase/messaging`'s `notificationReceived` event, filtered to
 * `data.type === 'movie_night_reminder'` only. Every OTHER push type is left
 * completely untouched: no suppression logic changes anywhere, iOS still
 * shows its normal system banner for them while the app is foregrounded —
 * per the plan's instruction to build this "narrowly... leave other types
 * untouched" since no general foreground-push hook existed to extend.
 *
 * Web has no equivalent (the Service Worker's `push` handler has no
 * "app already open" signal either) — this is native-only by construction
 * (`Capacitor.isNativePlatform()` gate) and silently no-ops on web/PWA.
 *
 * Takes `onOpenNight` as a PROP (not `useMovieNight()`) so this file and
 * `movie-night-provider.tsx` — which mounts it — don't import each other.
 */
export function MovieNightReminderToastBridge({ onOpenNight }: { onOpenNight: (id: string) => void }) {
  const { toast } = useToast();

  useEffect(() => {
    let removed = false;
    let handle: { remove: () => void } | null = null;

    (async () => {
      const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      if (cap?.isNativePlatform?.() !== true) return;
      try {
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
        if (removed) return;
        handle = await FirebaseMessaging.addListener('notificationReceived', (event) => {
          try {
            const data = (event?.notification?.data ?? {}) as Record<string, unknown>;
            if (data?.type !== 'movie_night_reminder') return; // every other type: untouched
            const nightId = typeof data.nightId === 'string' ? data.nightId : null;
            const body = event?.notification?.body || 'tonight: your movie night.';
            // `title` is typed `string` (it collides with the native HTML `title`
            // attribute on the underlying element) — the popcorn glyph + copy
            // combo lives in `description`, which has no such conflict.
            toast({
              title: 'movie night',
              description: (
                <span className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] bg-primary">
                    <Popcorn className="h-[15px] w-[15px] text-primary-foreground" strokeWidth={2} />
                  </span>
                  <span className="font-ui text-[13.5px] font-semibold leading-snug text-foreground">{body}</span>
                </span>
              ),
              action: nightId ? (
                <ToastAction altText="view the movie night" onClick={() => onOpenNight(nightId)}>view</ToastAction>
              ) : undefined,
            });
          } catch (err) {
            console.error('[movie-night] foreground reminder toast failed:', err);
          }
        });
      } catch (err) {
        console.error('[movie-night] notificationReceived listener failed:', err);
      }
    })();

    return () => {
      removed = true;
      handle?.remove();
    };
  }, [toast, onOpenNight]);

  return null;
}
