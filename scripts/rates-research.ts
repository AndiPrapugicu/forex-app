/**
 * The Rates parity experiment: does "2-year yield vs its own 21-day SMA", run
 * on every currency's OWN yield rather than only the US one, reproduce A1's
 * observed/inferred per-currency Rates legs?
 *
 *   npm run rates-research
 *   npm run rates-research -- --json
 *
 * RESEARCH ONLY. Reads `lib/scoring/rates-research.ts` (the candidate rule,
 * also research-only) and `fixtures/research/rates-2y/*.json` (real historical
 * data fetched from FRED/ECB/SNB/BoE/BoC/MOF this round — see each file's
 * `source`/`url`/`seriesDefinition` fields). Nothing here writes to
 * `lib/scoring/rates.ts`, and nothing here is imported by `buildSetupsMatrix`.
 *
 * THE EVIDENCE THIS TESTS AGAINST. `solveA1Legs`, run on every checksum-valid
 * row this repo currently holds, pins the 'rates' column's leg for four
 * currencies from FOUR INDEPENDENT EQUATIONS (EURX single-row, EURUSD, GBPUSD
 * and EURCHF all differenced) — not the "one algebraic row" prior rounds
 * described, because EURX and GBPUSD were not previously fed into the same
 * solve as EURCHF. All four equations are satisfied by ONE assignment with no
 * conflicts: USD=-1, EUR=0, GBP=0, CHF=-1. USD's -1 is independently
 * corroborated a second way — the checksummed DXY row (`fixtures/a1-board.json`,
 * 2026-08-23) scores rates -1 on a card A1 themselves label "2 Yr Yield
 * (21 day SMA)". JPY, CAD, AUD and NZD have NO checksummed row of any shape in
 * either fixture, so this script can only PREDICT their candidate leg — it
 * cannot compare it to anything and must not pretend otherwise (STEP 8 of this
 * round's directive: calculate the prediction, do not fabricate the A1 side).
 *
 * DATE ALIGNMENT IS NOT UNIFORM ACROSS CURRENCIES, and this script does not
 * paper over that. USD/EUR/GBP/CAD have a real observation on 2026-08-24, the
 * date the EURX/EURUSD/GBPUSD/EURCHF rows were captured. JPY's most recent
 * observation is 2026-08-25 (one day past capture — immaterial). CHF's source
 * has published NOTHING since 2026-07-31 (see `EdgeFinder-known-unknown-blocked.md`,
 * Rates section) — roughly 3.5 weeks stale versus the capture date. CHF is
 * scored anyway, using its own most recent available date, with the staleness
 * reported plainly rather than hidden — see `CandidateRateReading.staleDays`.
 */

import USD from '@/fixtures/research/rates-2y/USD.json';
import EUR from '@/fixtures/research/rates-2y/EUR.json';
import GBP from '@/fixtures/research/rates-2y/GBP.json';
import CAD from '@/fixtures/research/rates-2y/CAD.json';
import JPY from '@/fixtures/research/rates-2y/JPY.json';
import CHF from '@/fixtures/research/rates-2y/CHF.json';
import board from '@/fixtures/a1-board.json';
import top24 from '@/fixtures/a1-top-setups-2026-08-24.json';
import top25 from '@/fixtures/a1-top-setups-2026-08-25.json';
import {
  checkBounds,
  checkRowSum,
  checkStructuralZeros,
  solvePerCapture,
} from '@/lib/scoring/a1-legs';
import {
  scoreHistorical2YRate,
  type CandidateRateReading,
  type HistoricalYieldSeries,
} from '@/lib/scoring/rates-research';
import { scoreRateExpectation } from '@/lib/scoring/rates';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import type { Currency } from '@/lib/types';

/** The date every USD/EUR/GBP/CAD checksummed row used for this experiment was captured on. */
const AS_OF = '2026-08-24';

