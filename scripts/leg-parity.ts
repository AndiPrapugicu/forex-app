/**
 * PARITY MEASURED ON LEGS, NOT ON PAIRS.
 *
 * Every other parity script in this repo compares our rows against A1's PAIR
 * rows. That surface is broken. `npm run a1-surfaces` shows A1's pair rows
 * contradicting A1's own published arithmetic on four columns — PPI is an exact
 * global sign flip, and mPMI, Cnsmr Conf and PCE diverge irregularly — while
 * their index rows agree with their country heatmaps on 104 of 104 cells.
 *
 * So the pair rows are not a parity target in either direction: matching one
 * side of somebody's internal contradiction is a coin flip. The index rows are.
 *
 * WHY THIS IS A DIFFERENT MEASUREMENT, not a nicer report of the same one:
 *
 *   1. NO DIFFERENCING, SO NO CANCELLATION. A pair cell is `base - quote`, and
 *      two compensating leg errors produce a correct-looking pair. CADX and
 *      AUDX both matched A1's total exactly on 2026-09-01 while carrying two
 *      and three wrong cells. A total is blind to that; a leg is not.
 *   2. EIGHT ROWS INSTEAD OF TWENTY-EIGHT. Fourteen macro legs per currency is
 *      the entire model — every pair on the board is arithmetic over them. 112
 *      cells is the whole truth, and the other 500 are restatements of it.
 *   3. ATTRIBUTION. A signed gap split into TECHNICAL / SENTIMENT / RATES /
 *      MACRO answers "which subsystem", which is the question a fix starts
 *      from. The first run said -18 of -20 was technicals, and the macro engine
 *      — the thing twenty rounds went into — was already at parity.
 *
 * REWOUND ON PURPOSE. Technicals are the columns that move overnight, so
 * comparing our live board against a capture from a previous day measures the
 * calendar rather than the model. Prices are cut at the capture with
 * `pricesAsOf` and events with `asOf`, the same pattern as
 * scripts/top-setups-parity.ts. Seasonality is why this is not optional: A1
 * captured on 31 August and read the AUGUST bucket, so an un-rewound run
 * reports three currencies as defects for turning the month.
 *
 * WHAT THIS SCRIPT IS NOT. Agreement here is evidence we match A1, not evidence
 * either of us is right. A1 is a Tier 4 observation. A cell sourced to a
 * national statistics office beats a cell that agrees with this report.
 *
 *   npm run leg-parity
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  HEATMAP_ROW_TO_COLUMN,
  INDEX_ROW_COUNTRY,
  NAME_MAP,
} from '@/lib/scoring/a1-symbol-map';
import { asOf } from '@/lib/scoring/backtest';
import { buildSetupsMatrix, type SymbolRow } from '@/lib/scoring/setups';
import { runSetupsPipeline } from '@/lib/setups-pipeline';

/**
 * A REWIND CAN ONLY REMOVE EVENTS, NEVER RESTORE ONE THE FEED HAS DROPPED.
 *
 * This measurement degrades as the day goes on, and silently. `asOf` trims the
 * calendar to the capture moment, but the calendar it trims is whatever the feed
 * returns NOW - a rolling window. Measured 2026-09-01: at 09:49 UTC the EUR mPMI
 * slot resolved to the 21 August flash print and scored; at 13:14 the feed had
 * moved on to the 1 September final, the flash was no longer in the window, and
 * trimming back to 31 August left the slot with nothing at all.
 *
 * The visible effect is a slot that reads "not scored" in a rewound run while
 * the live board scores it fine, and - worse for delta-parity - an OLDER board
 * that is thinner than the newer one, which manufactures deltas out of nothing.
 * Between those two runs the spurious count went from 44 to 61 with no code
 * change.
 *
 * So: run these close to the capture, and read the coverage line below before
 * trusting any number here. A drop in resolved slots is the tell.
 */
/** The capture this fixture was taken from. Both sides are measured here. */
const FIXTURE = 'a1-top-setups-2026-08-31.csv';
const CAPTURED_AT = new Date('2026-08-31T23:59:59.000Z');

