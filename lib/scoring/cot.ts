/**
 * Turns COT positioning into scorecard cells.
 *
 * Two independent readings from the same report:
 *
 *   COT   — large speculators, read WITH the trend. Where does the current net
 *           position sit within this contract's own 3-year range?
 *   Crowd — small traders, read AGAINST it. A crowded retail long is a bearish
 *           signal, so the mapping is deliberately inverted.
 *
 * The percentile matters more than it might look. A net long of 200,000
 * contracts is meaningless in isolation — gold routinely runs several hundred
 * thousand while the Swiss franc trades in tens of thousands. Ranking a position
 * against its own history is what makes one number comparable across contracts.
 */

import {
  COT_LONG_PCT_BUCKETS,
  COT_PERCENTILE_BUCKETS,
  CROWD_LONG_PCT_BUCKETS,
} from '@/config/setups.config';
import type { CotReport, CotSeries } from '@/lib/connectors/cftc';
import { clamp } from '@/lib/scoring/surprise';

export interface CotScore {
  /**
   * The contribution for this contract.
   *
   * FX legs: -1..+1, the weekly change only.
   * Everything else: -2..+2, weekly change plus net positioning.
   */
  cell: number;
  /**
   * Long share vs the 55/45 thresholds. Scored for indices, commodities and
   * crypto; computed but NOT scored for FX, where A1 uses only the weekly change.
   */
  netPositioning: number;
  /** Sign of the week-on-week change. A1's "COT - Latest Buys/Sells". */
  latestBuysSells: number;
  /**
   * Where the net position sits in its own 3-year range, 0..100.
   *
   * DISPLAY ONLY — it no longer drives the cell. Retained because it is the more
   * informative measure: gold's 197,634 net long looks overwhelming until you see
   * it is the 39th percentile of its own history.
   */
  percentile: number;
  net: number;
  netChange: number | null;
  specLongPct: number;
  reportDate: string;
  /** Weeks of history the percentile was computed from. */
  sampleSize: number;
  explanation: string;
}

export interface CrowdScore {
  /** -1..+1 for the Crowd Sentiment column. Inverted by design. */
  cell: number;
  retailLongPct: number;
  reportDate: string;
  /** True when retail and large specs are positioned on opposite sides. */
  divergence: boolean;
  explanation: string;
}

/**
 * Percentile rank of `value` within `history`, 0..100.
 *
 * Uses the midpoint convention (below + half of equal) so that a value sitting
 * exactly at the median scores 50 rather than being biased by ties — relevant
 * here because net positions repeat across quiet weeks.
 */
export function percentileRank(value: number, history: number[]): number {
  if (history.length === 0) return 50;

  let below = 0;
  let equal = 0;
  for (const h of history) {
    if (h < value) below++;
    else if (h === value) equal++;
  }
  return ((below + equal / 2) / history.length) * 100;
}

/** Long share -> +/-1. Gold at 85.4% long reads +1. */
function bucketLongPct(pct: number): number {
  if (pct >= COT_LONG_PCT_BUCKETS.bullish) return 1;
  if (pct <= COT_LONG_PCT_BUCKETS.bearish) return -1;
  return 0;
}

/** Human label for where the percentile sits. Display only. */
function describePercentile(p: number): string {
  if (p >= COT_PERCENTILE_BUCKETS.veryBullish) return 'near the top of its 3-year range';
  if (p >= COT_PERCENTILE_BUCKETS.bullish) return 'in the upper half of its range';
  if (p <= COT_PERCENTILE_BUCKETS.veryBearish) return 'near the bottom of its 3-year range';
  if (p <= COT_PERCENTILE_BUCKETS.bearish) return 'in the lower half of its range';
  return 'mid-range';
}

/**
 * Scores speculator positioning for one contract.
 *
 * Returns null when there is too little history to rank against. Below ~26
 * weeks a percentile is arithmetic rather than information, and reporting a
 * confident +2 off eight data points would be worse than showing nothing.
 */
