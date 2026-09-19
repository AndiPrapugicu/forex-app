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
  BIAS_THRESHOLDS,
  MATRIX_SLOTS,
  SCORING_SLOTS,
  SLOT_CATEGORIES,
  TREND_SMA,
  maxCellFor,
  maxScoreForKind,
} from '@/config/setups.config';
import { ALL_SYMBOLS, findSymbol } from '@/config/symbols.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { getStore } from '@/lib/db/client';
import { scoreCot, scoreCrowd } from '@/lib/scoring/cot';
import { maxAgeFor } from '@/lib/scoring/discrete';
import { fetchSeasonalHistory } from '@/lib/connectors/technicals';
import { SEASONALITY_LOOKBACKS, buildProfile } from '@/lib/scoring/seasonality';
import { heatStyle } from '@/lib/ui/heat';
import { biasBandEdges } from '@/lib/ui/gauge-scale';
import { BandedLine } from '@/components/charts';
import { ScoreGauge } from '@/components/Gauge';
import { Explain, SignedBar } from '@/components/primitives';
import { BiasPill, Panel, cellBias, formatScore, formatValue } from '@/components/ui';
import { PriceStatistics } from '@/components/PriceStatistics';
import { ScorecardHeader, type SwitcherOption } from '@/components/ScorecardHeader';
import { SeasonalityStrip } from '@/components/SeasonalityStrip';
import { assetClassOf, CLASS_ORDER } from '@/lib/scoring/asset-class';

export const dynamic = 'force-dynamic';

/**
 * The cuts the bias words turn on, smallest first — +4 Bullish, +7 Very
 * Bullish. Read off the thresholds rather than written down, so the dial face
 * and this page cannot drift apart from the scorer.
 */
const BIAS_CUTS = BIAS_THRESHOLDS.map((t) => t.min)
  .filter((m) => Number.isFinite(m) && m > 0)
  .sort((a, b) => a - b);
/** The score that earns a "Very", which is where the banner paints solid. */
const VERY_BIAS_CUT = BIAS_CUTS[BIAS_CUTS.length - 1];

/** How far back the score-history panel looks. The full page offers 7/30/90. */
const SCORE_HISTORY_DAYS = 30;
/** Inside two days the captures are hours apart, so the clock is the useful label. */
const INTRADAY_SPAN_MS = 2 * 86_400_000;

/**
 * Snapshots for the score-history panel.
 *
 * Returned rather than thrown, and separated from the reason it is empty: a
 * blank chart otherwise reads as "this symbol has been flat", which is a
 * different claim from "we have not been recording". Same distinction the
 * /history page makes, in one line, because this is a sidebar panel.
 */