/**
 * A1's column headers -> our slot keys.
 *
 * `NFP` is their label for the employment slot and applies to every economy —
 * only the US series is actually called non-farm payrolls.
 */
const COLUMN: Record<string, string> = {
  Trend: 'trend', Seasonality: 'seasonality', COT: 'cot', Crowd: 'crowd',
  GDP: 'gdp', mPMI: 'mpmi', sPMI: 'spmi', RetailSales: 'retail-sales',
  CnsmrConf: 'consumer-confidence', CPI: 'cpi', PPI: 'ppi', PCE: 'pce',
  Rates: 'rates', NFP: 'employment', UnempRate: 'unemployment',
  UnempClaims: 'claims', ADP: 'adp', JOLTS: 'jolts',
};

type Group = 'TECHNICAL' | 'SENTIMENT' | 'RATES' | 'MACRO';
const GROUP: Record<string, Group> = {
  Trend: 'TECHNICAL', Seasonality: 'TECHNICAL',
  COT: 'SENTIMENT', Crowd: 'SENTIMENT',
  Rates: 'RATES',
};
const groupOf = (col: string): Group => GROUP[col] ?? 'MACRO';

/** A1's eight single-currency rows, in the order their board lists them. */
const INDEX_ROWS = [
  'US-DOLLAR', 'EURO', 'GB-POUND', 'JP-YEN',
  'AU-DOLLAR', 'NZ-DOLLAR', 'CA-DOLLAR', 'CH-FRANC',
];

/**
 * Divergences we have already explained and decided not to close. Counting
 * these as error would make the headline number a measure of our documented
 * decisions rather than of our unexplained ones.
 *
 * THE BIG ONE IS DERIVED, NOT LISTED. A1's country heatmaps publish exactly
 * which series each economy has, and their board prints 0 in every column an
 * economy does NOT publish. That 0 is "no such row", not a scored neutral, and
 * it is arithmetically identical to the blank we render. Reading it off the
 * heatmap fixture rather than hardcoding a column list means a new capture
 * updates the exemption automatically — and, more importantly, means a genuine
 * new defect in a column A1 DOES publish can never be absorbed by it.
 *
 * It generalises past the case that motivated it. Consumer confidence was the
 * known one; the same convention silently explains AU Retail Sales, which A1
 * has no row for at all.
 */
const EXPECTED: { when: (col: string, ours: number | null, theirs: number, country: string) => boolean; why: string }[] = [
  {
    when: (col, ours, theirs, country) =>
      /**
       * MACRO COLUMNS ONLY. Trend, Seasonality, COT and Crowd have no heatmap
       * row by construction, so without this guard every one of them would be
       * exempted the moment A1 printed a 0 — which silently swallowed a real
       * EURX Crowd disagreement the first time this ran.
       */
      groupOf(col) === 'MACRO' &&
      theirs === 0 &&
      ours !== null &&
      !PUBLISHES.get(country)?.has(col),
    why: 'A1 publishes no such series for that economy — their own heatmap has no row for it, so the 0 on their board is "no data", not a scored neutral. We carry the series. Ledger a1:no-consumer-confidence-series.',
  },
  {
    when: (col, ours, theirs) => col === 'Rates' && ours === 0 && theirs !== 0,
    why:
      'A1 scores rates as policy-vs-projection. IMPLEMENTED 2026-09-01, and it reproduces all ' +
      'eight of their published legs - but only from the 2026-09-01 projections reading, the ' +
      'first that covers every major. This fixture is the 2026-08-31 board, and the newest ' +
      'snapshot on or before that date covers five, so the all-or-nothing gate in ' +
      'resolveConsensusProjectionLegs correctly gives this board nothing rather than mixing two ' +
      'rules inside one differenced column. Exempt because it is a snapshot-coverage limit and ' +
      'not a scoring one: npm run board-parity measures the rule where the data exists and ' +
      'reports Rates exact on 51 of 51 rows.',
  },
];

/**
 * country code -> the set of columns A1's heatmap actually publishes for it.
 * Built from the heatmap capture taken the same day as the board.
 */
