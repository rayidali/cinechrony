/**
 * Content-report helpers — Phase A PR #15.
 *
 * AUDIT (App Store §1.2 — User-Generated Content): UGC apps must ship a
 * reporting mechanism. Reports land in `/reports` (server-only) for the
 * developer to review. Rate-limited to stop spam / harassment-by-
 * mass-report; gate is `'report'` in the rate-limit registry.
 *
 * Fixed during migration: the legacy action's runtime validator only
 * accepted `'review' | 'user' | 'list'` despite the type signature
 * including `'post' | 'post_comment'`, so post-side reports silently
 * 400ed. PR #15 accepts all five content types end-to-end.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';

// ─── Typed errors ─────────────────────────────────────────────────────────

export class ReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportValidationError';
  }
}

// ─── Constants ────────────────────────────────────────────────────────────

export const REPORTABLE_TYPES = [
  'review', 'user', 'list', 'post', 'post_comment',
] as const;
export type ReportableType = (typeof REPORTABLE_TYPES)[number];

const MAX_REASON_LEN = 1000;

function isReportableType(t: unknown): t is ReportableType {
  return typeof t === 'string' && (REPORTABLE_TYPES as readonly string[]).includes(t);
}

// ─── reportContent ───────────────────────────────────────────────────────

export async function reportContent(
  callerUid: string,
  contentType: unknown,
  targetId: unknown,
  reason: unknown,
): Promise<void> {
  if (!isReportableType(contentType)) {
    throw new ReportValidationError('Invalid contentType.');
  }
  if (typeof targetId !== 'string' || !targetId) {
    throw new ReportValidationError('targetId is required.');
  }

  const db = getDb();
  await db.collection('reports').add({
    reporterId: callerUid,
    contentType,
    targetId,
    reason: (typeof reason === 'string' ? reason : '').trim().slice(0, MAX_REASON_LEN),
    status: 'pending', // pending → reviewed → actioned/dismissed
    createdAt: FieldValue.serverTimestamp(),
  });
}
