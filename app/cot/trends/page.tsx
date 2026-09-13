/**
 * COT Trends — net speculator change over 1, 4, 13 and 26 weeks.
 *
 * Plain differences of the net position between reports. No threshold and no
 * score: a trend page that invented a "strong trend" cut would be a rule nobody
 * measured.
 */

import { cotTicker } from '@/config/symbols.config';
import { fetchCotData, latestReportDate } from '@/lib/connectors/cftc';
import { CotTrendsTable, type CotTrendRow } from '@/components/CotFlowTable';
import { MetricDescription, PageHeader } from '@/components/primitives';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

const HORIZONS = [1, 4, 13, 26] as const;

export default async function CotTrendsPage() {
  const res = await fetchCotData();
  const reportDate = res.ok ? latestReportDate(res.data) : null;

  const rows: CotTrendRow[] = res.ok
    ? [...res.data.values()].flatMap((s) => {
        const reports = s.reports; // newest first
        if (reports.length === 0) return [];
        const net = reports[0].specNet;
        const change = Object.fromEntries(
          HORIZONS.map((h) => [h, reports[h] ? net - reports[h].specNet : null]),
        ) as CotTrendRow['change'];
        return [
          {
            contract: s.contract,
            ticker: cotTicker(s.contract),
            net,
            change,
            path: reports.slice(0, 26).map((r) => r.specNet).reverse(),
          },
        ];
      })
    : [];

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="COT Trends"
        description="How far large speculators have moved over one week to six months"
        updated={reportDate ? `Report ${reportDate}` : undefined}
      />
      <Panel title="Net change by horizon" subtitle="Contracts, sorted by the 4-week change">
        {!res.ok ? <EmptyState message="Could not load COT data" hint={res.error} /> : <CotTrendsTable rows={rows} />}
      </Panel>
      <MetricDescription>
        Each column is the current net position minus the net position that many reports ago. A contract building in the
        same direction across every horizon is a trend; one whose 1-week change fights its 13-week change is a turn, or
        noise. This page does not score — the board&rsquo;s COT column reads the weekly change in long share.
      </MetricDescription>
    </div>
  );
}
