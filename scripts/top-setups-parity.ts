/**
 * Parity against real Top Setups data -- not the locked page, not a board dropdown.
 *
 * Six screenshots from the 2026-08-24 A1 Trading Show livestream caught hosts with
 * a paid seat scrolling the actual Top Setups matrix (normally "Premium only
 * feature" on the free demo). This is the first round with genuine per-cell Top
 * Setups evidence instead of the two locked single-symbol Scorecard cards.
 *
 * Source data: fixtures/a1-top-setups-2026-08-24.json. Read that file's _readme
 * before trusting anything here -- only EURCHF's cell row passed both an internal
 * checksum and a cross-check against the independently-derived Forex Scorecard
 * card already on file. Every other row is Symbol/Bias/Score ONLY: large,
 * high-contrast text read with high confidence, but the 18-cell breakdowns for
 * those rows did NOT pass a checksum on this pass and are deliberately omitted
 * rather than reported as precise numbers we can't verify.
 */

import top from '@/fixtures/a1-top-setups-2026-08-24.json';
import { asOf } from '@/lib/scoring/backtest';
import { ASSET_TYPE, NAME_MAP, NOT_MODELED } from '@/lib/scoring/a1-symbol-map';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import { runSetupsPipeline } from '@/lib/setups-pipeline';

const CAPTURED_AT = new Date('2026-08-24T23:59:59.000Z');

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padStart = (s: string | number, n: number) => String(s).padStart(n);
const signed = (n: number | null | undefined) => (n === null || n === undefined ? '-' : n > 0 ? `+${n}` : String(n));

