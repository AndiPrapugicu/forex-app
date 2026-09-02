/**
 * A1 PUBLISHES THREE SURFACES, AND THEY DO NOT AGREE.
 *
 * Captured 2026-08-31 during A1's "EdgeFinder Free Week", which for the first
 * time exposed Top Setups and the per-country Economic Heatmaps together. That
 * combination is what makes this script possible, and it overturns an
 * assumption several earlier rounds were built on: that the only way to reach
 * A1's per-currency legs was to solve for them off the metals.
 *
 * The three surfaces:
 *
 *   1. COUNTRY HEATMAPS  per-release arithmetic - series, date, actual,
 *      forecast, previous, surprise, and a Bullish/Bearish/Neutral currency
 *      impact. This is the only surface that shows its work.
 *   2. INDEX ROWS        EURO, GB-POUND, JP-YEN, CH-FRANC, CA-DOLLAR,
 *      AU-DOLLAR, NZ-DOLLAR, US-DOLLAR on Top Setups. A single-currency row,
 *      so each cell IS that currency's leg, undifferenced.
 *   3. PAIR ROWS         the 28 FX pairs on Top Setups.
 *
 * WHAT THIS SCRIPT MEASURES, and why each check earns its place:
 *
 *   - index row == heatmap currency impact, cell by cell. If this holds, the
 *     index rows are trustworthy legs and every earlier leg-solving exercise
 *     can be replaced by simply reading them.
 *   - pair cell == leg(base) - leg(quote), against those same published legs.
 *     A column that fails here is one where A1 contradicts A1, which makes it
 *     worthless as a parity target in EITHER direction. See HARDENING.md 6:
 *     matching one side of someone's internal contradiction is a coin flip.
 *
 * A NOTE ON WHAT "AGREE" DOES NOT MEAN. Agreement across A1's own surfaces is
 * evidence that A1 is self-consistent. It is not evidence that A1 is right, and
 * this script is not a scoring authority. It classifies A1, not us.
 *
 *   npm run a1-surfaces
 */

import fs from 'node:fs';
import path from 'node:path';

type Row = Record<string, string>;

const readCsv = (file: string): Row[] => {
  const lines = fs.readFileSync(path.join(process.cwd(), 'fixtures', file), 'utf8').trim().split('\n');
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])) as Row);
};

const board = readCsv('a1-top-setups-2026-08-31.csv');
const heat = readCsv('a1-economic-heatmaps-2026-08-31.csv');

/** A1's own name for each single-currency row. */
const INDEX_ROW: Record<string, string> = {
  US: 'US-DOLLAR', EU: 'EURO', UK: 'GB-POUND', JP: 'JP-YEN',
  CA: 'CA-DOLLAR', AU: 'AU-DOLLAR', NZ: 'NZ-DOLLAR', CH: 'CH-FRANC',
};
const CURRENCY: Record<string, string> = {
  US: 'USD', EU: 'EUR', UK: 'GBP', JP: 'JPY',
  CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF',
};

/**
 * Heatmap row numbers are stable across countries and are the real column
 * identity - the board's header is just a label over the top of them. Slot 8 is
 * the one that shows this most clearly: the board calls it "Cnsmr Conf" and the
 * US populates it with Wage Growth YoY. No country publishes a consumer
 * confidence row at all.
 */
const ROW_TO_COLUMN: Record<number, string> = {
  1: 'GDP', 2: 'mPMI', 3: 'sPMI', 4: 'RetailSales', 5: 'CPI', 6: 'PPI',
  7: 'PCE', 8: 'CnsmrConf', 9: 'UnempRate', 10: 'NFP', 11: 'ADP',
  12: 'JOLTS', 13: 'UnempClaims',
};
const IMPACT: Record<string, number> = { Bullish: 1, Bearish: -1, Neutral: 0 };
const ECONOMIC = [
  'GDP', 'mPMI', 'sPMI', 'RetailSales', 'CnsmrConf', 'CPI', 'PPI',
  'PCE', 'NFP', 'UnempRate', 'UnempClaims', 'ADP', 'JOLTS',
];

