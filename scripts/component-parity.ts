/**
 * The component-level parity matrix, printed.
 *
 *   npm run component-parity            -- console table + tallies
 *   npm run component-parity -- --json  -- raw ComponentParityMatrix, for piping to a file
 *
 * See `lib/scoring/component-parity.ts` for the evidence-tier and
 * reproducibility model this renders. This script's only job is sourcing that
 * model's inputs from the fixtures on disk and the live pipeline.
 *
 * TWO DATE CONTEXTS NOW, NOT THREE. `fixtures/a1-top-setups-2026-08-25.json`
 * carried totals only until a second, cleaner screenshot (a proper multi-row
 * table crop, not the squished video-frame strip captures D/E came from)
 * produced three checksum-valid rows — GBPX, NZDX, EURJPY — cross-validated
 * against capture D's independently-recorded totals. That fixture's own
 * `_cellsReadme` explains why two other rows in the same screenshot (EURGBP,
 * UK100) were NOT admitted. This is the day this file's own prior comment
 * said to add a second context "the day a checksummed cell exists to compare
 * it against" — so it's added, still with no context for live-now, since
 * there is still no A1 capture for "today" at all.
 *
 * THE LEG SOLVE IS FED FROM TWO FIXTURES, NOT ONE. `scripts/parity.ts` only
 * ever passes `fixtures/a1-board.json`'s cells into `solveA1Legs`. This script
 * additionally merges in `fixtures/a1-top-setups-2026-08-24.json`'s EURCHF row
 * — checksummed AND cross-validated against an independently-derived Forex
 * Scorecard card, per that fixture's own `_readme` — which until now sat
 * unused as a second currency-index-shaped row the solver never saw.
 */

import board from '@/fixtures/a1-board.json';
import top24 from '@/fixtures/a1-top-setups-2026-08-24.json';
import top25 from '@/fixtures/a1-top-setups-2026-08-25.json';
import { ALL_SYMBOLS, type SymbolDefinition } from '@/config/symbols.config';
import {
  checkBounds,
  checkRowSum,
  checkStructuralZeros,
  solvePerCapture,
} from '@/lib/scoring/a1-legs';
import { ASSET_TYPE } from '@/lib/scoring/a1-symbol-map';
import { asOf } from '@/lib/scoring/backtest';
import { buildComponentParityMatrix, type ComponentParityCell, type ParityStatus } from '@/lib/scoring/component-parity';
import { buildSetupsMatrix, type SymbolRow } from '@/lib/scoring/setups';
import { runSetupsPipeline } from '@/lib/setups-pipeline';

const CAPTURED_AT_24 = new Date('2026-08-24T23:59:59.000Z');
const CAPTURED_AT_25 = new Date('2026-08-25T23:59:59.000Z');

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padStart = (s: string | number, n: number) => String(s).padStart(n);
const signed = (n: number | null | undefined) => (n === null || n === undefined ? '-' : n > 0 ? `+${n}` : String(n));

interface Capture {
  capturedUtc: string | null;
  provenance: string;
  totals: Record<string, number>;
  cells: Record<string, Record<string, number>>;
}

/**
 * The board's most recent DATED capture, validated cell by cell — the same
 * two checks `scripts/parity.ts` runs (row-sum, then bounds), reproduced here
 * rather than imported because `parity.ts` runs them as a side effect of its
 * own module-level constants, not as a reusable function.
 */
function boardCellsForSolve(): Record<string, Record<string, number>> {
  const captures = board.captures as unknown as Capture[];
  const dated = captures.filter((c) => c.capturedUtc !== null);
  const capture = dated.sort((a, b) => b.capturedUtc!.localeCompare(a.capturedUtc!))[0];
  if (!capture) return {};

  const good: Record<string, Record<string, number>> = {};
  for (const [symbol, row] of Object.entries(capture.cells)) {
    const published = capture.totals[symbol];
    if (published === undefined) continue;
    if (!checkRowSum(row, published).ok) continue;
    good[symbol] = row;
  }
  for (const breach of checkBounds(good)) delete good[breach.symbol];
  for (const breach of checkStructuralZeros(good)) delete good[breach.symbol];
  return good;
}

/**
 * Every row this run is about to believe, screened one more time.
 *
 * The fixture files carry their own admission notes, but a note is a claim and
 * this is a test. It runs over the MERGED set — board plus both Top Setups
 * captures — so a row that slips into a `cells` block without being screened
 * cannot reach the leg solve, and the run says out loud which rows it dropped
 * rather than silently disagreeing with the fixture that shipped them.
 */
