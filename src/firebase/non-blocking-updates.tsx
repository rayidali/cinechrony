'use client';

import {
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  CollectionReference,
  DocumentReference,
  SetOptions,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

type WriteCtx = {
  path: string;
  operation: 'create' | 'update' | 'delete' | 'write';
  requestResourceData?: unknown;
};

/**
 * AUDIT.md 2.4: previously EVERY failed non-blocking write emitted
 * 'permission-error' — network blips, offline, quota, malformed data all got
 * misclassified as a security-rules problem (and used to crash the app). These
 * writes are fire-and-forget by design; a transient failure is not fatal.
 * Only a genuine `permission-denied` belongs on the permission-error channel
 * (it carries the rich rule-debugging payload). Everything else is logged.
 */
function reportWriteError(error: unknown, ctx: WriteCtx) {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'permission-denied') {
    errorEmitter.emit(
      'permission-error',
      new FirestorePermissionError({
        path: ctx.path,
        operation: ctx.operation,
        requestResourceData: ctx.requestResourceData,
      })
    );
    return;
  }
  // Transient / non-permission failure — diagnostic only, non-fatal.
  console.error(
    `[non-blocking ${ctx.operation}] ${ctx.path} failed (${code ?? 'unknown'}):`,
    error
  );
}

/**
 * Initiates a setDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function setDocumentNonBlocking(docRef: DocumentReference, data: any, options: SetOptions) {
  setDoc(docRef, data, options).catch((error) =>
    reportWriteError(error, { path: docRef.path, operation: 'write', requestResourceData: data })
  );
  // Execution continues immediately
}

/**
 * Initiates an addDoc operation for a collection reference.
 * Does NOT await the write operation internally.
 * Returns the Promise for the new doc ref, but typically not awaited by caller.
 */
export function addDocumentNonBlocking(colRef: CollectionReference, data: any) {
  const promise = addDoc(colRef, data).catch((error) =>
    reportWriteError(error, { path: colRef.path, operation: 'create', requestResourceData: data })
  );
  return promise;
}

/**
 * Initiates an updateDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function updateDocumentNonBlocking(docRef: DocumentReference, data: any) {
  updateDoc(docRef, data).catch((error) =>
    reportWriteError(error, { path: docRef.path, operation: 'update', requestResourceData: data })
  );
}

/**
 * Initiates a deleteDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function deleteDocumentNonBlocking(docRef: DocumentReference) {
  deleteDoc(docRef).catch((error) =>
    reportWriteError(error, { path: docRef.path, operation: 'delete' })
  );
}
