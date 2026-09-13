/**
 * One symbol's eighteen cells, printed. The level below `npm run parity`.
 *
 *   npm run row -- GBPX GBPUSD EURGBP
 *
 * WHY THIS EXISTS SEPARATELY FROM `legs` AND `cards`. Those two answer questions
 * about the ECONOMIC block — which series filled a slot, what it was measured
 * against, whether their card carries the same row. Neither can see the other
 * four columns, and a currency-index row is mostly those four: trend and
 * seasonality come from the index INSTRUMENT, not from any leg, so a currency
 * whose index row is wrong may have perfectly good legs.
 *
 * That distinction is not academic. GBP measured +4 against A1's GBPX row while
 * every GBP PAIR sat within 2 of theirs, which is impossible if the error is in
 * a leg — a bad leg moves the index row and all seven pairs together. Reading
 * the row cell by cell is what separates the two.
 *
 * Scored at the same rewound cutoff as `npm run parity`, so the numbers here are
 * the numbers in that table and not a fresh board.
 */

import board from '@/fixtures/a1-board.json';
import { MATRIX_SLOTS } from '@/config/setups.config';
import { ALL_SYMBOLS } from '@/config/symbols.config';
import { asOf } from '@/lib/scoring/backtest';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import { runSetupsPipeline } from '@/lib/setups-pipeline';

interface Capture {
  capturedUtc: string | null;
  provenance: string;
  totals: Record<string, number>;
  cells: Record<string, Record<string, number>>;
}

const captures = board.captures as unknown as Capture[];
const CAPTURE = captures
  .filter((c) => c.capturedUtc !== null)
  .sort((a, b) => b.capturedUtc!.localeCompare(a.capturedUtc!))[0];

const HAS_TIME = CAPTURE.capturedUtc!.includes('T');
const END_OF_DAY = new Date(HAS_TIME ? CAPTURE.capturedUtc! : `${CAPTURE.capturedUtc}T23:59:59.000Z`);
const CAPTURED_AT = new Date(Math.min(END_OF_DAY.getTime(), Date.now()));

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padStart = (s: string | number, n: number) => String(s).padStart(n);
const signed = (n: number | null) => (n === null ? '-' : n > 0 ? `+${n}` : String(n));

async function main() {
  const requested = process.argv.slice(2).map((a) => a.toUpperCase());
  if (requested.length === 0) {
    console.log('usage: npm run row -- GBPX GBPUSD EURGBP');
    console.log('       npm run row -- --ALL     the four non-macro columns, every captured row');
    return;
  }

  // `pricesAsOf` so the trend cell is cut at the same instant the events are.
  // Live `now` keeps the calendar's forward window — see PipelineOptions.
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
    now: CAPTURED_AT,
  });

  console.log(`scored as of ${CAPTURE.capturedUtc} (${CAPTURE.provenance})\n`);

  if (requested.includes('--ALL')) {
    printAll(matrix.rows);
    return;
  }

  for (const symbol of requested) {
    const row = matrix.rows.find((r) => r.symbol === symbol);
    if (!row) {
      const known = ALL_SYMBOLS.map((s) => s.symbol).join(' ');
      console.log(`${symbol}: not a symbol. known: ${known}\n`);
      continue;
    }

    const theirs = CAPTURE.totals[symbol];
    const theirCells = CAPTURE.cells[symbol];
    console.log(
      `=== ${symbol} — ours ${signed(row.totalScore)}` +
        (theirs === undefined ? '  (not on their capture)' : `  A1 ${signed(theirs)}  gap ${signed(row.totalScore - theirs)}`),
    );
    console.log(
      `  ${pad('slot', 24)}${padStart('cell', 5)}${padStart('base', 6)}${padStart('quote', 6)}` +
        `${padStart('A1', 5)}${pad('  status', 11)}why`,
    );
    console.log(`  ${'-'.repeat(118)}`);

    for (const slot of MATRIX_SLOTS) {
      const cell = row.cells[slot.key];
      if (!cell) continue;
      const a1 = theirCells?.[slot.key];
      const flag = a1 !== undefined && a1 !== (cell.cell ?? 0) ? ' <-' : '';
      console.log(
        `  ${pad(slot.label, 24)}${padStart(signed(cell.cell), 5)}` +
          `${padStart(cell.baseCell === undefined ? '' : signed(cell.baseCell), 6)}` +
          `${padStart(cell.quoteCell === undefined ? '' : signed(cell.quoteCell), 6)}` +
          `${padStart(a1 === undefined ? '' : signed(a1), 5)}` +
          `${pad(`  ${cell.status}`, 11)}${cell.explanation.slice(0, 66)}${flag}`,
      );
    }

    const cats = Object.entries(row.categoryScores)
      .map(([k, v]) => `${k} ${signed(v)}`)
      .join('   ');
    console.log(`  ${'-'.repeat(118)}`);
    console.log(`  ${cats}   |  populated ${row.populated}  partial ${row.partial}\n`);
  }
}

/**
 * The four columns that are NOT built from macro legs, for every captured row.
 *
 * `implied` is their total minus OUR macro sum: what their trend, seasonality,
 * COT and crowd must add to if their legs equal ours. That assumption is not
 * free — a leg fit over the same 47 totals puts every currency within 1 of ours
 * — so read `implied` as a bound with ±1 of slack, not a measurement.
 *
 * The point of the column is its RANGE. Four cells cap at ±6, so an implied
 * value outside that is proof the legs differ; one AT the cap is a row where
 * every non-macro cell has to be maxed in the same direction, which is a much
 * stronger claim than a 5-point total gap looks.
 */
function printAll(rows: { symbol: string; totalScore: number; cells: Record<string, { cell: number | null }> }[]) {
  const P_SLOTS = ['trend', 'seasonality', 'cot', 'crowd'];
  console.log(
    `  ${pad('symbol', 10)}${padStart('ours', 5)}${padStart('A1', 4)}${padStart('gap', 5)}   ` +
      `${padStart('trend', 6)}${padStart('seas', 5)}${padStart('cot', 5)}${padStart('crowd', 6)}` +
      `${padStart('P', 4)}${padStart('macro', 7)}${padStart('implied', 9)}${padStart('dP', 5)}`,
  );
  console.log(`  ${'-'.repeat(96)}`);

  const out: { line: string; dP: number }[] = [];
  for (const row of rows) {
    const theirs = CAPTURE.totals[row.symbol];
    if (theirs === undefined) continue;
    const p = P_SLOTS.map((k) => row.cells[k]?.cell ?? 0);
    const P = p.reduce((a, b) => a + b, 0);
    const macro = row.totalScore - P;
    const implied = theirs - macro;
    const dP = P - implied;
    out.push({
      dP,
      line:
        `  ${pad(row.symbol, 10)}${padStart(signed(row.totalScore), 5)}${padStart(signed(theirs), 4)}` +
        `${padStart(signed(row.totalScore - theirs), 5)}   ` +
        `${padStart(signed(p[0]), 6)}${padStart(signed(p[1]), 5)}${padStart(signed(p[2]), 5)}${padStart(signed(p[3]), 6)}` +
        `${padStart(signed(P), 4)}${padStart(signed(macro), 7)}${padStart(signed(implied), 9)}${padStart(signed(dP), 5)}` +
        (Math.abs(implied) > 6 ? '  <- impossible, legs differ' : Math.abs(implied) === 6 ? '  <- at the cap' : ''),
    });
  }
  out.sort((a, b) => Math.abs(b.dP) - Math.abs(a.dP));
  for (const o of out) console.log(o.line);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
