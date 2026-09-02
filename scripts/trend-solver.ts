/**
 * WHAT IS A1'S TREND RULE? Solved against evidence, not guessed.
 *
 * Trend is the largest single disagreement on the board and one of only two
 * columns applied to every symbol, so a wrong rule here is worth more than the
 * whole macro engine. `npm run leg-parity` puts it at -9 of a -10 gap across the
 * currency legs, with three currencies reading -1 where A1 reads +2.
 *
 * WHAT WAS RULED OUT FIRST, so nobody re-runs it. The obvious suspect was data:
 * Yahoo's `=X` spot series stamps Friday's close on the following SUNDAY and
 * was missing Monday 31 August entirely, verified against 6E=F euro futures
 * (Fri 08-28 1.15875 against "Sun" 08-30 1.15890). Dropping those bars flips
 * EURUSD from -1 to +2 and appears to fix it. It does not: on the correctly
 * dated futures series, cut at A1's own capture date, the current rule still
 * says -1 against their +2. The +2 was an artifact of a corrupted series, not a
 * fix. And the currency INDEX rows never touch `=X` at all — every one of them
 * is priced from futures (`6E=F`, `6B=F`, ...), so the leg-level trend gap has
 * no data component whatsoever. The rule is what is wrong.
 *
 * THE FITTING SET. `fixtures/a1-top-setups-2026-08-31.csv` carries 54 rows, all
 * captured on one day, each with A1's own trend cell. That is a real fitting
 * set spanning FX, metals, equity indices, energy and crypto — not the handful
 * of screenshots earlier rounds had to reason from.
 *
 * THE BAR FOR ADOPTING ANYTHING. `lib/scoring/eco-strength.ts` was adopted
 * because it reproduced 32 of 32 published sub-scores with no residual. This
 * script exists to see whether any trend rule clears a comparable bar. A rule
 * that merely beats the incumbent by a few cells is a better-fitting guess, not
 * a decoded rule, and MUST NOT be shipped as one: with a grid this size
 * something will always come top by chance. If nothing separates convincingly,
 * the honest output is "unresolved" and TREND_SMA stays as it is.
 *
 * A1's own scorecard labels the column `4H/Daily Chart Trend`, so the 4H
 * candidates below are the ones with published support. The rest are here to
 * give that claim something to beat.
 *
 * SCORED ON TWO AXES, because a level fit alone picked the wrong winner once
 * already. `npm run delta-parity` found that between 2026-08-31 and 09-01 A1
 * moved ZERO trend cells while we moved eleven, one of them by three points.
 * A rule can reproduce their board on a given day and still be far twitchier
 * than theirs, and a twitchier rule diverges every day after the one it was
 * fitted on — which is the failure the user actually feels.
 *
 * So each candidate is scored at BOTH captures and on CHURN: how many of its
 * cells changed across the interval, against A1's zero. A candidate at 41/51
 * that moves two cells may be strictly better than one at 43/51 that moves
 * eleven, and only a two-axis table can show that.
 *
 *   npm run trend-solver
 */

import fs from 'node:fs';
import path from 'node:path';

import { ALL_SYMBOLS } from '@/config/symbols.config';
import { NAME_MAP, NOT_MODELED } from '@/lib/scoring/a1-symbol-map';
import {
  FOUR_HOURS,
  fetchDailyBars,
  fetchHourlyBars,
  resampleBars,
  seriesAsOf,
  type DailyBars,
} from '@/lib/connectors/technicals';

/**
 * Two captures, so churn can be measured. The later is cut at 09:44 UTC, the
 * timestamp on their page, rather than at midnight - cutting it at end of day
 * would give our rule half a session A1 had not seen and manufacture churn.
 */
/**
 * THREE CAPTURES, and the third is the one that matters most.
 *
 * The first two are a day apart. The third is FIVE HOURS after the second, and
 * A1's trend column moved on 14 of 54 symbols across that gap with no macro cell
 * moving at all. A rule fitted on two daily snapshots can look stable purely
 * because a day is long enough for everything to move together; an intraday pair
 * separates a rule that tracks the price series from one that tracks the clock.
 */