const SERIES: Record<Currency, HistoricalYieldSeries | undefined> = {
  USD: USD as HistoricalYieldSeries,
  EUR: EUR as HistoricalYieldSeries,
  GBP: GBP as HistoricalYieldSeries,
  CAD: CAD as HistoricalYieldSeries,
  JPY: JPY as HistoricalYieldSeries,
  CHF: CHF as HistoricalYieldSeries,
  AUD: undefined, // RBA blocked by WAF this round — see EdgeFinder-known-unknown-blocked.md
  NZD: undefined, // Not re-fetched this round
  ZAR: undefined,
};

// ---------------------------------------------------------------------------
// A1 evidence: the same combined-fixture leg solve `component-parity.ts` runs.
// ---------------------------------------------------------------------------

interface Capture {
  capturedUtc: string | null;
  totals: Record<string, number>;
  cells: Record<string, Record<string, number>>;
}

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

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

type Classification =
  | 'EXACT'
  | 'MATCH_AFTER_ALIGNMENT'
  | 'MISMATCH'
  | 'A1_UNKNOWN'
  | 'SOURCE_UNAVAILABLE'
  | 'DATE_ALIGNMENT_UNKNOWN'
  | 'SOLVED_LEG_ONLY';

interface CurrencyResult {
  currency: Currency;
  a1Leg: number | null; // from solveA1Legs, when pinned
  a1EvidenceEquations: number; // how many independent rows constrained it
  ourProductionLeg: number | null; // current lib/scoring/rates.ts output
  exclCurrent: CandidateRateReading | null;
  inclCurrent: CandidateRateReading | null;
  classification: Classification;
  note: string;
}

function classify(
  a1Leg: number | null,
  primary: CandidateRateReading | null,
  alt: CandidateRateReading | null,
): { classification: Classification; note: string } {
  if (!primary && !alt) {
    return { classification: 'SOURCE_UNAVAILABLE', note: 'No historical series available.' };
  }
  if (a1Leg === null) {
    return {
      classification: 'A1_UNKNOWN',
      note: 'No checksum-valid A1 row constrains this currency\'s rates leg — prediction only.',
    };
  }
  if (primary && primary.candidateLeg === a1Leg) {
    if (primary.staleDays > 7) {
      return {
        classification: 'MATCH_AFTER_ALIGNMENT',
        note: `Matches, but "current" is ${primary.staleDays}d stale relative to ${AS_OF} — treat with caution.`,
      };
    }
    return { classification: 'EXACT', note: 'Candidate matches the A1-inferred leg exactly.' };
  }
  if (alt && alt.candidateLeg === a1Leg) {
    return {
      classification: 'MATCH_AFTER_ALIGNMENT',
      note: 'Only the incl-current window mode matches; excl-current does not.',
    };
  }
  if (primary && primary.staleDays > 7) {
    return {
      classification: 'DATE_ALIGNMENT_UNKNOWN',
      note: `Mismatch, but "current" is ${primary.staleDays}d stale — cannot rule out alignment as the cause.`,
    };
  }
  return { classification: 'MISMATCH', note: 'Candidate disagrees with the A1-inferred leg under both window modes.' };
}

/**
 * The SAME excl-current reading, re-thresholded with an ABSOLUTE percentage-
 * point flat band instead of the RELATIVE one `scoreHistorical2YRate` uses.
 *
 * Not a second candidate rule — the underlying yield/sma numbers are identical.
 * This exists because this codebase already carries two different flat-band
 * conventions for two adjacent purposes (`YIELD_FLAT_BAND = 0.005`, relative,
 * in `scoreYield2y`; `RATE_SPREAD_FLAT_BAND = 0.1`, absolute percentage
 * points, in `rates.ts`'s unused spread-vs-policy-rate reading), and Step 5 of
 * this round requires testing rather than assuming which threshold shape is
 * right before picking one. See the printed ambiguity note below for what
 * this changes.
 */
