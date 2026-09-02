/**
 * Asset Scorecard — one symbol in full.
 *
 * Same principle as the event detail page: the arithmetic comes first. The gauge
 * is a summary of the indicator table below it, not a separate opinion, and
 * every row states which release it resolved to and what the surprise was.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  MATRIX_SLOTS,
  SCORING_SLOTS,
  SLOT_CATEGORIES,
  TREND_SMA,
  maxCellFor,
  maxScoreForKind,
} from '@/config/setups.config';
import { ALL_SYMBOLS, findSymbol } from '@/config/symbols.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { scoreCot, scoreCrowd } from '@/lib/scoring/cot';
import { buildTradeIdea, upcomingEventRisk } from '@/lib/scoring/trade-ideas';
import { fetchSeasonalHistory } from '@/lib/connectors/technicals';
import { SEASONALITY_LOOKBACKS, buildProfile } from '@/lib/scoring/seasonality';
import { ScoreGauge } from '@/components/Gauge';
import { BiasPill, Panel, cellBias, formatValue } from '@/components/ui';
import { PriceStatistics } from '@/components/PriceStatistics';
import { ScorecardHeader, type SwitcherOption } from '@/components/ScorecardHeader';
import { SeasonalityStrip } from '@/components/SeasonalityStrip';
import { assetClassOf, CLASS_ORDER } from '@/lib/scoring/asset-class';

export const dynamic = 'force-dynamic';

const BIAS_COLOR: Record<string, string> = {
  'Very Bullish': 'text-[var(--color-bull)]',
  Bullish: 'text-[var(--color-bull)]',
  Neutral: 'text-[var(--color-muted)]',
  Bearish: 'text-[var(--color-bear)]',
  'Very Bearish': 'text-[var(--color-bear)]',
};

/**
 * Colour for a per-leg actual, matching the grid vocabulary rather than the
 * status vocabulary — this number sits in a dense table, not next to a label.
 * Was a hardcoded `#5b95e8` that matched neither `--color-bull` nor the chart's
 * own `#3a7ae0`; all three are now one token.
 */
function cellColor(value: number | null): string {
  if (value === null) return 'text-[var(--color-faint)]';
  if (value > 0) return 'text-[var(--color-bull-cell)]';
  if (value < 0) return 'text-[var(--color-bear)]';
  return 'text-[var(--color-muted)]';
}