function screen(
  cells: Record<string, Record<string, number>>,
): { cells: Record<string, Record<string, number>>; dropped: string[] } {
  const good = { ...cells };
  const dropped: string[] = [];
  for (const breach of checkStructuralZeros(good)) {
    dropped.push(`${breach.symbol}: ${breach.slotKey} = ${breach.value} — ${breach.detail}`);
    delete good[breach.symbol];
  }
  return { cells: good, dropped };
}

/** Every symbol this run builds parity rows for: the checksummed rows, plus every currency index. */
function focusSymbols(): SymbolDefinition[] {
  const names = new Set<string>([
    ...Object.keys(top24.cells),
    ...Object.keys(top25.cells),
    'DXY', 'EURX', 'GBPX', 'JPYX', 'AUDX', 'NZDX', 'CADX', 'CHFX',
  ]);
  return [...names]
    .map((name) => ALL_SYMBOLS.find((d) => d.symbol === name))
    .filter((d): d is SymbolDefinition => d !== undefined);
}

function summarize(cells: ComponentParityCell[]) {
  const byComponent = new Map<string, Map<ParityStatus, number>>();
  const byAssetType = new Map<string, Map<ParityStatus, number>>();
  for (const c of cells) {
    const bc = byComponent.get(c.component) ?? new Map<ParityStatus, number>();
    bc.set(c.status, (bc.get(c.status) ?? 0) + 1);
    byComponent.set(c.component, bc);

    const type = ASSET_TYPE[c.symbol] ?? '?';
    const ba = byAssetType.get(type) ?? new Map<ParityStatus, number>();
    ba.set(c.status, (ba.get(c.status) ?? 0) + 1);
    byAssetType.set(type, ba);
  }
  return { byComponent, byAssetType };
}

const STATUS_ORDER: ParityStatus[] = [
  'EXACT', 'MISMATCH', 'TIMING_CONFOUNDED', 'NOT_CHECKSUMMED', 'BLOCKED_SOURCE', 'NOT_VISIBLE', 'UNKNOWN',
];

function printTally(title: string, byKey: Map<string, Map<ParityStatus, number>>) {
  const COL = 20;
  console.log(`\n${title}\n${'-'.repeat(22 + COL * STATUS_ORDER.length)}`);
  console.log(`  ${pad('', 22)}${STATUS_ORDER.map((s) => padStart(s, COL)).join('')}`);
  for (const [key, counts] of byKey) {
    console.log(`  ${pad(key, 22)}${STATUS_ORDER.map((s) => padStart(counts.get(s) ?? 0, COL)).join('')}`);
  }
}

