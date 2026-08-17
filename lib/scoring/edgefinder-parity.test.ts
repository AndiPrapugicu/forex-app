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
  TREND_SMA,
  biasFromScore,
  maxScoreForKind,
} from '@/config/setups.config';
import {
  ALL_SYMBOLS,
  GOLD_POLARITY,
  INDUSTRIAL_POLARITY,
  RISK_ASSET_POLARITY,
} from '@/config/symbols.config';
import { normalizeZero, resolveSeries, ternarySign } from '@/lib/scoring/discrete';
import { scoreCot, scoreCrowd } from '@/lib/scoring/cot';
import { scoreSeasonality, scoreTrend, scoreYield2y } from '@/lib/scoring/technical';
import type { CotReport, CotSeries } from '@/lib/connectors/cftc';
import type { Technicals } from '@/lib/connectors/technicals';

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
   * THE CROSSOVER IS THE SCORE, the slope is only a modifier.
   *
   * We first read their "Slope Upward: +1" line as an addend and produced +/-3,
   * which put Gold on Trend +3 — a value their model cannot output. Their
   * combination rule only makes sense if the crossover alone is the baseline,
   * otherwise stating the adjustment separately would be redundant with adding.
   *
   * All four combinations are enumerated because that is the whole rule.
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

  it('treats SILVER and PLATINUM as havens, not as industrial metals', () => {
    /**
     * Their inflation page groups silver with oil and copper as "industrial
     * commodities", and we followed that. Their PRODUCT does not: the SILVER row
     * on Top Setups is identical to GOLD in every macro column — GDP +1,
     * mPMI -1, sPMI +1, NFP +1, unemployment -1, claims -1, ADP +1, JOLTS +1 —
     * differing only on COT.
     *
     * Scoring silver as industrial flipped the sign on eight of its cells.
     */
    for (const sym of ['XAGUSD', 'XPTUSD']) {
      const def = ALL_SYMBOLS.find((s) => s.symbol === sym)!;
      expect(def.macroPolarity?.growth, `${sym} growth`).toBe(-1);
      expect(def.macroPolarity?.jobs, `${sym} jobs`).toBe(-1);
    }

    // Oil stays industrial — demand-driven, and A1's reasoning there holds.
    const wti = ALL_SYMBOLS.find((s) => s.symbol === 'WTIUSD')!;
    expect(wti.macroPolarity?.growth).toBe(1);
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

describe('interest rates: US 2-year vs its 7-day average, for non-FX assets', () => {
  it('reads a yield above its average as a headwind', () => {
    // "If price is above the moving average, -1." Already expressed from the
    // asset's point of view, so callers must NOT invert it again.
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
 * The strongest parity evidence we have: seven rows read straight off an
 * EdgeFinder Top Setups screenshot, each summing to the total they display.
 *
 * This pins the COMPOSITION rule — a plain unweighted sum of all 18 columns,
 * with no normalisation, no scaling and no cap. If someone later adds a weight
 * or a clamp, these break.
 */
describe('A1 totals are a plain sum of the 18 columns', () => {
  const ROWS: Record<string, { cells: number[]; total: number; bias: string }> = {
    //         trend seas cot crowd gdp mpmi spmi rtl conf cpi ppi pce rate nfp unemp clm adp jolts
    GBPUSD: { cells: [2, -1, 0, 1, 1, -2, 2, 1, 2, 0, 2, 0, 1, 1, 0, -1, 1, 1], total: 11, bias: 'Very Bullish' },
    GBPCHF: { cells: [2, -1, 0, 1, -1, 2, 0, 2, 0, -1, 2, 0, 1, 0, 2, 0, 0, 0], total: 9, bias: 'Very Bullish' },
    EURUSD: { cells: [2, 1, 0, 1, 2, -2, 2, -1, 1, 1, 1, 0, 1, 1, -2, -1, 1, 1], total: 9, bias: 'Very Bullish' },
    GOLD: { cells: [2, 1, 2, -1, 1, -1, 1, 0, 1, 1, 1, 0, -1, 1, -1, -1, 1, 1], total: 8, bias: 'Very Bullish' },
    AUDUSD: { cells: [2, -1, 0, 1, 0, 0, 2, 0, 2, 0, 0, 0, 0, 1, -1, -1, 1, 1], total: 7, bias: 'Very Bullish' },
    SILVER: { cells: [2, 1, 0, -1, 1, -1, 1, 0, 1, 1, 1, 0, -1, 1, -1, -1, 1, 1], total: 6, bias: 'Bullish' },
    NZDUSD: { cells: [2, -1, -2, 1, 1, 0, 0, 1, 0, 2, 0, 0, 1, 1, -2, -1, 1, 1], total: 5, bias: 'Bullish' },
  };

  it.each(Object.entries(ROWS))('%s sums to its published total', (_sym, { cells, total }) => {
    expect(cells).toHaveLength(18);
    expect(cells.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it('agrees with our bias bands on every one of them', () => {
    for (const [sym, { total, bias }] of Object.entries(ROWS)) {
      expect(biasFromScore(total), sym).toBe(bias);
    }
  });

  it('confirms trend never exceeds +/-2 in the live product', () => {
    // Independent confirmation of the trend fix, from their own output rather
    // than from re-reading their prose.
    for (const { cells } of Object.values(ROWS)) {
      expect(Math.abs(cells[0])).toBeLessThanOrEqual(2);
    }
  });

  it('confirms seasonality never exceeds +/-1, including on GOLD and SILVER', () => {
    for (const [sym, { cells }] of Object.entries(ROWS)) {
      expect(Math.abs(cells[1]), sym).toBeLessThanOrEqual(1);
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