async function main() {
  /**
   * `pricesAsOf`, not `now`. The price series behind the trend cell is cut at
   * the capture — it was computed live until 2026-08-30, no matter what date
   * this script claimed to reproduce. `now` stays live on purpose: rewinding it
   * narrows the calendar fetch and loses scheduled events the frame could see.
   */
  const payload = await runSetupsPipeline(new Date(), { pricesAsOf: CAPTURED_AT });
  const trimmed = asOf({ events: payload.events, cot: payload.cot, bars: new Map(), seasonality: new Map() }, CAPTURED_AT);
  const matrix = buildSetupsMatrix({
    events: trimmed.events,
    cot: trimmed.cot,
    technicals: payload.technicals,
    sovereignYields: payload.sovereignYields,
    yield2y: payload.yield2y,
    // Same reason `yield2y` is threaded through: a rebuild that drops an input
    // makes the diagnostic and the app disagree about the board they are both
    // describing. Empty unless a crowd provider is configured.
    retailPositioning: payload.retailPositioning,
    now: CAPTURED_AT,
  });
  const rowOf = (sym: string) => matrix.rows.find((r) => r.symbol === sym);

  console.log('='.repeat(100));
  console.log('TOP SETUPS PARITY -- 2026-08-24 livestream captures, rewound to end of that day');
  console.log('='.repeat(100));

  // --- Board totals, all captures, merged view with drift flagged -----------
  const merged = new Map<string, { values: Record<string, number> }>();
  for (const cap of top.captures) {
    for (const [name, score] of Object.entries(cap.totals)) {
      const e = merged.get(name) ?? { values: {} };
      e.values[cap.id] = score as number;
      merged.set(name, e);
    }
  }

  console.log(`\n${pad('A1 name', 12)}${pad('ours sym', 10)}${padStart('ours', 6)}${padStart('A1', 12)}${padStart('gap', 6)}  note`);
  console.log('-'.repeat(100));
  let comparable = 0;
  let gapSum = 0;
  let gapAbsSum = 0;
  let exact0 = 0;
  const gaps: { name: string; gap: number }[] = [];
  const notModeled: string[] = [];
  const unmapped: string[] = [];

  for (const [name, { values }] of [...merged.entries()].sort()) {
    if (NOT_MODELED.has(name)) { notModeled.push(name); continue; }
    const ourSym = NAME_MAP[name] ?? name;
    const row = rowOf(ourSym);
    const distinctVals = [...new Set(Object.values(values))];
    const a1Display = distinctVals.length > 1 ? Object.entries(values).map(([k, v]) => `${k}:${signed(v)}`).join(' ') : signed(distinctVals[0]);
    if (!row) { unmapped.push(name); continue; }
    const a1 = distinctVals.length === 1 ? distinctVals[0] : Math.round(distinctVals.reduce((a, b) => a + b, 0) / distinctVals.length);
    const gap = row.totalScore - a1;
    comparable++;
    gapSum += gap;
    gapAbsSum += Math.abs(gap);
    if (gap === 0) exact0++;
    gaps.push({ name, gap });
    const note = distinctVals.length > 1 ? 'DRIFTED across captures, see below' : '';
    console.log(`${pad(name, 12)}${pad(ourSym, 10)}${padStart(signed(row.totalScore), 6)}${padStart(a1Display, 12)}${padStart(signed(gap), 6)}  ${note}`);
  }

  console.log(`\nNot modeled as a scored symbol at all: ${notModeled.join(', ') || 'none'}`);
  console.log(`Could not map to a symbol in this repo: ${unmapped.join(', ') || 'none'}`);

  console.log(`\n${'-'.repeat(100)}\nBOARD-TOTAL SUMMARY\n${'-'.repeat(100)}`);
  console.log(`Comparable symbols:    ${comparable}`);
  console.log(`Exact (gap 0):         ${exact0}  (${((exact0 / comparable) * 100).toFixed(1)}%)`);
  console.log(`TOTAL ABS GAP:         ${gapAbsSum}  (mean |gap| ${(gapAbsSum / comparable).toFixed(2)})`);
  console.log(`Signed gap sum:        ${signed(gapSum)}  (mean ${(gapSum / comparable).toFixed(2)})`);
  gaps.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  console.log(`\nLargest gaps:`);
  for (const g of gaps.slice(0, 12)) console.log(`  ${pad(g.name, 14)}${signed(g.gap)}`);

  // --- Full 18-cell rows, checksum-verified ---------------------------------
  console.log(`\n${'='.repeat(100)}\nCELL-LEVEL PARITY -- ${Object.keys(top.cells).length} checksum-verified Top Setups rows\n${'='.repeat(100)}`);

  const SLOTS = ['trend', 'seasonality', 'cot', 'crowd', 'gdp', 'mpmi', 'spmi', 'retail-sales',
    'consumer-confidence', 'cpi', 'ppi', 'pce', 'rates', 'employment', 'unemployment', 'claims', 'adp', 'jolts'];

  /**
   * FOUR OUTCOMES, NOT THREE, and the fourth is the one that was overstating
   * our error.
   *
   * A1 prints `0` in every US-only column — PCE, NFP, Unemployment Claims, ADP,
   * JOLTS — on rows with no dollar leg. Their EURO index row and their EURCHF
   * row both do it. There is no euro-area PCE and no euro-area JOLTS, so that 0
   * is a display default for "no such series", not a scored neutral.
   *
   * We render those cells blank instead, which is strictly more informative and
   * arithmetically identical: a blank contributes 0 to the total exactly as
   * their 0 does. Counting it as a MISS therefore measured a convention rather
   * than a defect, and it was worth 11 of the 23 non-exact cells — half the
   * apparent cross and index error was this.
   *
   * `n/a` keeps them visible without pretending they agree on a value, and
   * `missing` now means what it says: they scored something and we did not.
   */
  type Tally = { exact: number; diff: number; missing: number; na: number };
  const tally = (): Tally => ({ exact: 0, diff: 0, missing: 0, na: 0 });
  const byColumn = new Map<string, Tally>();
  const byAsset = new Map<string, Tally>();
  let tExact = 0, tDiff = 0, tMissing = 0, tNa = 0;

  for (const [symbol, a1row] of Object.entries(top.cells as Record<string, Record<string, number | string>>)) {
    const row = rowOf(symbol);
    if (!row) { console.log(`\n${symbol}: not in our matrix`); continue; }
    const type = ASSET_TYPE[symbol] ?? '?';
    console.log(`\n--- ${symbol} (${type})   ours ${signed(row.totalScore)}   A1 ${signed(a1row.total as number)}   gap ${signed(row.totalScore - (a1row.total as number))}`);
    const line: string[] = [];
    for (const slot of SLOTS) {
      const ours = row.cells[slot]?.cell ?? null;
      const theirs = a1row[slot] as number;
      const status =
        ours === null ? (theirs === 0 ? 'na' : 'missing') : ours === theirs ? 'exact' : 'diff';
      const bc = byColumn.get(slot) ?? tally();
      const ba = byAsset.get(type) ?? tally();
      if (status === 'exact') { bc.exact++; ba.exact++; tExact++; }
      else if (status === 'diff') { bc.diff++; ba.diff++; tDiff++; }
      else if (status === 'na') { bc.na++; ba.na++; tNa++; }
      else { bc.missing++; ba.missing++; tMissing++; }
      byColumn.set(slot, bc); byAsset.set(type, ba);
      if (status === 'diff' || status === 'missing') line.push(`${slot} ${signed(ours)}/${signed(theirs)}`);
    }
    console.log(line.length === 0 ? '  all 18 AGREE' : `  differs: ${line.join('   ')}`);
  }

  /**
   * Scored both sides. `n/a` cells are excluded from the denominator rather
   * than counted as agreement: neither side scored them, so calling them exact
   * would inflate the percentage with cells nobody measured.
   */
  const tScored = tExact + tDiff + tMissing;
  const tAll = tScored + tNa;
  const pct = (n: number, d: number) => (d === 0 ? ' n/a' : `${((n / d) * 100).toFixed(0)}%`);
  console.log(
    `\n${'-'.repeat(100)}\nCELL SUMMARY: ${tAll} cells = ${tScored} scored + ${tNa} n/a ` +
      `(column does not apply to that economy; A1 prints 0, we print blank)\n` +
      `  Of the ${tScored} scored:   EXACT ${tExact} (${((tExact / tScored) * 100).toFixed(1)}%)   ` +
      `DIFFERENT ${tDiff}   MISSING_OURS ${tMissing}`,
  );

  console.log(`\nBy column:  (exact / scored, n/a excluded)`);
  for (const slot of SLOTS) {
    const c = byColumn.get(slot); if (!c) continue;
    const n = c.exact + c.diff + c.missing;
    console.log(`  ${pad(slot, 22)}${c.exact}/${n} exact${padStart(pct(c.exact, n), 8)}   diff ${c.diff}  missing ${c.missing}  n/a ${c.na}`);
  }

  console.log(`\nBy asset type:  (exact / scored, n/a excluded)`);
  for (const [type, c] of byAsset) {
    const n = c.exact + c.diff + c.missing;
    console.log(`  ${pad(type, 20)}${c.exact}/${n} exact${padStart(pct(c.exact, n), 8)}   diff ${c.diff}  missing ${c.missing}  n/a ${c.na}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
