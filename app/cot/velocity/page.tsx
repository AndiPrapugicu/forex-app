/**
 * COT Velocity — how unusual this week's move is for each contract.
 *
 * `readAllCotFlows` was only ever shown inside an expanded COT row.
 */

import { fetchCotData, latestReportDate } from '@/lib/connectors/cftc';
import { readAllCotFlows } from '@/lib/scoring/cot-flow';
import { CotVelocityTable } from '@/components/CotFlowTable';
import { MetricDescription, PageHeader } from '@/components/primitives';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CotVelocityPage() {
  const res = await fetchCotData();
  const flows = res.ok ? readAllCotFlows(Object.fromEntries(res.data)) : [];
  const reportDate = res.ok ? latestReportDate(res.data) : null;

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="COT Velocity"
        description="This week's speculator flow, ranked against each contract's own history"
        updated={reportDate ? `Report ${reportDate}` : undefined}
      />
      <Panel title="Weekly flow" subtitle="Most unusual first. Tap a row for the full reading.">
        {!res.ok ? (
          <EmptyState message="Could not load COT data" hint={res.error} />
        ) : (
          <CotVelocityTable flows={flows} />
        )}
      </Panel>
      <MetricDescription>
        <p>
          Absolute contract counts do not compare across markets — gold moves more contracts in a quiet week than the franc
          does in a busy one. The percentile ranks this week&rsquo;s net change against the same contract&rsquo;s past weekly
          changes, which is the only ranking under which the kiwi can outrank gold.
        </p>
        <p className="mt-2">
          <strong className="text-[var(--color-text)]">Accumulation</strong> is longs added and shorts cut;{' '}
          <strong className="text-[var(--color-text)]">two-sided build</strong> and{' '}
          <strong className="text-[var(--color-text)]">liquidation</strong> are both books moving together, where the net
          hides a disagreement. ↩ marks a move against their own position — covering, not conviction.
        </p>
      </MetricDescription>
    </div>
  );
}
