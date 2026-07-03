'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useToast } from '@/hooks/use-toast';

/**
 * Listens for globally emitted 'permission-error' events.
 *
 * AUDIT.md 2.4: this used to `throw` the error during render, which crashed
 * the ENTIRE React tree into global-error.tsx. On a mobile PWA that means a
 * routine transient blip — logging out while a listener is still attached, a
 * Firestore rule change racing a write, momentary offline — took the whole app
 * down. We now surface it non-fatally: a console error for developer
 * diagnostics + a toast for the user. The app keeps running.
 */
export function FirebaseErrorListener() {
  const { toast } = useToast();

  useEffect(() => {
    const handleError = (error: FirestorePermissionError) => {
      console.error('[FirebaseErrorListener] Firestore permission error:', error);
      // Report to Sentry (no-op until DSN set) — a spike in these usually means a
      // firestore.rules regression or a listener attached after sign-out.
      Sentry.captureException(error, { tags: { source: 'firestore-permission' } });
      toast({
        variant: 'destructive',
        title: 'Action blocked',
        description:
          "That didn't go through. If it keeps happening, try refreshing or signing in again.",
      });
    };

    errorEmitter.on('permission-error', handleError);
    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, [toast]);

  // Renders nothing — never throws.
  return null;
}
