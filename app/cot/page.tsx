/**
 * COT positioning page.
 *
 * Reads straight from the CFTC connector rather than the setups pipeline — this
 * page needs the full contract detail, not the two derived cells the matrix uses.
 */

import { fetchCotData, latestReportDate, reportAgeDays } from '@/lib/connectors/cftc';
import { CotPanel } from '@/components/CotPanel';
import { PageHeader } from '@/components/primitives';
import { toCotRows } from '@/lib/scoring/cot-rows';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CotPage() {
  const res = await fetchCotData();

  const header = (updated?: string) => (
    <PageHeader
      title="Latest COT Report"
      description="Commitments of Traders — who is holding what, from the CFTC's weekly report."
      updated={updated}
      info={
        <>
          Positions are surveyed on Tuesday and published the following Friday, so this report always lags the
          market by at least three days. It shows large speculators (hedge funds, CTAs) and small traders; commercial
          hedgers are left out because they trade to offset business exposure, not to take a view.
        </>
      }
    />
  );

  if (!res.ok) {
    return (
      <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
        {header()}
        <Panel title="Unavailable">
          <EmptyState message="Could not load COT data" hint={`${res.error}. The CFTC publishes weekly on Fridays.`} />
        </Panel>
      </div>
    );
  }

  const reportDate = latestReportDate(res.data);
  const ageDays = reportDate ? reportAgeDays(reportDate) : null;
  const rows = toCotRows(Object.fromEntries(res.data));

  // The staleness note is mandatory, not decorative: presenting a Tuesday survey
  // as live positioning would misrepresent what it is.
  const updated =
    reportDate === null
      ? undefined
      : `Report ${reportDate}` +
        (ageDays !== null ? ` · ${ageDays} days old` : '') +
        (ageDays !== null && ageDays > 14 ? ' — unusually stale, the CFTC may have delayed publication' : '') +
        (res.degraded ? ` · ${res.degraded}` : '');

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      {header(updated)}
      <CotPanel rows={rows} />
    </div>
  );
}