export function scoreCot(
  series: CotSeries | undefined,
  /**
   * FX legs score the weekly change alone; every other asset class adds net
   * positioning on top. This is A1's split, not ours
   * (a1trading.com/edgefinder/cot-data/), and it matters: scoring net
   * positioning on both legs of a pair double-counted a signal they read once.
   */
  kind: 'fx' | 'asset' = 'fx',
): CotScore | null {
  if (!series || series.reports.length === 0) return null;

  const latest = series.reports[0];
  const history = series.reports.map((r) => r.specNet);

  // Percentile is display-only, so a short history no longer blocks scoring.
  const percentile = history.length > 0 ? percentileRank(latest.specNet, history) : 50;

  const netPositioning = bucketLongPct(latest.specLongPct);

  /**
   * A1's "Latest Buys/Sells" reads the change in LONG SHARE, not the change in
   * net contracts — their rule is "weekly % change in non-commercial long
   * positioning", and their Net % Change column reconciles to exactly that.
   *
   * We scored the net-contract change, which is a different measure: longs and
   * shorts growing together moves net sharply while the share barely shifts.
   * Falls back to the contract change only when the share is unavailable.
   */
  const change = latest.specLongPctChange ?? latest.specNetChange;
  const latestBuysSells = change === null || change === 0 ? 0 : change > 0 ? 1 : -1;

  const scored = kind === 'fx' ? latestBuysSells : netPositioning + latestBuysSells;
  const bound = kind === 'fx' ? 1 : 2;
  const cell = Math.max(-bound, Math.min(bound, scored));

  const position = latest.specNet >= 0 ? 'net long' : 'net short';
  const where = describePercentile(percentile);

  return {
    cell,
    netPositioning,
    latestBuysSells,
    percentile: Math.round(percentile),
    net: latest.specNet,
    netChange: latest.specNetChange,
    specLongPct: Math.round(latest.specLongPct * 10) / 10,
    reportDate: latest.reportDate,
    sampleSize: history.length,
    explanation:
      `Large speculators are ${latest.specLongPct.toFixed(1)}% long, ${position} ` +
      `${Math.abs(latest.specNet).toLocaleString()} contracts` +
      (latest.specNetChange !== null
        ? `, ${latest.specNetChange > 0 ? 'adding' : 'trimming'} this week`
        : '') +
      `. For context that position is ${where} (${Math.round(percentile)}th percentile)` +
      (kind === 'fx' ? ', which is shown but not scored for currencies.' : '.'),
  };
}

/**
 * Scores small-trader positioning, INVERTED.
 *
 * The sign flip is the whole point: when the crowd is heavily long, that is read
 * as bearish. Anyone editing this should keep the inversion in the bucket
 * mapping rather than negating the result, so the thresholds stay readable.
 */
export function scoreCrowd(series: CotSeries | undefined): CrowdScore | null {
  if (!series || series.reports.length === 0) return null;

  const latest: CotReport = series.reports[0];
  const pct = latest.retailLongPct;

  // Contracts with negligible small-trader participation give a meaningless
  // percentage, so no signal is better than a spurious one.
  if (latest.retailLong + latest.retailShort < 500) return null;

  // Ternary and inverted: a crowd leaning long is a bearish signal.
  let cell: number;
  if (pct >= CROWD_LONG_PCT_BUCKETS.bearish) cell = -1;
  else if (pct <= CROWD_LONG_PCT_BUCKETS.bullish) cell = 1;
  else cell = 0;

  // Retail and smart money on opposite sides is the setup worth flagging.
  const retailLong = latest.retailNet > 0;
  const specLong = latest.specNet > 0;
  const divergence = retailLong !== specLong;

  const crowding =
    pct >= 70 ? 'heavily long' : pct >= 60 ? 'leaning long' : pct <= 30 ? 'heavily short' : pct <= 40 ? 'leaning short' : 'balanced';

  return {
    cell,
    retailLongPct: Math.round(pct * 10) / 10,
    reportDate: latest.reportDate,
    divergence,
    explanation:
      `Small traders are ${crowding} (${pct.toFixed(1)}% long)` +
      (cell !== 0 ? `, read contrarian as ${cell > 0 ? 'bullish' : 'bearish'}` : '') +
      (divergence ? '. Positioned opposite large speculators.' : '.'),
  };
}

/**
 * COT cell for a currency pair.
 *
 * Both legs have their own contract, so the pair reading is the difference —
 * institutions adding EUR longs and trimming JPY longs both argue for EURJPY
 * upside. Each leg is +/-1 (the weekly change), so the pair lands in +/-2 and the
 * clamp is a guard rather than something that normally bites.
 *
 * USD is the exception: `USD INDEX` positioning already expresses the dollar
 * against a basket, so when USD is the quote leg its own contract is used
 * directly rather than being derived.
 */
export function combineLegs(
  baseCell: number | null,
  quoteCell: number | null,
  bound = 2,
): number | null {
  if (baseCell === null && quoteCell === null) return null;
  return clamp((baseCell ?? 0) - (quoteCell ?? 0), -bound, bound);
}
