/**
 * Is the board stable, and how close is it to not being?
 *
 * Run with `npm run verify:board`.
 *
 * This exists because of a specific report: "we had 20 bullish and from time to
 * time it appeared that it's 19, and no news occurred." That is hard to chase
 * by watching, because the two runs you want to compare are ten minutes apart
 * and the evidence is gone by the time you notice. So this runs the whole
 * pipeline twice back to back with the connector cache cleared between, and
 * diffs every cell of every row.
 *
 * It reports three things, and the third is the point:
 *
 *   1. Whether two runs over the same market produce the same board at all.
 *   2. Which cells are currently PARTIAL — scored from one leg because the
 *      other did not arrive. These are the cells that used to look confident.
 *   3. FRAGILITY: how many rows would change their label if any single cell
 *      went missing. Measured during planning at 13 of 51, with six rows
 *      sitting at exactly +4 or +5 against a Bullish floor of +4. A fix that
 *      lowers that number has made the board harder to flicker, and a change
 *      that raises it has made it easier — which is not visible any other way.
 */

import { biasFromScore, SCORING_SLOTS } from '@/config/setups.config';
import { clearCache } from '@/lib/connectors/base';
import type { SymbolRow } from '@/lib/scoring/setups';
import { runSetupsPipeline } from '@/lib/setups-pipeline';

function biasCounts(rows: SymbolRow[]) {
  const bullish = rows.filter((r) => r.bias.includes('Bullish')).length;
  const bearish = rows.filter((r) => r.bias.includes('Bearish')).length;
  return { bullish, bearish, neutral: rows.length - bullish - bearish };
}

/**
 * How many rows would change their LABEL if any one scoring cell vanished.
 *
 * Label, not score. A score drifting inside a band is invisible to the reader;
 * a row crossing the +4 Bullish floor is the thing that gets noticed and
 * reported as flicker.
 */
function fragility(rows: SymbolRow[]) {
  const fragile: { symbol: string; score: number; bias: string; via: string[] }[] = [];

  for (const row of rows) {
    const via: string[] = [];

    for (const slot of SCORING_SLOTS) {
      const cell = row.cells[slot.key];
      if (!cell || cell.cell === null) continue;

      // Removing the cell removes its contribution, nothing else — the bands
      // are absolute, so no renormalisation is involved.
      if (biasFromScore(row.totalScore - cell.cell) !== row.bias) via.push(slot.key);
    }

    if (via.length > 0) {
      fragile.push({ symbol: row.symbol, score: row.totalScore, bias: row.bias, via });
    }
  }

  return fragile;
}

function diffRuns(a: SymbolRow[], b: SymbolRow[]) {
  const byB = new Map(b.map((r) => [r.symbol, r]));
  const changed: string[] = [];

  for (const first of a) {
    const second = byB.get(first.symbol);
    if (!second) {
      changed.push(`${first.symbol}: present in run 1, absent in run 2`);
      continue;
    }

    for (const [key, cell] of Object.entries(first.cells)) {
      const other = second.cells[key];
      if (cell.cell !== other?.cell) {
        changed.push(`${first.symbol}.${key}: ${cell.cell} -> ${other?.cell ?? 'absent'}`);
      }
      if (cell.status !== other?.status) {
        changed.push(`${first.symbol}.${key}: status ${cell.status} -> ${other?.status ?? 'absent'}`);
      }
    }
  }

  return changed;
}

async function main() {
  console.log('\nBoard stability — two full runs, cache cleared between\n' + '-'.repeat(70));

  const first = await runSetupsPipeline();
  console.log('  run 1 complete');

  /**
   * The cache clear is what makes this a real test. Without it the second run
   * is served entirely from the first run's connector cache and would agree
   * with itself by construction.
   */
  clearCache();

  const second = await runSetupsPipeline();
  console.log('  run 2 complete\n');

  const one = biasCounts(first.matrix.rows);
  const two = biasCounts(second.matrix.rows);

  console.log(`  run 1   ${one.bullish} bullish · ${one.bearish} bearish · ${one.neutral} neutral`);
  console.log(`  run 2   ${two.bullish} bullish · ${two.bearish} bearish · ${two.neutral} neutral`);

  const drift = diffRuns(first.matrix.rows, second.matrix.rows);
  console.log(`\n  Cells that differ between the two runs: ${drift.length}`);
  for (const line of drift.slice(0, 20)) console.log(`    ${line}`);
  if (drift.length > 20) console.log(`    ... and ${drift.length - 20} more`);

  // --- Partial cells -------------------------------------------------------

  const partial: string[] = [];
  for (const row of second.matrix.rows) {
    for (const [key, cell] of Object.entries(row.cells)) {
      if (cell.status === 'partial') {
        partial.push(`${row.symbol}.${key} = ${cell.cell} (missing ${cell.missingLeg})`);
      }
    }
  }

  console.log(`\n  Partial cells — scored from one leg only: ${partial.length}`);
  for (const line of partial.slice(0, 20)) console.log(`    ${line}`);
  if (partial.length > 20) console.log(`    ... and ${partial.length - 20} more`);

  // --- Fragility -----------------------------------------------------------

  const fragile = fragility(second.matrix.rows);
  console.log(
    `\n  Rows one cell away from a different label: ${fragile.length} of ${second.matrix.rows.length}`,
  );
  for (const row of fragile.slice(0, 15)) {
    console.log(`    ${row.symbol.padEnd(10)} ${String(row.score).padStart(4)} ${row.bias.padEnd(13)} via ${row.via.join(', ')}`);
  }
  if (fragile.length > 15) console.log(`    ... and ${fragile.length - 15} more`);

  // --- Health --------------------------------------------------------------

  console.log('\n  Source health on run 2');
  for (const h of second.health) {
    const detail = h.detail ? `  ${h.detail}` : '';
    console.log(`    ${h.ok ? 'ok  ' : 'FAIL'}  ${h.source.padEnd(24)}${detail}`);
  }

  console.log('');

  /**
   * A nonzero exit when the two runs disagree, so this can gate a change rather
   * than only inform one. Fragility and partial cells are reported but do NOT
   * fail the run — they are properties of today's market data, not defects.
   */
  if (drift.length > 0) {
    console.error(`Board is not reproducible: ${drift.length} cells differ across two runs.\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