const PUBLISHES = (() => {
  const text = fs.readFileSync(
    path.join(process.cwd(), 'fixtures', 'a1-economic-heatmaps-2026-08-31.csv'),
    'utf8',
  );
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const out = new Map<string, Set<string>>();
  for (const line of lines.slice(1)) {
    const row = Object.fromEntries(line.split(',').map((v, i) => [head[i], v])) as Record<string, string>;
    const col = HEATMAP_ROW_TO_COLUMN[Number.parseInt(row.row, 10)];
    if (!col) continue;
    if (!out.has(row.country)) out.set(row.country, new Set());
    out.get(row.country)!.add(col);
  }
  return out;
})();

const expectedFor = (col: string, ours: number | null, theirs: number, country: string) =>
  EXPECTED.find((e) => e.when(col, ours, theirs, country));

// ---------------------------------------------------------------------------

const pad = (s: unknown, n: number) => String(s ?? '').padEnd(n);
const padS = (s: unknown, n: number) => String(s ?? '').padStart(n);
const signed = (n: number | null | undefined) =>
  n === null || n === undefined ? '.' : n > 0 ? `+${n}` : String(n);

type A1Row = Record<string, string>;

function readFixture(): A1Row[] {
  const text = fs.readFileSync(path.join(process.cwd(), 'fixtures', FIXTURE), 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])) as A1Row);
}

