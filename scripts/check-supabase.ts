/**
 * Verifies Supabase is wired up correctly.
 *
 * Run: npm run check:supabase
 *
 * Checks, in order: env vars present -> credentials accepted -> schema.sql has
 * been run -> writes and reads actually work. Each failure prints the specific
 * fix rather than a generic connection error, because "invalid API key" and
 * "you forgot to run the schema" need completely different responses.
 */

import { createClient } from '@supabase/supabase-js';

const REQUIRED_TABLES = [
  'events',
  'manual_actuals',
  'event_scores',
  'news_items',
  'alert_log',
  'ai_cache',
  // Score history. Added after the initial schema, so an existing project needs
  // the tail of lib/db/schema.sql re-run — this is what makes that visible
  // instead of surfacing as an empty history chart.
  'score_snapshots',
];

function isPlaceholder(v: string | undefined): boolean {
  return !v || v.startsWith('<') || v.includes('PASTE_HERE');
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  console.log('\nSupabase check\n' + '-'.repeat(58));

  if (isPlaceholder(url) || isPlaceholder(key)) {
    console.log('  not configured — still using the in-memory fallback.');
    console.log('\n  SUPABASE_URL          Settings -> Data API -> Project URL');
    console.log('  SUPABASE_SERVICE_KEY  Settings -> API Keys -> Secret keys -> reveal "default"');
    console.log('\n  Fine locally. On Vercel it means alert dedupe cannot work.\n');
    process.exit(1);
  }

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url!.trim())) {
    console.log(`  FAIL  SUPABASE_URL looks wrong: ${url}`);
    console.log('        Expected https://<project-ref>.supabase.co');
    console.log('        This is the Project URL, not the dashboard URL.\n');
    process.exit(1);
  }

  // The anon/publishable key would connect but silently fail on writes, so the
  // wrong-key case is worth naming explicitly rather than discovering later.
  if (key!.startsWith('sb_publishable_')) {
    console.log('  FAIL  that is the PUBLISHABLE key — it cannot write.');
    console.log('        Use the Secret key (sb_secret_...) under "Secret keys".\n');
    process.exit(1);
  }

  const keyKind = key!.startsWith('sb_secret_')
    ? 'secret (new format)'
    : key!.startsWith('eyJ')
      ? 'service_role JWT (legacy format)'
      : 'unrecognised format';
  console.log(`  url       ${url}`);
  console.log(`  key       ${keyKind}`);

  const db = createClient(url!.trim().replace(/\/$/, ''), key!.trim(), {
    auth: { persistSession: false },
  });

  // 1. Credentials + schema
  //
  // NOTE: do NOT use `{ head: true }` here. It issues a HEAD request, which by
  // definition returns no response body, so supabase-js has no JSON error to
  // parse and reports success even when the table does not exist. This check
  // originally did exactly that and cheerfully declared "all 6 tables present"
  // against a completely empty database. A normal GET with limit(1) returns the
  // PGRST205 error body we actually need to see.
  const missing: string[] = [];
  for (const table of REQUIRED_TABLES) {
    const { error } = await db.from(table).select('*').limit(1);
    if (error) {
      if (/JWT|api key|Invalid|401/i.test(error.message)) {
        console.log(`\n  FAIL  credentials rejected: ${error.message}`);
        console.log('        Re-copy the Secret key from Settings -> API Keys.\n');
        process.exit(1);
      }
      missing.push(table);
    }
  }

  if (missing.length) {
    const allMissing = missing.length === REQUIRED_TABLES.length;
    console.log(`\n  FAIL  missing table(s): ${missing.join(', ')}`);
    console.log(
      allMissing
        ? '\n        No tables exist yet — the schema has not been run.\n' +
            '        Supabase dashboard -> SQL Editor -> New query, paste the\n' +
            '        contents of lib/db/schema.sql, and Run.\n'
        : '\n        Re-run lib/db/schema.sql in the Supabase SQL editor.\n' +
            '        It is idempotent (every statement is CREATE TABLE IF NOT EXISTS),\n' +
            '        so running it again is safe.\n',
    );
    process.exit(1);
  }
  console.log(`  schema    all ${REQUIRED_TABLES.length} tables present`);

  // 2. Round-trip write, so we know it is not read-only
  const probe = `__check_${Date.now()}`;
  const { error: writeErr } = await db
    .from('ai_cache')
    .upsert({ hash: probe, kind: 'check', model: 'check', output: { ok: true } });

  if (writeErr) {
    console.log(`\n  FAIL  write rejected: ${writeErr.message}`);
    console.log('        The key may be publishable/anon rather than secret.\n');
    process.exit(1);
  }

  const { data } = await db.from('ai_cache').select('output').eq('hash', probe).maybeSingle();
  await db.from('ai_cache').delete().eq('hash', probe);

  if (!data) {
    console.log('\n  FAIL  wrote a row but could not read it back.\n');
    process.exit(1);
  }

  console.log('  write     round-trip ok');
  console.log('-'.repeat(58));
  console.log('\nPASS: Supabase is ready. Alert dedupe will work in production.\n');
}

main().catch((err) => {
  console.error('\ncheck failed:', err instanceof Error ? err.message : err, '\n');
  process.exit(1);
});
