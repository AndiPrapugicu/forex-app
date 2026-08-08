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
  COT_PERCENTILE_BUCKETS,
  CROWD_LONG_PCT_BUCKETS,
  CELL_MAX,
  CELL_MIN,
} from '@/config/setups.config';
import type { CotReport, CotSeries } from '@/lib/connectors/cftc';
import { clamp } from '@/lib/scoring/surprise';

export interface CotScore {
  /** -2..+2 for the COT column. */
  cell: number;
  /** Where the current net position sits in its own range, 0..100. */
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
  /** -2..+2 for the Crowd Sentiment column. Inverted by design. */
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

function bucketPercentile(p: number): number {
  if (p >= COT_PERCENTILE_BUCKETS.veryBullish) return 2;
  if (p >= COT_PERCENTILE_BUCKETS.bullish) return 1;
  if (p <= COT_PERCENTILE_BUCKETS.veryBearish) return -2;
  if (p <= COT_PERCENTILE_BUCKETS.bearish) return -1;
  return 0;
}

/**
 * Scores speculator positioning for one contract.
 *
 * Returns null when there is too little history to rank against. Below ~26
 * weeks a percentile is arithmetic rather than information, and reporting a
 * confident +2 off eight data points would be worse than showing nothing.
 */
export function scoreCot(series: CotSeries | undefined): CotScore | null {
  if (!series || series.reports.length === 0) return null;

  const latest = series.reports[0];
  const history = series.reports.map((r) => r.specNet);

  const MIN_HISTORY = 26;
  if (history.length < MIN_HISTORY) return null;

  const percentile = percentileRank(latest.specNet, history);
  const cell = bucketPercentile(percentile);

  const position = latest.specNet >= 0 ? 'net long' : 'net short';
  const where =
    percentile >= 80
      ? 'near the top of its 3-year range'
      : percentile >= 60
        ? 'in the upper half of its range'
        : percentile <= 20
          ? 'near the bottom of its 3-year range'
          : percentile <= 40
            ? 'in the lower half of its range'
            : 'mid-range';

  return {
    cell,
    percentile: Math.round(percentile),
    net: latest.specNet,
    netChange: latest.specNetChange,
    specLongPct: Math.round(latest.specLongPct * 10) / 10,
    reportDate: latest.reportDate,
    sampleSize: history.length,
    explanation:
      `Large speculators are ${position} ${Math.abs(latest.specNet).toLocaleString()} contracts, ` +
      `${where} (${Math.round(percentile)}th percentile of ${history.length} weeks).`,
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

  let cell: number;
  if (pct >= CROWD_LONG_PCT_BUCKETS.veryBearish) cell = -2;
  else if (pct >= CROWD_LONG_PCT_BUCKETS.bearish) cell = -1;
  else if (pct <= CROWD_LONG_PCT_BUCKETS.veryBullish) cell = 2;
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
 * long EUR and short JPY both argue for EURJPY upside. Clamped back into the
 * cell range because two opposing +/-2 legs would otherwise produce +/-4.
 *
 * USD is the exception: `USD INDEX` positioning already expresses the dollar
 * against a basket, so when USD is the quote leg its own contract is used
 * directly rather than being derived.
 */
export function combineLegs(baseCell: number | null, quoteCell: number | null): number | null {
  if (baseCell === null && quoteCell === null) return null;
  return clamp((baseCell ?? 0) - (quoteCell ?? 0), CELL_MIN, CELL_MAX);
}