function legUnderAbsoluteBand(reading: CandidateRateReading | null, bandPct: number): -1 | 0 | 1 | null {
  if (!reading) return null;
  if (Math.abs(reading.delta) < bandPct) return 0;
  return reading.delta > 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  const json = process.argv.includes('--json');

  /**
   * ONE DATE PER SOLVE, and this round is where that stopped being optional.
   *
   * A rates leg is not a constant. Merging 2026-08-25's CHFX row into the
   * 2026-08-24 set makes the rates column UNSATISFIABLE — CHFX prints 0 where
   * EURCHF and EURX together require CHF = -1 the day before — and the solver
   * correctly reports a contradiction that is really just two different days.
   * Every leg this experiment compares against is therefore solved from rows
   * captured on ONE date, and the 2026-08-25 evidence is reported separately
   * below rather than blended in.
   */
  const cells24: Record<string, Record<string, number>> = {
    ...boardCellsForSolve(),
    ...(top24.cells as unknown as Record<string, Record<string, number>>),
  };
  for (const breach of checkStructuralZeros(cells24)) delete cells24[breach.symbol];

  const cells25: Record<string, Record<string, number>> = {
    ...(top25.cells as unknown as Record<string, Record<string, number>>),
  };
  for (const breach of checkStructuralZeros(cells25)) delete cells25[breach.symbol];

  // One call, two dates kept apart by construction. CHF's rates leg differs
  // between them (-1 then 0) and that difference is the finding, not noise to
  // be averaged away by solving the union.
  const [{ result: solved }, { result: solved25 }] = solvePerCapture([
    { date: '2026-08-24', rows: cells24 },
    { date: '2026-08-25', rows: cells25 },
  ]);
  const legs25 = solved25.columns.find((c) => c.slotKey === 'rates')?.legs ?? {};
  const ratesColumn = solved.columns.find((c) => c.slotKey === 'rates');
  const a1Legs = ratesColumn?.legs ?? {};

  const payload = await runSetupsPipeline();
  const now = new Date(`${AS_OF}T23:59:59.000Z`);

  const results: CurrencyResult[] = [];

  for (const currency of ['USD', 'EUR', 'GBP', 'CAD', 'JPY', 'CHF', 'AUD', 'NZD'] as Currency[]) {
    const series = SERIES[currency];
    const exclCurrent = series ? scoreHistorical2YRate(series, AS_OF, 'excl-current') : null;
    const inclCurrent = series ? scoreHistorical2YRate(series, AS_OF, 'incl-current') : null;

    const a1Leg = a1Legs[currency] ?? null;
    const equations = ratesColumn
      ? ratesColumn.equations // total equations in the column, not per-currency — see printed detail below
      : 0;

    const production = scoreRateExpectation(currency, payload.sovereignYields ?? new Map(), payload.events, now);

    const { classification, note } = classify(a1Leg, exclCurrent, inclCurrent);

    results.push({
      currency,
      a1Leg,
      a1EvidenceEquations: equations,
      ourProductionLeg: production.cell,
      exclCurrent,
      inclCurrent,
      classification,
      note,
    });
  }

  if (json) {
    console.log(JSON.stringify({ asOf: AS_OF, solvedRatesColumn: ratesColumn, results }, null, 2));
    return;
  }

  console.log('='.repeat(100));
  console.log(`RATES PARITY EXPERIMENT — candidate "2Y yield vs 21-day SMA" per currency, as of ${AS_OF}`);
  console.log('='.repeat(100));

  console.log(`\nA1 evidence (solveA1Legs on every checksum-valid row): ${ratesColumn?.equations ?? 0} equations, ` +
    `${ratesColumn?.satisfied ?? 0} satisfied, satisfiable=${ratesColumn?.satisfiable ?? false}, ` +
    `conflicts=${ratesColumn?.conflicts.length ?? 0}`);
  console.log(`Pinned legs: ${JSON.stringify(a1Legs)}`);

  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const padStart = (s: string | number, n: number) => String(s).padStart(n);
  const signed = (n: number | null) => (n === null ? '—' : n > 0 ? `+${n}` : String(n));

  console.log('\n' + pad('CCY', 5) + padStart('A1 leg', 8) + padStart('Ours', 7) + padStart('Cand(excl)', 12) +
    padStart('Cand(incl)', 12) + padStart('Yield', 9) + padStart('SMA21', 9) + padStart('Delta%', 9) +
    padStart('Stale', 7) + '  ' + pad('Classification', 22));
  console.log('-'.repeat(120));

  for (const r of results) {
    const c = r.exclCurrent;
    console.log(
      pad(r.currency, 5) +
      padStart(signed(r.a1Leg), 8) +
      padStart(signed(r.ourProductionLeg), 7) +
      padStart(signed(c?.candidateLeg ?? null), 12) +
      padStart(signed(r.inclCurrent?.candidateLeg ?? null), 12) +
      padStart(c ? c.currentYield.toFixed(3) : '—', 9) +
      padStart(c ? c.sma.toFixed(3) : '—', 9) +
      padStart(c ? `${(c.deltaPct * 100).toFixed(2)}%` : '—', 9) +
      padStart(c ? `${c.staleDays}d` : '—', 7) +
      '  ' + pad(r.classification, 22),
    );
  }

  const ABS_BAND = 0.1; // percentage points — RATE_SPREAD_FLAT_BAND's shape, not YIELD_FLAT_BAND's
  console.log(`\nTHRESHOLD AMBIGUITY (Step 5): the same excl-current yield/SMA numbers, re-thresholded with an\n` +
    `ABSOLUTE ${ABS_BAND}pp flat band (this codebase's OTHER existing flat-band convention,\n` +
    `RATE_SPREAD_FLAT_BAND) instead of the RELATIVE 0.5% one scoreHistorical2YRate uses by default:`);
  console.log('\n' + pad('CCY', 5) + padStart('A1 leg', 8) + padStart('Relative-band', 15) + padStart('Absolute-band', 15) + '  ' + pad('Agrees with A1 under', 24));
  for (const r of results) {
    const abs = legUnderAbsoluteBand(r.exclCurrent, ABS_BAND);
    const relMatch = r.a1Leg !== null && r.exclCurrent?.candidateLeg === r.a1Leg;
    const absMatch = r.a1Leg !== null && abs === r.a1Leg;
    const agrees = r.a1Leg === null ? 'n/a — A1_UNKNOWN' : relMatch && absMatch ? 'both' : relMatch ? 'relative only' : absMatch ? 'absolute only' : 'neither';
    console.log(pad(r.currency, 5) + padStart(signed(r.a1Leg), 8) + padStart(signed(r.exclCurrent?.candidateLeg ?? null), 15) + padStart(signed(abs), 15) + '  ' + pad(agrees, 24));
  }
  console.log('\nThe two bands do not agree on which currencies match — see FINAL REPORT for why neither is chosen here.');

  console.log('\nNotes:');
  for (const r of results) {
    console.log(`  ${r.currency}: ${r.note}`);
    if (r.exclCurrent) console.log(`    excl-current: ${r.exclCurrent.explanation}`);
    if (r.inclCurrent) console.log(`    incl-current: ${r.inclCurrent.explanation}`);
  }

  console.log('\nA SECOND DATE, KEPT SEPARATE (2026-08-25 Top Setups, structurally screened):');
  console.log(`  rates legs pinned: ${JSON.stringify(legs25)}`);
  console.log('  These are NOT merged into the table above -- see the comment in main(). NZD is the');
  console.log('  first checksummed New Zealand rates evidence this repo has held, and no historical');
  console.log('  NZ 2-year series is on file to test the SMA candidate against it.');

  const tally = new Map<Classification, number>();
  for (const r of results) tally.set(r.classification, (tally.get(r.classification) ?? 0) + 1);
  console.log('\nTally:');
  for (const [k, v] of tally) console.log(`  ${k}: ${v}`);
}

main().catch((err) => {
  console.error('rates-research run failed:', err);
  process.exitCode = 1;
});
