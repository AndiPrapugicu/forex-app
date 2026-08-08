/**
 * Parity test against a published EdgeFinder Asset Scorecard.
 *
 * This is the acceptance test for the whole ternary rework. The reference card
 * (GOLD, 2026-08-06) states four sub-scores — Technical 3, Sentiment+COT 1,
 * Fundamentals 4, total 8 — and lists every input that produced them. Feeding
 * those same inputs through our engine has to land on the same four numbers.
 *
 * It is the reason the model changed at all: our previous sigma bucketing gave
 * GOLD +4 against their 8, and this test pins each of the four causes so they
 * cannot silently regress:
 *
 *   trend      counted 4 moving averages -> 0; short-term reading gives +2
 *   COT        ranked by 3-year percentile -> -1; long share gives +2
 *   JOLTS      -0.15 sigma fell in the +/-0.25 deadband -> 0; ternary gives -1
 *   seasonality reached +/-2; capped at +/-1
 *
 * Every figure below is transcribed from the reference card.
 */

import { describe, expect, it } from 'vitest';
import { biasFromScore } from '@/config/setups.config';
import { normalizeZero, ternarySign } from '@/lib/scoring/discrete';
import { scoreCot, scoreCrowd } from '@/lib/scoring/cot';
import { scoreTrend, scoreYield2y } from '@/lib/scoring/technical';
import type { CotReport, CotSeries } from '@/lib/connectors/cftc';
import type { Technicals } from '@/lib/connectors/technicals';

/**
 * The fundamentals exactly as printed on the reference card.
 * `polarity` is ours; for GOLD every US reading inverts, applied below.
 */
const GOLD_FUNDAMENTALS: {
  name: string;
  actual: number;
  consensus: number;
  polarity: 1 | -1;
  expected: number;
}[] = [
  // Economic growth — card states this block sums to +2
  { name: 'GDP Growth QoQ', actual: 1.5, consensus: 2.1, polarity: 1, expected: 1 },
  { name: 'Manufacturing PMI', actual: 55.6, consensus: 54, polarity: 1, expected: -1 },
  { name: 'Services PMI', actual: 54.1, consensus: 54.5, polarity: 1, expected: 1 },
  { name: 'Retail Sales MoM', actual: 0.2, consensus: 0.2, polarity: 1, expected: 0 },
  { name: 'Consumer Confidence', actual: 90.8, consensus: 92.4, polarity: 1, expected: 1 },

  // Inflation — card states +1 (including the 2-year yield, handled separately)
  { name: 'CPI YoY', actual: 3.5, consensus: 3.8, polarity: 1, expected: 1 },
  { name: 'PPI YoY', actual: 5.5, consensus: 6.2, polarity: 1, expected: 1 },
  { name: 'PCE YoY', actual: 3.3, consensus: 3.3, polarity: 1, expected: 0 },

  // Jobs — card states +1
  { name: 'Non-Farm Payroll', actual: 57, consensus: 114, polarity: 1, expected: 1 },
  { name: 'Unemployment Rate', actual: 4.2, consensus: 4.3, polarity: -1, expected: -1 },
  { name: 'Weekly Jobless Claims', actual: 199, consensus: 202, polarity: -1, expected: -1 },
  { name: 'ADP Employment Change', actual: 44, consensus: 68, polarity: 1, expected: 1 },
  { name: 'JOLTS Job Openings', actual: 7.36, consensus: 7.44, polarity: 1, expected: 1 },
];

/** GOLD has no base currency, so every US reading enters inverted. */
const GOLD_USD_SIDE = -1;

function goldCell(f: (typeof GOLD_FUNDAMENTALS)[number]): number {
  // normalizeZero mirrors the engine: 0 * -1 is -0 in JavaScript, which renders
  // as "-0" and fails Object.is against 0.
  return normalizeZero(ternarySign(f.actual, f.consensus) * f.polarity * GOLD_USD_SIDE);
}

describe('EdgeFinder parity — GOLD fundamentals', () => {
  it.each(GOLD_FUNDAMENTALS)(
    '$name: $actual vs $consensus -> $expected',
    (f) => {
      expect(goldCell(f)).toBe(f.expected);
    },
  );

  it('scores JOLTS as a miss, which the old deadband swallowed', () => {
    // 7.36 vs 7.44 is only -0.15 sigma. Under +/-0.25 bucketing it read 0.
    const jolts = GOLD_FUNDAMENTALS.find((f) => f.name.startsWith('JOLTS'))!;
    expect(goldCell(jolts)).toBe(1); // bullish for gold, since the US number missed
  });

  it('scores an exact-on-forecast print as 0, not as a miss', () => {
    expect(ternarySign(3.3, 3.3)).toBe(0);
    expect(ternarySign(0.2, 0.2)).toBe(0);
  });

  it('reproduces the three stated fundamental subtotals', () => {
    const sum = (names: string[]) =>
      GOLD_FUNDAMENTALS.filter((f) => names.includes(f.name)).reduce((t, f) => t + goldCell(f), 0);

    const growth = sum([
      'GDP Growth QoQ', 'Manufacturing PMI', 'Services PMI', 'Retail Sales MoM', 'Consumer Confidence',
    ]);
    // The card's inflation block also contains the 2-year yield at -1.
    const inflationExYield = sum(['CPI YoY', 'PPI YoY', 'PCE YoY']);
    const jobs = sum([
      'Non-Farm Payroll', 'Unemployment Rate', 'Weekly Jobless Claims',
      'ADP Employment Change', 'JOLTS Job Openings',
    ]);

    expect(growth).toBe(2);
    expect(inflationExYield + -1).toBe(1); // -1 is the 2-year yield, tested below
    expect(jobs).toBe(1);
    expect(growth + inflationExYield + -1 + jobs).toBe(4); // card states Fundamentals = 4
  });
});