const CAPTURES = [
  { file: 'a1-top-setups-2026-08-31.csv', at: new Date('2026-08-31T23:59:59.000Z') },
  { file: 'a1-top-setups-2026-09-01.csv', at: new Date('2026-09-01T09:44:00.000Z') },
  { file: 'a1-top-setups-2026-09-01-1433.csv', at: new Date('2026-09-01T14:33:00.000Z') },
] as const;

const pad = (s: unknown, n: number) => String(s ?? '').padEnd(n);
const padS = (s: unknown, n: number) => String(s ?? '').padStart(n);
const signed = (n: number | null) => (n === null ? '.' : n > 0 ? `+${n}` : String(n));

const sma = (xs: number[], n: number): number | null =>
  xs.length < n ? null : xs.slice(-n).reduce((a, b) => a + b, 0) / n;

function ema(xs: number[], n: number): number | null {
  if (xs.length < n) return null;
  const k = 2 / (n + 1);
  let v = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (const x of xs.slice(n)) v = x * k + v * (1 - k);
  return v;
}

/** A candidate reads closes (daily) and optionally 4h closes, and returns a cell. */
interface Candidate {
  name: string;
  published: boolean;
  score: (daily: number[], fourH: number[]) => number | null;
}

/**
 * The incumbent, reproduced exactly as lib/scoring/technical.ts computes it:
 * a fast/slow crossover worth +/-2, docked one point when the slow average's
 * slope disagrees with it.
 */
function crossover(xs: number[], fast: number, slow: number): number | null {
  const f = sma(xs, fast);
  const s = sma(xs, slow);
  const sPrior = sma(xs.slice(0, -1), slow);
  if (f === null || s === null || sPrior === null) return null;
  const cross = f > s ? 2 : -2;
  const slope = s > sPrior ? 1 : -1;
  return Math.sign(cross) !== Math.sign(slope) ? cross - Math.sign(cross) : cross;
}

/** Direction only, +1/-1, from a fast/slow average pair. */
const dir = (xs: number[], fast: number, slow: number): number | null => {
  const f = sma(xs, fast);
  const s = sma(xs, slow);
  return f === null || s === null ? null : f > s ? 1 : -1;
};

const CANDIDATES: Candidate[] = [];

/** Incumbent and a grid around it, to show whether 3/14 is a special point. */
for (const [f, s] of [[3, 14], [5, 20], [8, 21], [9, 21], [10, 20], [20, 50], [50, 200]] as const) {
  CANDIDATES.push({
    name: `SMA ${f}/${s} crossover, docked on slope`,
    published: false,
    score: (d) => crossover(d, f, s),
  });
}

/**
 * A1's published label: `4H/Daily Chart Trend`. Two timeframes voting is the
 * natural reading of that, and it is the only shape here with their words
 * behind it. Both agreeing gives the full +/-2; a split gives +/-1 on the
 * daily, which is the slower and therefore the tie-breaking timeframe.
 */
for (const [f, s] of [[3, 14], [8, 21], [10, 20], [20, 50], [50, 200]] as const) {
  CANDIDATES.push({
    name: `4H+Daily agreement, SMA ${f}/${s}`,
    published: true,
    score: (d, h) => {
      const dd = dir(d, f, s);
      const hh = dir(h, f, s);
      if (dd === null) return null;
      if (hh === null) return dd;
      return dd === hh ? dd * 2 : dd;
    },
  });
}

/** Price against a single average, the simplest thing a chart shows. */
for (const n of [20, 50, 200] as const) {
  CANDIDATES.push({
    name: `close vs SMA${n}, +/-2 on distance`,
    published: false,
    score: (d) => {
      const s = sma(d, n);
      if (s === null) return null;
      const gap = (d[d.length - 1] - s) / s;
      const sign = gap > 0 ? 1 : -1;
      return Math.abs(gap) > 0.01 ? sign * 2 : sign;
    },
  });
}

