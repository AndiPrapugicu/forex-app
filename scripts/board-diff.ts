/**
 * The whole board against A1's, grouped so a systematic defect is visible.
 *
 *   npm run board:diff
 *
 * `npm run parity` answers "how far off are we" and, for the handful of rows
 * captured cell by cell, "which column". This answers the question between those
 * two: WHICH GROUP OF ROWS is wrong, and is the cause shared.
 *
 * Fifty symbols sorted by gap is fifty unrelated numbers, and every fix driven
 * off that list so far has been a single row that happened to look explicable.
 * Two of them improved TOTAL ABS GAP and were still wrong — the GBP producer
 * price series and the consensus fallback — and both were caught only by asking
 * which OTHER rows moved. So this prints no row list at all. It prints the two
 * groupings that carry a cause:
 *
 *   BY CODE PATH   `buildSetupsMatrix` sends each symbol down a different
 *                  branch — pair, single-economy, technical-only. A branch-wide
 *                  defect shows as one group uniformly off while the rest are
 *                  fine, which no per-row view makes visible.
 *
 *   BY CURRENCY    a currency's macro legs feed every pair it appears in, with
 *                  the sign flipped depending on which side it is on. A bad leg
 *                  therefore shows as a base-mean and a quote-mean that are
 *                  large and OPPOSITE. This is the view that isolated the JPY
 *                  block; it is a standing report rather than an ad-hoc script
 *                  because it is the first thing to read after any leg change.
 *
 * Same capture selection and rewind as `scripts/parity.ts`, so the two agree
 * about what "A1's board" means.
 */

import board from '@/fixtures/a1-board.json';
import { ALL_SYMBOLS, type SymbolDefinition } from '@/config/symbols.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { asOf } from '@/lib/scoring/backtest';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import { MAJORS } from '@/lib/types';

interface Capture {
  capturedUtc: string | null;
  provenance: string;
  totals: Record<string, number>;
  cells: Record<string, Record<string, number>>;
}

