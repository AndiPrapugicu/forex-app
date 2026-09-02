/**
 * Every unresolved mismatch, and what it actually is.
 *
 *   npm run ledger
 *   npm run ledger -- --json
 *
 * Read this before proposing a scoring change. A cell filed
 * SOURCE_DIFFERENCE or A1_INCONSISTENCY has already been diagnosed and
 * deliberately not fixed; re-fixing it is how a scoring engine turns into a
 * curve fit. UNKNOWN is the only class that licenses more work.
 *
 * Prints from `lib/scoring/parity-ledger.ts`. Nothing here scores anything.
 */

import {
  PARITY_LEDGER,
  ledgerByClassification,
  type ParityClassification,
} from '@/lib/scoring/parity-ledger';

/** Weakest first: the top of the list is where the next round's work is. */
const ORDER: ParityClassification[] = [
  'UNKNOWN',
  'A1_INCONSISTENCY',
  'SOURCE_DIFFERENCE',
  'TRANSCRIPTION_ERROR',
  'TIMING',
  'FIXED',
];

const LICENSE: Record<ParityClassification, string> = {
  UNKNOWN: 'needs more A1 evidence — the only class that licenses research',
  A1_INCONSISTENCY: "A1's own cells disagree with A1's own data — do not pick a side",
  SOURCE_DIFFERENCE: 'their rule, our numbers — fix the feed or nothing',
  TRANSCRIPTION_ERROR: 'the observation is unsafe — do not let it pin a leg',
  TIMING: 'both models right, different moments',
  FIXED: 'rule and input proven, change landed',
};

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join('\n');
}

function main() {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(PARITY_LEDGER, null, 2));
    return;
  }

  const groups = ledgerByClassification();

  console.log(`\n${'='.repeat(96)}`);
  console.log('REMAINING PARITY LEDGER -- what each unresolved mismatch IS');
  console.log('='.repeat(96));
  console.log(
    `${PARITY_LEDGER.length} entries: ` +
      ORDER.filter((c) => groups[c].length > 0)
        .map((c) => `${c} ${groups[c].length}`)
        .join('  '),
  );

  for (const classification of ORDER) {
    const entries = groups[classification];
    if (entries.length === 0) continue;
    console.log(`\n${'-'.repeat(96)}`);
    console.log(`${classification}  --  ${LICENSE[classification]}`);
    console.log('-'.repeat(96));
    for (const entry of entries) {
      console.log(
        `\n  ${entry.component} / ${entry.symbol}${entry.date ? ` @ ${entry.date}` : ''}  [${entry.key}]`,
      );
      console.log(`    ours ${entry.ours}   |   A1 ${entry.a1}   |   confidence ${entry.confidence}`);
      console.log('    Evidence  :');
      console.log(wrap(entry.evidence, 86, '      '));
      console.log('    Root cause:');
      console.log(wrap(entry.rootCause, 86, '      '));
      console.log('    Action    :');
      console.log(wrap(entry.productionAction, 86, '      '));
    }
  }

  console.log(`\n${'='.repeat(96)}`);
  console.log(
    'A smaller TOTAL ABS GAP is not an entry in this file. A new exact cell with a proven rule is.\n',
  );
}

main();