async function main() {
  const json = process.argv.includes('--json');

  /**
   * ONE PIPELINE RUN PER DATE, not one shared run trimmed twice.
   *
   * `asOf` rewinds events and COT after the fact, but the price series behind
   * the trend cell is fixed when the pipeline runs — so a single shared payload
   * gave both dates TODAY's moving averages. That is what put `trend` in the
   * TIMING_CONFOUNDED column and kept it there. Since 2026-08-30 the pipeline
   * takes the date, so it has to be called with each one.
   *
   * Two runs rather than one is the cost. Yahoo's responses are cached per
   * ticker inside the connector, so the second run re-reads them rather than
   * re-downloading two years of bars for 33 symbols.
   */
  const payloads = new Map<number, Awaited<ReturnType<typeof runSetupsPipeline>>>();
  for (const at of [CAPTURED_AT_24, CAPTURED_AT_25]) {
    payloads.set(at.getTime(), await runSetupsPipeline(new Date(), { pricesAsOf: at }));
  }
  const payload = payloads.get(CAPTURED_AT_24.getTime())!;

  function rowsAsOf(capturedAt: Date): Map<string, SymbolRow> {
    const forDate = payloads.get(capturedAt.getTime()) ?? payload;
    const trimmed = asOf({ events: forDate.events, cot: forDate.cot, bars: new Map(), seasonality: new Map() }, capturedAt);
    const matrix = buildSetupsMatrix({
      events: trimmed.events,
      cot: trimmed.cot,
      technicals: forDate.technicals,
      sovereignYields: forDate.sovereignYields,
      yield2y: forDate.yield2y,
      retailPositioning: forDate.retailPositioning,
      now: capturedAt,
    });
    return new Map(matrix.rows.map((r) => [r.symbol, r]));
  }

  /**
   * ONE SOLVE PER DATE. A leg is not a constant — A1's CHF rates leg reads -1
   * on 2026-08-24 (via EURCHF against EURX) and 0 on 2026-08-25 (via CHFX), and
   * a solve fed both dates at once reports that as a self-contradicting column
   * rather than as the two observations it is. Merging dates was the same
   * mistake `fixtures/a1-board.json` already warns about for TOTALS; it applies
   * to cells with more force, because a cell is what the leg is read from.
   *
   * The board's own dated capture goes with 2026-08-24 despite being taken on
   * 2026-08-23: it contributes exactly one row, DXY, whose only leg-bearing
   * columns are economic, and no closer-dated board capture exists.
   */
  const screened = screen({
    ...boardCellsForSolve(),
    ...(top24.cells as unknown as Record<string, Record<string, number>>),
  });
  const screened25 = screen(top25.cells as unknown as Record<string, Record<string, number>>);
  /**
   * Solved through `solvePerCapture` rather than two bare calls, so the two
   * dates cannot drift back together. A merge here would not fail: the spread
   * would keep whichever capture came last and the solve would look clean.
   */
  const [{ result: solved }, { result: solved25 }] = solvePerCapture([
    { date: '2026-08-24', rows: screened.cells },
    { date: '2026-08-25', rows: screened25.cells },
  ]);
  const legs = solved.legs;

  const symbols = focusSymbols();
  const result24 = buildComponentParityMatrix({
    date: '2026-08-24',
    liveNow: false,
    ourRows: rowsAsOf(CAPTURED_AT_24),
    checksummedCells: top24.cells as unknown as Record<string, Partial<Record<string, number>>>,
    checksummedSource: 'fixtures/a1-top-setups-2026-08-24.json .cells (checksum-verified)',
    legs,
    symbols,
  });
  const result25 = buildComponentParityMatrix({
    date: '2026-08-25',
    liveNow: false,
    ourRows: rowsAsOf(CAPTURED_AT_25),
    checksummedCells: top25.cells as unknown as Record<string, Partial<Record<string, number>>>,
    checksummedSource:
      'fixtures/a1-top-setups-2026-08-25.json .cells (checksum + bounds + structural-zero verified, capture F)',
    legs: solved25.legs,
    // Only the three symbols capture F actually checksummed — the 2026-08-24
    // context above already covers every other symbol in `symbols`, and
    // running the full list again here would just duplicate SOLVED_LEG/UNKNOWN
    // reads against the wrong date's `ourRows` for HISTORICAL columns.
    symbols: symbols.filter((d) => Object.keys(top25.cells).includes(d.symbol)),
  });

  const result = { generatedAtUtc: new Date().toISOString(), cells: [...result24.cells, ...result25.cells] };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('='.repeat(100));
  console.log('COMPONENT PARITY MATRIX -- evidence-tiered, two date contexts (2026-08-24 and 2026-08-25 end of day)');
  console.log('='.repeat(100));

  const dropped = [...screened.dropped, ...screened25.dropped];
  if (dropped.length > 0) {
    console.log(`\nSTRUCTURAL SCREEN dropped ${dropped.length} captured row(s) before the solve:`);
    for (const line of dropped) console.log(`  ${line}`);
    console.log('');
  }

  for (const [date, result] of [['2026-08-24', solved], ['2026-08-25', solved25]] as const) {
    if (result.contradicted.length === 0) continue;
    console.log(`\nNOTE: the ${date} leg solve found ${result.contradicted.length} self-contradicting column(s)`);
    console.log(`(${result.contradicted.map((c) => c.slotKey).join(', ')}) -- SOLVED_LEG predictions on those`);
    console.log('columns rest on at least one misread cell somewhere in that date\'s captured evidence.\n');
  }

  const bySymbol = new Map<string, ComponentParityCell[]>();
  for (const cell of result.cells) {
    const key = `${cell.symbol} @ ${cell.date}`;
    bySymbol.set(key, [...(bySymbol.get(key) ?? []), cell]);
  }

  for (const [key, cells] of bySymbol) {
    const symbol = cells[0].symbol;
    console.log(`\n--- ${key} (${ASSET_TYPE[symbol] ?? '?'})`);
    for (const c of cells) {
      const line =
        `  ${pad(c.component, 20)}${pad(c.status, 18)}` +
        `ours ${padStart(signed(c.ourValue), 4)}   theirs ${padStart(signed(c.theirValue), 4)}` +
        `   [${c.evidenceTier}, ${c.reproducibility}]`;
      console.log(line);
      if (c.note) console.log(`  ${' '.repeat(20)}${c.note}`);
    }
  }

  const { byComponent, byAssetType } = summarize(result.cells);
  printTally('BY COMPONENT', byComponent);
  printTally('BY ASSET TYPE', byAssetType);

  const total = result.cells.length;
  const counts = new Map<ParityStatus, number>();
  for (const c of result.cells) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
  console.log(`\n${'-'.repeat(100)}\nTOTAL ${total} cells across ${bySymbol.size} symbols`);
  for (const s of STATUS_ORDER) console.log(`  ${pad(s, 20)}${counts.get(s) ?? 0}`);
}

main().catch((err) => {
  console.error('component-parity run failed:', err);
  process.exitCode = 1;
});