const captures = board.captures as unknown as Capture[];

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padStart = (s: string | number, n: number) => String(s).padStart(n);
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const fixed = (n: number) => (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

function selectCapture(): Capture {
  const dated = captures.filter((c) => c.capturedUtc !== null);
  if (dated.length === 0) throw new Error('fixtures/a1-board.json has no dated capture');
  return dated.sort((a, b) => b.capturedUtc!.localeCompare(a.capturedUtc!))[0];
}

const CAPTURE = selectCapture();
const HAS_TIME = CAPTURE.capturedUtc!.includes('T');
const END_OF_DAY = new Date(HAS_TIME ? CAPTURE.capturedUtc! : `${CAPTURE.capturedUtc}T23:59:59.000Z`);
const CAPTURED_AT = new Date(Math.min(END_OF_DAY.getTime(), Date.now()));

/**
 * The branch `buildSetupsMatrix` will send a symbol down.
 *
 * Named for the CODE PATH rather than the asset class, because that is what the
 * grouping is for. `currency` and `commodity` look like different things on a
 * trading screen and are the same eight lines of scoring; an FX pair is the only
 * one that differences two legs.
 */
function codePath(def: SymbolDefinition): string {
  if (def.kind === 'fx') return 'fx pair (base - quote)';
  if (def.kind === 'currency') return 'currency row (single economy)';
  return `${def.kind} (single economy)`;
}

async function main() {
  // `pricesAsOf` so the trend cell is cut at the same instant the events are.
  // Live `now` keeps the calendar's forward window — see PipelineOptions.
  const payload = await runSetupsPipeline(new Date(), { pricesAsOf: CAPTURED_AT });
  const trimmed = asOf(
    { events: payload.events, cot: payload.cot, bars: new Map(), seasonality: new Map() },
    CAPTURED_AT,
  );
  const matrix = buildSetupsMatrix({
    events: trimmed.events,
    cot: trimmed.cot,
    technicals: payload.technicals,
    sovereignYields: payload.sovereignYields,
    // Same reason as `scripts/parity.ts`: without it the rate column is blank on
    // every single-economy row and the code-path table blames the wrong branch.
    yield2y: payload.yield2y,
    now: CAPTURED_AT,
  });

  const defs = new Map((ALL_SYMBOLS as SymbolDefinition[]).map((d) => [d.symbol, d]));
  const rows = Object.keys(CAPTURE.totals)
    .map((symbol) => {
      const row = matrix.rows.find((r) => r.symbol === symbol);
      const def = defs.get(symbol);
      if (!row || !def) return null;
      return { symbol, def, ours: row.totalScore, a1: CAPTURE.totals[symbol], gap: row.totalScore - CAPTURE.totals[symbol] };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  console.log(`BOARD DIFF vs A1 captured ${CAPTURE.capturedUtc} (${CAPTURE.provenance})`);
  console.log(`${rows.length} of ${Object.keys(CAPTURE.totals).length} published symbols matched\n`);

  // --- by code path ------------------------------------------------------
  console.log('BY CODE PATH — a branch-wide defect shows as one group uniformly off\n');
  console.log(
    `  ${pad('path', 30)}${padStart('n', 3)}${padStart('mean gap', 11)}${padStart('mean |gap|', 12)}${padStart('abs total', 11)}`,
  );
  console.log(`  ${'-'.repeat(67)}`);

  const paths = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = codePath(r.def);
    paths.set(k, [...(paths.get(k) ?? []), r]);
  }
  for (const [path, group] of [...paths.entries()].sort(
    (a, b) => mean(b[1].map((r) => Math.abs(r.gap))) - mean(a[1].map((r) => Math.abs(r.gap))),
  )) {
    const gaps = group.map((r) => r.gap);
    console.log(
      `  ${pad(path, 30)}${padStart(group.length, 3)}${padStart(fixed(mean(gaps)), 11)}` +
        `${padStart(mean(gaps.map(Math.abs)).toFixed(1), 12)}${padStart(gaps.reduce((t, g) => t + Math.abs(g), 0), 11)}`,
    );
  }

  /**
   * A mean gap near zero with a large mean ABSOLUTE gap is the interesting case:
   * the group is not biased, it is noisy, which points at the legs rather than
   * at the branch. A large signed mean points at the branch itself.
   */
  console.log('\n  a large SIGNED mean points at the branch; a large ABSOLUTE mean with a');
  console.log('  signed mean near zero points at the legs feeding it\n');

  // --- by currency -------------------------------------------------------
  console.log('BY CURRENCY LEG — a bad leg shows as base and quote means large and OPPOSITE\n');
  console.log(
    `  ${pad('cur', 5)}${padStart('as base', 9)}${padStart('n', 4)}${padStart('as quote', 11)}${padStart('n', 4)}` +
      `${padStart('spread', 10)}${padStart('own row', 9)}`,
  );
  console.log(`  ${'-'.repeat(52)}`);

  const fx = rows.filter((r) => r.def.kind === 'fx');
  const byCur = MAJORS.map((cur) => {
    const asBase = fx.filter((r) => r.def.base === cur).map((r) => r.gap);
    const asQuote = fx.filter((r) => r.def.quote === cur).map((r) => r.gap);
    /**
     * The single-currency row for the same currency, which has no second leg to
     * confound it. Where it agrees with the spread the diagnosis is settled;
     * where it disagrees, the currency row is scored by a different branch and
     * that disagreement is itself the finding.
     */
    const ownSymbol = cur === 'USD' ? 'DXY' : `${cur}X`;
    const own = rows.find((r) => r.symbol === ownSymbol);
    return { cur, asBase, asQuote, spread: mean(asBase) - mean(asQuote), own };
  }).sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread));

  for (const c of byCur) {
    console.log(
      `  ${pad(c.cur, 5)}${padStart(fixed(mean(c.asBase)), 9)}${padStart(c.asBase.length, 4)}` +
        `${padStart(fixed(mean(c.asQuote)), 11)}${padStart(c.asQuote.length, 4)}` +
        `${padStart(fixed(c.spread), 10)}${padStart(c.own ? signed(c.own.gap) : '-', 9)}`,
    );
  }

  console.log('\n  spread = mean(as base) - mean(as quote). A leg scored too BULLISH lifts every');
  console.log('  pair it leads and drags every pair it backs, so it reads as a large POSITIVE');
  console.log('  spread. "own row" is that currency alone — no second leg to confound it.\n');

  const worst = byCur[0];
  console.log(
    `  largest: ${worst.cur} at ${fixed(worst.spread)}` +
      (worst.own ? `, and its own row is ${signed(worst.own.gap)}` : ''),
  );
}

main().catch((err) => {
  console.error('board diff failed:', err);
  process.exitCode = 1;
});
