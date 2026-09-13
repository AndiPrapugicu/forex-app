/**
 * COT Data History — every weekly report we hold, per contract.
 */

import { cotTicker } from '@/config/symbols.config';
import { fetchCotData } from '@/lib/connectors/cftc';
import { CotHistoryView, type CotHistorySeries } from '@/components/CotHistoryView';
import { PageHeader } from '@/components/primitives';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CotHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ contract?: string | string[] }>;
}) {
  const requested = (await searchParams).contract;
  const res = await fetchCotData();

  const header = (
    <PageHeader
      title="COT Data History"
      description="Large-speculator positioning, week by week"
      info={<>Surveyed each Tuesday, published the following Friday. The history is what the percentile on the COT page is measured against.</>}
    />
  );

  if (!res.ok) {
    return (
      <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
        {header}
        <Panel title="Unavailable">
          <EmptyState message="Could not load COT data" hint={res.error} />
        </Panel>
      </div>
    );
  }

  const series: CotHistorySeries[] = [...res.data.values()]
    .map((s) => ({
      contract: s.contract,
      ticker: cotTicker(s.contract),
      weeks: [...s.reports].reverse().map((r) => ({
        date: r.reportDate,
        specLong: r.specLong,
        specShort: r.specShort,
        specNet: r.specNet,
        specLongPct: r.specLongPct,
        specNetChange: r.specNetChange ?? null,
        retailLongPct: r.retailLongPct,
        openInterest: r.openInterest,
      })),
    }))
    .filter((s) => s.weeks.length > 0)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      {header}
      <CotHistoryView series={series} initial={typeof requested === 'string' ? requested : undefined} />
    </div>
  );
}
