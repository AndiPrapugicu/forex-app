/**
 * THE WHOLE BOARD, THREE WAYS.
 *
 *   npm run board-parity
 *
 * `npm run leg-parity` compares eight currency-index rows — 144 cells, the
 * entire model, and the right instrument for "is our engine right". It is the
 * wrong instrument for the question a user actually asks, which is why the 51
 * rows on their screen do not match the 51 rows on ours. Those are 918 cells,
 * and most of the difference between the two numbers is not scoring at all.
 *
 * SO EVERY CELL IS SCORED THREE TIMES:
 *
 *   ours vs their PAIR row      what the user sees, and the only number that
 *                               matches the complaint
 *   ours vs their LEG DIFF      base row minus quote row, off their own eight
 *                               currency rows
 *   their PAIR vs their LEGS    A1 against A1, and the term the first two
 *                               comparisons have been silently sharing
 *
 * The third column is the point. A1 publishes the same macro legs twice and the
 * two copies disagree on four of eight columns — PPI is their pair board reading
 * the release's STOCKS impact instead of its currency impact, consumer
 * confidence is a leg set their index rows omit entirely. See
 * `lib/scoring/a1-pair-legs.ts`, which solves both vectors and is what this
 * report reads. Without that split, "we are 61 points apart on PPI" reads as our
 * defect; with it, every one of those points is A1 disagreeing with A1.
 *
 * REWOUND, and read the coverage line. A REWIND CAN ONLY REMOVE EVENTS, NEVER
 * RESTORE ONE THE FEED HAS DROPPED: `asOf` trims the calendar to the capture,
 * but the calendar it trims is whatever the feed returns NOW, a rolling window.
 * Measured 2026-09-01, the EUR mPMI slot scored off the 21 August flash at
 * 09:49 UTC and resolved to nothing at 13:14, because by then the feed had moved
 * to the 1 September final and the flash was outside the window. Run this close
 * to the capture and check the resolved-cell count before trusting a column.
 *
 * WHAT AGREEMENT HERE IS NOT. Evidence that either of us is right. A1 is a Tier
 * 4 observation; a cell sourced to a national statistics office beats a cell
 * that agrees with this report.
 */

import fs from 'node:fs';
import path from 'node:path';

import { findSymbol } from '@/config/symbols.config';
import { listCaptures } from '@/lib/a1-capture-file';
import {
  A1_COLUMN_TO_SLOT,
  NAME_MAP,
  NOT_MODELED,
} from '@/lib/scoring/a1-symbol-map';
import {
  comparePairAndIndexLegs,
  parseCapture,
  type ColumnComparison,
} from '@/lib/scoring/a1-pair-legs';
import { asOf } from '@/lib/scoring/backtest';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import type { Currency } from '@/lib/types';

/**
 * The capture both sides are measured at. Defaults to the NEWEST on disk;
 * pass a filename to pin an older one.
 *
 *   npm run board-parity
 *   npm run board-parity a1-top-setups-2026-08-31.csv
 *
 * Newest by default because a stale default is how a measurement quietly stops
 * describing the present: their board moved 31 of 54 rows in five hours on
 * 2026-09-01, so "the 09-01 capture" was already two different boards.
 */
const FIXTURE = process.argv[2] ?? listCaptures()[0]?.file ?? 'a1-top-setups-2026-09-01.csv';

/**
 * The moment to rewind BOTH sides to, read out of the filename.
 *
 * An untimed capture is wound to the end of its day, which is what the earlier
 * fixtures assumed. A timed one is wound to its own minute — and it has to be,
 * because the columns that move intraday (trend, seasonality, crowd) are
 * exactly the ones a whole-day rewind gets wrong.
 */
const CAPTURED_AT = (() => {
  const m = /(\d{4}-\d{2}-\d{2})(?:-(\d{2})(\d{2}))?\.csv$/.exec(FIXTURE);
  if (!m) throw new Error(`cannot read a capture moment out of ${FIXTURE}`);
  return m[2]
    ? new Date(`${m[1]}T${m[2]}:${m[3]}:00.000Z`)
    : new Date(`${m[1]}T23:59:59.000Z`);
})();

const COLUMNS = Object.keys(A1_COLUMN_TO_SLOT);

const pad = (s: unknown, n: number) => String(s ?? '').padEnd(n);
const padS = (s: unknown, n: number) => String(s ?? '').padStart(n);
const signed = (n: number | null | undefined) =>
  n === null || n === undefined ? '.' : n > 0 ? `+${n}` : String(n);
const clampPair = (n: number) => Math.max(-2, Math.min(2, n));

