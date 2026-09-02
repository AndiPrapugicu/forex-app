/**
 * Does our Crowd transformation reproduce A1's cell when fed A1's own input?
 *
 *   npm run crowd-oracle
 *
 * This is the section-1E join, printed. It is deliberately NOT `npm run
 * crowd-coverage`: that one asks whether a live provider covers our symbols and
 * what it would change, which is a question about data. This one holds the data
 * fixed at A1's own published percentages and asks whether the RULE is right.
 *
 * Everything it prints comes from `lib/scoring/crowd-oracle.ts`, which calls the
 * production `resolveCrowd`. If this run and `lib/scoring/crowd-oracle.test.ts`
 * ever disagree, the fixture moved.
 */

import ORACLE from '@/fixtures/a1-retail-sentiment-history.json';
import {
  a1CrowdCells,
  crowdOracleJoin,
  feedForDate,
  oracleDates,
  summarizeOracleJoin,
} from '@/lib/scoring/crowd-oracle';
import { CROWD_LONG_PCT_BUCKETS } from '@/config/setups.config';

const signed = (n: number | null) => (n === null ? '  -' : n > 0 ? ` +${n}` : ` ${n}`);
const pad = (s: string, n: number) => s.padEnd(n);
const padStart = (s: string, n: number) => s.padStart(n);

function main() {
  const rows = crowdOracleJoin();
  const summary = summarizeOracleJoin(rows);

  console.log(`\n${'='.repeat(92)}`);
  console.log('CROWD ORACLE -- A1 s own retail long share, replayed through our scorer');
  console.log('='.repeat(92));
  console.log(`Oracle:    ${ORACLE.source.page}`);
  console.log(`Read:      ${ORACLE.source.readAtUtc}`);
  console.log(
    `Rule:      long% <= ${CROWD_LONG_PCT_BUCKETS.bullish} -> +1   ` +
      `${CROWD_LONG_PCT_BUCKETS.bullish} < long% < ${CROWD_LONG_PCT_BUCKETS.bearish} -> 0   ` +
      `long% >= ${CROWD_LONG_PCT_BUCKETS.bearish} -> -1  (contrarian)\n`,
  );

  console.log(
    `${pad('SYMBOL', 8)}${pad('DATE', 12)}${padStart('LONG%', 7)}  ${pad('VIA', 34)}` +
      `${padStart('OURS', 5)}${padStart('A1', 5)}  RESULT`,
  );
  console.log('-'.repeat(92));

  for (const row of rows) {
    const via = row.explanation.includes('read off ')
      ? row.explanation.slice(row.explanation.indexOf('read off '), row.explanation.indexOf(';'))
      : 'own book';
    console.log(
      `${pad(row.symbol, 8)}${pad(row.date, 12)}` +
        `${padStart(row.longPct === null ? '-' : row.longPct.toFixed(2), 7)}  ` +
        `${pad(via.slice(0, 33), 34)}` +
        `${padStart(signed(row.ourCell).trim(), 5)}${padStart(signed(row.a1Cell).trim(), 5)}  ` +
        `${row.match ? 'EXACT' : 'MISMATCH'}`,
    );
  }

  console.log('-'.repeat(92));
  console.log(`${summary.matched}/${summary.total} EXACT`);
  if (summary.mismatched.length > 0) {
    console.log('\nMISMATCHES');
    for (const row of summary.mismatched) {
      console.log(`  ${row.symbol} ${row.date}: ours ${signed(row.ourCell)} vs A1 ${signed(row.a1Cell)}`);
      console.log(`    ${row.explanation}`);
    }
  }

  // What the oracle CANNOT answer is as important as what it can: a join that
  // silently drops the rows it has no input for looks stronger than it is.
  const answered = new Set(rows.map((r) => `${r.symbol}@${r.date}`));
  const unanswered = a1CrowdCells().filter((c) => !answered.has(`${c.symbol}@${c.date}`));
  console.log(`\nA1 crowd cells on file: ${a1CrowdCells().length}. Answered by the oracle: ${rows.length}.`);
  if (unanswered.length > 0) {
    console.log('Not answered (no A1 long share on that exact date, and never carried forward):');
    for (const c of unanswered) console.log(`  ${c.symbol} ${c.date} (A1 cell ${signed(c.cell)})`);
  }

  console.log('\nORACLE COVERAGE BY DATE');
  for (const date of oracleDates()) {
    const feed = feedForDate(date);
    console.log(`  ${date}  ${String(feed.size).padStart(2)} symbols  ${[...feed.keys()].sort().join(' ')}`);
  }

  console.log(
    '\nWHAT THIS DOES NOT SHOW: A1 s upstream provider is named nowhere on any of their pages,\n' +
      'so a purchased feed is not known to agree with these numbers. This measures the rule.\n',
  );
}

main();
