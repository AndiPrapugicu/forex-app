/**
 * DO WE MOVE THE WAY THEY MOVE? A different question from "do we match today".
 *
 * `npm run leg-parity` measures LEVELS on one day. Two boards can sit a constant
 * apart and still track each other perfectly, and two boards can agree today and
 * diverge tomorrow. Neither is visible in a level measurement, and the second is
 * the one that actually degrades: a board that agrees on Monday and drifts by
 * Friday is worse than one that is honestly two points off and stays there.
 *
 * So this measures CHANGE. For every symbol and every column it computes A1's
 * day-over-day delta from two captures, and ours over the same interval from two
 * rewound runs of our own pipeline, and asks whether the two agree.
 *
 * WHAT THE FIRST RUN ESTABLISHED, and why this script exists at all. Between
 * 2026-08-31 and 2026-09-01 A1's board changed 13 cells out of 972 - one and a
 * third percent - and every single one was Seasonality, Rates or Crowd. No macro
 * cell moved. No trend cell moved. Their board is extremely sticky, which means
 * tracking it is mostly a question of NOT MOVING when they do not move.
 *
 * That reframes what a defect looks like here. A cell of ours that flickers
 * day to day on a column A1 holds still is a tracking failure even when its
 * level is right, and it will not show up in any parity number measured on a
 * single day.
 *
 * FOUR OUTCOMES PER CELL:
 *
 *   AGREED     both moved by the same amount, or both held still
 *   MISSED     they moved, we did not
 *   SPURIOUS   we moved, they did not      <- the one that compounds
 *   DIFFERED   both moved, by different amounts
 *
 * A held-still cell counts as AGREED on purpose. Holding still is the majority
 * behaviour and the thing most easily got wrong, so a measure that ignored it
 * would score a board that changes everything every day the same as one that
 * changes nothing.
 *
 *   npm run delta-parity
 */

import fs from 'node:fs';
import path from 'node:path';

import { NAME_MAP, NOT_MODELED } from '@/lib/scoring/a1-symbol-map';
import projectionSnapshots from '@/fixtures/a1-rate-projections.json';
import { asOf } from '@/lib/scoring/backtest';
import {
  resolveConsensusProjectionLegs,
  type RateProjectionSnapshot,
} from '@/lib/scoring/rate-projections';
import { buildSetupsMatrix, type SymbolRow } from '@/lib/scoring/setups';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { MAJORS } from '@/lib/types';

/**
 * The two captures, oldest first. Both are full 54-row boards read off the same
 * page during EdgeFinder Free Week.
 *
 * The later one was taken at 09:44 UTC, MID-SESSION, and is cut there rather
 * than at end of day. Cutting it at midnight would compare their morning board
 * against our whole day and charge us for hours they had not seen.
 */
const CAPTURES = [
  { file: 'a1-top-setups-2026-08-31.csv', at: new Date('2026-08-31T23:59:59.000Z') },
  { file: 'a1-top-setups-2026-09-01.csv', at: new Date('2026-09-01T09:44:00.000Z') },
] as const;

const COLUMN: Record<string, string> = {
  Trend: 'trend', Seasonality: 'seasonality', COT: 'cot', Crowd: 'crowd',
  GDP: 'gdp', mPMI: 'mpmi', sPMI: 'spmi', RetailSales: 'retail-sales',
  CnsmrConf: 'consumer-confidence', CPI: 'cpi', PPI: 'ppi', PCE: 'pce',
  Rates: 'rates', NFP: 'employment', UnempRate: 'unemployment',
  UnempClaims: 'claims', ADP: 'adp', JOLTS: 'jolts',
};

const pad = (s: unknown, n: number) => String(s ?? '').padEnd(n);
const padS = (s: unknown, n: number) => String(s ?? '').padStart(n);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

type A1Row = Record<string, string>;

function readFixture(file: string): Map<string, A1Row> {
  const lines = fs.readFileSync(path.join(process.cwd(), 'fixtures', file), 'utf8')
    .trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const out = new Map<string, A1Row>();
  for (const line of lines.slice(1)) {
    const row = Object.fromEntries(line.split(',').map((v, i) => [head[i], v])) as A1Row;
    out.set(row.Symbol, row);
  }
  return out;
}

/** Our whole board, rebuilt as of one moment. */
async function ourBoardAt(at: Date): Promise<Map<string, SymbolRow>> {
  const payload = await runSetupsPipeline(new Date(), { pricesAsOf: at });
  const trimmed = asOf(
    { events: payload.events, cot: payload.cot, bars: new Map(), seasonality: new Map() },
    at,
  );
  const matrix = buildSetupsMatrix({
    events: trimmed.events,
    cot: trimmed.cot,
    technicals: payload.technicals,
    sovereignYields: payload.sovereignYields,
    yield2y: payload.yield2y,
    retailPositioning: payload.retailPositioning,
    now: at,
  });
  return new Map(matrix.rows.map((r) => [r.symbol, r]));
}

