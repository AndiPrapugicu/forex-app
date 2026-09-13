/**
 * Asset Scorecard index — every symbol, grouped by what it is.
 *
 * The scorecard used to be reachable only by clicking a row on Top Setups,
 * which made it a drill-down rather than a place. This is the tab: pick an
 * asset class, pick a symbol, open its card.
 *
 * Built from the `matrix.rows` `runSetupsPipeline` already produces, so it costs
 * nothing beyond the render. Prices go live in the browser.
 */

import { ALL_SYMBOLS } from '@/config/symbols.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { CLASS_ORDER, assetClassOf } from '@/lib/scoring/asset-class';
import { ScorecardIndex, type ScorecardEntry } from '@/components/ScorecardIndex';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ScorecardIndexPage() {
  const { matrix } = await runSetupsPipeline();

  const byRow = new Map(matrix.rows.map((r) => [r.symbol, r]));

  const entries: ScorecardEntry[] = ALL_SYMBOLS.flatMap((def) => {
    const row = byRow.get(def.symbol);
    if (!row) return [];
    return [
      {
        symbol: def.symbol,
        label: def.label,
        assetClass: assetClassOf(def.symbol, def.kind),
        kind: def.kind,
        totalScore: row.totalScore,
        bias: row.bias,
        populated: row.populated,
        price: row.price,
        changePct: row.changePct,
      },
    ];
  });

  if (entries.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
        <Panel title="Asset scorecard">
          <EmptyState
            message="No symbols scored"
            hint="Every upstream is down. npm run ingest:dry prints which."
          />
        </Panel>
      </div>
    );
  }

  return (
    <ScorecardIndex
      entries={entries}
      classOrder={[...CLASS_ORDER]}
      generatedAtUtc={matrix.generatedAtUtc}
    />
  );
}
