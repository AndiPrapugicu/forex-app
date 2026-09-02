/**
 * What do we actually know about each column's input?
 *
 *   npm run sources
 *
 * Prints `lib/scoring/source-confidence.ts` — the ledger of source,
 * transformation, grade and the dates the grade rests on. Read it before
 * proposing a scoring change: a column graded UNKNOWN is where evidence is
 * worth buying, and a column graded CONFIRMED is where a change needs a very
 * good reason.
 */

import { SOURCE_CONFIDENCE, byConfidence, slotsWithoutSource, type Confidence } from '@/lib/scoring/source-confidence';

const ORDER: Confidence[] = ['UNKNOWN', 'BLOCKED', 'SUPPORTED', 'CONFIRMED'];

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
  const groups = byConfidence();

  console.log(`\n${'='.repeat(96)}`);
  console.log('SOURCE CONFIDENCE -- what is known about each column, and what it rests on');
  console.log('='.repeat(96));
  console.log(
    `${SOURCE_CONFIDENCE.length} entries: ` +
      ORDER.map((c) => `${c} ${groups[c].length}`).join('  ') +
      '\n',
  );

  // Weakest first: the top of this list is where the next round's work is.
  for (const confidence of ORDER) {
    const entries = groups[confidence];
    if (entries.length === 0) continue;
    console.log(`\n${'-'.repeat(96)}`);
    console.log(confidence);
    console.log('-'.repeat(96));
    for (const entry of entries) {
      console.log(`\n  ${entry.component}  [${entry.key}]`);
      console.log(`    A1 source     : ${entry.a1Source}`);
      console.log(`    A1 transform  : ${entry.a1Transformation}`);
      console.log(`    Ours          : ${entry.ourSource}`);
      console.log(
        `    Evidence dates: ${entry.evidenceDates.length > 0 ? entry.evidenceDates.join(', ') : '(none)'}`,
      );
      console.log('    Evidence      :');
      console.log(wrap(entry.evidence, 86, '      '));
      if (entry.blocker) {
        console.log('    Blocked by    :');
        console.log(wrap(entry.blocker, 86, '      '));
      }
    }
  }

  const missing = slotsWithoutSource();
  console.log(`\n${'='.repeat(96)}`);
  if (missing.length > 0) console.log(`SCORING SLOTS WITH NO LEDGER ENTRY: ${missing.join(', ')}`);
  else console.log('Every scoring slot has an entry.');
  console.log(
    'A grade never moves because parity improved. It moves when an observation moves it.\n',
  );
}

main();
