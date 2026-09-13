/**
 * Macro Scanners — the overview.
 *
 * Was one 600-line page. Each scanner now has its own route under /scanners,
 * rendered by the shared panels in `components/MacroPanels.tsx`, and this page
 * is the index: one tile per scanner with its headline reading, plus the two
 * short panels that are read together (surprise and the yield curve).
 *
 * Everything is derived in runSetupsPipeline from data the scorecard already
 * needed, so neither this page nor the scanners cost an upstream request.
 */

import Link from 'next/link';
import { FX_SYMBOLS } from '@/config/symbols.config';
import { YIELD_SMA_DAYS } from '@/config/setups.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { SURPRISE_MIN_SAMPLE, buildCarryTable, buildSurpriseIndex } from '@/lib/scoring/market';
import { MAJORS } from '@/lib/types';
import { SurpriseListPanel, YieldCurvePanel } from '@/components/MacroPanels';
import { PageHeader } from '@/components/primitives';

export const dynamic = 'force-dynamic';

function Tile({ href, title, value, detail, tone }: { href: string; title: string; value: string; detail: string; tone?: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-24 flex-col justify-between rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-border-bright)] active:bg-[var(--color-surface-2)]"
    >
      <span className="text-micro font-semibold tracking-wider text-[var(--color-faint)] uppercase">{title}</span>
      <span className={`tnum mt-2 text-title font-semibold ${tone ?? ''}`}>{value}</span>
      <span className="mt-1 text-caption text-[var(--color-muted)]">{detail} →</span>
    </Link>
  );
}

const tone = (v: number) => (v > 0 ? 'text-[var(--color-bull)]' : v < 0 ? 'text-[var(--color-bear)]' : 'text-[var(--color-muted)]');

export default async function MacroPage() {
  const { risk, strength, ecoStrength, policyRates, yieldCurve, events, clusters, matrix } = await runSetupsPipeline();

  const carry = buildCarryTable(FX_SYMBOLS, policyRates).sort((a, b) => Math.abs(b.carry) - Math.abs(a.carry));
  const surprise = MAJORS.map((c) => buildSurpriseIndex(c, events)).sort((a, b) => (b.index ?? -1) - (a.index ?? -1));
  const topEco = [...ecoStrength].sort((a, b) => b.totalScore - a.totalScore)[0];
  const topReal = [...strength].filter((r) => r.realYield !== null).sort((a, b) => b.realYield! - a.realYield!)[0];
  const stacked = clusters.filter((c) => c.members.length > 1).length;

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Macro Scanners"
        description="Cross-asset reads · derived from the same data as the scorecard"
        updated={`Updated ${matrix.generatedAtUtc.slice(11, 16)} UTC`}
        info={
          <>
            Every scanner is computed from the same fetch as Top Setups, so it costs no extra request and cannot disagree with
            the board about an input. Tap a tile for the full scanner.
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          href="/scanners/risk"
          title="Risk on / off"
          value={`${risk.score > 0 ? '+' : ''}${risk.score} ${risk.label}`}
          tone={tone(risk.score)}
          detail={`${stacked} stacked trade${stacked === 1 ? '' : 's'} on the board`}
        />
        <Tile
          href="/scanners/eco-strength"
          title="Eco strength"
          value={topEco ? `${topEco.currency} ${topEco.totalScore}` : '—'}
          detail="Strongest economy by level"
        />
        <Tile
          href="/scanners/real-yield"
          title="Real yield"
          value={topReal ? `${topReal.currency} ${topReal.realYield! > 0 ? '+' : ''}${topReal.realYield!.toFixed(2)}%` : '—'}
          tone={topReal ? tone(topReal.realYield!) : undefined}
          detail="Highest real return"
        />
        <Tile
          href="/scanners/carry"
          title="Carry"
          value={carry[0] ? `${carry[0].symbol} ${carry[0].carry > 0 ? '+' : ''}${carry[0].carry.toFixed(2)}%` : '—'}
          detail={carry[0] ? `Widest differential · collect ${carry[0].direction}` : 'No rates resolved'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SurpriseListPanel surprise={surprise} minSample={SURPRISE_MIN_SAMPLE} />
        <YieldCurvePanel curve={yieldCurve} smaDays={YIELD_SMA_DAYS} />
      </div>
    </div>
  );
}
