/**
 * Carry Scanner — the annual policy-rate differential for every FX pair.
 */

import { FX_SYMBOLS } from '@/config/symbols.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { buildCarryTable } from '@/lib/scoring/market';
import { CarryPanel } from '@/components/MacroPanels';
import { MetricDescription, PageHeader } from '@/components/primitives';

export const dynamic = 'force-dynamic';

export default async function CarryPage() {
  const { policyRates, matrix } = await runSetupsPipeline();
  const carry = buildCarryTable(FX_SYMBOLS, policyRates);

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Carry Scanner"
        description={`${carry.length} pairs with both policy rates resolved`}
        updated={`Updated ${matrix.generatedAtUtc.slice(11, 16)} UTC`}
      />
      <CarryPanel carry={carry} maxHeight="calc(100dvh - 14rem)" />
      <MetricDescription>
        <p>
          Carry is what holding a pair pays or costs per year from the interest-rate gap alone. A pair is omitted when either
          policy rate is missing: treating an unknown rate as 0% would manufacture the widest carry in the table out of
          missing data.
        </p>
        <p className="mt-2">Carry does not score on the board. It is context for how expensive a position is to hold.</p>
      </MetricDescription>
    </div>
  );
}
