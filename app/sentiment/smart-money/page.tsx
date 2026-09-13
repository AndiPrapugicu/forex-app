/**
 * Smart Money — large speculators against small traders, per contract.
 *
 * `payload.smartMoney` is built on every pipeline run; this is the first page
 * that shows it.
 */

import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { SmartMoneyTable } from '@/components/SmartMoneyTable';
import { Legend, MetricDescription, PageHeader } from '@/components/primitives';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function SmartMoneyPage() {
  const { smartMoney, matrix } = await runSetupsPipeline();
  const divergent = smartMoney.filter((r) => r.divergent).length;

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Smart Money"
        description={`Institutions against the crowd · ${divergent} of ${smartMoney.length} contracts on opposite sides`}
        updated={matrix.cotReportDate ? `CFTC report of ${matrix.cotReportDate}` : undefined}
        info={
          <>
            Both sides come from the same free CFTC file: large speculators (non-commercial) and small traders
            (non-reportable). Net is taken as a share of each side&rsquo;s own book, so a 30,000-lot contract and a
            300,000-lot one compare.
          </>
        }
      />
      <Panel
        title="Positioning spread"
        subtitle="Widest disagreement first"
        action={
          <Legend
            items={[
              { label: 'Institutions', color: 'var(--color-bull-cell)', shape: 'line' },
              { label: 'Crowd', color: 'var(--color-uncertain)', shape: 'line' },
            ]}
          />
        }
      >
        {smartMoney.length === 0 ? (
          <EmptyState message="No positioning data" hint="The CFTC file did not load." />
        ) : (
          <SmartMoneyTable rows={smartMoney} />
        )}
      </Panel>
      <MetricDescription>
        Both sides 60% long is agreement and says little. Institutions at +40 and the crowd at −40 is the setup worth
        looking at. Contracts where small traders hold fewer than 500 positions are left out — a percentage off a handful
        of contracts is arithmetic, not a crowd. This page does not score; the board&rsquo;s COT and Crowd columns do.
      </MetricDescription>
    </div>
  );
}
