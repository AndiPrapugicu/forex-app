/**
 * COT positioning page.
 *
 * Reads straight from the CFTC connector rather than the setups pipeline — this
 * page needs the full contract detail, not the two derived cells the matrix uses.
 */

import { fetchCotData, latestReportDate, reportAgeDays } from '@/lib/connectors/cftc';
import { CotPanel } from '@/components/CotPanel';
import { toCotRows } from '@/lib/scoring/cot-rows';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CotPage() {
  const res = await fetchCotData();

  if (!res.ok) {
    return (
      <div className="px-4 py-4">
        <h1 className="mb-4 text-lg font-bold">COT Positioning</h1>
        <Panel title="Unavailable">
          <EmptyState
            message="Could not load COT data"
            hint={`${res.error}. The CFTC publishes weekly on Fridays.`}
          />
        </Panel>
      </div>
    );
  }

  const reportDate = latestReportDate(res.data);
  const rows = toCotRows(Object.fromEntries(res.data));

  return (
    <div className="px-4 py-4">
      <header className="mb-4">
        <h1 className="text-lg font-bold">COT Positioning</h1>
        <p className="text-xs text-[var(--color-faint)]">
          Commitments of Traders — who is holding what, from the CFTC&rsquo;s weekly report.
          {res.degraded && ` (${res.degraded})`}
        </p>
      </header>

      <CotPanel
        rows={rows}
        reportDate={reportDate}
        ageDays={reportDate ? reportAgeDays(reportDate) : null}
      />
    </div>
  );
}