async function main() {
  const board = readFixture();
  const a1 = (name: string) => board.find((r) => r.Symbol === name);

  /**
   * `pricesAsOf`, not `now`. Rewinding `now` narrows the calendar fetch and
   * loses scheduled events the frame could see; the price series is the part
   * that has to be cut. See the header of scripts/top-setups-parity.ts.
   */
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
    yield2y: payload.yield2y,
    retailPositioning: payload.retailPositioning,
    now: CAPTURED_AT,
  });
  const ours = (symbol: string) => matrix.rows.find((r) => r.symbol === symbol);

  console.log('='.repeat(104));
  console.log(`LEG PARITY -- our currency-index rows against A1's, ${FIXTURE}`);
  console.log(`both sides measured at ${CAPTURED_AT.toISOString().slice(0, 10)}`);
  console.log('='.repeat(104));

  const columns = Object.keys(COLUMN);
  type Tally = { agree: number; diff: number; expected: number; oursNull: number };
  const tally = (): Tally => ({ agree: 0, diff: 0, expected: 0, oursNull: 0 });
  const byColumn = new Map<string, Tally>(columns.map((c) => [c, tally()]));
  const totals = tally();

  const attribution: Record<Group, number> = { TECHNICAL: 0, SENTIMENT: 0, RATES: 0, MACRO: 0 };
  const perRow: { symbol: string; ours: number; theirs: number; gap: number; groups: Record<Group, number> }[] = [];
  const unexplained: string[] = [];
  const expectedSeen = new Map<string, number>();

  for (const name of INDEX_ROWS) {
    const their = a1(name);
    const symbol = NAME_MAP[name];
    const row = symbol ? ours(symbol) : undefined;
    if (!their) {
      console.log(`\n${name}: not in the fixture`);
      continue;
    }
    if (!row) {
      console.log(`\n${name}: no mapping to a row on our board (NAME_MAP)`);
      continue;
    }

    const groups: Record<Group, number> = { TECHNICAL: 0, SENTIMENT: 0, RATES: 0, MACRO: 0 };
    const notes: string[] = [];

    for (const col of columns) {
      const cell = row.cells[COLUMN[col]]?.cell ?? null;
      const theirs = Number.parseInt(their[col], 10);
      const t = byColumn.get(col)!;

      /**
       * A null of ours contributes 0 to our total exactly as their 0 does, so
       * the two agree arithmetically wherever they print 0. Calling that a miss
       * measures a rendering convention: we leave a column blank where the
       * economy has no such series and they print 0.
       */
      if (cell === null && theirs === 0) {
        t.agree++;
        totals.agree++;
        continue;
      }

      groups[groupOf(col)] += (cell ?? 0) - theirs;

      if (cell === theirs) {
        t.agree++;
        totals.agree++;
        continue;
      }

      const exempt = expectedFor(col, cell, theirs, INDEX_ROW_COUNTRY[name]);
      if (exempt) {
        t.expected++;
        totals.expected++;
        expectedSeen.set(exempt.why, (expectedSeen.get(exempt.why) ?? 0) + 1);
        notes.push(`${col} ${signed(cell)}/${signed(theirs)} (expected)`);
        continue;
      }

      if (cell === null) {
        t.oursNull++;
        totals.oursNull++;
        notes.push(`${col} ./${signed(theirs)} NOT SCORED`);
      } else {
        t.diff++;
        totals.diff++;
        notes.push(`${col} ${signed(cell)}/${signed(theirs)}`);
      }
      unexplained.push(`${pad(symbol, 6)}${pad(col, 14)}ours ${padS(signed(cell), 4)}   A1 ${padS(signed(theirs), 4)}`);
    }

    const theirTotal = Number.parseInt(their.Score, 10);
    const gap = row.totalScore - theirTotal;
    for (const g of Object.keys(attribution) as Group[]) attribution[g] += groups[g];
    perRow.push({ symbol, ours: row.totalScore, theirs: theirTotal, gap, groups });

    console.log(
      `\n${pad(`${name} -> ${symbol}`, 24)}ours ${padS(signed(row.totalScore), 4)}` +
        `   A1 ${padS(signed(theirTotal), 4)}   gap ${padS(signed(gap), 4)}`,
    );
    console.log(`  ${notes.length === 0 ? 'every column AGREES' : notes.join('   ')}`);
  }

  // --- Attribution ---------------------------------------------------------
  console.log(`\n${'='.repeat(104)}`);
  console.log('SIGNED GAP BY SUBSYSTEM  (ours - A1; the question a fix starts from)');
  console.log('='.repeat(104));
  console.log(
    `${pad('symbol', 8)}${padS('ours', 6)}${padS('A1', 6)}${padS('gap', 6)}  |` +
      `${padS('TECHNICAL', 11)}${padS('SENTIMENT', 11)}${padS('RATES', 8)}${padS('MACRO', 8)}`,
  );
  console.log('-'.repeat(104));
  for (const r of perRow) {
    console.log(
      `${pad(r.symbol, 8)}${padS(signed(r.ours), 6)}${padS(signed(r.theirs), 6)}${padS(signed(r.gap), 6)}  |` +
        `${padS(signed(r.groups.TECHNICAL), 11)}${padS(signed(r.groups.SENTIMENT), 11)}` +
        `${padS(signed(r.groups.RATES), 8)}${padS(signed(r.groups.MACRO), 8)}`,
    );
  }
  const totalGap = perRow.reduce((s, r) => s + r.gap, 0);
  console.log('-'.repeat(104));
  console.log(
    `${pad('TOTAL', 8)}${padS('', 6)}${padS('', 6)}${padS(signed(totalGap), 6)}  |` +
      `${padS(signed(attribution.TECHNICAL), 11)}${padS(signed(attribution.SENTIMENT), 11)}` +
      `${padS(signed(attribution.RATES), 8)}${padS(signed(attribution.MACRO), 8)}`,
  );

  // --- Cells ---------------------------------------------------------------
  const scored = totals.agree + totals.diff + totals.expected + totals.oursNull;
  console.log(`\n${'='.repeat(104)}\nCELLS: ${scored} compared\n${'='.repeat(104)}`);
  console.log(`  AGREE       ${padS(totals.agree, 4)}  (${((totals.agree / scored) * 100).toFixed(1)}%)`);
  console.log(`  DIFFERENT   ${padS(totals.diff, 4)}   <- unexplained, this is the number to move`);
  console.log(`  NOT SCORED  ${padS(totals.oursNull, 4)}   they scored, we produced nothing`);
  console.log(`  EXPECTED    ${padS(totals.expected, 4)}   divergences we have decided not to close:`);
  for (const [why, n] of expectedSeen) console.log(`      ${n}x  ${why}`);

  console.log('\nBy column:');
  for (const col of columns) {
    const t = byColumn.get(col)!;
    if (t.diff === 0 && t.oursNull === 0 && t.expected === 0) continue;
    console.log(
      `  ${pad(col, 14)}agree ${padS(t.agree, 2)}   DIFF ${padS(t.diff, 2)}` +
        `   not-scored ${padS(t.oursNull, 2)}   expected ${padS(t.expected, 2)}`,
    );
  }

  if (unexplained.length > 0) {
    console.log('\nEvery unexplained cell, which is the whole work list:');
    for (const u of unexplained) console.log(`  ${u}`);
  }

  identities(matrix, board);
}

