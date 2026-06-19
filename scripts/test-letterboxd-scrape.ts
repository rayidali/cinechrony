/**
 * Dry-run harness for the Letterboxd username scrape engine.
 *
 *   1. Put your Apify token in .env.local  →  APIFY_TOKEN=apify_api_xxx
 *      (or pass it inline: APIFY_TOKEN=xxx npx tsx scripts/test-letterboxd-scrape.ts <user>)
 *   2. Run:   npx tsx scripts/test-letterboxd-scrape.ts <letterboxd-username>
 *
 * It scrapes the public library and PRINTS what it found (counts + samples).
 * It writes NOTHING to the database — purely to confirm the parser works
 * before we wire it to onboarding.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scrapeLetterboxdLibrary } from '../src/lib/letterboxd-scrape-server';

// Minimal .env.local loader (so you don't have to export the token by hand).
function loadEnvLocal() {
  try {
    const txt = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env.local — rely on the inline env var */
  }
}

async function main() {
  loadEnvLocal();
  const username = process.argv[2];
  const token = process.env.APIFY_TOKEN;

  if (!username) {
    console.error('Usage: npx tsx scripts/test-letterboxd-scrape.ts <letterboxd-username>');
    process.exit(1);
  }
  if (!token) {
    console.error('Missing APIFY_TOKEN — add it to .env.local or pass it inline.');
    process.exit(1);
  }

  console.log(`\nScraping letterboxd.com/${username}/ …  (this runs an Apify actor; ~30–90s)\n`);
  const t0 = Date.now();
  const { data, summary } = await scrapeLetterboxdLibrary(username, { token });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('────────────────────────────────────────');
  console.log(`  summary for @${summary.username}  (${secs}s)`);
  console.log('────────────────────────────────────────');
  console.log(`  watched    : ${summary.watched}`);
  console.log(`  ratings    : ${summary.ratings}`);
  console.log(`  watchlist  : ${summary.watchlist}`);
  console.log(`  reviews    : ${summary.reviews}`);
  console.log(`  lists      : ${summary.lists}`);
  console.log(`  favorites  : ${summary.favorites}`);
  console.log(`  missingYear: ${summary.missingYear}  (matched by title only if >0)`);
  console.log('────────────────────────────────────────\n');

  const sample = (label: string, arr: Array<Record<string, unknown>>) => {
    console.log(`  ${label} (first 5):`);
    arr.slice(0, 5).forEach((r) => console.log('    ', JSON.stringify(r)));
    if (arr.length === 0) console.log('     (none)');
    console.log('');
  };
  sample('watched', data.watched);
  sample('ratings', data.ratings);
  sample('reviews', data.reviews as Array<Record<string, unknown>>);
  console.log('  lists:');
  data.lists.forEach((l) => console.log(`     "${l.name}" — ${l.movies.length} films`));
  if (data.lists.length === 0) console.log('     (none)');
  console.log('');
  sample('favorites', data.favorites);

  if (summary.watched === 0) {
    console.warn('⚠ 0 films parsed. Either the profile is private/empty, the actor was');
    console.warn('  blocked (check the Apify run log), or the grid selectors need a tweak.');
  }
}

main().catch((err) => {
  console.error('\n✖ scrape failed:', err?.message || err);
  process.exit(1);
});
