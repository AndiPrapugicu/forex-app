/**
 * The capture list, ranked.
 *
 *   npm run evidence-next
 *
 * Reads `lib/scoring/parity-ledger.ts` and prints what to go and photograph, in
 * order, with the arithmetic behind the ordering. See `lib/scoring/evidence-next.ts`
 * for why the rank is derived rather than written down.
 */

import { rankEvidence, unaddressedLedgerKeys } from '@/lib/scoring/evidence-next';

const RULE = '='.repeat(100);

function wrap(text: string, indent: number): string {
  const width = 100 - indent;
  const pad = ' '.repeat(indent);
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line.length + word.length + 1 > width) {
      out.push(pad + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(pad + line);
  return out.join('\n');
}

function main() {
  const ranked = rankEvidence();

  console.log(RULE);
  console.log('NEXT BEST EVIDENCE -- ranked from the parity ledger');
  console.log(RULE);
  console.log();

  ranked.forEach((r, idx) => {
    const cells = r.entries.map((e) => `${e.key} [${e.classification}]`).join(', ') || 'none';
    console.log(`${idx + 1}. ${r.key}   score ${r.score}   (${r.access}${r.dateMatchable ? ', date-matchable' : ''})`);
    console.log(wrap(`CAPTURE: ${r.capture}`, 5));
    console.log(wrap(`RESOLVES: ${cells}`, 5));
    if (r.missingKeys.length > 0) {
      console.log(wrap(`STALE -- names ledger keys that no longer exist: ${r.missingKeys.join(', ')}`, 5));
    }
    console.log(wrap(`WHY: ${r.rationale}`, 5));
    console.log(wrap(`RANK: ${r.breakdown}`, 5));
    console.log();
  });

  const unaddressed = unaddressedLedgerKeys();
  console.log('-'.repeat(100));
  if (unaddressed.length === 0) {
    console.log('Every unresolved ledger entry is named by at least one request.');
  } else {
    console.log('Unresolved ledger entries no request would touch:');
    console.log(wrap(unaddressed.join(', '), 2));
    console.log();
    console.log(wrap(
      'That is not necessarily a gap. A proven SOURCE_DIFFERENCE needs a different feed, not a ' +
      'better screenshot, and no capture will close it.', 2));
  }
  console.log(RULE);
  console.log('A capture that cannot change a cell is research. Rank it accordingly.');
}

main();
