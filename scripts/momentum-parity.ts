/**
 * IS OUR PRICE FEED THEIR PRICE FEED? A checksum, upstream of the trend rule.
 *
 * Trend is the largest clean disagreement on the board (45 of 223 absolute cell
 * error) and every round so far has attacked it as a RULE problem: fit a
 * crossover, fit a slope, fit a quadrant. That search has now been shown to be
 * capped — pooling the paired board-and-heatmap captures gives 78 observations
 * of which 87% sit in an SMA state that maps to more than one printed Trend
 * value, so NO rule reading only their four published daily SMAs can exceed
 * 75.6%. More rule candidates cannot close it.
 *
 * What has never been tested is the layer below: whether the price series we
 * average is the price series they average. A crossover of two short averages
 * is extremely sensitive to its input — a feed a few hours stale, or stamped on
 * a different day, moves the 3-day average enough to flip the cell while every
 * line of the rule stays correct. That failure mode is invisible to a rule fit,
 * because a rule fit only ever sees the output.
 *
 * A1's Momentum Heatmap publishes, per asset, both a NUMBER and four STATES
 * computed from their own series:
 *
 *   Avg 1D Move (7D)   a decimal to two places
 *   20/50/100/200 SMA  Bullish / Bearish / Neutral
 *
 * The number is what makes this worth doing. A categorical fit over 54 assets
 * can be reached by luck; matching a two-decimal statistic on 50+ assets cannot.
 * Either our series is theirs and the number falls out, or it is not and the
 * residual says how it differs — early, late, differently dated, or a different
 * instrument altogether.
 *
 * SO THE VARIANT SWEEP BELOW IS NOT A FIT. It is a search for the DEFINITION of
 * a published statistic, scored on an exact numeric match. A definition that
 * lands 50/51 to two decimal places is decoded; one that lands 12/51 is wrong,
 * and no amount of it coming top of the table makes it right. Anything short of
 * a near-total match is reported as UNRESOLVED and licenses no change to
 * scoreTrend.
 *
 *   npm run momentum-parity
 */

import fs from 'node:fs';
import path from 'node:path';

import { ALL_SYMBOLS } from '@/config/symbols.config';
import { NAME_MAP, NOT_MODELED } from '@/lib/scoring/a1-symbol-map';
import { fetchDailyBars, type DailyBars } from '@/lib/connectors/technicals';

/**
 * The heatmap captures, each with the UTC moment A1's own refresh stamp names.
 *
 * The 09-01 file is the first sorted PAGE only (24 rows) — Looker virtualises
 * the table and it was read before that was understood. It is kept because a
 * second day is worth more than the rows it is missing.
 */
const CAPTURES = [
  { file: 'a1-momentum-heatmap-2026-09-01.csv', at: new Date('2026-09-01T14:33:00.000Z') },
  { file: 'a1-momentum-heatmap-2026-09-02-1455.csv', at: new Date('2026-09-02T14:55:00.000Z') },
] as const;

/**
 * THE HEATMAP'S INDEX ROWS ARE NOT INDICES. They are the dollar pair, verbatim.
 *
 * On the 09-02 capture, EURO/GB-POUND/AU-DOLLAR/NZ-DOLLAR/CA-DOLLAR/CH-FRANC/
 * JP-YEN are byte-for-byte identical to EURUSD/GBPUSD/AUDUSD/NZDUSD/USDCAD/
 * USDCHF/USDJPY on all six published fields — volatility, the 7-day average
 * move, and all four SMA states. Seven of seven, no exceptions.
 *
 * Note WHICH pair: for CAD, CHF and JPY it is the DOLLAR-BASE pair, so their
 * heatmap row reads dollar strength, the opposite of the currency the row is
 * named after. The Top Setups board does invert those three (its index-row
 * Trend is the exact negation of the pair's, 15/15 across five captures) — so
 * the two surfaces disagree in sign on three of the eight, and comparing our
 * futures-priced index rows against this surface without the mapping below
 * manufactures four whole-asset sign inversions that are not disagreements.
 *
 * US-DOLLAR has no dollar pair and is left alone.
 */
const HEATMAP_INDEX_ROW_IS_PAIR: Record<string, string> = {
  EURO: 'EURUSD', 'GB-POUND': 'GBPUSD', 'AU-DOLLAR': 'AUDUSD', 'NZ-DOLLAR': 'NZDUSD',
  'CA-DOLLAR': 'USDCAD', 'CH-FRANC': 'USDCHF', 'JP-YEN': 'USDJPY',
};