for (const [f, s] of [[12, 26], [8, 21], [9, 21], [20, 50]] as const) {
  CANDIDATES.push({
    name: `EMA ${f}/${s} crossover, docked on slope`,
    published: false,
    score: (d) => {
      const ef = ema(d, f);
      const es = ema(d, s);
      const esPrior = ema(d.slice(0, -1), s);
      if (ef === null || es === null || esPrior === null) return null;
      const cross = ef > es ? 2 : -2;
      const slope = es > esPrior ? 1 : -1;
      return Math.sign(cross) !== Math.sign(slope) ? cross - Math.sign(cross) : cross;
    },
  });
}

/**
 * CONFLICT RESOLUTION, which is where the incumbent actually loses.
 *
 * The 3/14 grid point wins comfortably, so the shape of the rule is right. But
 * every currency it misses is the same case: the fast average is BELOW the slow
 * one while the slow one is RISING. We resolve that toward the crossover and
 * print -1; A1 prints +2 on EURO, GB-POUND and CH-FRANC, which is what
 * resolving toward the SLOPE would give. These candidates vary only that
 * decision, holding 3/14 fixed.
 */
function conflicted(xs: number[], fast: number, slow: number, lookback: number) {
  const f = sma(xs, fast);
  const s = sma(xs, slow);
  const sPrior = sma(xs.slice(0, -lookback), slow);
  if (f === null || s === null || sPrior === null) return null;
  return { cross: f > s ? 2 : -2, slope: s > sPrior ? 1 : -1 };
}

for (const lookback of [1, 5] as const) {
  const via = (name: string, resolve: (cross: number, slope: number) => number) =>
    CANDIDATES.push({
      name: `${name}${lookback === 1 ? '' : `, slope over ${lookback}d`}`,
      published: false,
      score: (d) => {
        const c = conflicted(d, 3, 14, lookback);
        if (!c) return null;
        if (Math.sign(c.cross) === Math.sign(c.slope)) return c.cross;
        return resolve(c.cross, c.slope);
      },
    });
  via('SMA 3/14, conflict -> slope x2', (_c, slope) => slope * 2);
  via('SMA 3/14, conflict -> slope x1', (_c, slope) => slope);
  via('SMA 3/14, conflict -> zero', () => 0);
  via('SMA 3/14, conflict -> crossover undocked', (cross) => cross);
}

/**
 * THE QUADRANT-FITTED RULE, and the reason it is not just another guess.
 *
 * Cross-tabulating A1's printed cell against the (crossover, slope) state over
 * 51 symbols x 2 days shows three of the four quadrants already agree with what
 * we ship, at 94%, 90% and 69%. Exactly ONE disagrees: fast below slow while the
 * slow average is still RISING. We resolve that toward the crossover and print
 * -1; A1 prints +2 in two thirds of those cases.
 *
 * Stated forward, the fitted rule is: a rising 14-day average is +2 whatever the
 * fast average is doing, and only a falling one lets the crossover decide - +1
 * if the fast is still above, -2 if it is not.
 *
 * That is one parameter changed, not a new family, and the quadrant it changes
 * carries n=18. It is also the quadrant that produced every one of the
 * incumbent's spurious +2 -> -1 flips across the interval.
 */
CANDIDATES.push({
  name: 'SMA 3/14, rising slow avg is always +2',
  published: false,
  score: (d) => {
    const c = conflicted(d, 3, 14, 1);
    if (!c) return null;
    if (c.slope > 0) return 2;
    return c.cross > 0 ? 1 : -2;
  },
});

type A1Row = Record<string, string>;

function readFixture(file: string): A1Row[] {
  const text = fs.readFileSync(path.join(process.cwd(), 'fixtures', file), 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])) as A1Row);
}

const closesOf = (bars: DailyBars | null, at: Date): number[] =>
  bars ? seriesAsOf(bars, at).closes.filter((c): c is number => c !== null && Number.isFinite(c)) : [];