type Outcome = 'AGREED' | 'MISSED' | 'SPURIOUS' | 'DIFFERED';

async function main() {
  const [older, newer] = CAPTURES;
  const a1Old = readFixture(older.file);
  const a1New = readFixture(newer.file);

  const oursOld = await ourBoardAt(older.at);
  const oursNew = await ourBoardAt(newer.at);

  console.log('='.repeat(104));
  console.log('DELTA PARITY -- do we MOVE the way A1 moves?');
  console.log(`${older.file} -> ${newer.file}`);
  console.log('='.repeat(104));

  ruleChangeGuard(older.at, newer.at);

  const columns = Object.keys(COLUMN);
  type Tally = Record<Outcome, number>;
  const tally = (): Tally => ({ AGREED: 0, MISSED: 0, SPURIOUS: 0, DIFFERED: 0 });
  const byColumn = new Map<string, Tally>(columns.map((c) => [c, tally()]));
  const totals = tally();
  /** Held-still cells, tracked apart so AGREED is not just "nothing happened". */
  let bothHeld = 0;
  let bothMoved = 0;

  const problems: string[] = [];
  const skipped: string[] = [];

  for (const [name, theirNew] of a1New) {
    if (NOT_MODELED.has(name)) continue;
    const theirOld = a1Old.get(name);
    const symbol = NAME_MAP[name] ?? name;
    const ourOld = oursOld.get(symbol);
    const ourNew = oursNew.get(symbol);
    if (!theirOld || !ourOld || !ourNew) { skipped.push(name); continue; }

    for (const col of columns) {
      const key = COLUMN[col];
      /**
       * A null of ours is 0 for DELTA purposes, and that is safe in a way it is
       * not for levels: a column we never score contributes no movement to
       * either side, so it lands in AGREED/held rather than distorting the
       * count. What matters here is whether the cell CHANGED.
       */
      const theirs = Number.parseInt(theirNew[col], 10) - Number.parseInt(theirOld[col], 10);
      const ours = (ourNew.cells[key]?.cell ?? 0) - (ourOld.cells[key]?.cell ?? 0);

      let outcome: Outcome;
      if (ours === theirs) outcome = 'AGREED';
      else if (theirs !== 0 && ours === 0) outcome = 'MISSED';
      else if (ours !== 0 && theirs === 0) outcome = 'SPURIOUS';
      else outcome = 'DIFFERED';

      if (ours === 0 && theirs === 0) bothHeld++;
      if (ours !== 0 && theirs !== 0) bothMoved++;

      byColumn.get(col)![outcome]++;
      totals[outcome]++;
      if (outcome !== 'AGREED') {
        /**
         * WHAT MOVED US, printed beside the disagreement.
         *
         * A spurious macro move is almost always a release the other side has
         * not ingested yet, and without the release date behind it that is
         * indistinguishable from a scoring defect. A cell that changed because
         * a PMI printed this morning is us being FASTER, not wrong, and the two
         * need opposite responses.
         */
        const leg = ourNew.cells[key]?.legs?.[0];
        const why = leg?.dateUtc
          ? `   <- ${leg.seriesName ?? '?'} ${String(leg.dateUtc).slice(0, 10)}`
          : '';
        problems.push(
          `  ${pad(symbol, 10)}${pad(col, 14)}${pad(outcome, 10)}ours ${padS(signed(ours), 3)}   A1 ${padS(signed(theirs), 3)}${why}`,
        );
      }
    }
  }

  const cells = totals.AGREED + totals.MISSED + totals.SPURIOUS + totals.DIFFERED;
  console.log(`\n${cells} cells tracked across ${a1New.size - skipped.length} symbols`);
  if (skipped.length) console.log(`not on both sides: ${skipped.join(', ')}`);
  /**
   * COVERAGE, read before anything else. See the note at the top of this file:
   * if the older board resolved FEWER cells than the newer one, the feed has
   * aged prints out of its window since the capture, and some of the deltas
   * below are artifacts of that rather than of scoring.
   */
  const populated = (board: Map<string, SymbolRow>) => {
    let n = 0;
    for (const row of board.values()) {
      for (const col of columns) {
        const c = row.cells[COLUMN[col]]?.cell;
        if (c !== null && c !== undefined) n++;
      }
    }
    return n;
  };
  const oldCells = populated(oursOld);
  const newCells = populated(oursNew);
  console.log(
    `  coverage: older board resolved ${oldCells} cells, newer ${newCells}` +
      (oldCells < newCells
        ? `   <- WARNING: older is ${newCells - oldCells} cells THINNER; re-run closer to the capture`
        : '   (older is not thinner, so the rewind is sound)'),
  );

  console.log(`\n  AGREED    ${padS(totals.AGREED, 5)}  (${((totals.AGREED / cells) * 100).toFixed(1)}%)`);
  console.log(`      of which both held still ${bothHeld}, both moved the same ${totals.AGREED - bothHeld}`);
  console.log(`  SPURIOUS  ${padS(totals.SPURIOUS, 5)}   we moved, they did not  <- this is what compounds`);
  console.log(`  MISSED    ${padS(totals.MISSED, 5)}   they moved, we did not`);
  console.log(`  DIFFERED  ${padS(totals.DIFFERED, 5)}   both moved, by different amounts`);
  console.log(`\n  cells where BOTH moved: ${bothMoved}`);

  console.log(`\n${pad('column', 14)}${padS('agreed', 8)}${padS('spurious', 10)}${padS('missed', 8)}${padS('differed', 10)}`);
  console.log('-'.repeat(104));
  for (const col of columns) {
    const t = byColumn.get(col)!;
    const bad = t.SPURIOUS + t.MISSED + t.DIFFERED;
    console.log(
      pad(col, 14) + padS(t.AGREED, 8) + padS(t.SPURIOUS, 10) + padS(t.MISSED, 8) + padS(t.DIFFERED, 10) +
        (bad > 0 ? `   <- ${bad}` : ''),
    );
  }

  if (problems.length > 0) {
    console.log(`\nEvery cell that did not track:\n${problems.join('\n')}`);
  }

  /**
   * Board-total tracking, which is what a user actually sees. A row can have
   * compensating cell errors and still track on total, and it can have every
   * cell right and still be reported wrong here if a column we do not model
   * moved - so this is reported beside the cell view, never instead of it.
   */
  console.log(`\n${'='.repeat(104)}\nSCORE TRACKING  (the number on the board)\n${'='.repeat(104)}`);
  let tracked = 0;
  let compared = 0;
  const drift: string[] = [];
  for (const [name, theirNew] of a1New) {
    if (NOT_MODELED.has(name)) continue;
    const theirOld = a1Old.get(name);
    const symbol = NAME_MAP[name] ?? name;
    const ourOld = oursOld.get(symbol);
    const ourNew = oursNew.get(symbol);
    if (!theirOld || !ourOld || !ourNew) continue;
    const theirs = Number.parseInt(theirNew.Score, 10) - Number.parseInt(theirOld.Score, 10);
    const ours = ourNew.totalScore - ourOld.totalScore;
    compared++;
    if (ours === theirs) tracked++;
    else {
      drift.push(
        `  ${pad(symbol, 10)}ours ${padS(signed(ourOld.totalScore), 3)} -> ${padS(signed(ourNew.totalScore), 3)}` +
          ` (${padS(signed(ours), 3)})    A1 ${padS(theirOld.Score, 3)} -> ${padS(theirNew.Score, 3)} (${padS(signed(theirs), 3)})`,
      );
    }
  }
  console.log(`\n  moved by the same amount: ${tracked}/${compared} (${((tracked / compared) * 100).toFixed(1)}%)`);
  if (drift.length) console.log(`\n  drifted:\n${drift.join('\n')}`);
}