/**
 * Two identities that must hold, checked here because a report of the gap is
 * worthless if the board underneath it is not internally coherent.
 */
function identities(matrix: { rows: SymbolRow[] }, board: A1Row[]) {
  const ours = (s: string) => matrix.rows.find((r) => r.symbol === s);
  const MACRO = ['gdp', 'mpmi', 'spmi', 'retail-sales', 'consumer-confidence', 'cpi',
    'ppi', 'pce', 'employment', 'unemployment', 'claims', 'adp', 'jolts'];

  console.log(`\n${'='.repeat(104)}\nIDENTITIES\n${'='.repeat(104)}`);

  /**
   * A1's metals rows carry the negated dollar leg and nothing else — confirmed
   * 14/14 on this capture. Checked against the FIXTURE, not against us: it is
   * what licences reading GOLD as a second, independent publication of the
   * US-DOLLAR row, and it would be the first thing to break if a future capture
   * were transcribed a column out of alignment.
   */
  const usd = board.find((r) => r.Symbol === 'US-DOLLAR')!;
  for (const metal of ['GOLD', 'SILVER']) {
    const m = board.find((r) => r.Symbol === metal);
    if (!m) continue;
    const cols = Object.keys(COLUMN).filter((c) => groupOf(c) === 'MACRO');
    const bad = cols.filter((c) => Number.parseInt(m[c], 10) !== -Number.parseInt(usd[c], 10));
    console.log(
      `  A1 ${pad(metal, 8)} == -US-DOLLAR on ${cols.length - bad.length}/${cols.length} macro legs` +
        (bad.length ? `   BROKEN: ${bad.join(' ')}` : ''),
    );
  }

  /**
   * On our own board, a pair's macro cell must be its base leg minus its quote
   * leg, clamped. This is arithmetic, not parity — a failure here is a bug in
   * us, and it is the check that would have caught a leg being wired to the
   * wrong currency.
   *
   * `rates` IS EXCLUDED, and not as a convenience. DXY scores that column from
   * the US 2-year yield against its 21-day average, inverted (the DXY branch in
   * lib/scoring/setups.ts), which is A1's published rule for that row and is
   * deliberately NOT the USD rate leg a pair differences. So our board is
   * non-additive there by construction. A1's board is non-additive there too:
   * their EURO row reads +1 and their EURUSD row reads +1, which implies a zero
   * dollar leg, while their US-DOLLAR row reads +1.
   */
  const IDX: Record<string, string> = {
    USD: 'DXY', EUR: 'EURX', GBP: 'GBPX', JPY: 'JPYX',
    NZD: 'NZDX', CAD: 'CADX', CHF: 'CHFX', AUD: 'AUDX',
  };
  let checked = 0;
  const broken: string[] = [];
  for (const row of matrix.rows) {
    if (!row.base || !row.quote) continue;
    const b = IDX[row.base] ? ours(IDX[row.base]) : undefined;
    const q = IDX[row.quote] ? ours(IDX[row.quote]) : undefined;
    if (!b || !q) continue;
    for (const key of MACRO) {
      const pair = row.cells[key]?.cell;
      const bc = b.cells[key]?.cell;
      const qc = q.cells[key]?.cell;
      if (pair === null || pair === undefined) continue;
      if (bc === null || bc === undefined || qc === null || qc === undefined) continue;
      checked++;
      const want = Math.max(-2, Math.min(2, bc - qc));
      if (pair !== want) broken.push(`${row.symbol} ${key}: ${pair} vs ${bc}-${qc}=${want}`);
    }
  }
  console.log(
    `  ours   pair == base leg - quote leg on ${checked - broken.length}/${checked} macro cells` +
      (broken.length ? `\n     ${broken.join('\n     ')}` : '   (rates excluded by design, see source)'),
  );
}

main().catch((err) => {
  console.error('leg-parity failed:', err);
  process.exit(1);
});
