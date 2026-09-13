/**
 * Real Yield — policy rate minus inflation, with the stance and the market 2-year.
 */

import { CURRENCY_REGIME } from '@/config/scoring.config';
import { YIELD_SMA_DAYS } from '@/config/setups.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { RatesPanel, YieldCurvePanel, type RateRow } from '@/components/MacroPanels';
import { MetricDescription, PageHeader } from '@/components/primitives';

export const dynamic = 'force-dynamic';

export default async function RealYieldPage() {
  const { strength, sovereignYields, yieldCurve, matrix } = await runSetupsPipeline();

  // Maps do not cross into a client component; flatten here.
  const rows: RateRow[] = strength.map((row) => ({
    ...row,
    regime: CURRENCY_REGIME[row.currency],
    marketYield: sovereignYields.get(row.currency) ?? null,
  }));

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Real Yield"
        description="What each central bank pays once inflation is taken out"
        updated={`Updated ${matrix.generatedAtUtc.slice(11, 16)} UTC`}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RatesPanel rows={rows} />
        <YieldCurvePanel curve={yieldCurve} smaDays={YIELD_SMA_DAYS} />
      </div>
      <MetricDescription>
        Real yield is the column that explains flows the others cannot: a nominally high-rate currency with hotter inflation
        pays a negative real return, and is routinely weak for exactly that reason. Policy rates come from the calendar; CPI
        is the latest headline year-on-year print.
      </MetricDescription>
    </div>
  );
}