export default async function ScorecardPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const def = findSymbol(symbol);
  if (!def) notFound();

  /**
   * The seasonal history is fetched for THIS SYMBOL ONLY, alongside the
   * pipeline rather than after it. It is a decade of daily bars on a seven-day
   * cache — free after the first load of the week, and the /seasonality tab
   * warms the same cache entry.
   */
  const [{ matrix, technicals, cot, events }, seasonalBars] = await Promise.all([
    runSetupsPipeline(),
    fetchSeasonalHistory(def.yahoo),
  ]);

  const row = matrix.rows.find((r) => r.symbol === def.symbol);
  if (!row) notFound();

  const tech = technicals.get(def.symbol);

  const now = new Date();

  /**
   * Month and week profiles at the scoring window. The month strip is what the
   * `seasonality` cell reads; the week strip is context the cell has never had,
   * and the one A1 shows beside it.
   */
  const scoringLookback = SEASONALITY_LOOKBACKS[SEASONALITY_LOOKBACKS.length - 1];
  const monthProfile = seasonalBars
    ? buildProfile(seasonalBars, 'month', scoringLookback, now)
    : null;
  const weekProfile = seasonalBars
    ? buildProfile(seasonalBars, 'week', scoringLookback, now)
    : null;

  /** Every symbol, in trader order, for the header switcher. */
  const switcherOptions: SwitcherOption[] = ALL_SYMBOLS.slice()
    .sort(
      (a, b) =>
        CLASS_ORDER.indexOf(assetClassOf(a.symbol, a.kind)) -
        CLASS_ORDER.indexOf(assetClassOf(b.symbol, b.kind)),
    )
    .map((s) => ({
      symbol: s.symbol,
      label: s.label,
      assetClass: assetClassOf(s.symbol, s.kind),
    }));

  // Sentiment detail for the legs, so the COT numbers are inspectable rather
  // than just a cell value. Must use the SAME asset-class rule the matrix used,
  // or the detail panel contradicts the cell above it.
  const cotDetail = def.cotContract
    ? scoreCot(cot.get(def.cotContract), def.kind === 'fx' ? 'fx' : 'asset')
    : null;
  const crowdDetail = def.cotContract ? scoreCrowd(cot.get(def.cotContract)) : null;

  /**
   * The gauge now speaks the scorecard's own language. There is one score in
   * this app and this is it — no rescale, so a total of 14 displays as 14, the
   * way it does on EdgeFinder.
   *
   * The dial is drawn against the model's true maximum rather than a "realistic"
   * range, because A1's bias bands (+/-4, +/-7) are absolute. Shrinking the dial
   * to where scores usually land would make Very Bullish look like it sits near
   * the top of the scale when it is roughly a third of the way up.
   *
   * Per ASSET CLASS, not one shared number: a single-economy asset like gold
   * reads one economy at +/-1 a cell where a pair differences two at +/-2, so an
   * FX-sized dial permanently understates it.
   */
  const gaugeRange = maxScoreForKind(def.kind);

  const tradeIdea = buildTradeIdea(row, tech);

  /**
   * The releases that can invalidate those levels before they resolve. The stop
   * is sized from realised volatility, which by definition has not seen the next
   * print yet — so this is the one risk the trade idea cannot see in itself.
   */
  const eventRisk = tradeIdea
    ? upcomingEventRisk([def.base, def.quote, def.macroEconomy], events)
    : [];

  /**
   * The 3/14 pair drives the trend score; the rest are context. Kept in that
   * order and labelled, so it is obvious which two actually vote.
   */
  const smaRows = [
    { label: `${TREND_SMA.fast}-day`, value: tech?.smaFast, scored: true },
    { label: `${TREND_SMA.slow}-day`, value: tech?.smaSlow, scored: true },
    { label: '20-day', value: tech?.sma20, scored: false },
    { label: '50-day', value: tech?.sma50, scored: false },
    { label: '100-day', value: tech?.sma100, scored: false },
    { label: '200-day', value: tech?.sma200, scored: false },
  ];

  return (
    <div className="px-4 py-3">
      <ScorecardHeader
        symbol={def.symbol}
        label={def.label}
        options={switcherOptions}
        fallbackPrice={row.price}
        fallbackChangePct={row.changePct}
      />

      <div className="grid grid-cols-1 gap-3 lg:h-[calc(100vh-4.75rem)] lg:grid-cols-12">
        {/* --- Left: the verdict ------------------------------------------ */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto lg:col-span-3">
          <Panel>
            <div className="flex flex-col items-center gap-2 px-4 py-5">
              <ScoreGauge
                score={row.totalScore}
                range={gaugeRange}
                direction={
                  row.bias.includes('Bullish') ? 'bullish' : row.bias.includes('Bearish') ? 'bearish' : 'neutral'
                }
                confidence={Math.round((row.populated / SCORING_SLOTS.length) * 100)}
                label={`${row.populated} of ${SCORING_SLOTS.length} scored indicators had data`}
              />
              <div className={`text-lg font-bold ${BIAS_COLOR[row.bias]}`}>{row.bias}</div>
            </div>
          </Panel>

          {/* Category subtotals — the EdgeFinder-style breakdown. */}
          <Panel title="Score breakdown">
            <dl className="divide-y divide-[var(--color-border)]">
              {SLOT_CATEGORIES.map((cat) => {
                const value = row.categoryScores[cat.key];

                /**
                 * A block's own maximum, so "Inflation +3" is legible as
                 * two-thirds of the way up rather than as a number in a vacuum.
                 * Summed from the same per-slot rule the cells use.
                 */
                const blockMax = SCORING_SLOTS.filter((s) => s.category === cat.key).reduce(
                  (t, s) => t + maxCellFor(s.key, def.kind),
                  0,
                );
                const tone = cellBias(value, blockMax).tone;

                return (
                  <div key={cat.key} className="flex items-center justify-between px-4 py-2">
                    <dt className="text-[11px] text-[var(--color-muted)]">{cat.label}</dt>
                    <dd
                      className={`tnum text-sm font-semibold ${tone}`}
                      title={`${value > 0 ? '+' : ''}${value} out of a possible ±${blockMax}`}
                    >
                      {value > 0 ? '+' : ''}
                      {value}
                      <span className="ml-1 text-[9px] font-normal text-[var(--color-faint)]">
                        /{blockMax}
                      </span>
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

          {/*
            Trade idea. Absent entirely below ±4 rather than shown as "no setup",
            because a greyed-out box still puts the idea of a trade on screen for
            a symbol that has no directional signal.
          */}
          {tradeIdea && (
            <Panel title="Trade idea" subtitle="Levels derived from volatility, not advice">
              <div className="px-4 py-3">
                <div className="mb-2 flex items-baseline gap-2">
                  <span
                    className={`text-sm font-bold uppercase ${
                      tradeIdea.direction === 'long' ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'
                    }`}
                  >
                    {tradeIdea.direction}
                  </span>
                  <span className="text-[10px] text-[var(--color-faint)]">
                    {tradeIdea.rewardRisk}:1 · {tradeIdea.dailyMovePct}% avg daily move
                  </span>
                </div>

                <dl className="space-y-1 text-[11px]">
                  {[
                    { label: 'Entry', value: `${tradeIdea.entryMin} – ${tradeIdea.entryMax}`, color: '' },
                    { label: 'Target', value: tradeIdea.target, color: 'text-[var(--color-bull)]' },
                    { label: 'Stop', value: tradeIdea.stop, color: 'text-[var(--color-bear)]' },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center justify-between">
                      <dt className="text-[var(--color-muted)]">{r.label}</dt>
                      <dd className={`tnum font-semibold ${r.color}`}>{r.value}</dd>
                    </div>
                  ))}
                </dl>

                {/*
                  Event risk sits INSIDE the trade-idea panel, above the caveat.
                  Put anywhere else it reads as general context; here it reads as
                  a property of these levels, which is what it is.
                */}
                {eventRisk.length > 0 && (
                  <div className="mt-2 border-t border-[var(--color-border)] pt-2">
                    <div className="mb-1 text-[10px] font-semibold tracking-wide text-[var(--color-uncertain)] uppercase">
                      {eventRisk.length} high-impact release{eventRisk.length > 1 ? 's' : ''} before this resolves
                    </div>
                    {eventRisk.slice(0, 4).map((e) => (
                      <div key={`${e.dateUtc}${e.name}`} className="flex items-baseline gap-2 text-[10px]">
                        <span className="tnum w-12 shrink-0 text-[var(--color-uncertain)]">
                          {e.hoursAway < 1 ? '<1h' : `${Math.round(e.hoursAway)}h`}
                        </span>
                        <span className="font-mono text-[var(--color-muted)]">{e.currency}</span>
                        <span className="truncate text-[var(--color-faint)]">{e.name}</span>
                      </div>
                    ))}
                  </div>
                )}

                <p className="mt-2 border-t border-[var(--color-border)] pt-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
                  Sized from the average daily move alone.
                  {eventRisk.length > 0
                    ? ' The stop comes from realised volatility, which has not seen the releases above.'
                    : ' No high-impact release is due for either leg in the next 48 hours.'}{' '}
                  Not financial advice.
                </p>
              </div>
            </Panel>
          )}

          <Link
            href={`/history/${def.symbol}`}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-center text-xs text-[var(--color-muted)] transition-colors hover:border-[var(--color-border-bright)] hover:text-[var(--color-text)]"
          >
            View score history →
          </Link>

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
                    <th className="px-2 py-1.5 text-right">Actual</th>
                    <th className="px-2 py-1.5 text-right">Forecast</th>
                    <th className="px-2 py-1.5 text-right">Previous</th>
                  </tr>
                </thead>
                <tbody>
                  {SLOT_CATEGORIES.map((cat) => {
                    const slots = MATRIX_SLOTS.filter((s) => s.category === cat.key);
                    return [
                      <tr key={`cat-${cat.key}`} className="bg-[var(--color-surface-2)]/40">
                        <td
                          colSpan={5}
                          className="px-3 py-1 text-[9px] font-semibold tracking-wider text-[var(--color-faint)] uppercase"
                        >
                          {cat.label}
                        </td>
                      </tr>,
                      ...slots.map((slot) => {
                        const cell = row.cells[slot.key];
                        const legs = cell.legs?.filter((l) => l.seriesName !== null) ?? [];
                        // Prefix the currency only when the legs actually come
                        // from different economies. PMI on gold has two legs that
                        // are both USD, and "USD · … USD · …" is just noise.
                        const multiCurrency = new Set(legs.map((l) => l.currency)).size > 1;

                        return (
                          <tr key={slot.key} className="border-b border-[var(--color-border)]/60 align-top">
                            <td className="px-3 py-1.5" title={slot.title}>
                              <div className="whitespace-nowrap">
                                {slot.label}
                                {!slot.scoring && (
                                  <span className="ml-1 text-[9px] text-[var(--color-faint)] italic">context</span>
                                )}
                              </div>
                              {/* The resolved series, per leg. Naming it matters:
                                  "CPI YoY" for EUR is the euro-area HICP. */}
                              {legs.map((leg, i) => (
                                <div key={i} className="text-[9px] leading-tight text-[var(--color-faint)]">
                                  {multiCurrency ? `${leg.currency} · ` : ''}
                                  {leg.seriesName}
                                </div>
                              ))}
                            </td>

                            {/*
                              The cell as WORDS, not a bare integer.
                              "+2" asks the reader to remember that Trend spans
                              +/-2 while Seasonality spans +/-1 before they can
                              tell a strong reading from a maximal one; the pill
                              says it. The arithmetic is not lost — the number is
                              still in the pill, the tooltip names the column's
                              range, and Actual/Forecast/Previous are untouched.
                            */}
                            <td className="px-2 py-1.5 text-center">
                              <BiasPill
                                cell={cell.cell}
                                maxCell={maxCellFor(slot.key, def.kind)}
                                stale={cell.status === 'stale'}
                                partial={cell.status === 'partial' ? (cell.missingLeg ?? null) : null}
                              />
                            </td>

                            {/*
                              Actual / Forecast / Previous as real columns.
                              These were previously concatenated into one prose
                              string, which is unreadable at a glance and buries
                              the only three numbers that matter.
                            */}
                            {/*
                              Trend, seasonality, COT and the rate cell have no
                              calendar release behind them, so there is nothing to
                              put in three numeric columns. They get the width
                              instead — cramming a sentence into "Actual" truncated
                              exactly the part that explains the score.
                            */}
                            {legs.length === 0 ? (
                              <td colSpan={3} className="px-2 py-1.5 text-[10px] leading-snug text-[var(--color-muted)]">
                                {cell.explanation}
                              </td>
                            ) : (
                              (['actual', 'reference', 'previous'] as const).map((field) => (
                                <td key={field} className="px-2 py-1.5 text-right">
                                  {legs.map((leg, i) => (
                                    <div
                                      key={i}
                                      className={`tnum text-[10px] leading-tight ${
                                        field === 'actual'
                                          ? `font-semibold ${cellColor(leg.cell)}`
                                          : 'text-[var(--color-muted)]'
                                      }`}
                                      title={
                                        field === 'reference'
                                          ? `Scored against the ${leg.referenceLabel}`
                                          : undefined
                                      }
                                    >
                                      {formatValue(leg[field], leg.unit)}
                                    </div>
                                  ))}
                                </td>
                              ))
                            )}
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-[var(--color-border)] px-3 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
              The Forecast column is what the cell was actually scored against — for PMI that is the
              previous print, not the consensus, which is A1&rsquo;s rule. Pair cells are base minus
              quote: a currency that publishes no payrolls still shows a value there, inheriting the
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
                    <div className="flex items-baseline gap-2 text-[10px] tracking-wide text-[var(--color-faint)] uppercase">
                      Small traders (contrarian)
                      <Link
                        href="/sentiment"
                        className="ml-auto normal-case underline decoration-dotted underline-offset-2 hover:text-[var(--color-text)]"
                      >
                        all contracts
                      </Link>
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


          <PriceStatistics
            symbol={def.symbol}
            smaRows={smaRows.map((s) => ({ ...s, value: s.value ?? null }))}
            fallbackPrice={row.price}
            realizedVolPct={tech?.realizedVolPct ?? null}
            avgDailyMove7Pct={tech?.avgDailyMove7Pct ?? null}
            avgDailyMove90Pct={tech?.avgDailyMove90Pct ?? null}
          />

          {/*
            Month first, because that is the bucket the Seasonality cell above
            actually reads. Week second, as context the cell has never had.
          */}
          {monthProfile && monthProfile.buckets.size > 0 && (
            <SeasonalityStrip
              kind="month"
              profile={monthProfile}
              lookbackYears={scoringLookback}
              symbol={def.symbol}
              scores
            />
          )}
          {weekProfile && weekProfile.buckets.size > 0 && (
            <SeasonalityStrip
              kind="week"
              profile={weekProfile}
              lookbackYears={scoringLookback}
              symbol={def.symbol}
            />
          )}
        </div>
      </div>
    </div>
  );
}
