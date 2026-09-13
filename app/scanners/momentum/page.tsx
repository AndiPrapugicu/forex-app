/**
 * Momentum & Volatility — moving-average state and daily range for every symbol.
 *
 * Reads `payload.technicals`, which the Trend column already fetched.
 */

import { ALL_SYMBOLS } from '@/config/symbols.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { assetClassOf } from '@/lib/scoring/asset-class';
import { MomentumTable, type MomentumRow } from '@/components/MomentumTable';
import { MetricDescription, PageHeader } from '@/components/primitives';
import { Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

const distance = (price: number, avg: number | null) =>
  avg === null || avg === 0 ? null : Math.round(((price - avg) / avg) * 10000) / 100;

export default async function MomentumPage() {
  const { technicals, matrix } = await runSetupsPipeline();

  const rows: MomentumRow[] = ALL_SYMBOLS.flatMap((def) => {
    const t = technicals.get(def.symbol);
    if (!t) return [];
    return [
      {
        symbol: def.symbol,
        label: def.label,
        assetClass: assetClassOf(def.symbol, def.kind),
        price: t.price,
        vs20: distance(t.price, t.sma20),
        vs50: distance(t.price, t.sma50),
        vs100: distance(t.price, t.sma100),
        vs200: distance(t.price, t.sma200),
        aboveCount: t.aboveCount,
        smaCount: t.smaCount,
        realizedVolPct: t.realizedVolPct,
        avgDailyMove7Pct: t.avgDailyMove7Pct,
        avgDailyMove90Pct: t.avgDailyMove90Pct,
      },
    ];
  });

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Momentum & Volatility"
        description={`${rows.length} symbols · price against the 20, 50, 100 and 200-day averages`}
        updated={`Updated ${matrix.generatedAtUtc.slice(11, 16)} UTC`}
      />
      <Panel title="Scanner" subtitle="Most averages cleared first">
        <MomentumTable rows={rows} />
      </Panel>
      <MetricDescription>
        The long averages are context and do not score: the board&rsquo;s Trend cell reads the 3-day average against the
        14-day and that average&rsquo;s slope. Realised volatility and the average daily move are what Trade Ideas sizes its
        stops from.
      </MetricDescription>
    </div>
  );
}
