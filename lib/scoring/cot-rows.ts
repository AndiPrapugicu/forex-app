/**
 * Derives the COT page's view rows from raw series.
 *
 * Lives outside the component file because the COT page is a server component
 * and this runs during render. Exporting it from a 'use client' module made
 * Next reject the call at runtime ("attempted to call toCotRows() from the
 * server but toCotRows is on the client").
 */

import type { CotReport, CotSeries } from '@/lib/connectors/cftc';
import { scoreCot, scoreCrowd } from '@/lib/scoring/cot';

export interface CotRowView {
  contract: string;
  latest: CotReport;
  cotCell: number | null;
  cotPercentile: number | null;
  crowdCell: number | null;
  retailLongPct: number | null;
  divergence: boolean;
}

/** Derives the view rows from raw series, so the page stays a thin wrapper. */
export function toCotRows(data: Record<string, CotSeries>): CotRowView[] {
  return Object.values(data)
    .filter((s) => s.reports.length > 0)
    .map((series) => {
      const cot = scoreCot(series);
      const crowd = scoreCrowd(series);
      return {
        contract: series.contract,
        latest: series.reports[0],
        cotCell: cot?.cell ?? null,
        cotPercentile: cot?.percentile ?? null,
        crowdCell: crowd?.cell ?? null,
        retailLongPct: crowd?.retailLongPct ?? null,
        divergence: crowd?.divergence ?? false,
      };
    });
}