async function main() {
  const tickerOf = new Map(ALL_SYMBOLS.map((d) => [d.symbol, d.yahoo]));

  /** Per capture: A1's trend cell per symbol, and our closes cut at that moment. */
  type Day = {
    capture: (typeof CAPTURES)[number];
    targets: { symbol: string; ticker: string; trend: number }[];
    series: Map<string, { daily: number[]; fourH: number[] }>;
  };
  const days: Day[] = [];
  for (const capture of CAPTURES) {
    const board = readFixture(capture.file);
    const targets: { symbol: string; ticker: string; trend: number }[] = [];
    for (const row of board) {
      if (NOT_MODELED.has(row.Symbol)) continue;
      const symbol = NAME_MAP[row.Symbol] ?? row.Symbol;
      const ticker = tickerOf.get(symbol);
      if (!ticker) continue;
      targets.push({ symbol, ticker, trend: Number.parseInt(row.Trend, 10) });
    }

    const series = new Map<string, { daily: number[]; fourH: number[] }>();
    for (const t of targets) {
      const [daily, hourly] = await Promise.all([fetchDailyBars(t.ticker), fetchHourlyBars(t.ticker)]);
      const fourH = hourly ? resampleBars(hourly, FOUR_HOURS) : null;
      series.set(t.symbol, {
        daily: closesOf(daily, capture.at),
        fourH: closesOf(fourH, capture.at),
      });
    }
    days.push({ capture, targets, series });
  }

  /** Symbols with enough history on BOTH days, so churn is comparable. */
  const usable = days[0].targets
    .map((t) => t.symbol)
    .filter((sym) => days.every((d) => (d.series.get(sym)?.daily.length ?? 0) >= 60));

  console.log('='.repeat(104));
  console.log(`TREND SOLVER -- ${usable.length} symbols priced on both captures`);
  console.log(CAPTURES.map((c) => c.at.toISOString().slice(0, 16).replace('T', ' ')).join('  ->  '));
  console.log('='.repeat(104));

  /** A1's own churn over the interval, the number every candidate is held to. */
  const a1ByDay = days.map((d) => new Map(d.targets.map((t) => [t.symbol, t.trend])));

  /**
   * Churn summed over CONSECUTIVE captures, not first-against-last. With three
   * frames the two are different numbers, and only the consecutive sum counts a
   * cell that moved and moved back — which is exactly the behaviour a rule that
   * over-reacts to an unfinished daily bar would show.
   */
  const churnBetween = (byFrame: Map<string, number | null>[]) => {
    let n = 0;
    for (let i = 1; i < byFrame.length; i++) {
      for (const sym of usable) if (byFrame[i - 1].get(sym) !== byFrame[i].get(sym)) n++;
    }
    return n;
  };
  const a1Churn = churnBetween(a1ByDay);

  type Row = {
    name: string; published: boolean;
    exact: number[]; absErr: number[]; churn: number; scored: number;
  };
  const results: Row[] = [];

  for (const c of CANDIDATES) {
    const cellsByDay = days.map((d) =>
      new Map(usable.map((sym) => {
        const s = d.series.get(sym)!;
        return [sym, c.score(s.daily, s.fourH)];
      })),
    );

    const exact: number[] = [];
    const absErr: number[] = [];
    let scored = 0;
    days.forEach((d, i) => {
      let e = 0;
      let err = 0;
      let n = 0;
      for (const sym of usable) {
        const got = cellsByDay[i].get(sym);
        if (got === null || got === undefined) continue;
        n++;
        const want = a1ByDay[i].get(sym)!;
        if (got === want) e++;
        err += Math.abs(got - want);
      }
      exact.push(e);
      absErr.push(err);
      scored = Math.max(scored, n);
    });

    const churn = churnBetween(cellsByDay);
    results.push({ name: c.name, published: c.published, exact, absErr, churn, scored });
  }

  const total = (r: Row) => r.exact.reduce((a, b) => a + b, 0);
  const totalErr = (r: Row) => r.absErr.reduce((a, b) => a + b, 0);
  results.sort((a, b) => total(b) - total(a) || a.churn - b.churn);

  console.log(`\nA1 moved ${a1Churn} of ${usable.length} trend cells across the interval.`);
  console.log('CHURN is how many each candidate moved. Closer to A1 is better; it is not a fit score.\n');
  console.log(
    pad('candidate', 42) +
      CAPTURES.map((c) => padS(c.at.toISOString().slice(5, 16).replace('T', ' '), 13)).join('') +
      padS('all', 7) + padS('absErr', 9) + padS('churn', 8) + '  published',
  );
  console.log('-'.repeat(112));
  for (const r of results) {
    console.log(
      pad(r.name, 42) +
        r.exact.map((e) => padS(`${e}/${r.scored}`, 13)).join('') +
        padS(total(r), 7) +
        padS(totalErr(r), 9) +
        padS(`${r.churn}`, 8) +
        (r.published ? '   <- A1 label' : ''),
    );
  }

  /**
   * THE QUADRANT TABLE, and it decides the rule rather than the horse race above.
   *
   * Every candidate in the list is some resolution of the two CONFLICTED states
   * of a 3/14 crossover against the 14-day's own slope. Rather than scoring 28
   * guesses and taking the top one — which is how a rule gets fitted to whichever
   * frames happen to be on disk — this cross-tabulates A1's PRINTED cell against
   * the (crossover, slope) state they were in, pooled over every capture.
   *
   * A quadrant is only decided when one value is a clear majority AND the count
   * is large enough to mean anything. Reading a 4-3 split as a rule is the
   * failure this table exists to prevent, and it is reported as UNDECIDED.
   */
  console.log(`\n${'-'.repeat(112)}`);
  console.log("A1's PRINTED CELL BY (crossover, slope) STATE, pooled over every capture");
  console.log('-'.repeat(112));

  type Bucket = Map<number, number>;
  const quadrants = new Map<string, Bucket>();
  for (const [i, d] of days.entries()) {
    for (const sym of usable) {
      const c = conflicted(d.series.get(sym)!.daily, 3, 14, 1);
      if (!c) continue;
      const want = a1ByDay[i].get(sym);
      if (want === undefined || want === null) continue;
      const key = `cross ${c.cross > 0 ? '+' : '-'}, slope ${c.slope > 0 ? '+' : '-'}`;
      if (!quadrants.has(key)) quadrants.set(key, new Map());
      const b = quadrants.get(key)!;
      b.set(want, (b.get(want) ?? 0) + 1);
    }
  }

  console.log(pad('state', 22) + padS('n', 6) + '   distribution of A1 cells        verdict');
  for (const key of ['cross +, slope +', 'cross -, slope -', 'cross +, slope -', 'cross -, slope +']) {
    const b = quadrants.get(key);
    if (!b) continue;
    const n = [...b.values()].reduce((a, x) => a + x, 0);
    const sorted = [...b.entries()].sort((x, y) => y[1] - x[1]);
    const [topValue, topCount] = sorted[0];
    const share = topCount / n;
    const dist = sorted.map(([v, c]) => `${v > 0 ? '+' : ''}${v}:${c}`).join('  ');
    const verdict = share >= 0.6 && n >= 20
      ? `${topValue > 0 ? '+' : ''}${topValue} in ${(share * 100).toFixed(0)}%`
      : `UNDECIDED (best ${(share * 100).toFixed(0)}%, n=${n})`;
    console.log(pad(key, 22) + padS(n, 6) + '   ' + pad(dist, 30) + verdict);
  }

  /**
   * The incumbent's churn, symbol by symbol. A rule that flips a whole asset
   * class on one session is a different defect from one that flips a scatter,
   * and only the first is about the rule rather than the data.
   */
  const incumbent = CANDIDATES[0];
  console.log(`\n${'-'.repeat(104)}\nWhere the incumbent (${incumbent.name}) MOVED and A1 did not:\n${'-'.repeat(104)}`);
  for (const sym of usable) {
    const a = incumbent.score(days[0].series.get(sym)!.daily, days[0].series.get(sym)!.fourH);
    const b = incumbent.score(days[1].series.get(sym)!.daily, days[1].series.get(sym)!.fourH);
    if (a === b) continue;
    const t0 = a1ByDay[0].get(sym)!;
    const t1 = a1ByDay[1].get(sym)!;
    console.log(
      `  ${pad(sym, 10)}ours ${padS(signed(a), 3)} -> ${padS(signed(b), 3)}` +
        `    A1 ${padS(signed(t0), 3)} -> ${padS(signed(t1), 3)}${t0 === t1 ? '   (they held still)' : ''}`,
    );
  }
}

main().catch((err) => {
  console.error('trend-solver failed:', err);
  process.exit(1);
});
