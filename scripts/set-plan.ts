/**
 * set-plan — set an account's plan tier, which is what governs its weekly scan
 * budget (`PLAN_LIMITS` in src/lib/extraction-server.ts).
 *
 * Admin SDK only. The plan lives on `users_private/{uid}`, which
 * `firestore.rules` denies to ALL client access — a user can never grant
 * themselves a tier, which is the whole point of keeping it there.
 *
 *   npx tsx scripts/set-plan.ts <username> unlimited   # uncap (staff/maintainer)
 *   npx tsx scripts/set-plan.ts <username> free        # back to 7/week
 *   npx tsx scripts/set-plan.ts <username>             # just report current state
 *
 * Note `unlimited` skips ENFORCEMENT but not COUNTING — `scanUsage` keeps
 * accruing, because that counter is the only per-account view of real
 * Apify+Gemini spend. Check it here before assuming an uncapped account is free.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getDb } from '../src/firebase/admin';
import { resolveUidByUsername } from '../src/lib/verified-server';
import { PLAN_LIMITS, currentWeekKey } from '../src/lib/extraction-server';

async function main() {
  const username = process.argv[2];
  const plan = process.argv[3];
  if (!username) {
    console.error('usage: npx tsx scripts/set-plan.ts <username> [plan]');
    console.error(`known plans: ${Object.keys(PLAN_LIMITS).join(', ')}`);
    process.exit(1);
  }
  if (plan && !PLAN_LIMITS[plan]) {
    console.error(`✗ unknown plan "${plan}". known: ${Object.keys(PLAN_LIMITS).join(', ')}`);
    console.error('  (an unknown plan would silently fall back to free — refusing.)');
    process.exit(1);
  }

  const uid = await resolveUidByUsername(username);
  if (!uid) {
    console.error(`✗ no account found for @${username.replace(/^@/, '')}`);
    process.exit(1);
  }

  const db = getDb();
  const ref = db.collection('users_private').doc(uid);
  const before = (await ref.get()).data() as
    | { plan?: string; scanUsage?: { week?: string; used?: number } }
    | undefined;

  const week = currentWeekKey();
  const used = before?.scanUsage?.week === week ? (before.scanUsage.used ?? 0) : 0;
  console.log(`@${username.replace(/^@/, '')} (${uid})`);
  console.log(`  current plan : ${before?.plan ?? 'free (unset)'}`);
  console.log(`  this week    : ${used} scan(s) claimed (week of ${week})`);

  if (!plan) {
    console.log('\nno plan argument — nothing written.');
    process.exit(0);
  }
  if (before?.plan === plan) {
    console.log(`\nalready on "${plan}" — nothing written.`);
    process.exit(0);
  }

  // merge:true — this doc also holds scanUsage and the letterboxd import state.
  await ref.set({ plan }, { merge: true });
  const entry = PLAN_LIMITS[plan];
  console.log(
    `\n✓ plan → "${plan}" (${entry.unlimited ? 'uncapped' : `${entry.scansPerWeek}/week`})`,
  );
  console.log('  takes effect on the next scan; no sign-out needed.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
