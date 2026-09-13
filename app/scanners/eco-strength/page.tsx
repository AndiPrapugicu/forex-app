/**
 * Eco Strength Index — where each economy stands, as against how it surprised.
 *
 * Split out of /macro. Same pipeline call, so no extra upstream request.
 */

import { COMPONENT_MAX } from '@/lib/scoring/eco-strength';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { EcoStrengthPanel, StrengthPanel } from '@/components/MacroPanels';
import { MetricDescription, PageHeader } from '@/components/primitives';

export const dynamic = 'force-dynamic';

export default async function EcoStrengthPage() {
  const { ecoStrength, strength, matrix } = await runSetupsPipeline();

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Eco Strength Index"
        description="GDP, unemployment, inflation and the policy rate, scored against the other majors"
        updated={`Updated ${matrix.generatedAtUtc.slice(11, 16)} UTC`}
        info={
          <>
            A1&rsquo;s construction, adopted because it reproduces all 32 of their published sub-scores. The numbers are
            ours, computed from the same releases the board scores.
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <EcoStrengthPanel rows={ecoStrength} componentMax={COMPONENT_MAX} />
        <StrengthPanel strength={strength} />
      </div>
      <MetricDescription>
        Every other number on the board scores a <em>surprise</em>: how a release compared with what was expected. This
        index scores <em>level</em>. An economy can beat a low bar and lead the strength ranking while sitting last here, and
        that disagreement is itself worth reading.
      </MetricDescription>
    </div>
  );
}
