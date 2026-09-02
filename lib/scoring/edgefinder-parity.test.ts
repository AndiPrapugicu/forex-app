/**
 * Parity against A1 Trading's PUBLISHED scoring rules.
 *
 * This file used to reconstruct the model from a screenshot of one GOLD card
 * (Technical 3 / Sentiment 1 / Fundamentals 4 / total 8). That reconstruction
 * was under-determined and got several rules wrong, because A1 publishes the
 * rules themselves — scattered one page per metric, which is why they were
 * missed the first time.
 *
 * Concretely, the screenshot let us conclude Technical 3 = trend +2 (from
 * 20/50-day averages) + seasonality +1. The published rules say trend runs over
 * a 3/14-day pair on a +/-3 range and commodity seasonality is +/-2, so the same
 * "Technical 3" is equally consistent with trend +1 + seasonality +2. One
 * observation, two unknowns.
 *
 * So every assertion below cites the page it encodes. A screenshot is evidence;
 * a published rule is the specification.
 */

import { describe, expect, it } from 'vitest';
import {
  CROWD_LONG_PCT_BUCKETS,
  SCORING_SLOTS,
  SLOTS,
  SEASONALITY_YEARS,
  TREND_SMA,
  biasFromScore,
  maxCellFor,
  maxScoreForKind,
} from '@/config/setups.config';
import {
  ALL_SYMBOLS,
  GOLD_POLARITY,
  INDUSTRIAL_POLARITY,
  RISK_ASSET_POLARITY,
} from '@/config/symbols.config';
import { compareFor, normalizeZero, resolveSeries, scoreSlot, ternarySign } from '@/lib/scoring/discrete';
import { scoreCot, scoreCrowd } from '@/lib/scoring/cot';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import { buildProfile } from '@/lib/scoring/seasonality';
import { scoreSeasonality, scoreTrend, scoreYield2y } from '@/lib/scoring/technical';
import { computeSeasonality } from '@/lib/connectors/technicals';
import type { CotReport, CotSeries } from '@/lib/connectors/cftc';
import type { Technicals } from '@/lib/connectors/technicals';
import type { NormalizedEvent } from '@/lib/types';
import board from '@/fixtures/a1-board.json';

/** Mid-August, so "the month in progress" is a case every seasonality test hits. */
const NOW = new Date('2026-08-17T12:00:00Z');

/**
 * One capture of A1's board. Their board is only reachable as livestream frames,
 * so `fixtures/a1-board.json` keeps every capture ever taken rather than one —
 * see that file's comment. `capturedUtc` is null when the date was not
 * recoverable, which excludes the capture from parity but not from the
 * date-independent structure asserted below.
 */
interface Capture {
  capturedUtc: string | null;
  provenance: string;
  totals: Record<string, number>;
  cells: Record<string, Record<string, number>>;
}

function makeParityEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: Math.random().toString(36).slice(2),
    seriesId: null,
    name: 'Consumer Price Index (YoY)',
    currency: 'USD',
    countryCode: 'US',
    dateUtc: '2026-08-15T12:00:00Z',
    impact: 'HIGH',
    actual: 3.4,
    consensus: 3.1,
    previous: 3.1,
    revised: null,
    unit: null,
    ratioDeviation: null,
    isBetterThanExpected: null,
    isSpeech: false,
    isPreliminary: false,
    source: 'fxstreet',
    actualSource: 'fxstreet',
    sourceUrl: null,
    lastUpdated: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function technicals(overrides: Partial<Technicals> = {}): Technicals {
  return {
    symbol: 'TEST',
    price: 100,
    smaFast: null,
    smaSlow: null,
    smaSlowPrior: null,
    sma20: null,
    sma50: null,
    sma100: null,
    sma200: null,
    aboveCount: null,
    smaCount: 0,
    realizedVolPct: null,
    avgDailyMove7Pct: null,
    avgDailyMove90Pct: null,
    seasonality: {},
    ...overrides,
  };
}

function cotSeries(overrides: Partial<CotReport> = {}, historyNet = 0): CotSeries {
  const report: CotReport = {
    contract: 'TEST',
    reportDate: '2026-08-04',
    specLong: 60_000,
    specShort: 40_000,
    specNet: 20_000,
    specLongPct: 60,
    commLong: 0,
    commShort: 0,
    commNet: 0,
    retailLong: 5_000,
    retailShort: 5_000,
    retailNet: 0,
    retailLongPct: 50,
    openInterest: 100_000,
    openInterestChange: 0,
    specNetChange: 1_000,
    specLongPctChange: 1,
    specLongChange: 0,
    specShortChange: 0,
    ...overrides,
  };

  const history = Array.from({ length: 60 }, (_, i) => ({
    ...report,
    specNet: historyNet || report.specNet - i * 100,
  }));

  return { contract: report.contract, reports: [report, ...history] };
}

// ---------------------------------------------------------------------------
// Trend — a1trading.com/edgefinder/trend/
// ---------------------------------------------------------------------------