/**
 * A COLUMN THAT CHANGED RULE BETWEEN THE TWO BOARDS IS NOT A COLUMN THAT MOVED.
 *
 * This measures a DELTA, so it is confounded by anything that differs between
 * the two rewound runs — and that includes our own code, not just the feed. The
 * rates column is the live case: `resolveConsensusProjectionLegs` is
 * all-or-nothing per board, so a board whose date the projection snapshots cover
 * scores rates from A1's quarterly consensus while an earlier board falls
 * through to the calendar ladder. Each board is internally coherent, which is
 * the property that matters for the board itself; across two boards it makes
 * every rates cell look like it moved.
 *
 * Measured 2026-09-01, the first day the rule shipped: rates went from 8 cells
 * not tracking to 20, and not one of those was data. It resolves itself as soon
 * as a snapshot exists on or before BOTH captures — which is one more reason to
 * read their projections page on a new day and append.
 *
 * Printed rather than corrected for. Silently excluding the column would hide a
 * genuine rates divergence the day one appears.
 */
function ruleChangeGuard(olderAt: Date, newerAt: Date) {
  const snapshots = (projectionSnapshots as { snapshots: RateProjectionSnapshot[] }).snapshots;
  const on = (d: Date) =>
    resolveConsensusProjectionLegs(snapshots, MAJORS, d.toISOString().slice(0, 10)).legs !== null;

  const before = on(olderAt);
  const after = on(newerAt);
  if (before === after) {
    console.log(
      `  rates rule: ${before ? 'projection consensus' : 'calendar ladder'} on both boards, so the ` +
        'column is comparable.',
    );
    return;
  }
  console.log(
    '  <- WARNING: the RATES column changed RULE between these two boards. ' +
      `${before ? 'older' : 'newer'} scores from A1's quarterly consensus and ` +
      `${before ? 'newer' : 'older'} falls through to the calendar ladder, because the projection ` +
      'snapshots cover only one of the two dates. Every rates delta below is that, not data. ' +
      'Append a snapshot dated on or before both captures and this line goes away.',
  );
}

main().catch((err) => {
  console.error('delta-parity failed:', err);
  process.exit(1);
});
