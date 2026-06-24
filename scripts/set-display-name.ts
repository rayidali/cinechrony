/**
 * set-display-name — set a user's display name (Admin SDK; bypasses rules).
 * Useful for legacy accounts created before the app captured names.
 *
 *   npx tsx scripts/set-display-name.ts <username|email> <name…>
 *
 * Loads prod creds from .env.local. Writes the Firestore profile
 * (displayName + displayNameLower for search) and the Firebase Auth record.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getDb } from '../src/firebase/admin';
import { getAuth } from 'firebase-admin/auth';

async function resolveUid(identifier: string): Promise<string | null> {
  const db = getDb();
  const norm = identifier.toLowerCase().replace(/^@/, '').trim();
  let snap = await db.collection('users').where('usernameLower', '==', norm).limit(1).get();
  if (snap.empty) snap = await db.collection('users').where('username', '==', norm).limit(1).get();
  if (!snap.empty) return snap.docs[0].id;
  // Email fallback via Firebase Auth (email isn't stored on the public user doc).
  try {
    return (await getAuth().getUserByEmail(identifier)).uid;
  } catch {
    return null;
  }
}

async function main() {
  const identifier = process.argv[2];
  const name = process.argv.slice(3).join(' ').trim();
  if (!identifier || !name) {
    console.error('usage: npx tsx scripts/set-display-name.ts <username|email> <name>');
    process.exit(1);
  }

  const uid = await resolveUid(identifier);
  if (!uid) {
    console.error(`✗ no account found for "${identifier}"`);
    process.exit(1);
  }

  await getDb().collection('users').doc(uid).set(
    { displayName: name, displayNameLower: name.toLowerCase(), updatedAt: new Date() },
    { merge: true },
  );
  try {
    await getAuth().updateUser(uid, { displayName: name });
  } catch (e) {
    console.warn('  (auth displayName not updated:', (e as Error).message, ')');
  }

  console.log(`✓ set displayName="${name}" for ${identifier} (uid: ${uid})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