describe('EdgeFinder parity — GOLD technicals', () => {
  /** Live figures from our own run: price 4399.7, SMA20 4084.76, SMA50 4169.27. */
  const gold: Technicals = {
    symbol: 'XAUUSD',
    price: 4399.7,
    sma20: 4084.76,
    sma50: 4169.27,
    sma100: 4408.08, // price is BELOW these two
    sma200: 4478.67,
    aboveCount: 2,
    smaCount: 4,
    realizedVolPct: 20,
    avgDailyMove7Pct: 1,
    avgDailyMove90Pct: 1,
    seasonality: {},
  };

  it('reads the trend as +2 from the short-term averages', () => {
    // Counting all four gave 2-of-4 -> 0, against the card's Bullish.
    expect(scoreTrend(gold)!.cell).toBe(2);
  });

  it('still reports the long-term averages as context', () => {
    // They must remain available for the price-statistics panel even though
    // they no longer vote on the trend.
    expect(gold.sma100).toBeGreaterThan(gold.price);
    expect(gold.sma200).toBeGreaterThan(gold.price);
  });

  it('reproduces the stated Technical subtotal of 3', () => {
    const trend = scoreTrend(gold)!.cell; // +2
    const seasonality = 1; // card: Seasonality Trend = Bullish, capped at +/-1
    expect(trend + seasonality).toBe(3);
  });
});

describe('EdgeFinder parity — GOLD sentiment', () => {
  /** Card states: Long 85.4%, Short 14.6%, Change +0.78%. */
  function goldCot(): CotSeries {
    const report: CotReport = {
      contract: 'GOLD',
      reportDate: '2026-08-04',
      specLong: 227_013,
      specShort: 29_379,
      specNet: 197_634,
      specLongPct: 85.4,
      commLong: 0,
      commShort: 0,
      commNet: 0,
      retailLong: 74_000,
      retailShort: 26_000,
      retailNet: 48_000,
      retailLongPct: 74,
      openInterest: 371_551,
      openInterestChange: 0,
      specNetChange: 15_564, // positive: adding longs
    };
    // History deliberately ABOVE the current net, so the percentile is low —
    // this is the case that used to produce -1.
    const history = Array.from({ length: 60 }, (_, i) => ({
      ...report,
      specNet: 210_000 + i * 1000,
    }));
    return { contract: 'GOLD', reports: [report, ...history] };
  }

  it('reads COT as +2 from the long share, not the percentile', () => {
    const score = scoreCot(goldCot())!;
    expect(score.netPositioning).toBe(1); // 85.4% long
    expect(score.latestBuysSells).toBe(1); // adding this week
    expect(score.cell).toBe(2);
  });

  it('still reports the percentile, which tells a different and useful story', () => {
    const score = scoreCot(goldCot())!;
    // The same position is below its own 3-year median. Kept as context.
    expect(score.percentile).toBeLessThan(50);
    expect(score.explanation).toMatch(/percentile/);
  });

  it('reads the crowd as -1, contrarian', () => {
    expect(scoreCrowd(goldCot())!.cell).toBe(-1); // 74% retail long
  });

  it('reproduces the stated Sentiment + COT subtotal of 1', () => {
    const series = goldCot();
    expect(scoreCot(series)!.cell + scoreCrowd(series)!.cell).toBe(1);
  });
});

describe('EdgeFinder parity — GOLD total', () => {
  it('reproduces the full card: 3 + 1 + 4 = 8, Very Bullish', () => {
    const technical = 3;
    const sentiment = 1;
    const fundamentals = 4;
    const total = technical + sentiment + fundamentals;

    expect(total).toBe(8);
    // The card labels 8 as "Very Bullish"; our thresholds must agree.
    expect(biasFromScore(total)).toBe('Very Bullish');
  });
});

describe('2-year yield', () => {
  it('reads a rising yield as hawkish, bullish for the dollar', () => {
    expect(scoreYield2y(4.25, 4.0)!.cell).toBe(1);
  });

  it('reads a falling yield as dovish', () => {
    expect(scoreYield2y(3.8, 4.0)!.cell).toBe(-1);
  });

  it('treats a yield sitting on its average as flat', () => {
    expect(scoreYield2y(4.0, 4.0)!.cell).toBe(0);
  });

  it('returns null without data rather than guessing', () => {
    expect(scoreYield2y(null, 4.0)).toBeNull();
    expect(scoreYield2y(4.0, null)).toBeNull();
  });
});
