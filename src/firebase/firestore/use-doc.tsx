'use client';
    
import { useState, useEffect, useRef } from 'react';
import {
  DocumentReference,
  onSnapshot,
  DocumentData,
  FirestoreError,
  DocumentSnapshot,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

/** Utility type to add an 'id' field to a given type T. */
type WithId<T> = T & { id: string };

/**
 * Interface for the return value of the useDoc hook.
 * @template T Type of the document data.
 */
export interface UseDocResult<T> {
  data: WithId<T> | null; // Document data with ID, or null.
  isLoading: boolean;       // True if loading.
  error: FirestoreError | Error | null; // Error object, or null.
}

/**
 * React hook to subscribe to a single Firestore document in real-time.
 * Handles nullable references.
 * 
 * IMPORTANT! YOU MUST MEMOIZE the inputted memoizedTargetRefOrQuery or BAD THINGS WILL HAPPEN
 * use useMemo to memoize it per React guidence.  Also make sure that it's dependencies are stable
 * references
 *
 *
 * @template T Optional type for document data. Defaults to any.
 * @param {DocumentReference<DocumentData> | null | undefined} docRef -
 * The Firestore DocumentReference. Waits if null/undefined.
 * @returns {UseDocResult<T>} Object with data, isLoading, error.
 */
export function useDoc<T = any>(
  memoizedDocRef: DocumentReference<DocumentData> | null | undefined,
): UseDocResult<T> {
  type StateDataType = WithId<T> | null;

  const [data, setData] = useState<StateDataType>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<FirestoreError | Error | null>(null);
  // A Firestore onSnapshot listener is DEAD after its error callback fires (token
  // expiry / dropped WebChannel after the app is backgrounded). Bumping this tick
  // re-runs the effect to re-subscribe, so the UI self-heals without an app
  // restart. attemptRef drives the backoff; lastRefRef distinguishes a real ref
  // change from a retry of the same ref.
  const [retryTick, setRetryTick] = useState(0);
  const attemptRef = useRef(0);
  const lastRefRef = useRef<DocumentReference<DocumentData> | null>(null);

  useEffect(() => {
    if (!memoizedDocRef) {
      setData(null);
      setIsLoading(false);
      setError(null);
      attemptRef.current = 0;
      lastRefRef.current = null;
      return;
    }

    if (lastRefRef.current !== memoizedDocRef) {
      lastRefRef.current = memoizedDocRef;
      attemptRef.current = 0;
      setIsLoading(true); // fresh target → show loading; retries keep stale data
    }
    setError(null);

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = onSnapshot(
      memoizedDocRef,
      (snapshot: DocumentSnapshot<DocumentData>) => {
        if (cancelled) return;
        if (snapshot.exists()) {
          setData({ ...(snapshot.data() as T), id: snapshot.id });
        } else {
          setData(null);
        }
        setError(null);
        setIsLoading(false);
        attemptRef.current = 0; // recovered → reset backoff
      },
      (err: FirestoreError) => {
        if (cancelled) return;
        const contextualError = new FirestorePermissionError({
          operation: 'get',
          path: memoizedDocRef.path,
        });
        setError(contextualError);
        setIsLoading(false);
        // Keep the last-known data (no blank flash). Surface the error only on the
        // FIRST failure of a streak so retries don't spam the global toast.
        if (attemptRef.current === 0) errorEmitter.emit('permission-error', contextualError);
        const n = (attemptRef.current = Math.min(attemptRef.current + 1, 6));
        const backoff = Math.min(30000, 1500 * 2 ** (n - 1)); // 1.5s,3,6,12,24,30…
        retryTimer = setTimeout(() => { if (!cancelled) setRetryTick((t) => t + 1); }, backoff);
      },
    );

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe();
    };
  }, [memoizedDocRef, retryTick]); // re-subscribe on ref change OR a scheduled retry

  return { data, isLoading, error };
}