/**
 * Risk and concentration — is capital risk-seeking, and how many real trades is the board.
 */

import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { CLUSTER_THRESHOLD } from '@/lib/scoring/correlation';
import { RISK_BANDS } from '@/lib/scoring/market';
import { ConcentrationPanel, RiskPanel } from '@/components/MacroPanels';
import { PageHeader } from '@/components/primitives';

export const dynamic = 'force-dynamic';

export default async function RiskPage() {
  const { risk, clusters, matrix } = await runSetupsPipeline();

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Risk & Concentration"
        description="Cross-asset risk appetite, and the board grouped into the trades it actually is"
        updated={`Updated ${matrix.generatedAtUtc.slice(11, 16)} UTC`}
        info={<>Both panels are our own reads, not reproductions of an A1 page. Neither feeds a symbol&rsquo;s score.</>}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <RiskPanel risk={risk} bands={RISK_BANDS} />
        <ConcentrationPanel clusters={clusters} threshold={CLUSTER_THRESHOLD} />
      </div>
    </div>
  );
}