const rowFor = (symbol: string) => board.find((b) => b.Symbol === symbol)!;
const pad = (s: unknown, n: number) => String(s ?? '').padEnd(n);

function indexRowsVsHeatmaps() {
  console.log('='.repeat(94));
  console.log('1. INDEX ROWS vs COUNTRY HEATMAPS - is a single-currency row the same thing as its heatmap?');
  console.log('='.repeat(94));

  let match = 0;
  const problems: string[] = [];

  for (const country of Object.keys(INDEX_ROW)) {
    const idx = rowFor(INDEX_ROW[country]);
    const covered = new Set<string>();

    for (const h of heat.filter((x) => x.country === country)) {
      const col = ROW_TO_COLUMN[Number(h.row)];
      if (!col) continue;
      covered.add(col);
      const want = IMPACT[h.currencyImpact];
      const got = Number(idx[col]);
      if (want === got) match += 1;
      else problems.push(`${country} ${pad(col, 12)} heatmap ${pad(h.currencyImpact, 8)}(${want}) vs index ${got}  [${h.series}]`);
    }

    // A column with no heatmap row must score 0. That is a real claim, not a
    // gap: it is how we learned A1 carries no consumer confidence anywhere.
    for (const col of ECONOMIC) {
      if (covered.has(col)) continue;
      const got = Number(idx[col]);
      if (got === 0) match += 1;
      else problems.push(`${country} ${pad(col, 12)} no heatmap row - expected 0, index says ${got}`);
    }
  }

  console.log(`  MATCH ${match}   MISMATCH ${problems.length}`);
  problems.forEach((p) => console.log('  ' + p));
  if (!problems.length) {
    console.log('  The index rows ARE the heatmaps. Read legs off them directly; do not solve for them.');
  }
}

function pairRowsVsPublishedLegs() {
  console.log();
  console.log('='.repeat(94));
  console.log('2. PAIR ROWS vs THOSE SAME PUBLISHED LEGS - cell(pair) == leg(base) - leg(quote)?');
  console.log('='.repeat(94));

  const byCurrency = Object.fromEntries(
    Object.entries(CURRENCY).map(([country, cur]) => [cur, INDEX_ROW[country]]),
  );
  const currencies = Object.values(CURRENCY);
  const pairs = board
    .map((b) => b.Symbol)
    .filter((s) => s.length === 6 && currencies.includes(s.slice(0, 3)) && currencies.includes(s.slice(3)));

  for (const col of ECONOMIC) {
    const equations = pairs
      .map((p) => [p.slice(0, 3), p.slice(3), Number(rowFor(p)[col])] as const)
      .filter((e) => Number.isFinite(e[2]));
    const leg = Object.fromEntries(currencies.map((c) => [c, Number(rowFor(byCurrency[c])[col])]));

    const gap = equations.reduce((s, [b, q, v]) => s + Math.abs(leg[b] - leg[q] - v), 0);
    const flipped = equations.reduce((s, [b, q, v]) => s + Math.abs(-(leg[b] - leg[q]) - v), 0);

    const verdict =
      gap === 0 ? 'consistent'
      : flipped === 0 ? 'EXACT NEGATION - A1 contradicts A1 on polarity'
      : `INCONSISTENT - absolute gap ${gap} across ${equations.length} cells`;
    console.log(`  ${pad(col, 13)} ${verdict}`);
  }

  console.log();
  console.log('  Trend, Seasonality, COT and Crowd are excluded on purpose: those are measured');
  console.log('  per instrument, not differenced from currency legs, on their board and on ours.');
  console.log();
  console.log('  A column marked inconsistent is NOT a parity target. Ledger it A1_INCONSISTENCY.');
}

indexRowsVsHeatmaps();
pairRowsVsPublishedLegs();