interface Row {
  asset: string;
  volatility: string;
  avg1dMove7d: number;
  sma: Record<number, string>;
}

function readCapture(file: string): Row[] {
  const text = fs.readFileSync(path.join(process.cwd(), 'fixtures', file), 'utf8');
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((line) => {
    const cell = Object.fromEntries(line.split(',').map((v, i) => [cols[i], v]));
    return {
      asset: cell.asset,
      volatility: cell.volatility,
      avg1dMove7d: Number.parseFloat(cell.avg1dMove7d),
      sma: { 20: cell.sma20, 50: cell.sma50, 100: cell.sma100, 200: cell.sma200 },
    };
  });
}

const pad = (s: unknown, n: number) => String(s ?? '').padEnd(n);
const padS = (s: unknown, n: number) => String(s ?? '').padStart(n);

const sma = (xs: number[], n: number): number | null =>
  xs.length < n ? null : xs.slice(-n).reduce((a, b) => a + b, 0) / n;

/**
 * Candidate readings of "Avg 1D Move (7D)". Each takes the cut series and
 * returns a number to compare against their two decimal places.
 *
 * `bars` is how many daily observations the average covers; `skipLast` drops
 * today's unfinished bar, which is a real possibility for a figure computed
 * from a spreadsheet refreshed on a schedule rather than at the close.
 */
interface MoveDef {
  name: string;
  value: (b: DailyBars) => number | null;
}

function windowed(b: DailyBars, bars: number, skipLast: boolean) {
  const end = b.closes.length - (skipLast ? 1 : 0);
  if (end < bars + 1) return null;
  return { start: end - bars, end };
}

const MOVE_DEFS: MoveDef[] = [];
for (const bars of [5, 6, 7, 8] as const) {
  for (const skipLast of [false, true] as const) {
    const tag = `${bars}d${skipLast ? ', excl. today' : ''}`;
    MOVE_DEFS.push({
      name: `mean |close-to-close| % (${tag})`,
      value: (b) => {
        const w = windowed(b, bars, skipLast);
        if (!w) return null;
        let sum = 0;
        for (let i = w.start; i < w.end; i++) {
          sum += Math.abs(b.closes[i] / b.closes[i - 1] - 1) * 100;
        }
        return sum / bars;
      },
    });
    MOVE_DEFS.push({
      name: `mean (high-low)/close % (${tag})`,
      value: (b) => {
        const w = windowed(b, bars, skipLast);
        if (!w) return null;
        let sum = 0;
        for (let i = w.start; i < w.end; i++) {
          sum += ((b.highs[i] - b.lows[i]) / b.closes[i]) * 100;
        }
        return sum / bars;
      },
    });
    MOVE_DEFS.push({
      name: `mean |close-open|/open % (${tag})`,
      value: (b) => {
        const w = windowed(b, bars, skipLast);
        if (!w) return null;
        let sum = 0;
        for (let i = w.start; i < w.end; i++) {
          sum += (Math.abs(b.closes[i] - b.opens[i]) / b.opens[i]) * 100;
        }
        return sum / bars;
      },
    });
  }
}

/** Two decimal places is what they print, so that is the tolerance. */
const HITS = (ours: number, theirs: number) => Math.abs(ours - theirs) < 0.005;

