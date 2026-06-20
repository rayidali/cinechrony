/**
 * Login-by-identifier — Phase 0.7 Wave 7. Lets the login screen (006) accept an
 * EMAIL or an @USERNAME without leaking the private email.
 *
 * Flow: resolve the identifier to an email server-side (username → uid →
 * `users_private/{uid}.email`, never returned to the client), verify the
 * password via the Identity Toolkit REST endpoint, and on success mint a Firebase
 * custom token the client exchanges with `signInWithCustomToken`. Failures all
 * collapse to one generic `InvalidCredentialsError` (no account-existence oracle —
 * AUDIT 2.10 posture).
 *
 * Email logins go straight through the Web SDK on the client; this endpoint
 * exists for the username path (and as a uniform fallback).
 */

import { getAuth } from 'firebase-admin/auth';
import { getDb, getFirebaseAdminApp } from '@/firebase/admin';

export class InvalidCredentialsError extends Error {
  constructor(message = 'Incorrect email/username or password.') {
    super(message);
    this.name = 'InvalidCredentialsError';
  }
}

const EMAIL_RE = /^\S+@\S+\.\S+$/;

async function emailForHandle(handle: string): Promise<string | null> {
  const normalized = handle.replace(/^@/, '').toLowerCase().trim();
  if (!normalized) return null;
  const db = getDb();
  let snap = await db.collection('users').where('usernameLower', '==', normalized).limit(1).get();
  if (snap.empty) {
    snap = await db.collection('users').where('username', '==', normalized).limit(1).get();
  }
  if (snap.empty) return null;
  const uid = snap.docs[0].id;
  const priv = await db.collection('users_private').doc(uid).get();
  const email = priv.data()?.email;
  return typeof email === 'string' && email ? email : null;
}

export async function loginWithIdentifier(
  identifier: string,
  password: string,
): Promise<{ customToken: string }> {
  const id = (identifier || '').trim();
  if (!id || !password) throw new InvalidCredentialsError();

  const email = EMAIL_RE.test(id) ? id : await emailForHandle(id);
  if (!email) throw new InvalidCredentialsError();

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error('Firebase API key not configured.');

  // Verify the password against Firebase Auth (Admin SDK can't verify passwords).
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const json = (await res.json().catch(() => null)) as { localId?: string } | null;
  if (!res.ok || !json?.localId) throw new InvalidCredentialsError();

  const customToken = await getAuth(getFirebaseAdminApp()).createCustomToken(json.localId);
  return { customToken };
}