async function loadScoreHistory(symbol: string) {
  const store = getStore();
  const since = new Date(Date.now() - SCORE_HISTORY_DAYS * 86_400_000).toISOString();
  try {
    const history = await store.getSnapshots(symbol, since);
    return {
      history,
      note: store.durable
        ? `No boards stored in the last ${SCORE_HISTORY_DAYS} days yet — history fills in as the ingest job runs.`
        : 'Storage is in-memory, so no board survives between requests.',
    };
  } catch (err) {
    return { history: [], note: `Could not read history: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * "Sep 01", the way A1 dates a release.
 *
 * Sliced off the ISO string against a fixed month list rather than run through
 * `toLocaleDateString`: the server and the browser would otherwise format in
 * different locales and time zones, and React would flag the mismatch.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function releaseDay(dateUtc: string | null): string {
  if (dateUtc === null) return '—';
  const month = MONTHS[Number(dateUtc.slice(5, 7)) - 1];
  return month === undefined ? dateUtc.slice(5, 10) : `${month} ${dateUtc.slice(8, 10)}`;
}

/** Whole days between a release and now, for the date column's age marker. */
function ageInDays(dateUtc: string | null, now: Date): number | null {
  if (dateUtc === null) return null;
  const then = Date.parse(dateUtc);
  if (!Number.isFinite(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

/**
 * Actual minus what it was scored against.
 *
 * Unsigned when positive, as A1 prints it — a minus sign is the only sign that
 * carries information here, because the COLOUR already says whether the surprise
 * was good news or bad. Formatted through `formatValue`, which trims the float
 * noise that makes 0.6 - 0.4 print as 0.19999999999999998.
 */
function surpriseOf(leg: { actual: number | null; reference: number | null; unit: string | null }): string {
  if (leg.actual === null || leg.reference === null) return '—';
  const diff = leg.actual - leg.reference;
  return formatValue(diff, leg.unit);
}

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
  const [{ matrix, technicals, cot }, seasonalBars, scoreHistory] = await Promise.all([
    runSetupsPipeline(),
    fetchSeasonalHistory(def.yahoo),
    loadScoreHistory(def.symbol),
  ]);
  const { history, note: historyNote } = scoreHistory;

  /**
   * Hours inside a couple of days, dates beyond that. The ingest cron captures
   * roughly every three hours, so a two-day window labelled by date would print
   * the same day five times.
   */
  const historySpanMs =
    history.length > 1
      ? Date.parse(history[history.length - 1].capturedAtUtc) - Date.parse(history[0].capturedAtUtc)
      : 0;
  const historyLabel = (iso: string) =>
    historySpanMs <= INTRADAY_SPAN_MS ? iso.slice(11, 16) : iso.slice(5, 10);

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

  /**
   * ...and the dial is BANDED on that range rather than linear, because the two
   * facts fight each other: the maximum is real, but the bias cuts are absolute,
   * so on a linear face a Very Bearish -9 sat a tenth of the way off centre
   * under a banner reading Very Bearish, and the only numbers on the face were
   * ±34 — a score nothing reaches. Each band now owns an equal slice, so the
   * needle agrees with the word, and the face is labelled with the cuts.
   */
  const gaugeBands = biasBandEdges(
    gaugeRange,
    BIAS_THRESHOLDS.map((t) => t.min),
  );

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
            {/*
              The verdict as a painted banner, the way A1's widget opens: the
              word was a coloured line of text under the dial, which is the one
              thing on this page a trader reads from across the room.
            */}
            <div
              className="px-4 py-2 text-center text-sm font-bold tracking-wide"
              style={heatStyle(row.totalScore, { max: VERY_BIAS_CUT })}
            >
              {row.bias}
            </div>
            <div className="flex flex-col items-center gap-2 px-4 py-5">
              <ScoreGauge
                score={row.totalScore}
                range={gaugeRange}
                bands={gaugeBands}
                showDirection={false}
                direction={
                  row.bias.includes('Bullish') ? 'bullish' : row.bias.includes('Bearish') ? 'bearish' : 'neutral'
                }
                confidence={Math.round((row.populated / SCORING_SLOTS.length) * 100)}
                label={`${row.populated} of ${SCORING_SLOTS.length} scored indicators had data · dial banded at ${BIAS_CUTS.map(
                  (c) => `±${c}`,
                ).join(' and ')}, this asset tops out at ±${gaugeRange}`}
              />
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
                return (
                  <div
                    key={cat.key}
                    className="px-4 py-2"
                    title={`${value > 0 ? '+' : ''}${value} out of a possible ±${blockMax}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-micro text-[var(--color-muted)]">{cat.label}</dt>
                      {/*
                        Painted on the block's OWN maximum, which is the only
                        scale on which "Inflation -2" and "Jobs -1" can be
                        compared: the blocks are eight and ten points wide.
                      */}
                      <dd
                        className="tnum rounded px-1.5 py-0.5 text-sm font-semibold"
                        style={heatStyle(value, { max: blockMax, zeroGrey: false })}
                      >
                        {value > 0 ? '+' : ''}
                        {value}
                        <span className="ml-1 text-micro font-normal opacity-70">/{blockMax}</span>
                      </dd>
                    </div>
                    {/* The same number as length, so the blocks rank at a glance. */}
                    <div className="mt-1.5">
                      <SignedBar value={value} max={blockMax} label={`${cat.label} ${value} of ±${blockMax}`} />
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between bg-[var(--color-surface-2)]/40 px-4 py-2">
                <dt className="text-micro font-semibold">Total</dt>
                <dd
                  className="tnum rounded px-2 py-0.5 text-base font-bold"
                  style={heatStyle(row.totalScore, { max: VERY_BIAS_CUT })}
                >
                  {row.totalScore > 0 ? '+' : ''}
                  {row.totalScore}
                </dd>
              </div>
            </dl>
          </Panel>

          {/*
            Score history, where A1 puts it: directly under the breakdown.
            The Trade idea panel that used to sit here is gone — it was the one
            block on the page that was not a reading of the board, and levels
            sized from volatility are not what this app is for.
          */}
          <Panel
            title="Score history"
            subtitle={
              history.length > 0
                ? `${history.length} captures · ${SCORE_HISTORY_DAYS} days`
                : `Last ${SCORE_HISTORY_DAYS} days`
            }
          >
            <div className="px-3 py-3">
              {history.length > 0 ? (
                <>
                  <BandedLine
                    label={`${def.symbol} total score over the last ${SCORE_HISTORY_DAYS} days`}
                    points={history.map((h) => ({ label: historyLabel(h.capturedAtUtc), value: h.totalScore }))}
                    bands={[
                      { value: BIAS_CUTS[0], label: 'Bullish', tone: 'bull', zone: 'above' },
                      { value: -BIAS_CUTS[0], label: 'Bearish', tone: 'bear', zone: 'below' },
                    ]}
                    width={340}
                    height={150}
                    zones
                    format={(v) => formatScore(Math.round(v))}
                  />
                  <p className="mt-1 text-micro leading-relaxed text-[var(--color-faint)]">
                    Every board we stored, newest on the right. Blue above +{BIAS_CUTS[0]} is the bullish zone, red
                    below −{BIAS_CUTS[0]} the bearish one — the same cuts the banner above reads.
                  </p>
                </>
              ) : (
                <p className="text-micro leading-relaxed text-[var(--color-faint)]">
                  {historyNote}
                </p>
              )}
            </div>
          </Panel>


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
              <table className="w-full text-left text-micro">
                {/*
                  NO GLOBAL HEADER ROW, because A1 has none: every section states
                  its own columns, and they are not the same columns — the
                  sentiment block has no calendar release to put under "Forecast".
                  The caption keeps the table named for a screen reader, and the
                  section rows carry real `th scope="col"` cells, so dropping the
                  sticky header costs nothing semantically.
                */}
                <caption className="sr-only">
                  {def.symbol} indicator detail: every slot, its reading, and the release it resolved to
                </caption>
                <tbody>
                  {SLOT_CATEGORIES.map((cat) => {
                    const slots = MATRIX_SLOTS.filter((s) => s.category === cat.key);
                    /**
                     * The block's own subtotal, repeated on its header row. The
                     * left panel already carries these, but a reader scrolling
                     * the table has no way back to them, and A1's widget states
                     * the block verdict on the header exactly here.
                     */
                    const blockScore = row.categoryScores[cat.key];
                    const blockMax = SCORING_SLOTS.filter((s) => s.category === cat.key).reduce(
                      (t, s) => t + maxCellFor(s.key, def.kind),
                      0,
                    );
                    const blockBias = cellBias(blockScore, blockMax);
                    /**
                     * Only a section whose rows HAVE releases gets the numeric
                     * column names. Trend, seasonality and the COT cells carry a
                     * sentence instead, and heading it "Actual · Forecast" would
                     * be naming columns that are not there.
                     */
                    const sectionHasLegs = slots.some(
                      (sl) => (row.cells[sl.key]?.legs?.filter((l) => l.seriesName !== null).length ?? 0) > 0,
                    );
                    return [
                      <tr key={`cat-${cat.key}`} className="table-head">
                        <th scope="col" className="px-3 py-1 text-left text-micro font-medium italic">
                          {cat.label}
                        </th>
                        <th
                          scope="col"
                          className={`px-2 py-1 text-center text-micro font-semibold ${blockBias.tone}`}
                          title={`${cat.label}: ${blockScore > 0 ? '+' : ''}${blockScore} of a possible ±${blockMax}`}
                        >
                          {blockBias.label}
                        </th>
                        {sectionHasLegs ? (
                          ['Actual', 'Forecast', 'Surprise', 'Date'].map((h) => (
                            <th key={h} scope="col" className="px-2 py-1 text-right text-micro font-medium italic">
                              {h}
                            </th>
                          ))
                        ) : (
                          <th scope="col" colSpan={4} className="px-2 py-1" />
                        )}
                      </tr>,
                      ...slots.map((slot) => {
                        const cell = row.cells[slot.key];
                        const legs = cell.legs?.filter((l) => l.seriesName !== null) ?? [];

                        return (
                          <tr key={slot.key} className="border-b border-[var(--color-border)]/60 align-top">
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-1 whitespace-nowrap">
                                <span title={slot.title}>{slot.label}</span>
                                {!slot.scoring && (
                                  <span className="text-micro text-[var(--color-faint)] italic">context</span>
                                )}
                                {/*
                                  The resolved series names moved in HERE.
                                  "EUR · Gross Domestic Product s.a. (QoQ)" over
                                  "USD · Gross Domestic Product Annualized" wrapped
                                  onto five lines and pushed the three numbers that
                                  matter down the page, for a name that is read
                                  once. Naming the series still matters — CPI YoY
                                  for EUR is the euro-area HICP — so it is a tap
                                  away rather than gone, and works on a phone,
                                  which a `title` does not.
                                */}
                                {legs.length > 0 && (
                                  <Explain label={`Which series ${slot.label} reads`}>
                                    <div className="flex flex-col gap-1">
                                      {legs.map((leg, i) => (
                                        <div key={i}>
                                          <span className="font-mono font-semibold">{leg.currency}</span>{' '}
                                          {leg.seriesName}
                                          <span className="text-[var(--color-faint)]">
                                            {' '}
                                            &middot; scored against the {leg.referenceLabel} &middot; previous{' '}
                                            {formatValue(leg.previous, leg.unit)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </Explain>
                                )}
                              </div>
                              {/*
                                One line per leg, in the same order as the numeric
                                columns, so "EUR" lines up with the EUR actual.
                                That alignment is the whole reason the currency
                                stays visible while the series name does not.
                              */}
                              {legs.map((leg, i) => (
                                <div
                                  key={i}
                                  className="font-mono text-micro leading-tight text-[var(--color-faint)]"
                                  title={leg.seriesName ?? undefined}
                                >
                                  {leg.currency}
                                </div>
                              ))}
                            </td>

                            {/*
                              The cell as A1 draws it: a filled block spanning the
                              column, carrying the WORD alone. Consecutive rows
                              then read as one strip of colour, which is the whole
                              point of their layout — the verdict is legible
                              before a single number is.

                              The integer moved into the block's tooltip and the
                              row's disclosure. It is not lost, and it was never
                              readable on its own anyway: "+2" means maximal on a
                              seasonality row and middling on a trend row, which
                              is why the word exists.
                            */}
                            <td className="w-[88px] p-0 align-middle md:w-[104px]">
                              <BiasPill
                                variant="block"
                                cell={cell.cell}
                                maxCell={maxCellFor(slot.key, def.kind)}
                                stale={cell.stale ?? false}
                                partial={cell.status === 'partial' ? (cell.missingLeg ?? null) : null}
                              />
                            </td>

                            {/*
                              Actual / Forecast / SURPRISE / DATE, which is the
                              set A1's own widget prints. The surprise is what
                              the cell is actually made of — every economic
                              column is "vs. forecast" — and it was left for the
                              reader to do in their head, from two columns that
                              are not in the same units as each other. Previous
                              moved into the disclosure above: it is the scoring
                              basis only for PMI, where the Forecast column is
                              already showing it.
                            */}
                            {/*
                              Trend, seasonality, COT and the rate cell have no
                              calendar release behind them, so there is nothing to
                              put in four numeric columns. They get the width
                              instead — cramming a sentence into "Actual" truncated
                              exactly the part that explains the score.
                            */}
                            {legs.length === 0 ? (
                              <td colSpan={4} className="px-2 py-1.5 text-micro leading-snug text-[var(--color-muted)]">
                                {cell.explanation}
                              </td>
                            ) : (
                              <>
                                {/*
                                  Actual and Forecast are PLAIN, as A1 prints
                                  them. They used to be painted by the leg's own
                                  reading, which put three coloured numbers on a
                                  row whose verdict is already a filled block —
                                  and a colour on "1.50%" says nothing anyway,
                                  since the reading is the DIFFERENCE. Only the
                                  surprise is coloured now.
                                */}
                                {(['actual', 'reference'] as const).map((field) => (
                                  <td key={field} className="px-2 py-1.5 text-right">
                                    {legs.map((leg, i) => (
                                      <div
                                        key={i}
                                        className={`tnum text-micro leading-tight ${
                                          field === 'actual' ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
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
                                ))}

                                {/*
                                  Coloured by the LEG'S OWN CELL, never by the
                                  sign of the difference: a rise in unemployment
                                  is a positive surprise and a bearish one, and
                                  painting that blue would contradict the pill two
                                  columns to its left.
                                */}
                                <td className="px-2 py-1.5 text-right">
                                  {legs.map((leg, i) => (
                                    <div key={i} className={`tnum text-micro leading-tight ${cellColor(leg.cell)}`}>
                                      {surpriseOf(leg)}
                                    </div>
                                  ))}
                                </td>

                                <td className="px-2 py-1.5 text-right">
                                  {legs.map((leg, i) => {
                                    const age = ageInDays(leg.dateUtc, now);
                                    const past = age !== null && age > maxAgeFor(slot, leg.currency);
                                    return (
                                      <div
                                        key={i}
                                        className={`tnum text-micro leading-tight ${
                                          past ? 'text-[var(--color-uncertain)]' : 'text-[var(--color-faint)]'
                                        }`}
                                        title={
                                          age === null
                                            ? undefined
                                            : past
                                              ? `${age} days old, past this series' usual cadence — still scored, as A1 scores theirs`
                                              : `${age} days old`
                                        }
                                      >
                                        {releaseDay(leg.dateUtc)}
                                        {past && '*'}
                                      </div>
                                    );
                                  })}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-[var(--color-border)] px-3 py-2 text-micro leading-relaxed text-[var(--color-faint)]">
              The Forecast column is what the cell was actually scored against — for PMI that is the
              previous print, not the consensus, which is A1&rsquo;s rule. Surprise is actual minus that
              number, coloured by what it MEANS rather than by its sign, so a rise in unemployment reads
              red. A date marked * is past its series&rsquo; usual cadence and is still scored, as A1
              scores theirs. Each block&rsquo;s own score is on its header, and every cell&rsquo;s integer
              is in its tooltip. Pair cells are base minus quote, one line per leg: a currency that
              publishes no payrolls still shows a value there, inheriting the inverted reading from the
              other leg.
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
                    <div className="text-micro tracking-wide text-[var(--color-faint)] uppercase">
                      Large speculators
                    </div>
                    <div className="tnum mt-1 text-lg font-bold">
                      {cotDetail.net > 0 ? '+' : ''}
                      {cotDetail.net.toLocaleString()}
                    </div>
                    <div className="mt-0.5 text-micro text-[var(--color-muted)]">
                      {cotDetail.percentile}th percentile of {cotDetail.sampleSize} weeks
                    </div>
                    <p className="mt-1.5 text-micro leading-relaxed text-[var(--color-faint)]">
                      {cotDetail.explanation}
                    </p>
                  </div>
                )}
                {crowdDetail && (
                  <div className="bg-[var(--color-surface)] px-4 py-3">
                    <div className="flex items-baseline gap-2 text-micro tracking-wide text-[var(--color-faint)] uppercase">
                      Small traders (contrarian)
                      <Link
                        href="/sentiment"
                        className="ml-auto normal-case underline decoration-dotted underline-offset-2 hover:text-[var(--color-text)]"
                      >
                        all contracts
                      </Link>
                    </div>
                    <div className="tnum mt-1 text-lg font-bold">{crowdDetail.retailLongPct}% long</div>
                    <div className="mt-0.5 text-micro text-[var(--color-muted)]">
                      Read as {crowdDetail.cell > 0 ? 'bullish' : crowdDetail.cell < 0 ? 'bearish' : 'neutral'}
                    </div>
                    <p className="mt-1.5 text-micro leading-relaxed text-[var(--color-faint)]">
                      {crowdDetail.explanation}
                    </p>
                  </div>
                )}
              </div>
              {crowdDetail?.divergence && (
                <p className="border-t border-[var(--color-border)] px-4 py-2 text-micro text-[var(--color-uncertain)]">
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
