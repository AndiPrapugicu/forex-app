/**
 * Asset Scorecard — one symbol in full.
 *
 * Same principle as the event detail page: the arithmetic comes first. The gauge
 * is a summary of the indicator table below it, not a separate opinion, and
 * every row states which release it resolved to and what the surprise was.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SLOTS, SLOT_CATEGORIES } from '@/config/setups.config';
import { findSymbol } from '@/config/symbols.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { scoreCot, scoreCrowd } from '@/lib/scoring/cot';
import { ScoreGauge } from '@/components/Gauge';
import { Panel } from '@/components/ui';
import { SeasonalityStrip } from '@/components/SeasonalityStrip';

export const dynamic = 'force-dynamic';

const BIAS_COLOR: Record<string, string> = {
  'Very Bullish': 'text-[var(--color-bull)]',
  Bullish: 'text-[var(--color-bull)]',
  Neutral: 'text-[var(--color-muted)]',
  Bearish: 'text-[var(--color-bear)]',
  'Very Bearish': 'text-[var(--color-bear)]',
};

function cellColor(value: number | null): string {
  if (value === null) return 'text-[var(--color-faint)]';
  if (value > 0) return 'text-[#5b95e8]';
  if (value < 0) return 'text-[var(--color-bear)]';
  return 'text-[var(--color-muted)]';
}

export default async function ScorecardPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const def = findSymbol(symbol);
  if (!def) notFound();

  const { matrix, technicals, cot } = await runSetupsPipeline();
  const row = matrix.rows.find((r) => r.symbol === def.symbol);
  if (!row) notFound();

  const tech = technicals.get(def.symbol);

  // Sentiment detail for the legs, so the COT numbers are inspectable rather
  // than just a cell value.
  const cotDetail = def.cotContract ? scoreCot(cot.get(def.cotContract)) : null;
  const crowdDetail = def.cotContract ? scoreCrowd(cot.get(def.cotContract)) : null;

  /**
   * The gauge speaks the app's usual -10..+10 language, but the matrix total is
   * a sum of 18 cells on a different scale. Rescaling by the realistic +/-15
   * range keeps the needle meaningful instead of pinning it.
   */
  const gaugeScore = Math.max(-10, Math.min(10, (row.totalScore / 15) * 10));

  const smaRows = [
    { label: '20-day', value: tech?.sma20 },
    { label: '50-day', value: tech?.sma50 },
    { label: '100-day', value: tech?.sma100 },
    { label: '200-day', value: tech?.sma200 },
  ];

  return (
    <div className="px-4 py-3">
      <header className="mb-3 flex flex-wrap items-baseline gap-3">
        <Link href="/" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]">
          ← Top Setups
        </Link>
        <h1 className="text-xl font-bold">{def.label}</h1>
        <span className="font-mono text-xs text-[var(--color-faint)]">{def.symbol}</span>
        {row.price !== null && (
          <span className="tnum text-sm text-[var(--color-muted)]">
            {row.price.toLocaleString()}
            {row.changePct !== null && (
              <span className={row.changePct >= 0 ? 'ml-1.5 text-[var(--color-bull)]' : 'ml-1.5 text-[var(--color-bear)]'}>
                {row.changePct >= 0 ? '+' : ''}
                {row.changePct.toFixed(2)}%
              </span>
            )}
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 lg:h-[calc(100vh-4.75rem)] lg:grid-cols-12">
        {/* --- Left: the verdict ------------------------------------------ */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto lg:col-span-3">
          <Panel>
            <div className="flex flex-col items-center gap-2 px-4 py-5">
              <ScoreGauge
                score={gaugeScore}
                direction={
                  row.bias.includes('Bullish') ? 'bullish' : row.bias.includes('Bearish') ? 'bearish' : 'neutral'
                }
                confidence={Math.round((row.populated / SLOTS.length) * 100)}
                label={`${row.populated} of ${SLOTS.length} indicators had data`}
                displayScore={row.totalScore}
              />
              <div className={`text-lg font-bold ${BIAS_COLOR[row.bias]}`}>{row.bias}</div>
            </div>
          </Panel>

          {/* Category subtotals — the EdgeFinder-style breakdown. */}
          <Panel title="Score breakdown">
            <dl className="divide-y divide-[var(--color-border)]">
              {SLOT_CATEGORIES.map((cat) => {
                const value = row.categoryScores[cat.key];
                return (
                  <div key={cat.key} className="flex items-center justify-between px-4 py-2">
                    <dt className="text-[11px] text-[var(--color-muted)]">{cat.label}</dt>
                    <dd className={`tnum text-sm font-semibold ${cellColor(value)}`}>
                      {value > 0 ? '+' : ''}
                      {value}
                    </dd>
                  </div>
                );
              })}
              <div className="flex items-center justify-between bg-[var(--color-surface-2)]/40 px-4 py-2">
                <dt className="text-[11px] font-semibold">Total</dt>
                <dd className={`tnum text-base font-bold ${BIAS_COLOR[row.bias]}`}>
                  {row.totalScore > 0 ? '+' : ''}
                  {row.totalScore}
                </dd>
              </div>
            </dl>
          </Panel>

        </div>

        {/* --- Centre: the evidence, the tall element --------------------- */}
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden lg:col-span-6">
          <Panel
            title="Indicator detail"
            subtitle={`Every slot, and the release it resolved to${matrix.cotReportDate ? ` · COT as of ${matrix.cotReportDate}` : ''}`}
          >
            <div className="max-h-[calc(100vh-13rem)] overflow-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="sticky top-0 z-10 bg-[var(--color-surface)] text-[9px] tracking-wider text-[var(--color-faint)] uppercase">
                    <th className="px-3 py-1.5">Indicator</th>
                    <th className="px-2 py-1.5 text-center">Cell</th>
                    {def.base && <th className="px-2 py-1.5 text-center">{def.base}</th>}
                    {def.quote && <th className="px-2 py-1.5 text-center">{def.quote}</th>}
                    <th className="px-3 py-1.5">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {SLOT_CATEGORIES.map((cat) => {
                    const slots = SLOTS.filter((s) => s.category === cat.key);
                    return [
                      <tr key={`cat-${cat.key}`} className="bg-[var(--color-surface-2)]/40">
                        <td
                          colSpan={3 + (def.base ? 1 : 0) + (def.quote ? 1 : 0)}
                          className="px-3 py-1 text-[9px] font-semibold tracking-wider text-[var(--color-faint)] uppercase"
                        >
                          {cat.label}
                        </td>
                      </tr>,
                      ...slots.map((slot) => {
                        const cell = row.cells[slot.key];
                        return (
                          <tr key={slot.key} className="border-b border-[var(--color-border)]/60">
                            <td className="px-3 py-1.5 whitespace-nowrap" title={slot.title}>
                              {slot.label}
                            </td>
                            <td className={`tnum px-2 py-1.5 text-center font-semibold ${cellColor(cell.cell)}`}>
                              {cell.status === 'stale' ? (
                                <span className="text-[9px] text-[var(--color-faint)] italic">stale</span>
                              ) : cell.cell === null ? (
                                '—'
                              ) : (
                                `${cell.cell > 0 ? '+' : ''}${cell.cell}`
                              )}
                            </td>
                            {def.base && (
                              <td className={`tnum px-2 py-1.5 text-center text-[10px] ${cellColor(cell.baseCell ?? null)}`}>
                                {cell.baseCell ?? '—'}
                              </td>
                            )}
                            {def.quote && (
                              <td className={`tnum px-2 py-1.5 text-center text-[10px] ${cellColor(cell.quoteCell ?? null)}`}>
                                {cell.quoteCell ?? '—'}
                              </td>
                            )}
                            <td className="px-3 py-1.5 text-[10px] leading-snug text-[var(--color-muted)]">
                              {cell.explanation}
                            </td>
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-[var(--color-border)] px-3 py-2 text-[10px] text-[var(--color-faint)]">
              Pair cells are base minus quote, clamped to ±2. A missing leg counts as 0, which is why a
              currency that publishes no payrolls still shows a value in the NFP row — it inherits the
              inverted reading from the other leg.
            </p>
          </Panel>

        </div>

        {/* --- Right: context ------------------------------------------- */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto lg:col-span-3">
          {/* Sentiment detail, where a single contract backs the symbol. */}
          {(cotDetail || crowdDetail) && (
            <Panel title="Positioning detail" subtitle={def.cotContract}>
              <div className="grid grid-cols-1 gap-px bg-[var(--color-border)] sm:grid-cols-2">
                {cotDetail && (
                  <div className="bg-[var(--color-surface)] px-4 py-3">
                    <div className="text-[10px] tracking-wide text-[var(--color-faint)] uppercase">
                      Large speculators
                    </div>
                    <div className="tnum mt-1 text-lg font-bold">
                      {cotDetail.net > 0 ? '+' : ''}
                      {cotDetail.net.toLocaleString()}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                      {cotDetail.percentile}th percentile of {cotDetail.sampleSize} weeks
                    </div>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-faint)]">
                      {cotDetail.explanation}
                    </p>
                  </div>
                )}
                {crowdDetail && (
                  <div className="bg-[var(--color-surface)] px-4 py-3">
                    <div className="text-[10px] tracking-wide text-[var(--color-faint)] uppercase">
                      Small traders (contrarian)
                    </div>
                    <div className="tnum mt-1 text-lg font-bold">{crowdDetail.retailLongPct}% long</div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                      Read as {crowdDetail.cell > 0 ? 'bullish' : crowdDetail.cell < 0 ? 'bearish' : 'neutral'}
                    </div>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-faint)]">
                      {crowdDetail.explanation}
                    </p>
                  </div>
                )}
              </div>
              {crowdDetail?.divergence && (
                <p className="border-t border-[var(--color-border)] px-4 py-2 text-[10px] text-[var(--color-uncertain)]">
                  Retail and large speculators are positioned on opposite sides — the setup this panel
                  exists to surface.
                </p>
              )}
            </Panel>
          )}


          {/* Price stats */}
          <Panel title="Price statistics">
            <dl className="divide-y divide-[var(--color-border)]">
              {smaRows.map((s) => (
                <div key={s.label} className="flex items-center justify-between px-4 py-1.5">
                  <dt className="text-[11px] text-[var(--color-muted)]">{s.label} SMA</dt>
                  <dd className="flex items-center gap-2">
                    <span className="tnum text-xs text-[var(--color-faint)]">
                      {s.value ? s.value.toFixed(s.value > 100 ? 2 : 5) : '—'}
                    </span>
                    {s.value && row.price !== null && (
                      <span
                        className={`text-[10px] font-medium ${row.price > s.value ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'}`}
                      >
                        {row.price > s.value ? 'above' : 'below'}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-1.5">
                <dt className="text-[11px] text-[var(--color-muted)]">Realized vol (annual)</dt>
                <dd className="tnum text-xs">{tech?.realizedVolPct ?? '—'}%</dd>
              </div>
              <div className="flex items-center justify-between px-4 py-1.5">
                <dt className="text-[11px] text-[var(--color-muted)]">Avg daily move (7d)</dt>
                <dd className="tnum text-xs">{tech?.avgDailyMove7Pct ?? '—'}%</dd>
              </div>
              <div className="flex items-center justify-between px-4 py-1.5">
                <dt className="text-[11px] text-[var(--color-muted)]">Avg daily move (90d)</dt>
                <dd className="tnum text-xs">{tech?.avgDailyMove90Pct ?? '—'}%</dd>
              </div>
            </dl>
          </Panel>
          {tech && Object.keys(tech.seasonality).length > 0 && (
            <SeasonalityStrip seasonality={tech.seasonality} />
          )}
        </div>
      </div>
    </div>
  );
}
