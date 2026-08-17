/**
 * Crowd Sentiment.
 *
 * Reads the COT data `runSetupsPipeline` already fetched, so this page costs no
 * additional upstream request — same arrangement as /macro.
 */

import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { buildCrowdRows } from '@/lib/scoring/sentiment';
import { SentimentPanel } from '@/components/SentimentPanel';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function SentimentPage() {
  const { cot, matrix } = await runSetupsPipeline();
  const rows = buildCrowdRows(cot);

  if (rows.length === 0) {
    return (
      <div className="px-4 py-4">
        <Panel title="Crowd sentiment">
          <EmptyState
            message="No positioning data"
            hint="The CFTC file is the only source here. Try npm run ingest:dry to see whether it answered."
          />
        </Panel>
      </div>
    );
  }

  return <SentimentPanel rows={rows} reportDate={matrix.cotReportDate} />;
}
