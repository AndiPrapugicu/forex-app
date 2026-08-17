/**
 * Crowd sentiment: what small traders are doing, read against them.
 *
 * WHERE THE NUMBER COMES FROM, AND WHAT IT IS NOT. EdgeFinder's Crowd Sentiment
 * is retail broker positioning, refreshed every 30 minutes, from a vendor they
 * do not name. There is no free equivalent — Myfxbook's API needs an account and
 * its terms ask that anything built on it be free, IG/DailyFX returns 403 to
 * anything that is not a browser, FX Blue publishes no JSON, and Dukascopy's
 * SWFX endpoint is undocumented enough that wiring it would mean shipping a
 * scrape that breaks silently.
 *
 * So this reads the CFTC's NON-REPORTABLE positions instead: traders too small
 * to be required to report, published weekly in the same free file as the
 * institutional data. It is genuinely small-trader money and genuinely
 * contrarian, and it is futures rather than spot, weekly rather than half-hourly,
 * and always at least three days old. The page says all of that; the point is
 * that the difference is stated rather than papered over.
 *
 * Pure and server-safe, in the same spirit as `cot-rows.ts` — the page is a
 * server component and cannot call into a 'use client' module during render.
 */

import { COT_PERCENTILE_BUCKETS, CROWD_LONG_PCT_BUCKETS } from '@/config/setups.config';
import type { CotSeries } from '@/lib/connectors/cftc';
import { percentileRank, scoreCrowd } from '@/lib/scoring/cot';
import { cotTicker } from '@/config/symbols.config';

/** How many weekly reports the retail history sparkline draws. */
export const RETAIL_HISTORY_WEEKS = 52;

export interface CrowdRow {
  contract: string;
  /** Short ticker — "CAD", not "CANADIAN DOLLAR". Bar widths depend on it. */
  ticker: string;

  retailLongPct: number;
  retailLong: number;
  retailShort: number;
  /** The contrarian vote this produces on the scorecard: -1, 0 or +1. */
  cell: number;

  /** Large speculators, for the crowd-vs-smart-money read. */
  specLongPct: number;
  specNetPct: number;
  retailNetPct: number;
  /** Spec net % minus retail net %. Widest disagreement is the interesting row. */
  spread: number;
  /** Positioned on literally opposite sides, not merely by different amounts. */
  divergent: boolean;

  /** Where today's retail long share sits in its own 3-year history, 0..100. */
  percentile: number;
  /** Oldest first, so the sparkline reads left to right. */
  history: number[];

  reportDate: string;
  explanation: string;
}

/** Net as a share of the book, so contracts of wildly different size compare. */
function netPct(long: number, short: number): number {
  const total = long + short;
  return total === 0 ? 0 : ((long - short) / total) * 100;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function buildCrowdRows(cot: Map<string, CotSeries>): CrowdRow[] {
  const rows: CrowdRow[] = [];

  for (const series of cot.values()) {
    const latest = series.reports[0];
    if (!latest) continue;

    /**
     * `scoreCrowd` owns the participation floor and the +/-60/40 bands. Calling
     * it rather than re-deriving them is what stops this page from disagreeing
     * with the cell it is supposed to explain — and it returns null for a
     * contract with negligible small-trader money, which is the same reason
     * that cell is blank on the scorecard.
     */
    const crowd = scoreCrowd(series);
    if (!crowd) continue;

    // Oldest-first, and only the window the sparkline draws.
    const history = series.reports
      .slice(0, RETAIL_HISTORY_WEEKS)
      .map((r) => r.retailLongPct)
      .reverse();

    const specNetPct = netPct(latest.specLong, latest.specShort);
    const retailNetPct = netPct(latest.retailLong, latest.retailShort);

    rows.push({
      contract: series.contract,
      ticker: cotTicker(series.contract),
      retailLongPct: crowd.retailLongPct,
      retailLong: latest.retailLong,
      retailShort: latest.retailShort,
      cell: crowd.cell,
      specLongPct: round1(latest.specLongPct),
      specNetPct: round1(specNetPct),
      retailNetPct: round1(retailNetPct),
      spread: round1(specNetPct - retailNetPct),
      divergent: crowd.divergence,
      /**
       * Percentile of the LONG SHARE against its own history, not of the net
       * contract count. A share is already normalised, so it stays comparable
       * as a contract's open interest grows over three years.
       */
      percentile: Math.round(
        percentileRank(
          latest.retailLongPct,
          series.reports.map((r) => r.retailLongPct),
        ),
      ),
      history,
      reportDate: latest.reportDate,
      explanation: crowd.explanation,
    });
  }

  return rows;
}

/** The bands the cell actually uses, exported so the UI can draw them. */
export const CROWD_BANDS = CROWD_LONG_PCT_BUCKETS;
export const PERCENTILE_BANDS = COT_PERCENTILE_BUCKETS;

/**
 * How stretched the crowd is, for sorting.
 *
 * Distance from a balanced book, not from the scoring band — a contract at 59%
 * long scores 0 but is far more interesting than one at 51%, and sorting by the
 * cell would file them together.
 */
export function crowdExtremity(row: CrowdRow): number {
  return Math.abs(row.retailLongPct - 50);
}
