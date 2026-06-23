/**
 * grant-verified — flip an account's official/verified status (+ admin claim).
 *
 * Admin SDK only (bypasses firestore.rules). Loads prod creds from .env.local.
 *
 *   npx tsx scripts/grant-verified.ts <username>            # grant
 *   npx tsx scripts/grant-verified.ts <username> --revoke   # revoke
 *
 * After granting, the account must log out/in once to pick up the new custom
 * claim (the BADGE shows immediately — it reads the Firestore flag, not the claim).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { resolveUidByUsername, setVerified } from '../src/lib/verified-server';

async function main() {
  const username = process.argv[2];
  const revoke = process.argv.includes('--revoke');
  if (!username) {
    console.error('usage: npx tsx scripts/grant-verified.ts <username> [--revoke]');
    process.exit(1);
  }

  const uid = await resolveUidByUsername(username);
  if (!uid) {
    console.error(`✗ no account found for @${username.replace(/^@/, '')}`);
    process.exit(1);
  }

  const verified = !revoke;
  await setVerified(uid, verified, Date.now());
  console.log(`✓ ${verified ? 'granted' : 'revoked'} verified + admin for @${username.replace(/^@/, '')} (uid: ${uid})`);
  console.log('  → the account should log out and back in once to refresh its token claim.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