describe('trend: 3-day vs 14-day SMA, range +/-2', () => {
  it('uses a 3-day and a 14-day average, not the 20/50 pair we inferred', () => {
    expect(TREND_SMA).toEqual({ fast: 3, slow: 14 });
  });

  /**
   * THE CROSSOVER IS THE SCORE, the slope is only a modifier — and the two
   * conflicted states are NOT symmetric.
   *
   * We first read their "Slope Upward: +1" line as an addend and produced +/-3,
   * which put Gold on Trend +3 — a value their model cannot output. Their
   * combination rule only makes sense if the crossover alone is the baseline,
   * otherwise stating the adjustment separately would be redundant with adding.
   *
   * "Dip against a rising average" was changed to +2 on 2026-09-01 and changed
   * BACK the same day. Two captures made that quadrant look like +2 at 67%
   * (n=18); a third, taken five hours after the second, pulled it to 15 against
   * 12 and put -1 back in front. Pooled over all three captures:
   *
   *     cross +, slope +   n=71   +2 in 96%
   *     cross -, slope -   n=35   -2 in 89%
   *     cross +, slope -   n=20   +1 in 70%
   *     cross -, slope +   n=27   -1 in 56%   <- UNDECIDED, and this is the one
   *
   * So three quadrants are decided by measurement and the fourth is not. Where
   * the measurement is undecided the published description wins, and docking the
   * crossover by one is exactly what their wording says.
   *
   * All four combinations are enumerated because that is the whole rule.
   * `npm run trend-solver` regenerates the table above.
   */
  it.each([
    { name: 'clean uptrend', fast: 105, slow: 100, prior: 99, cell: 2, conflicted: false },
    { name: 'rally into a falling average', fast: 105, slow: 100, prior: 101, cell: 1, conflicted: true },
    { name: 'dip against a rising average', fast: 95, slow: 100, prior: 99, cell: -1, conflicted: true },
    { name: 'clean downtrend', fast: 95, slow: 100, prior: 101, cell: -2, conflicted: false },
  ])('$name scores $cell', ({ fast, slow, prior, cell, conflicted }) => {
    const score = scoreTrend(technicals({ smaFast: fast, smaSlow: slow, smaSlowPrior: prior }))!;
    expect(score.cell).toBe(cell);
    expect(score.conflicted).toBe(conflicted);
  });

  it('docks a point in both conflicted states and never flips the sign', () => {
    // The property, stated once rather than as two rows: a conflicted state
    // moves one step toward zero from the crossover and stops there. It is what
    // makes the range {-2,-1,+1,+2} with no 0 and no +/-3.
    const dip = scoreTrend(technicals({ smaFast: 95, smaSlow: 100, smaSlowPrior: 99 }))!;
    const rally = scoreTrend(technicals({ smaFast: 105, smaSlow: 100, smaSlowPrior: 101 }))!;
    expect(dip.conflicted && rally.conflicted).toBe(true);
    expect(dip.cell).toBe(-1);
    expect(rally.cell).toBe(1);
    expect(Math.sign(dip.cell)).toBe(Math.sign(dip.crossover));
    expect(Math.sign(rally.cell)).toBe(Math.sign(rally.crossover));
  });

  it('lets the crossover, not the slope, decide the sign', () => {
    // The rule from the other side, and the assertion that fails first if the
    // 2026-09-01 experiment is ever re-applied without new evidence: the slope
    // modulates magnitude only.
    for (const prior of [99, 101]) {
      expect(scoreTrend(technicals({ smaFast: 105, smaSlow: 100, smaSlowPrior: prior }))!.cell)
        .toBeGreaterThan(0);
      expect(scoreTrend(technicals({ smaFast: 95, smaSlow: 100, smaSlowPrior: prior }))!.cell)
        .toBeLessThan(0);
    }
  });

  it('adds NOTHING when crossover and slope agree', () => {
    // The specific regression: aligned bullish must be +2, never +3.
    const score = scoreTrend(technicals({ smaFast: 105, smaSlow: 100, smaSlowPrior: 99 }))!;
    expect(score.crossover).toBe(2);
    expect(score.slope).toBe(1);
    expect(score.cell).toBe(2);
  });

  it('treats a perfectly flat slow average as downward', () => {
    // "Slope Downward or Flat: -1" — flat is explicitly not neutral.
    const score = scoreTrend(technicals({ smaFast: 105, smaSlow: 100, smaSlowPrior: 100 }))!;
    expect(score.slope).toBe(-1);
    expect(score.cell).toBe(1);
  });

  it('never leaves the +/-2 range', () => {
    const cases = [
      [105, 100, 99],
      [105, 100, 101],
      [95, 100, 99],
      [95, 100, 101],
    ] as const;
    for (const [smaFast, smaSlow, smaSlowPrior] of cases) {
      const { cell } = scoreTrend(technicals({ smaFast, smaSlow, smaSlowPrior }))!;
      expect(Math.abs(cell)).toBeLessThanOrEqual(2);
    }
  });

  it('returns null rather than guessing when the averages are missing', () => {
    expect(scoreTrend(technicals())).toBeNull();
    expect(scoreTrend(technicals({ smaFast: 105, smaSlow: 100 }))).toBeNull();
    expect(scoreTrend(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Seasonality — a1trading.com/edgefinder/seasonality/
// ---------------------------------------------------------------------------

describe('seasonality: sign of the 10-year monthly average', () => {
  const august = { seasonality: { 8: { meanPct: 0.04, winRatePct: 52, years: 10 } } };
  const now = new Date('2026-08-15T00:00:00Z');

  it('scores +1 for FX on any positive average, however small', () => {
    // Their rule is the SIGN, full stop. Our old version required 0.15% and a
    // 60% win rate, which would have scored this 0.
    expect(scoreSeasonality(technicals(august), now, 'fx')!.cell).toBe(1);
  });

  it('stays +1 for indices, commodities and crypto too', () => {
    /**
     * Their seasonality page says these get +/-2 "because seasonal tendencies
     * are very pronounced in indices & commodities". Their PRODUCT does not:
     * GOLD and SILVER both show 1 in that column, and GOLD's published total of
     * 8 only reconciles with seasonality at 1 — at 2 it would be 9. No row in
     * their table shows +/-2 here.
     *
     * Where the doc and the running product disagree, the product wins.
     */
    expect(scoreSeasonality(technicals(august), now, 'commodity')!.cell).toBe(1);
    expect(scoreSeasonality(technicals(august), now, 'index')!.cell).toBe(1);
    expect(scoreSeasonality(technicals(august), now, 'crypto')!.cell).toBe(1);
  });

  it('scores the mirror image for a negative average', () => {
    const bearish = { seasonality: { 8: { meanPct: -0.04, winRatePct: 48, years: 10 } } };
    expect(scoreSeasonality(technicals(bearish), now, 'fx')!.cell).toBe(-1);
    expect(scoreSeasonality(technicals(bearish), now, 'commodity')!.cell).toBe(-1);
  });

  it('still reports mean and win rate, which no longer gate the score', () => {
    const score = scoreSeasonality(technicals(august), now, 'fx')!;
    expect(score.meanPct).toBe(0.04);
    expect(score.winRatePct).toBe(52);
  });

  it('declines to score a month with too few observations', () => {
    const thin = { seasonality: { 8: { meanPct: 2.0, winRatePct: 100, years: 3 } } };
    expect(scoreSeasonality(technicals(thin), now, 'fx')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// COT — a1trading.com/edgefinder/cot-data/
// ---------------------------------------------------------------------------

describe('COT: weekly change for FX, weekly change plus net positioning otherwise', () => {
  it('scores an FX leg purely on the weekly change', () => {
    // "If weekly % change in net long positioning is positive, add +1". Net
    // positioning is NOT part of the forex rule, so 60% long contributes nothing.
    const score = scoreCot(cotSeries({ specLongPct: 60, specLongPctChange: 1.2 }), 'fx')!;
    expect(score.latestBuysSells).toBe(1);
    expect(score.cell).toBe(1);
  });

  it('holds an FX leg to +/-1 even when positioning is extreme', () => {
    const score = scoreCot(cotSeries({ specLongPct: 95, specLongPctChange: 1.2 }), 'fx')!;
    expect(score.netPositioning).toBe(1); // computed and shown...
    expect(score.cell).toBe(1); // ...but not scored
  });

  it('adds net positioning for a non-FX asset, reaching +2', () => {
    // "If net positioning is bullish, the asset's COT score is increased by +1"
    // on top of the weekly change, summing to a -2..+2 range.
    const score = scoreCot(cotSeries({ specLongPct: 85, specLongPctChange: 1.2 }), 'asset')!;
    expect(score.netPositioning).toBe(1);
    expect(score.latestBuysSells).toBe(1);
    expect(score.cell).toBe(2);
  });

  it('nets the two components off against each other when they disagree', () => {
    const score = scoreCot(cotSeries({ specLongPct: 85, specLongPctChange: -1.2 }), 'asset')!;
    expect(score.cell).toBe(0);
  });

  it('reads an unchanged position as 0, not as selling', () => {
    expect(scoreCot(cotSeries({ specLongPctChange: 0 }), 'fx')!.cell).toBe(0);
  });

  it('scores the change in LONG SHARE, not the change in net contracts', () => {
    /**
     * A1's rule is "weekly % change in non-commercial long positioning", and
     * their Net % Change column is exactly that. We previously scored the change
     * in NET CONTRACTS, which is a different measure — longs and shorts growing
     * together move net sharply while the share barely shifts.
     *
     * Here they disagree outright: net contracts fell, but the long share rose.
     */
    const series = cotSeries({ specNetChange: -50_000, specLongPctChange: 3.2 });
    expect(scoreCot(series, 'fx')!.latestBuysSells).toBe(1);
  });

  it('reproduces A1’s published JPY "Net % Change" of 15.64%', () => {
    /**
     * Their Latest COT Report shows JPY at long 147,228 / short 192,701 with
     * changes of +45,957 and -71,982, and a Net % Change of 15.64%.
     *
     * Backing last week out of this week gives 43.31% against 27.67%, a rise of
     * 15.64 points — which pins both the measure and the way we reconstruct the
     * prior week from a single CFTC row.
     */
    const long = 147_228;
    const short = 192_701;
    const prevLong = long - 45_957;
    const prevShort = short - -71_982;

    const change = (long / (long + short)) * 100 - (prevLong / (prevLong + prevShort)) * 100;
    expect(change).toBeCloseTo(15.64, 2);
  });

  it('still reports the 3-year percentile, which tells a different story', () => {
    // A large net long can sit below its own median. Kept as context because it
    // is the more revealing measure, even though A1 does not score it.
    const score = scoreCot(cotSeries({ specNet: 20_000 }, 30_000), 'asset')!;
    expect(score.percentile).toBeLessThan(50);
    expect(score.explanation).toMatch(/percentile/);
  });
});

// ---------------------------------------------------------------------------
// Retail sentiment — a1trading.com/edgefinder/retail-sentiment/
// ---------------------------------------------------------------------------

describe('retail sentiment: 60/40 contrarian, range +/-1', () => {
  it('uses 60/40 rather than the 55/45 we had', () => {
    expect(CROWD_LONG_PCT_BUCKETS).toEqual({ bearish: 60, bullish: 40 });
  });

  it('scores -1 at exactly 60% long', () => {
    // "If retail positioning is greater or equal to 60% long -> -1 score."
    // Boundary is inclusive, and the sign is inverted because it is contrarian.
    expect(scoreCrowd(cotSeries({ retailLong: 6_000, retailShort: 4_000, retailLongPct: 60 }))!.cell).toBe(-1);
  });

  it('scores +1 at exactly 40% long', () => {
    expect(scoreCrowd(cotSeries({ retailLong: 4_000, retailShort: 6_000, retailLongPct: 40 }))!.cell).toBe(1);
  });

  it('says nothing inside the 40-60% band', () => {
    for (const pct of [41, 50, 59]) {
      expect(scoreCrowd(cotSeries({ retailLongPct: pct }))!.cell).toBe(0);
    }
  });

  it('declines to score a contract with negligible retail participation', () => {
    // A percentage off a handful of contracts is arithmetic, not signal.
    expect(scoreCrowd(cotSeries({ retailLong: 100, retailShort: 100 }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Inflation by asset class — a1trading.com/edgefinder/inflation/
// ---------------------------------------------------------------------------

/**
 * The sign bug that shipped: a cooler-than-forecast US CPI was scoring NEGATIVE
 * for gold. It should be positive — softer inflation means less room to hike,
 * lower real yields, and gold becomes more attractive. A1 states it plainly:
 * "If latest US CPI is LOWER than forecasted, +1".
 *
 * These assert the CHANGE component, which is the currency cell multiplied by
 * the asset's own polarity. A cooler US print gives the dollar -1; each asset
 * class then reads that -1 its own way.
 */
describe('inflation change: a cooler US print, read per asset class', () => {
  // The USD cell for a cooler CPI: 3.5% actual against a 3.8% forecast.
  const usdCell = ternarySign(3.5, 3.8); // -1, bearish USD

  const applied = (polarity: 1 | -1) => normalizeZero(usdCell * polarity);

  it('gives the dollar itself -1', () => {
    expect(usdCell).toBe(-1);
  });

  it('gives GOLD +1 — the bug the review caught', () => {
    expect(applied(GOLD_POLARITY.inflation!)).toBe(1);
  });

  it('gives silver, platinum and oil +1', () => {
    // "If latest CPI is HIGHER than forecasted, -1 / LOWER, +1" — commodities.
    expect(applied(INDUSTRIAL_POLARITY.inflation!)).toBe(1);
  });

  it('gives indices and crypto +1', () => {
    expect(applied(RISK_ASSET_POLARITY.inflation!)).toBe(1);
  });

  it('inverts all three for a HOTTER print', () => {
    const hot = ternarySign(4.1, 3.8); // +1, bullish USD
    for (const p of [GOLD_POLARITY, INDUSTRIAL_POLARITY, RISK_ASSET_POLARITY]) {
      expect(normalizeZero(hot * p.inflation!)).toBe(-1);
    }
  });

  it('keeps the asset classes apart on GROWTH, which is the real distinction', () => {
    // Strong US growth: bearish gold (haven), bullish industrials (demand) and
    // bullish equities. If these ever converge, the classes have collapsed.
    expect(GOLD_POLARITY.growth).toBe(-1);
    expect(INDUSTRIAL_POLARITY.growth).toBe(1);
    expect(RISK_ASSET_POLARITY.growth).toBe(1);
  });

  it('treats SILVER as a haven, not as an industrial metal', () => {
    /**
     * Their inflation page groups silver with oil and copper as "industrial
     * commodities", and we followed that. Their PRODUCT does not: the SILVER row
     * on Top Setups is identical to GOLD in every macro column — GDP +1,
     * mPMI -1, sPMI +1, NFP +1, unemployment -1, claims -1, ADP +1, JOLTS +1 —
     * differing only on COT, and the two total 10 against 11.
     *
     * Scoring silver as industrial flipped the sign on eight of its cells.
     */
    const silver = ALL_SYMBOLS.find((s) => s.symbol === 'XAGUSD')!;
    expect(silver.macroPolarity?.growth).toBe(-1);
    expect(silver.macroPolarity?.jobs).toBe(-1);

    // Oil stays industrial — demand-driven, and A1's reasoning there holds.
    const wti = ALL_SYMBOLS.find((s) => s.symbol === 'WTIUSD')!;
    expect(wti.macroPolarity?.growth).toBe(1);
  });

  it('treats PLATINUM as industrial, which their own table forces', () => {
    /**
     * PLATINUM was grouped with silver by assumption, and that is the assumption
     * their table breaks: it shows GOLD +11 and PLATINUM -4 in one snapshot.
     *
     * Both read the US economy. Under a shared polarity every macro cell would be
     * identical and the totals could only diverge across the four per-symbol
     * slots, whose combined spread is bounded below. The observed spread is 15,
     * so the fundamentals cannot be shared.
     */
    const platinum = ALL_SYMBOLS.find((s) => s.symbol === 'XPTUSD')!;
    expect(platinum.macroPolarity?.growth).toBe(1);
    expect(platinum.macroPolarity?.jobs).toBe(1);

    const spread =
      maxCellFor('trend', 'commodity') * 2 +
      maxCellFor('seasonality', 'commodity') * 2 +
      maxCellFor('cot', 'commodity') * 2 +
      maxCellFor('crowd', 'commodity') * 2;

    expect(spread).toBeLessThan(11 - -4);
  });

  it('keeps platinum inverted against gold on the same print', () => {
    // One US growth miss, read by both metals. They must disagree.
    const miss = ternarySign(1.5, 2.1); // -1
    expect(normalizeZero(miss * GOLD_POLARITY.growth!)).toBe(1); // haven bid
    expect(normalizeZero(miss * INDUSTRIAL_POLARITY.growth!)).toBe(-1); // demand
  });
});

// ---------------------------------------------------------------------------
// Series resolution
// ---------------------------------------------------------------------------

describe('resolution picks the most recent SCOREABLE print', () => {
  const base = {
    id: 'x', seriesId: null, currency: 'GBP' as const, countryCode: 'UK',
    impact: 'MEDIUM' as const, previous: null, revised: null, unit: null,
    ratioDeviation: null, isBetterThanExpected: null, isSpeech: false,
    isPreliminary: false, source: 'fxstreet' as const, actualSource: null,
    sourceUrl: null, lastUpdated: null,
  };

  const matcher = { match: [/^Test Series$/i] };

  it('skips a newer print that carries no forecast', () => {
    /**
     * The live case: UK core PPI's newest entry has an actual but no consensus,
     * so it cannot produce a beat or a miss. Taking it anyway discarded an older
     * print that could, and GBPUSD's PPI cell collapsed to a USD-only reading.
     */
    const events = [
      { ...base, name: 'Test Series', dateUtc: '2026-08-01T00:00:00Z', actual: 0.5, consensus: null },
      { ...base, name: 'Test Series', dateUtc: '2026-07-01T00:00:00Z', actual: 0.8, consensus: 0.4 },
    ] as never[];

    const picked = resolveSeries(matcher, 'GBP', events)!;
    expect(picked.dateUtc).toBe('2026-07-01T00:00:00Z');
    expect(picked.consensus).toBe(0.4);
  });

  it('still prefers the newest when both are scoreable', () => {
    const events = [
      { ...base, name: 'Test Series', dateUtc: '2026-08-01T00:00:00Z', actual: 0.5, consensus: 0.3 },
      { ...base, name: 'Test Series', dateUtc: '2026-07-01T00:00:00Z', actual: 0.8, consensus: 0.4 },
    ] as never[];

    expect(resolveSeries(matcher, 'GBP', events)!.dateUtc).toBe('2026-08-01T00:00:00Z');
  });

  it('falls back to the newest when NOTHING has a forecast', () => {
    // A series that has never carried a consensus must still surface, as
    // "awaiting" rather than vanishing from the card entirely.
    const events = [
      { ...base, name: 'Test Series', dateUtc: '2026-08-01T00:00:00Z', actual: 0.5, consensus: null },
      { ...base, name: 'Test Series', dateUtc: '2026-07-01T00:00:00Z', actual: 0.8, consensus: null },
    ] as never[];

    expect(resolveSeries(matcher, 'GBP', events)!.dateUtc).toBe('2026-08-01T00:00:00Z');
  });

  it('scores the CONFIRMING REVISION, not the flash behind it', () => {
    /**
     * REGRESSION: the euro-area GDP case, and the reason EURUSD's Economic
     * Growth block read 6 against their published 5.
     *
     * Both prints describe the same quarter:
     *
     *   30 Jul  flash      actual 0.4 against a 0.2 forecast — a beat
     *   14 Aug  revision   actual 0.4 against a 0.4 forecast — says nothing
     *
     * `resolveSeries` used to reach back to the flash, on the reasoning that a
     * consensus equal to the previous print is a survey that was never taken and
     * the revision therefore reports "no news" about a quarter that did beat.
     * Sound analysis, wrong model of A1: their 2026-08-23 EURUSD card publishes
     * an Economic Growth subtotal of 5, and with the dollar legs known exactly
     * from their US-DOLLAR card that only reconciles at a euro GDP leg of 0 —
     * the REVISION. Measured board-wide, removing the reach-back moved TOTAL ABS
     * GAP 96 -> 92 and exact rows 7 -> 9.
     *
     * This test is the guard on that: if it starts failing, someone has restored
     * the reach-back and EUR's growth block has silently gained a point.
     */
    const events = [
      { ...base, name: 'Test Series', dateUtc: '2026-08-14T00:00:00Z', actual: 0.4, consensus: 0.4, previous: 0.4 },
      { ...base, name: 'Test Series', dateUtc: '2026-07-30T00:00:00Z', actual: 0.4, consensus: 0.2, previous: -0.2 },
    ] as never[];

    const picked = resolveSeries(matcher, 'GBP', events)!;
    expect(picked.dateUtc).toBe('2026-08-14T00:00:00Z');
    expect(ternarySign(picked.actual!, picked.consensus!)).toBe(0); // the revision says nothing
  });

  it('does NOT reach into an older month for a series the feed never forecasts', () => {
    /**
     * The guard that makes the rule above safe, and it is not hypothetical:
     * Japan's PMIs carry a forecast equal to the prior reading every single
     * month. Without the revision window every one of them looked uninformative
     * and the fallback scored a stale month as though it were current — CHFJPY
     * lost eight points that way, which is worse than the problem being fixed.
     */
    const events = [
      { ...base, name: 'Test Series', dateUtc: '2026-08-03T00:00:00Z', actual: 54.5, consensus: 54.7, previous: 54.7 },
      { ...base, name: 'Test Series', dateUtc: '2026-07-01T00:00:00Z', actual: 52.0, consensus: 50.0, previous: 49.0 },
    ] as never[];

    // 33 days apart: a different month, not a revision. Keep the current print.
    expect(resolveSeries(matcher, 'GBP', events)!.dateUtc).toBe('2026-08-03T00:00:00Z');
  });

  /**
   * Choosing BETWEEN patterns, which the tests above deliberately do not touch —
   * every one of them uses a single-pattern matcher.
   *
   * The loop used to advance to the next pattern only when a pattern matched
   * NOTHING, so a pattern that matched and then produced an unusable print
   * returned it and stopped. New Zealand retail sales is the live case:
   * `Electronic Card Retail Sales (MoM)` leads the list and has carried no
   * consensus on any of its prints, which made the quarterly behind it
   * unreachable and killed the column for every kiwi pair.
   */
  describe('resolveSeries across several patterns', () => {
    const twoPatterns = { match: [/^Card Sales$/i, /^Quarterly Sales$/i] };

    it('reaches a later pattern when the first can only offer an unscoreable print', () => {
      const events = [
        { ...base, name: 'Card Sales', dateUtc: '2026-08-16T00:00:00Z', actual: 1.3, consensus: null, previous: -1.4 },
        { ...base, name: 'Quarterly Sales', dateUtc: '2026-08-15T00:00:00Z', actual: 0.9, consensus: 0.5, previous: 0.9 },
      ] as never[];

      const picked = resolveSeries(twoPatterns, 'GBP', events, 'forecast', {
        now: new Date('2026-08-19T00:00:00Z'),
        maxAgeDays: 75,
      })!;
      expect(picked.name).toBe('Quarterly Sales');
    });

    it('keeps the earlier pattern when both offer equally good prints', () => {
      // Pattern order is a preference list. It must still mean something.
      const events = [
        { ...base, name: 'Card Sales', dateUtc: '2026-08-16T00:00:00Z', actual: 1.3, consensus: 1.0, previous: -1.4 },
        { ...base, name: 'Quarterly Sales', dateUtc: '2026-08-18T00:00:00Z', actual: 0.9, consensus: 0.5, previous: 0.9 },
      ] as never[];

      const picked = resolveSeries(twoPatterns, 'GBP', events, 'forecast', {
        now: new Date('2026-08-19T00:00:00Z'),
        maxAgeDays: 75,
      })!;
      expect(picked.name).toBe('Card Sales');
    });

    it('prefers a FRESH unscoreable print over a STALE scoreable one', () => {
      /**
       * The ordering that makes the fix safe rather than merely different.
       *
       * Preferring the stale-but-scoreable quarterly hands `scoreSlot` a print
       * it must then reject as beyond its window — so the column stays blank AND
       * the fresher reading is thrown away. Freshness outranks scoreability
       * because the staleness windows exist to say a number that old no longer
       * describes anything.
       */
      const events = [
        { ...base, name: 'Card Sales', dateUtc: '2026-08-16T00:00:00Z', actual: 1.3, consensus: null, previous: -1.4 },
        { ...base, name: 'Quarterly Sales', dateUtc: '2026-05-21T00:00:00Z', actual: 0.9, consensus: 0.5, previous: 0.9 },
      ] as never[];

      const picked = resolveSeries(twoPatterns, 'GBP', events, 'forecast', {
        now: new Date('2026-08-19T00:00:00Z'),
        maxAgeDays: 75, // the quarterly is 90 days old
      })!;
      expect(picked.name).toBe('Card Sales');
    });

    it('without a freshness window, behaves exactly as it did before', () => {
      // Callers that do not pass one must not be handed a different answer.
      const events = [
        { ...base, name: 'Card Sales', dateUtc: '2026-08-16T00:00:00Z', actual: 1.3, consensus: null, previous: -1.4 },
        { ...base, name: 'Quarterly Sales', dateUtc: '2026-05-21T00:00:00Z', actual: 0.9, consensus: 0.5, previous: 0.9 },
      ] as never[];

      // Both count as fresh, so the scoreable one wins on the second key.
      expect(resolveSeries(twoPatterns, 'GBP', events)!.name).toBe('Quarterly Sales');
    });
  });
});

/**
 * The GBP producer-price slot, pinned against A1's published UK card.
 *
 * Their card names the row `PPI YoY`, dated Jan 21 26, with Actual 3.4,
 * Forecast BLANK, Previous 3.4 and Surprise 0. Three facts fall out of one row,
 * and this slot had all three wrong:
 *
 *   YoY, not MoM        the label says so outright
 *   headline, not core  UK core output YoY runs near 2.8 and input near 4.9, so
 *                       3.4 can only be the headline output series
 *   vs PREVIOUS         actual minus previous is the only arithmetic that gives
 *                       a Surprise of 0 from 3.4 against a blank forecast
 *
 * The old order asked for core output MoM against a FORECAST, and UK core
 * carries no consensus on any recent print — so `resolveSeries` reached past
 * every fresh release to 2026-06-17, sixty-eight days before the 2026-08-23
 * capture, and scored +1 off it. The print it walked over, 2026-08-19, reads
 * 3.1 against a 3.5 previous: -1. Two points on the GBP leg of every sterling
 * pair, and it moved GBPUSD and GBPCAD onto their numbers exactly.
 */
describe("GBP producer prices: the series their card names", () => {
  const slot = SLOTS.find((s) => s.key === 'ppi')!;

  it('asks for headline OUTPUT prices year on year, not core month on month', () => {
    const patterns = slot.matchByCurrency!.GBP!;
    expect(patterns[0].source).toMatch(/Output.*YoY/);
    // Core is what this used to lead with. It must not be reachable at all now:
    // a fallback to core would resurrect the 68-day print by another route.
    expect(patterns.some((p) => /Core/i.test(p.source))).toBe(false);
  });

  it('reads it against the PREVIOUS print, like their blank-forecast CH and AU cards', () => {
    expect(compareFor(slot, 'GBP')).toBe('previous');
    // The currencies whose cards DO publish a forecast keep reading one.
    expect(compareFor(slot, 'USD')).toBe('forecast');
    expect(compareFor(slot, 'EUR')).toBe('forecast');
  });

  it('scores the fresh print instead of reaching two cycles back for a forecast', () => {
    /**
     * The live feed on 2026-08-23, trimmed to the three releases that decided
     * it. Note that BOTH August entries carry `consensus: null` — under a
     * forecast basis neither is scoreable and the resolver keeps walking, which
     * is exactly how a June print ended up filling an August cell.
     */
    const base = {
      id: 'x', seriesId: null, currency: 'GBP' as const, countryCode: 'UK',
      impact: 'MEDIUM' as const, revised: null, unit: '%',
      ratioDeviation: null, isBetterThanExpected: null, isSpeech: false,
      isPreliminary: false, source: 'fxstreet' as const, actualSource: null,
      sourceUrl: null, lastUpdated: null, consensusSource: null,
    };
    const events = [
      { ...base, name: 'Producer Price Index - Output (YoY) n.s.a', dateUtc: '2026-08-19T09:00:00Z', actual: 3.1, consensus: 3.2, previous: 3.5 },
      { ...base, name: 'PPI Core Output (MoM) n.s.a', dateUtc: '2026-08-19T09:00:00Z', actual: 0.6, consensus: null, previous: 0.5 },
      { ...base, name: 'PPI Core Output (MoM) n.s.a', dateUtc: '2026-06-17T09:00:00Z', actual: 0.8, consensus: 0.4, previous: 0.7 },
    ] as never[];

    const result = scoreSlot(slot, 'GBP', events, new Date('2026-08-23T15:11:37Z'));

    expect(result.event!.name).toBe('Producer Price Index - Output (YoY) n.s.a');
    expect(result.event!.dateUtc).toBe('2026-08-19T09:00:00Z');
    expect(result.referenceLabel).toBe('previous');
    expect(result.cell).toBe(-1); // 3.1 against a 3.5 previous: producer inflation cooling
    expect(result.ageDays!).toBeLessThan(10); // not the 68 the old order scored
  });

  it('would still read -1 if the forecast basis came back, which is why today looks quiet', () => {
    // 3.1 against a 3.2 consensus is also a miss. The two bases agree on this
    // print and disagree in general - do not read the agreement as a licence to
    // revert the basis.
    expect(ternarySign(3.1, 3.2)).toBe(-1);
    expect(ternarySign(3.1, 3.5)).toBe(-1);
  });
});

describe('inflation has NO level component, despite their docs', () => {
  /**
   * Their inflation page describes a second, level-based term for non-FX assets
   * (indices want CPI <=3%; gold gains both below 1% and above 3%). We shipped
   * it, and their own Asset Scorecard disproves it.
   *
   * Their GOLD card lists four inflation rows — CPI +1, PPI +1, PCE 0, 2Y yield
   * -1 — subtotalling +1. With a level term on CPI it would be +2 and the block
   * would read Very Bullish, not Bullish.
   */
  it('reconciles their GOLD inflation block only WITHOUT a level term', () => {
    const rows = { cpi: 1, ppi: 1, pce: 0, yield2y: -1 };
    const subtotal = Object.values(rows).reduce((a, b) => a + b, 0);

    expect(subtotal).toBe(1); // their card: Inflation = Bullish = +1
    expect(subtotal + 1).not.toBe(1); // a level term would break it
  });
});

// ---------------------------------------------------------------------------
// Interest rates, non-FX arm — a1trading.com/edgefinder/interest-rates/
// ---------------------------------------------------------------------------

describe('interest rates: US 2-year vs its 21-day average, for non-FX assets', () => {
  it('reads a yield above its average as a headwind', () => {
    // "If price is above the moving average, -1." Expressed from a RISK asset's
    // point of view, so gold and the indices take it as-is.
    expect(scoreYield2y(4.25, 4.0)!.cell).toBe(-1);
  });

  it('reads a yield below its average as a tailwind', () => {
    expect(scoreYield2y(3.8, 4.0)!.cell).toBe(1);
  });

  it('treats a yield sitting on its average as flat', () => {
    expect(scoreYield2y(4.0, 4.0)!.cell).toBe(0);
  });

  it('returns null without data rather than guessing', () => {
    expect(scoreYield2y(null, 4.0)).toBeNull();
    expect(scoreYield2y(4.0, null)).toBeNull();
  });

  it('carries a second sentence told from the dollar’s side', () => {
    /**
     * One reading, two signs. A falling 2-year is a tailwind for gold and a
     * headwind for the dollar, and a single string cannot honestly say both —
     * the live card said "easing, a tailwind" beside a bullish dollar cell.
     */
    const falling = scoreYield2y(3.96, 4.12)!;
    expect(falling.explanation).toMatch(/easing, a tailwind/);
    expect(falling.dollarExplanation).toMatch(/dovish, bearish USD/);

    const rising = scoreYield2y(4.25, 4.0)!;
    expect(rising.explanation).toMatch(/tightening, a headwind/);
    expect(rising.dollarExplanation).toMatch(/hawkish, bullish USD/);
  });
});

// ---------------------------------------------------------------------------
// Which symbols read which rate rule
// ---------------------------------------------------------------------------

describe('the rate column routes by asset class', () => {
  /** The live figures behind A1's card: 3.96% against a 21-day average of 4.12%. */
  const fallingYield = { current: 3.96, sma: 4.12 };

  const matrix = () =>
    buildSetupsMatrix({
      events: [],
      cot: new Map(),
      technicals: new Map(),
      yield2y: fallingYield,
      now: NOW,
    });

  const row = (symbol: string) => matrix().rows.find((r) => r.symbol === symbol)!;

  it('gives the DOLLAR the opposite sign to gold on the same yield', () => {
    /**
     * The bug this pins. DXY fell through to the risk-asset branch and read +1
     * on a falling 2-year, against A1's -1 — worth two points on every run, and
     * with it their US-DOLLAR card reconciles at -8 instead of our -9.
     */
    expect(row('DXY').cells.rates.cell).toBe(-1);
    expect(row('XAUUSD').cells.rates.cell).toBe(1);
  });

  it('explains the dollar cell in dollar terms', () => {
    expect(row('DXY').cells.rates.explanation).toMatch(/dovish, bearish USD/);
  });

  it('does not read the US 2-year for a non-dollar currency index', () => {
    /**
     * A pound index scoring off US financial conditions is not a rule A1 has.
     * GBP's own rate expectation is 0 with a calendar present — the BoE
     * publishes no numeric projection — and an honest 0 beats a US number
     * wearing a GBP label.
     *
     * The calendar has to be non-empty for that 0 to be the honest one: with no
     * calendar at all the cell is null, because an outage is not a neutral view.
     */
    const withCalendar = buildSetupsMatrix({
      events: [
        makeParityEvent({
          currency: 'USD',
          countryCode: 'US',
          name: 'Nonfarm Payrolls',
          actual: 200,
          consensus: 100,
        }),
      ],
      cot: new Map(),
      technicals: new Map(),
      yield2y: fallingYield,
      now: NOW,
    });
    const gbpx = withCalendar.rows.find((r) => r.symbol === 'GBPX')!.cells.rates;
    expect(gbpx.cell).toBe(0);
    expect(gbpx.explanation).toMatch(/GBP/);
    // The risk-asset yield wording is the tell that it read the US 2-year.
    expect(gbpx.explanation).not.toMatch(/tailwind|headwind/);
  });

  it('reads null for that index when there is no calendar at all', () => {
    // The distinction the null exists for: a missing provider must not arrive
    // as "no change expected".
    expect(row('GBPX').cells.rates.cell).toBeNull();
    // The US-2-year rows are unaffected — they never depended on the calendar.
    expect(row('XAUUSD').cells.rates.cell).toBe(1);
  });

  it('still reads the US 2-year for indices and crypto', () => {
    // These genuinely are risk assets, and the rule is theirs.
    expect(row('NAS100').cells.rates.cell).toBe(1);
    expect(row('BTCUSD').cells.rates.cell).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Ternary fundamentals
// ---------------------------------------------------------------------------

describe('fundamentals are ternary, with no deadband', () => {
  it('scores any beat +1 and any miss -1, however small', () => {
    expect(ternarySign(7.36, 7.44)).toBe(-1); // -0.15 sigma; an old deadband ate this
    expect(ternarySign(55.6, 54)).toBe(1);
  });

  it('scores an exact-on-forecast print as 0', () => {
    expect(ternarySign(3.3, 3.3)).toBe(0);
    expect(ternarySign(0.2, 0.2)).toBe(0);
  });

  it('collapses negative zero, which would render as "-0"', () => {
    expect(Object.is(normalizeZero(0 * -1), 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bias bands — a1trading.com/edgefinder/top-setups/
// ---------------------------------------------------------------------------

describe('bias bands are absolute, not a fraction of the maximum', () => {
  it('cuts at +4 and +7, and mirrors them', () => {
    // "'Bullish' if the total score is greater or equal to +4, and 'Very
    // Bullish' if the total score is greater or equal to +7."
    expect(biasFromScore(7)).toBe('Very Bullish');
    expect(biasFromScore(6)).toBe('Bullish');
    expect(biasFromScore(4)).toBe('Bullish');
    expect(biasFromScore(3)).toBe('Neutral');
    expect(biasFromScore(-3)).toBe('Neutral');
    expect(biasFromScore(-4)).toBe('Bearish');
    expect(biasFromScore(-6)).toBe('Bearish');
    expect(biasFromScore(-7)).toBe('Very Bearish');
  });

  it('labels a 14 the same as a 7, which is the whole point', () => {
    // The user's original question: EdgeFinder shows EURUSD at 14. That is not
    // near a cap, it is twice the Very Bullish floor. Nothing clamps here.
    expect(biasFromScore(14)).toBe('Very Bullish');
    expect(biasFromScore(21)).toBe('Very Bullish');
  });
});

// ---------------------------------------------------------------------------
// Scale guardrail
// ---------------------------------------------------------------------------

describe('the scoring column set is pinned', () => {
  /**
   * Because the bands above are absolute, adding a scoring column silently
   * redefines "Bullish". This is the test that fails when someone does — which
   * is exactly the drift that had us at a theoretical +/-36 against A1's +/-21.
   */
  /**
   * Transcribed column-for-column from a live EdgeFinder Top Setups screenshot.
   * Eighteen columns, in their order. This is stronger evidence than any of
   * their prose: seven rows of it reconcile to their stated totals exactly.
   */
  const A1_COLUMNS = [
    'trend', 'seasonality',
    'cot', 'crowd',
    'gdp', 'mpmi', 'spmi', 'retail-sales', 'consumer-confidence',
    'cpi', 'ppi', 'pce', 'rates',
    'employment', 'unemployment', 'claims', 'adp', 'jolts',
  ];

  it('carries exactly the 18 columns A1 scores', () => {
    expect(SCORING_SLOTS.map((s) => s.key).sort()).toEqual([...A1_COLUMNS].sort());
  });

  it('scores mPMI and sPMI as SEPARATE columns', () => {
    // Their EURUSD reads mPMI -2 and sPMI +2 on the same day. Merging them into
    // one composite collapsed that to a single -1 and halved the growth block.
    expect(SCORING_SLOTS.some((s) => s.key === 'mpmi')).toBe(true);
    expect(SCORING_SLOTS.some((s) => s.key === 'spmi')).toBe(true);
    expect(SCORING_SLOTS.some((s) => s.key === 'pmi')).toBe(false);
  });

  it('scores consumer confidence, claims, ADP and JOLTS', () => {
    // All four appear as populated, contributing columns in their table. They
    // were wrongly demoted to context on the assumption A1 did not carry them,
    // which cost up to 8 points a row.
    for (const key of ['consumer-confidence', 'claims', 'adp', 'jolts']) {
      expect(SCORING_SLOTS.some((s) => s.key === key), key).toBe(true);
    }
  });

  it('keeps wages and participation OFF the total — those two are ours', () => {
    // A1 has no such columns, so counting them would push us off their scale.
    for (const key of ['wages', 'participation']) {
      expect(SCORING_SLOTS.some((s) => s.key === key), key).toBe(false);
    }
  });

  it('tops out at +/-34 for an FX pair and +/-20 for a single-economy asset', () => {
    /**
     * These differ because a pair DIFFERENCES two economies (+/-2 a macro cell)
     * while gold or an index reads ONE (+/-1). Drawing a single-economy asset on
     * the FX dial is what made Gold read "+5 out of 25".
     *
     * Both are far above the +/-7 "Very Bullish" cut, which is A1's design, not
     * a flaw in ours — their own GBPUSD prints 11 on this same column set.
     */
    expect(maxScoreForKind('fx')).toBe(34);
    expect(maxScoreForKind('commodity')).toBe(20);
    expect(maxScoreForKind('index')).toBe(20);
    expect(maxScoreForKind('crypto')).toBe(20);
  });

  it('never lets a single-economy asset reach the FX maximum', () => {
    // A structural property, not a coincidence of the current slot list.
    for (const kind of ['commodity', 'index', 'crypto'] as const) {
      expect(maxScoreForKind(kind)).toBeLessThan(maxScoreForKind('fx'));
    }
  });
});

// ---------------------------------------------------------------------------
// Whole-row reconciliation against the live product
// ---------------------------------------------------------------------------

/**
 * Rows read straight off A1's board, and what they are and are not evidence of.
 *
 * These used to be a hard-coded copy inside this file under a comment claiming
 * "if someone later adds a weight or a clamp, these break". THEY DID NOT. Every
 * assertion was about A1's own arithmetic — that THEIR cells sum to THEIR total
 * — and `buildSetupsMatrix` was never called, so a weight added to our own
 * summation would have sailed through a green suite. The composition rule this
 * block was named after is now actually tested, at the bottom.
 *
 * The rows themselves now live in `fixtures/a1-board.json` alongside the totals
 * `npm run parity` scores against, rather than in a second copy here that could
 * drift from it. Reading them from the fixture also means this suite validates
 * the transcriptions that the parity script depends on being right.
 */
describe("A1's captured board", () => {
  const CAPTURES = board.captures as unknown as Capture[];
  const ROWS = CAPTURES.flatMap((capture) =>
    Object.entries(capture.cells).map(([symbol, cells]) => ({
      label: `${capture.capturedUtc ?? 'undated'} ${symbol}`,
      symbol,
      cells,
      total: capture.totals[symbol],
    })),
  );

  it('has at least one row captured cell by cell', () => {
    /**
     * Guards the failure this whole investigation started from: the fixture's
     * `cells` was `{}`, so parity's per-slot attribution printed nothing and
     * every fix after that was a guess. An empty fixture is a silent one.
     */
    expect(ROWS.length).toBeGreaterThan(0);
  });

  it.each(ROWS)('$label sums to its published total', ({ cells, total }) => {
    /**
     * The transcription check, not a scoring check. Their score column IS the
     * sum of the 18 cells, so a row that does not add up was misread off a
     * compressed video frame — which is the normal failure, not a rare one.
     */
    expect(Object.keys(cells)).toHaveLength(SCORING_SLOTS.length);
    expect(Object.values(cells).reduce((a, b) => a + b, 0)).toBe(total);
  });

  it('uses exactly the slot keys we score', () => {
    for (const { label, cells } of ROWS) {
      expect(Object.keys(cells).sort(), label).toEqual(SCORING_SLOTS.map((s) => s.key).sort());
    }
  });

  it('agrees with our bias bands on every published total', () => {
    const BANDS: [number, string][] = [
      [13, 'Very Bullish'], [11, 'Very Bullish'], [9, 'Very Bullish'],
      [8, 'Very Bullish'], [7, 'Very Bullish'], [6, 'Bullish'], [5, 'Bullish'],
    ];
    for (const [total, bias] of BANDS) expect(biasFromScore(total), String(total)).toBe(bias);
  });

  it('confirms trend never exceeds +/-2 in the live product', () => {
    // Independent confirmation of the trend fix, from their own output rather
    // than from re-reading their prose.
    for (const { label, cells } of ROWS) {
      expect(Math.abs(cells.trend), label).toBeLessThanOrEqual(2);
    }
  });

  it('confirms seasonality never exceeds +/-1, including on GOLD and SILVER', () => {
    for (const { label, cells } of ROWS) {
      expect(Math.abs(cells.seasonality), label).toBeLessThanOrEqual(1);
    }
  });

  it('never exceeds +/-1 on a macro cell for a single-economy asset', () => {
    /**
     * XAUUSD and XAGUSD take the single-economy path, where a macro cell is one
     * currency's reading rather than base-minus-quote, so it cannot reach the
     * +/-2 an FX pair can. Their board agrees, which is what makes this a real
     * check on our composition rather than a restatement of our own config.
     */
    const macro = SCORING_SLOTS.filter((s) => s.kind === 'economic').map((s) => s.key);
    for (const { label, symbol, cells } of ROWS) {
      if (symbol !== 'XAUUSD' && symbol !== 'XAGUSD') continue;
      for (const key of macro) {
        expect(Math.abs(cells[key]), `${label} ${key}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

/**
 * THE COMPOSITION RULE, tested against our own matrix rather than against A1's.
 *
 * A row's score is a plain unweighted sum of its scoring cells — no weighting,
 * no normalisation, no scaling, no cap. This is the assertion the block above
 * claimed to make for months without making it.
 */
describe('our own total is a plain unweighted sum of the scored cells', () => {
  const scoringKeys = new Set(SCORING_SLOTS.map((s) => s.key));

  const matrix = buildSetupsMatrix({
    events: [
      makeParityEvent({ currency: 'USD', countryCode: 'US', name: 'Nonfarm Payrolls', actual: 200, consensus: 100 }),
      makeParityEvent({ currency: 'GBP', countryCode: 'GB', name: 'Consumer Price Index (YoY)', actual: 3.4, consensus: 3.1 }),
      makeParityEvent({ currency: 'JPY', countryCode: 'JP', name: 'Unemployment Rate', actual: 2.8, consensus: 2.5 }),
    ],
    cot: new Map(),
    technicals: new Map(),
    now: NOW,
  });

  it('reproduces every row total by re-adding its own cells', () => {
    for (const row of matrix.rows) {
      const sum = Object.entries(row.cells)
        .filter(([key, cell]) => scoringKeys.has(key) && cell.cell !== null)
        .reduce((t, [, cell]) => t + cell.cell!, 0);

      expect(sum, row.symbol).toBe(row.totalScore);
    }
  });

  it('scores at least one row non-zero, so the check above has something to prove', () => {
    // Without this, an all-blank board would satisfy the sum test trivially and
    // the suite would stay green through a total rewrite of the scoring.
    expect(matrix.rows.some((r) => r.totalScore !== 0)).toBe(true);
  });

  it('counts a cell exactly once, in one category', () => {
    for (const row of matrix.rows) {
      const sum = Object.values(row.categoryScores).reduce((a, b) => a + b, 0);
      expect(sum, row.symbol).toBe(row.totalScore);
    }
  });
});

// ---------------------------------------------------------------------------
// Conference Board consumer confidence
// ---------------------------------------------------------------------------

describe('consumer confidence uses the Conference Board consensus', () => {
  /**
   * The forecast decides the sign here, and the sources genuinely disagree:
   *
   *   ForexFactory  92.4  -> miss   (what A1's card shows)
   *   TradingView   92.3  -> miss   (what we use)
   *   MQL5          89.5  -> BEAT   (a first attempt, and the opposite reading)
   *
   * Every source agrees the July 2026 print was 90.8. Picking the wrong
   * consensus flipped GBPUSD's cell from +2 to 0 and cost two points on every
   * USD pair, so this pins the direction rather than the exact number.
   */
  const ACTUAL = 90.8;

  it('reads the July 2026 print as a MISS', () => {
    for (const [source, forecast] of [['ForexFactory', 92.4], ['TradingView', 92.3]] as const) {
      expect(ternarySign(ACTUAL, forecast), source).toBe(-1);
    }
  });

  it('would read it as a beat on the wrong consensus', () => {
    // Kept as a regression marker: if someone swaps the source back, this is
    // the sign that flips.
    expect(ternarySign(ACTUAL, 89.5)).toBe(1);
  });

  it('maps a USD miss to +2 on GBPUSD alongside a GBP beat', () => {
    // GfK -17 against a -21 forecast is a GBP beat; base minus quote gives the
    // +2 A1 publishes.
    const gbp = ternarySign(-17, -21);
    const usd = ternarySign(ACTUAL, 92.3);
    expect(gbp - usd).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The long-share band — a1trading.com/edgefinder/cot-data/
// ---------------------------------------------------------------------------

describe('COT net positioning uses a 60/40 band', () => {
  /**
   * Two published cards pin this, and only 60/40 satisfies both at once. At the
   * 55/45 we had, the euro cell collapsed to 0 against their +1.
   */
  it('reproduces the US-DOLLAR card: 74.4% long and buying scores +2', () => {
    const usd = scoreCot(cotSeries({ specLongPct: 74.39, specLongPctChange: 0.95 }), 'asset')!;
    expect(usd.netPositioning).toBe(1);
    expect(usd.latestBuysSells).toBe(1);
    expect(usd.cell).toBe(2);
  });

  it('reproduces the EURO row: 43.7% long and buying scores +1', () => {
    /**
     * This row is why the currency indices were on the change-only rule. The
     * long share is not scoring 0 because it is ignored — it is scoring 0
     * because 43.7% sits INSIDE the neutral band. Same cell, different reason,
     * and the difference shows the moment a currency runs to 74%.
     */
    const eur = scoreCot(cotSeries({ specLongPct: 43.7, specLongPctChange: 1.22 }), 'asset')!;
    expect(eur.netPositioning).toBe(0);
    expect(eur.latestBuysSells).toBe(1);
    expect(eur.cell).toBe(1);
  });

  it('leaves the 40-60 band saying nothing about positioning', () => {
    for (const pct of [40.1, 50, 59.9]) {
      expect(scoreCot(cotSeries({ specLongPct: pct }), 'asset')!.netPositioning, `${pct}%`).toBe(0);
    }
    expect(scoreCot(cotSeries({ specLongPct: 60 }), 'asset')!.netPositioning).toBe(1);
    expect(scoreCot(cotSeries({ specLongPct: 40 }), 'asset')!.netPositioning).toBe(-1);
  });

  it('scores a standalone currency index on both components, not just the change', () => {
    const matrix = buildSetupsMatrix({
      events: [],
      cot: new Map([['USD INDEX', cotSeries({ specLongPct: 74.39, specLongPctChange: 0.95 })]]),
      technicals: new Map(),
      now: NOW,
    });
    expect(matrix.rows.find((r) => r.symbol === 'DXY')!.cells.cot.cell).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Seasonality and the month in progress
// ---------------------------------------------------------------------------

describe('seasonality ignores the month it is standing in', () => {
  /**
   * Yahoo's monthly series carries the in-progress bar, so a seventeen-day-old
   * August was being averaged in as a complete historical August. The cell is
   * nothing but the SIGN of that average, so on a symbol whose real August is
   * near flat — the dollar index runs -0.06% — one partial observation decided
   * the cell outright.
   */

  /** Julys and Augusts alternating, ending on a part-finished August 2026. */
  function monthlySeries(augustCloses: number[], partialAugust: number) {
    const timestamps: number[] = [];
    const closes: number[] = [];

    augustCloses.forEach((close, i) => {
      const year = 2016 + i;
      timestamps.push(Date.UTC(year, 6, 31) / 1000); // 31 July
      closes.push(100);
      timestamps.push(Date.UTC(year, 7, 31) / 1000); // 31 August
      closes.push(close);
    });

    timestamps.push(Date.UTC(2026, 6, 31) / 1000);
    closes.push(100);
    timestamps.push(Date.UTC(2026, 7, 17) / 1000); // 17 August, still running
    closes.push(partialAugust);

    return { timestamps, closes };
  }

  /**
   * Ten completed Augusts at +1%, and a partial August down 20%.
   *
   * The partial month is deliberately large enough to drag the mean NEGATIVE
   * (10 - 20 over eleven observations). A milder one still corrupts the average
   * but leaves the sign alone, and since the sign is the whole cell, that would
   * make these tests pass against the very bug they exist to catch.
   */
  const COMPLETED = Array(10).fill(101);
  const PARTIAL = 80;

  it('excludes the partial month from the average', () => {
    const { timestamps, closes } = monthlySeries(COMPLETED, PARTIAL);
    const august = computeSeasonality(timestamps, closes, NOW)[8];

    expect(august.years).toBe(10); // not 11
    expect(august.meanPct).toBeCloseTo(1, 5);
    expect(august.winRatePct).toBe(100);
  });

  it('keeps the sign the completed history actually supports', () => {
    // Without the exclusion this mean is -0.91 and the cell reads -1, on a month
    // whose finished history is uniformly positive.
    const { timestamps, closes } = monthlySeries(COMPLETED, PARTIAL);
    const tech = technicals({ seasonality: computeSeasonality(timestamps, closes, NOW) });

    expect(scoreSeasonality(tech, NOW, 'currency')!.cell).toBe(1);
  });

  it('still counts the month once it has finished', () => {
    /**
     * The same series read from September, when August 2026 is complete and
     * belongs. Asserted through its EFFECT on the mean rather than through the
     * observation count, because the count is capped at SEASONALITY_YEARS and
     * would look identical whether the month was included or dropped.
     */
    const { timestamps, closes } = monthlySeries(COMPLETED, PARTIAL);
    const september = new Date('2026-09-10T12:00:00Z');

    expect(computeSeasonality(timestamps, closes, NOW)[8].meanPct).toBeCloseTo(1, 5);
    expect(computeSeasonality(timestamps, closes, september)[8].meanPct).toBeLessThan(0);
  });

  it('holds the sample to exactly the stated ten years', () => {
    /**
     * A1's rule names a ten-year average, so nine is as wrong as eleven. Both
     * were happening: a bare 10-year request leaves nine completed Augusts once
     * the in-progress one is dropped, which is why the caller now asks for
     * eleven.
     */
    const fifteen = Array.from({ length: 15 }, () => 101);
    const { timestamps, closes } = monthlySeries(fifteen, PARTIAL);

    expect(computeSeasonality(timestamps, closes, NOW)[8].years).toBe(SEASONALITY_YEARS);
  });

  it('applies the same exclusion to the profile behind the strip', () => {
    /**
     * The cell and the panel beside it are two implementations of one idea, and
     * both carried this bug — on screen the DXY row said August closed higher
     * 50% of the time while the panel next to it said 55%.
     */
    const bars = { timestamps: [] as number[], opens: [] as number[], highs: [] as number[], lows: [] as number[], closes: [] as number[] };
    const push = (t: number, close: number) => {
      bars.timestamps.push(t);
      bars.opens.push(close);
      bars.highs.push(close);
      bars.lows.push(close);
      bars.closes.push(close);
    };

    for (let i = 0; i < 8; i++) {
      const year = 2018 + i;
      push(Date.UTC(year, 6, 31) / 1000, 100);
      push(Date.UTC(year, 7, 31) / 1000, 101);
    }
    push(Date.UTC(2026, 6, 31) / 1000, 100);
    push(Date.UTC(2026, 7, 17) / 1000, 80); // in progress, and heavily down

    const august = buildProfile(bars, 'month', 10, NOW).buckets.get(8)!;
    expect(august.meanPct).toBeCloseTo(1, 5);
    expect(august.winRatePct).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// The published US-DOLLAR Asset Scorecard, end to end
// ---------------------------------------------------------------------------

/**
 * A1's US-DOLLAR card, 2026-08-17. It states four numbers — Technical -1,
 * Sentiment+COT +1, Fundamentals -8, total -8 — and lists every input behind
 * them, which makes it the strongest single acceptance test available.
 *
 * We read -9 on the same day. Three cells were wrong and this block is what
 * would have caught all three: seasonality (the partial month), COT (the
 * change-only rule) and the 2-year yield (the risk-asset sign).
 */
describe('parity: the US-DOLLAR card', () => {
  /** Every fundamental as printed on the card. Polarity is ours. */
  const FUNDAMENTALS: {
    name: string;
    actual: number;
    forecast: number;
    polarity: 1 | -1;
    expected: number;
  }[] = [
    // Economic growth — the card calls this block Very Bearish; it sums to -3.
    { name: 'GDP Growth QoQ', actual: 1.5, forecast: 2.1, polarity: 1, expected: -1 },
    { name: 'Manufacturing PMI', actual: 55.6, forecast: 54, polarity: 1, expected: 1 },
    { name: 'Services PMI', actual: 54.1, forecast: 54.5, polarity: 1, expected: -1 },
    { name: 'Retail Sales MoM', actual: -0.6, forecast: 0.1, polarity: 1, expected: -1 },
    { name: 'Consumer Confidence', actual: 90.8, forecast: 92.4, polarity: 1, expected: -1 },

    // Inflation — the card's fourth row is the 2-year yield, scored separately.
    { name: 'CPI YoY', actual: 3.4, forecast: 3.4, polarity: 1, expected: 0 },
    { name: 'PPI YoY', actual: 4.7, forecast: 4.9, polarity: 1, expected: -1 },
    { name: 'PCE YoY', actual: 3.3, forecast: 3.3, polarity: 1, expected: 0 },

    // Jobs market — Very Bearish, summing to -3.
    { name: 'Non-Farm Payroll', actual: -23, forecast: 85, polarity: 1, expected: -1 },
    { name: 'Unemployment Rate', actual: 4.1, forecast: 4.2, polarity: -1, expected: 1 },
    { name: 'Weekly Jobless Claims', actual: 209, forecast: 202, polarity: -1, expected: -1 },
    { name: 'ADP Employment Change', actual: 44, forecast: 68, polarity: 1, expected: -1 },
    { name: 'JOLTS Job Openings', actual: 7.36, forecast: 7.44, polarity: 1, expected: -1 },
  ];

  /** DXY sets no macroPolarity: the dollar's own strong data is bullish for it. */
  const cellFor = (f: (typeof FUNDAMENTALS)[number]) =>
    normalizeZero(ternarySign(f.actual, f.forecast) * f.polarity);

  it.each(FUNDAMENTALS)('$name: $actual vs $forecast -> $expected', (f) => {
    expect(cellFor(f)).toBe(f.expected);
  });

  /** 3.96% against a 21-day average of 4.12% — falling, which the card calls dovish. */
  const yield2y = () => normalizeZero(-scoreYield2y(3.96, 4.12)!.cell);

  it('reads the 2-year yield as -1 for the dollar', () => {
    expect(yield2y()).toBe(-1);
  });

  it('reproduces the three fundamental blocks', () => {
    const sum = (names: string[]) =>
      FUNDAMENTALS.filter((f) => names.includes(f.name)).reduce((t, f) => t + cellFor(f), 0);

    const growth = sum([
      'GDP Growth QoQ', 'Manufacturing PMI', 'Services PMI', 'Retail Sales MoM',
      'Consumer Confidence',
    ]);
    const inflation = sum(['CPI YoY', 'PPI YoY', 'PCE YoY']) + yield2y();
    const jobs = sum([
      'Non-Farm Payroll', 'Unemployment Rate', 'Weekly Jobless Claims',
      'ADP Employment Change', 'JOLTS Job Openings',
    ]);

    expect(growth).toBe(-3);
    expect(inflation).toBe(-2);
    expect(jobs).toBe(-3);
    expect(growth + inflation + jobs).toBe(-8); // card: Fundamentals -8
  });

  it('reproduces the stated Technical subtotal of -1', () => {
    /**
     * Card: "4H / Daily Chart Trend — Bearish", "Seasonality Trend — Bullish".
     * The 3-day sits below the 14-day and the 14-day is falling, so the two
     * agree and nothing is docked: -2. August is positive, so seasonality is +1.
     */
    const tech = technicals({
      smaFast: 99.2,
      smaSlow: 100.0,
      smaSlowPrior: 100.4,
      seasonality: { 8: { meanPct: 0.31, winRatePct: 60, years: 10 } },
    });

    const trend = scoreTrend(tech)!;
    const seasonality = scoreSeasonality(tech, NOW, 'currency')!;

    expect(trend.cell).toBe(-2);
    expect(seasonality.cell).toBe(1);
    expect(trend.cell + seasonality.cell).toBe(-1);
  });

  it('reproduces the stated Sentiment + COT subtotal of +1', () => {
    /**
     * Card: "COT - Net Positioning — Bullish", "COT - Latest Buys/Sells —
     * Bullish", "Crowd sentiment signal — Bearish", against Long 74.39% and a
     * Change of +0.95%. Only (+1 +1 -1) reaches their +1.
     *
     * The card publishes no retail percentage, so the crowded-long book below is
     * ours; what this pins is that a Bearish crowd row is worth exactly -1.
     */
    const series = cotSeries({
      specLongPct: 74.39,
      specLongPctChange: 0.95,
      retailLong: 7_400,
      retailShort: 2_600,
      retailNet: 4_800,
      retailLongPct: 74,
    });

    const cot = scoreCot(series, 'asset')!;
    const crowd = scoreCrowd(series)!;

    expect(cot.cell).toBe(2);
    expect(crowd.cell).toBe(-1);
    expect(cot.cell + crowd.cell).toBe(1);
  });

  it('totals -8 and labels it Very Bearish', () => {
    const technical = -1;
    const sentiment = 1;
    const fundamentals = -8;
    const total = technical + sentiment + fundamentals;

    expect(total).toBe(-8);
    expect(biasFromScore(total)).toBe('Very Bearish');
  });
});
