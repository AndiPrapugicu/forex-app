/**
 * Crowd Sentiment.
 *
 * Reads the COT data `runSetupsPipeline` already fetched, so this page costs no
 * additional upstream request — same arrangement as /macro.
 */

import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { buildCrowdRows, buildRetailPairRows } from '@/lib/scoring/sentiment';
import { SentimentPanel } from '@/components/SentimentPanel';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function SentimentPage() {
  const { cot, matrix, retailPositioning } = await runSetupsPipeline();
  const rows = buildCrowdRows(cot);
  /**
   * The broker feed the Crowd column already scores from, rendered as its own
   * list. It is the population A1's Retail Sentiment page shows — and the only
   * one that covers PAIRS, which is what the CFTC rows structurally cannot: a
   * weekly futures file has a euro contract, not a EURUSD book.
   */
  const pairs = buildRetailPairRows(retailPositioning);

  if (rows.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
        <Panel title="Crowd sentiment">
          <EmptyState
            message="No positioning data"
            hint="The CFTC file is the only source here. Try npm run ingest:dry to see whether it answered."
          />
        </Panel>
      </div>
    );
  }

  return <SentimentPanel rows={rows} pairs={pairs} reportDate={matrix.cotReportDate} />;
}