/** Verdict for one cell, once all three comparisons are in. */
type Verdict =
  /** We and their pair row print the same number. */
  | 'AGREE'
  /** We differ from their pair row, but their own two surfaces differ too. */
  | 'A1_VS_A1'
  /** We differ from their pair row and their surfaces agree with each other. */
  | 'OURS'
  /** They scored, we produced nothing. */
  | 'NOT_SCORED';

async function main() {
  const capture = parseCapture(
    fs.readFileSync(path.join(process.cwd(), 'fixtures', FIXTURE), 'utf8'),
    FIXTURE,
  );

  /** Which columns their two surfaces disagree on, and how. */
  const legComparison = new Map<string, ColumnComparison>(
    comparePairAndIndexLegs(capture).map((c) => [c.slotKey, c]),
  );

  const payload = await runSetupsPipeline(new Date(), { pricesAsOf: CAPTURED_AT });
  const trimmed = asOf(
    { events: payload.rewindPool, cot: payload.cot, bars: new Map(), seasonality: new Map() },
    CAPTURED_AT,
  );
  const matrix = buildSetupsMatrix({
    events: trimmed.events,
    cot: trimmed.cot,
    technicals: payload.technicals,
    sovereignYields: payload.sovereignYields,
    yield2y: payload.yield2y,
    retailPositioning: payload.retailPositioning,
    now: CAPTURED_AT,
  });
  const ours = new Map(matrix.rows.map((r) => [r.symbol, r]));

  console.log('='.repeat(112));
  console.log(`BOARD PARITY -- our whole board against ${FIXTURE}, three ways`);
  console.log(`both sides measured at ${CAPTURED_AT.toISOString().replace('T', ' ').slice(0, 16)}Z`);
  console.log('='.repeat(112));

  type Tally = { agree: number; a1VsA1: number; oursDiff: number; notScored: number; absGap: number };
  const tally = (): Tally => ({ agree: 0, a1VsA1: 0, oursDiff: 0, notScored: 0, absGap: 0 });
  const byColumn = new Map<string, Tally>(COLUMNS.map((c) => [c, tally()]));
  const totals = tally();

  const perRow: {
    symbol: string; theirName: string; ours: number; theirs: number; gap: number;
    a1VsA1Cells: number; oursCells: string[];
  }[] = [];
  const unmapped: string[] = [];
  let resolvedCells = 0;

  for (const [theirName, theirCells] of capture.rows) {
    if (NOT_MODELED.has(theirName)) continue;
    const symbol = NAME_MAP[theirName] ?? theirName;
    const row = ours.get(symbol);
    if (!row) {
      unmapped.push(theirName);
      continue;
    }

    const def = findSymbol(symbol);
    const oursCells: string[] = [];
    let a1VsA1Cells = 0;

    for (const column of COLUMNS) {
      const slotKey = A1_COLUMN_TO_SLOT[column];
      const cell = row.cells[slotKey]?.cell ?? null;
      const theirs = theirCells[slotKey];
      if (theirs === undefined) continue;
      const t = byColumn.get(column)!;
      if (cell !== null) resolvedCells++;

      /**
       * A null of ours contributes 0 to our total exactly as their 0 does. It
       * is the same rendering convention leg-parity forgives: we leave a column
       * blank where the economy has no such series and they print 0.
       */
      if (cell === theirs || (cell === null && theirs === 0)) {
        t.agree++; totals.agree++;
        continue;
      }

      const verdict = classify(cell, theirs, slotKey, def?.base, def?.quote, capture, legComparison);
      const gap = Math.abs((cell ?? 0) - theirs);
      t.absGap += gap; totals.absGap += gap;

      if (verdict === 'A1_VS_A1') {
        t.a1VsA1++; totals.a1VsA1++;
        a1VsA1Cells++;
      } else if (verdict === 'NOT_SCORED') {
        t.notScored++; totals.notScored++;
        oursCells.push(`${column} ./${signed(theirs)}`);
      } else {
        t.oursDiff++; totals.oursDiff++;
        oursCells.push(`${column} ${signed(cell)}/${signed(theirs)}`);
      }
    }

    const theirScore = capture.scores.get(theirName) ?? 0;
    perRow.push({
      symbol, theirName, ours: row.totalScore, theirs: theirScore,
      gap: row.totalScore - theirScore, a1VsA1Cells, oursCells,
    });
  }

  // --- Headline -------------------------------------------------------------
  const compared = totals.agree + totals.a1VsA1 + totals.oursDiff + totals.notScored;
  console.log(`\n${compared} cells compared across ${perRow.length} rows`);
  console.log(`  coverage: our rewound board resolved ${resolvedCells} of them.`);
  console.log('  A drop here between runs is the feed window, not the model - see the header.\n');
  console.log(`  AGREE          ${padS(totals.agree, 5)}  (${((totals.agree / compared) * 100).toFixed(1)}%)`);
  console.log(`  A1 vs A1       ${padS(totals.a1VsA1, 5)}   their pair rows contradict their own currency rows`);
  console.log(`  OURS           ${padS(totals.oursDiff, 5)}   <- the work list: their surfaces agree and we differ`);
  console.log(`  NOT SCORED     ${padS(totals.notScored, 5)}   they scored, we produced nothing`);

  // --- By column ------------------------------------------------------------
  console.log(`\n${'='.repeat(112)}`);
  console.log('BY COLUMN  (abs gap is the size of the disagreement, not its count)');
  console.log('='.repeat(112));
  console.log(
    `${pad('column', 14)}${padS('agree', 7)}${padS('A1vA1', 7)}${padS('OURS', 7)}` +
      `${padS('none', 7)}${padS('absGap', 8)}   their two surfaces`,
  );
  console.log('-'.repeat(112));
  const ranked = [...byColumn.entries()].sort((a, b) => b[1].absGap - a[1].absGap);
  for (const [column, t] of ranked) {
    const slotKey = A1_COLUMN_TO_SLOT[column];
    const cmp = legComparison.get(slotKey);
    console.log(
      `${pad(column, 14)}${padS(t.agree, 7)}${padS(t.a1VsA1, 7)}${padS(t.oursDiff, 7)}` +
        `${padS(t.notScored, 7)}${padS(t.absGap, 8)}   ${cmp ? cmp.agreement : '-'}`,
    );
  }

  // --- A1 against A1 --------------------------------------------------------
  console.log(`\n${'='.repeat(112)}`);
  console.log("A1 AGAINST A1  -- the leg vector their PAIR rows use vs the one their CURRENCY rows publish");
  console.log('='.repeat(112));
  for (const cmp of legComparison.values()) {
    const line =
      `${pad(cmp.column, 14)}${pad(cmp.agreement, 13)}` +
      `pair legs fit ${padS(`${cmp.pairsExplained}/${cmp.pairsTotal}`, 6)}` +
      `   index legs fit ${padS(`${cmp.pairsExplainedByIndexLegs}/${cmp.comparablePairs}`, 6)}`;
    console.log(line);
    if (cmp.differing.length > 0) {
      console.log(
        '                           ' +
          cmp.differing.map((d) => `${d.currency} pair ${signed(d.pair)} index ${signed(d.index)}`).join('   '),
      );
    }
  }

  // --- Rows -----------------------------------------------------------------
  console.log(`\n${'='.repeat(112)}`);
  console.log('EVERY ROW, worst score gap first');
  console.log('='.repeat(112));
  console.log(
    `${pad('symbol', 10)}${padS('ours', 6)}${padS('A1', 5)}${padS('gap', 6)}${padS('A1vA1', 7)}   cells where THEIR surfaces agree and we differ`,
  );
  console.log('-'.repeat(112));
  perRow.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  for (const r of perRow) {
    console.log(
      `${pad(r.symbol, 10)}${padS(signed(r.ours), 6)}${padS(signed(r.theirs), 5)}` +
        `${padS(signed(r.gap), 6)}${padS(r.a1VsA1Cells, 7)}   ${r.oursCells.join('  ') || '-'}`,
    );
  }

  const absGap = perRow.reduce((s, r) => s + Math.abs(r.gap), 0);
  console.log('-'.repeat(112));
  console.log(
    `TOTAL ABS SCORE GAP ${absGap} across ${perRow.length} rows (mean ${(absGap / perRow.length).toFixed(2)})`,
  );
  if (unmapped.length > 0) console.log(`\nOn their board, not on ours: ${unmapped.join(', ')}`);
}

/**
 * Which side owns a disagreement.
 *
 * A cell is A1_VS_A1 when their pair row and their own leg difference print
 * different numbers for it. That test is per CELL rather than per column on
 * purpose: PPI's two surfaces disagree everywhere, but consumer confidence's
 * disagree only where the index row is blank, and blaming a whole column for a
 * fault that touches half of it would absorb real defects of ours.
 */
function classify(
  cell: number | null,
  theirs: number,
  slotKey: string,
  base: Currency | undefined,
  quote: Currency | undefined,
  capture: ReturnType<typeof parseCapture>,
  legComparison: Map<string, ColumnComparison>,
): Verdict {
  const cmp = legComparison.get(slotKey);
  if (cmp && base && quote) {
    const b = cmp.indexLegs[base];
    const q = cmp.indexLegs[quote];
    if (b !== undefined && q !== undefined && clampPair(b - q) !== theirs) return 'A1_VS_A1';
  }
  void capture;
  return cell === null ? 'NOT_SCORED' : 'OURS';
}

main().catch((err) => {
  console.error('board-parity failed:', err);
  process.exit(1);
});
