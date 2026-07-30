'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Query,
  onSnapshot,
  DocumentData,
  FirestoreError,
  QuerySnapshot,
  CollectionReference,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import {
  describeListenerFailure,
  isListenerStillSettling,
  isPermissionDenial,
  listenerRetryDelayMs,
  nextListenerAttempt,
  shouldReportListenerFailure,
} from '@/firebase/firestore/listener-recovery';

/** Utility type to add an 'id' field to a given type T. */
export type WithId<T> = T & { id: string };

/**
 * Interface for the return value of the useCollection hook.
 * @template T Type of the document data.
 */
export interface UseCollectionResult<T> {
  data: WithId<T>[] | null; // Document data with ID, or null.
  isLoading: boolean;       // True if loading.
  error: FirestoreError | Error | null; // Error object, or null.
}

/* Internal implementation of Query:
  https://github.com/firebase/firebase-js-sdk/blob/c5f08a9bc5da0d2b0207802c972d53724ccef055/packages/firestore/src/lite-api/reference.ts#L143
*/
export interface InternalQuery extends Query<DocumentData> {
  _query: {
    path: {
      canonicalString(): string;
      toString(): string;
    }
  }
}

/**
 * React hook to subscribe to a Firestore collection or query in real-time.
 * Handles nullable references/queries.
 * 
 *
 * IMPORTANT! YOU MUST MEMOIZE the inputted memoizedTargetRefOrQuery or BAD THINGS WILL HAPPEN
 * use useMemo to memoize it per React guidence.  Also make sure that it's dependencies are stable
 * references
 *  
 * @template T Optional type for document data. Defaults to any.
 * @param {CollectionReference<DocumentData> | Query<DocumentData> | null | undefined} targetRefOrQuery -
 * The Firestore CollectionReference or Query. Waits if null/undefined.
 * @returns {UseCollectionResult<T>} Object with data, isLoading, error.
 */
export function useCollection<T = any>(
    memoizedTargetRefOrQuery: ((CollectionReference<DocumentData> | Query<DocumentData>) & {__memo?: boolean})  | null | undefined,
): UseCollectionResult<T> {
  type ResultItemType = WithId<T>;
  type StateDataType = ResultItemType[] | null;

  const [data, setData] = useState<StateDataType>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<FirestoreError | Error | null>(null);
  // Self-heal: a Firestore listener is DEAD after an error (token expiry / dropped
  // WebChannel after backgrounding). Re-subscribe with backoff so the UI recovers
  // without an app restart, and keep last-known data so it doesn't blank meanwhile.
  const [retryTick, setRetryTick] = useState(0);
  const attemptRef = useRef(0);
  const lastRefRef = useRef<unknown>(null);
  /** Has this query EVER produced a snapshot? Distinguishes "loaded, and the
   *  collection is genuinely empty" from "never got an answer" — the two states
   *  a bare `data === null` conflates. */
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!memoizedTargetRefOrQuery) {
      setData(null);
      setIsLoading(false);
      setError(null);
      attemptRef.current = 0;
      lastRefRef.current = null;
      loadedRef.current = false;
      return;
    }

    if (lastRefRef.current !== memoizedTargetRefOrQuery) {
      lastRefRef.current = memoizedTargetRefOrQuery;
      attemptRef.current = 0;
      loadedRef.current = false; // a DIFFERENT query has loaded nothing yet
      setIsLoading(true); // fresh query → loading; retries keep stale data
    }
    setError(null);

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // Directly use memoizedTargetRefOrQuery as it's assumed to be the final query
    const unsubscribe = onSnapshot(
      memoizedTargetRefOrQuery,
      (snapshot: QuerySnapshot<DocumentData>) => {
        if (cancelled) return;
        const results: ResultItemType[] = [];
        for (const doc of snapshot.docs) {
          results.push({ ...(doc.data() as T), id: doc.id });
        }
        setData(results);
        setError(null);
        setIsLoading(false);
        loadedRef.current = true;
        attemptRef.current = 0; // recovered → reset backoff
      },
      (err: FirestoreError) => {
        if (cancelled) return;
        // This logic extracts the path from either a ref or a query
        const path: string =
          memoizedTargetRefOrQuery.type === 'collection'
            ? (memoizedTargetRefOrQuery as CollectionReference).path
            : (memoizedTargetRefOrQuery as unknown as InternalQuery)._query.path.canonicalString()

        const contextualError = describeListenerFailure(err, 'list', path);
        setError(contextualError);

        const n = (attemptRef.current = nextListenerAttempt(attemptRef.current));
        // A listener that has NEVER loaded is not "empty", it's "still trying" —
        // hold `isLoading` so the screen shows its skeleton instead of an empty
        // state it can't vouch for. See listener-recovery.ts.
        setIsLoading(isListenerStillSettling(loadedRef.current, n));
        // Keep last-known data (no blank flash) and stay quiet until the failure
        // stops being plausibly transient. Only a real rules denial ever reaches
        // the global toast; everything else is a console diagnostic.
        if (shouldReportListenerFailure(n)) {
          if (isPermissionDenial(contextualError)) {
            errorEmitter.emit('permission-error', contextualError as FirestorePermissionError);
          } else {
            console.error('[useCollection] listener failing persistently:', contextualError);
          }
        }
        retryTimer = setTimeout(() => { if (!cancelled) setRetryTick((t) => t + 1); }, listenerRetryDelayMs(n));
      }
    );

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe();
    };
  }, [memoizedTargetRefOrQuery, retryTick]); // re-subscribe on query change OR a scheduled retry
  if(memoizedTargetRefOrQuery && !memoizedTargetRefOrQuery.__memo) {
    throw new Error(memoizedTargetRefOrQuery + ' was not properly memoized using useMemoFirebase');
  }
  return { data, isLoading, error };
}