async function main() {
  const tickerOf = new Map(ALL_SYMBOLS.map((d) => [d.symbol, d.yahoo]));

  type Obs = { capture: string; asset: string; symbol: string; row: Row; bars: DailyBars };
  const obs: Obs[] = [];
  const unmapped: string[] = [];

  for (const capture of CAPTURES) {
    for (const row of readCapture(capture.file)) {
      if (NOT_MODELED.has(row.asset)) continue;
      const symbol = HEATMAP_INDEX_ROW_IS_PAIR[row.asset] ?? NAME_MAP[row.asset] ?? row.asset;
      const ticker = tickerOf.get(symbol);
      if (!ticker) {
        unmapped.push(`${capture.file}: ${row.asset}`);
        continue;
      }
      /**
       * The cutoff goes INTO the fetch. Cutting afterwards would leave prices
       * from after the capture inside the rebuilt trailing session — see
       * `spliceFxSessions`.
       */
      const daily = await fetchDailyBars(ticker, capture.at);
      if (!daily) continue;
      obs.push({ capture: capture.file, asset: row.asset, symbol, row, bars: daily });
    }
  }

  console.log('='.repeat(100));
  console.log(`MOMENTUM PARITY — ${obs.length} asset-captures against the published heatmap`);
  console.log('='.repeat(100));
  if (unmapped.length) console.log(`\ncould not map: ${unmapped.join(', ')}`);

  console.log('\nAVG 1D MOVE (7D) — exact matches to two decimal places');
  console.log(pad('definition', 42) + padS('exact', 8) + padS('within .02', 12) + padS('median err', 12));
  console.log('-'.repeat(76));
  const scored = MOVE_DEFS.map((def) => {
    let exact = 0;
    let near = 0;
    const errs: number[] = [];
    for (const o of obs) {
      const ours = def.value(o.bars);
      if (ours === null || !Number.isFinite(o.row.avg1dMove7d)) continue;
      const err = Math.abs(ours - o.row.avg1dMove7d);
      errs.push(err);
      if (HITS(ours, o.row.avg1dMove7d)) exact++;
      if (err < 0.02) near++;
    }
    errs.sort((a, b) => a - b);
    return { def, exact, near, median: errs.length ? errs[Math.floor(errs.length / 2)] : NaN, n: errs.length };
  }).sort((a, b) => b.exact - a.exact || a.median - b.median);

  for (const s of scored) {
    console.log(
      pad(s.def.name, 42) + padS(`${s.exact}/${s.n}`, 8) + padS(`${s.near}/${s.n}`, 12) + padS(s.median.toFixed(3), 12),
    );
  }

  const best = scored[0];
  console.log(`\nBest definition: ${best.def.name}`);
  console.log(pad('asset', 12) + padS('A1', 8) + padS('ours', 10) + padS('err', 10) + '  ratio');
  console.log('-'.repeat(52));
  for (const o of obs) {
    if (o.capture !== CAPTURES[CAPTURES.length - 1].file) continue;
    const ours = best.def.value(o.bars);
    if (ours === null) continue;
    const err = ours - o.row.avg1dMove7d;
    console.log(
      pad(o.asset, 12) + padS(o.row.avg1dMove7d.toFixed(2), 8) + padS(ours.toFixed(3), 10) +
        padS(err.toFixed(3), 10) + '  ' + (o.row.avg1dMove7d ? (ours / o.row.avg1dMove7d).toFixed(2) : '-'),
    );
  }

  /**
   * THE SMA STATES, which are the same question asked categorically.
   *
   * Bullish/Bearish is presumably price against the average. `Neutral` appears
   * on a handful of cells and is the interesting one: either a band around the
   * average, or a gap in their data. Both are reported rather than assumed.
   */
  console.log(`\n${'-'.repeat(100)}`);
  console.log('SMA STATES — price against their published 20/50/100/200 day averages');
  console.log('-'.repeat(100));
  let agree = 0;
  let total = 0;
  let neutrals = 0;
  const misses: string[] = [];
  for (const o of obs) {
    const closes = o.bars.closes.filter((c): c is number => c !== null && Number.isFinite(c));
    const price = closes[closes.length - 1];
    for (const n of [20, 50, 100, 200] as const) {
      const theirs = o.row.sma[n];
      const avg = sma(closes, n);
      if (avg === null || !theirs) continue;
      const distance = ((price / avg - 1) * 100).toFixed(3);
      if (theirs === 'Neutral') {
        neutrals++;
        misses.push(`  NEUTRAL ${pad(o.asset, 11)} SMA${padS(n, 3)}  ours ${distance}% from the average`);
        continue;
      }
      total++;
      const ours = price > avg ? 'Bullish' : 'Bearish';
      if (ours === theirs) agree++;
      else misses.push(`  MISS    ${pad(o.asset, 11)} SMA${padS(n, 3)}  A1 ${pad(theirs, 8)} ours ${pad(ours, 8)} (${distance}% from the average)`);
    }
  }
  console.log(`price vs average agrees on ${agree}/${total} non-neutral cells; ${neutrals} neutral cells set aside\n`);
  for (const m of misses) console.log(m);
}

main().catch((err) => {
  console.error('momentum-parity failed:', err);
  process.exit(1);
});
