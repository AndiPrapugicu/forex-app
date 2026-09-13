/**
 * The Chart page: one high-conviction setup, its levels, and whether everything
 * agrees.
 *
 * This is the step after the board. Top Setups ranks what to trade; this says
 * whether price is anywhere sensible to trade it from, which is the question the
 * scorecard has never been able to answer.
 *
 * SYMBOL AND TIMEFRAME LIVE IN THE URL, not in component state. That keeps the
 * page a server component — it can fetch bars for the ONE symbol being looked at
 * rather than for every qualifying setup, which is the difference between one
 * Yahoo call and twenty. It also makes a particular read linkable.
 */

import {
  CURRENCY_COT_CONTRACT,
  findSymbol,
  tradingViewSymbol,
} from '@/config/symbols.config';
import {
  fetchBars,
  fetchDailyBars,
  isChartTimeframe,
  type ChartTimeframe,
} from '@/lib/connectors/technicals';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { buildAlignment } from '@/lib/scoring/alignment';
import { readCotFlow } from '@/lib/scoring/cot-flow';
import { buildSetupBrief } from '@/lib/scoring/setup-brief';
import { analyseStructure } from '@/lib/scoring/structure';
import { buildTradeIdea, upcomingEventRisk } from '@/lib/scoring/trade-ideas';
import { ChartWorkspace } from '@/components/ChartWorkspace';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Conviction thresholds offered.
 *
 * The user's own words: "not barely a +4 bullish, but more like a 7 Bullish, or
 * 9 Very Bullish, or the best 12". 7 is the default because it is where they
 * said they start paying attention, not because anything in the data marks it.
 */
export const CONVICTION_LEVELS = [7, 9, 12] as const;

export default async function ChartPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; tf?: string; min?: string }>;
}) {
  const params = await searchParams;
  const timeframe: ChartTimeframe = isChartTimeframe(params.tf) ? params.tf : '1d';

  const requestedMin = Number(params.min);
  const minScore = CONVICTION_LEVELS.includes(requestedMin as (typeof CONVICTION_LEVELS)[number])
    ? requestedMin
    : 7;

  let payload;
  try {
    payload = await runSetupsPipeline();
  } catch (error) {
    return (
      <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
        <h1 className="mb-4 text-title font-semibold tracking-tight">Chart</h1>
        <Panel title="Unavailable">
          <EmptyState
            message="Could not load setups"
            hint={error instanceof Error ? error.message : String(error)}
          />
        </Panel>
      </div>
    );
  }

  const { matrix, technicals, cot, events, clusters } = payload;

  const qualifying = matrix.rows
    .filter((r) => Math.abs(r.totalScore) >= minScore)
    .sort((a, b) => Math.abs(b.totalScore) - Math.abs(a.totalScore));

  const requested = params.symbol ? findSymbol(params.symbol) : undefined;
  const selected =
    (requested && qualifying.find((r) => r.symbol === requested.symbol)) ??
    (requested && matrix.rows.find((r) => r.symbol === requested.symbol)) ??
    qualifying[0] ??
    null;

  if (!selected) {
    return (
      <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
        <h1 className="mb-4 text-title font-semibold tracking-tight">Chart</h1>
        <Panel title={`Nothing at ${minScore} or beyond`}>
          <EmptyState
            message={`No setup currently scores ±${minScore} or better`}
            hint="Lower the conviction filter, or wait — this is the filter doing its job."
          />
        </Panel>
      </div>
    );
  }

  const def = findSymbol(selected.symbol)!;

  /**
   * WHICH SERIES THE LEVELS ARE MEASURED ON, which is not always the one drawn.
   *
   * Swing detection needs pivots that mean something, and on a 1- or 5-minute
   * series they do not: a 200-bar lookback is three hours, so every third wiggle
   * registers as a break of structure and the chart fills with levels that will
   * not exist by lunchtime. Those two widths exist to WATCH price move, and the
   * levels a trader wants while watching are the daily ones anyway — so they
   * borrow the daily structure, which this page already fetches for free.
   *
   * 15m and coarser measure their own, as 4H always has. Everything downstream
   * is told which series it got, so nothing labels a daily level as intraday.
   */
  const structureTimeframe: ChartTimeframe =
    timeframe === '1m' || timeframe === '5m' ? '1d' : timeframe;

  /**
   * Two fetches at most, and usually one: the daily series is needed either as
   * the chart itself or as the structure source behind an intraday view, and
   * `fetchBars('1d')` shares its cache entry with `fetchDailyBars` exactly.
   */
  const [bars, structureBars] = await Promise.all([
    fetchBars(def.yahoo, timeframe),
    structureTimeframe === timeframe ? Promise.resolve(null) : fetchDailyBars(def.yahoo),
  ]);

  const levelSource = structureTimeframe === timeframe ? bars : structureBars;

  const tech = technicals.get(selected.symbol);

  /**
   * DAILY moving averages, even on the intraday charts. A 200-period average of
   * 4H bars is a 33-day line that nobody watches; the daily 200 is what is
   * actually on the trader's screen, and relabelling one as the other would be
   * the same name over a different price. (The SMA lines the chart now draws are
   * a separate thing, computed on the displayed series and labelled as such.)
   */
  const view = levelSource
    ? analyseStructure(levelSource, {
        20: tech?.sma20 ?? null,
        50: tech?.sma50 ?? null,
        100: tech?.sma100 ?? null,
        200: tech?.sma200 ?? null,
      })
    : null;

  /**
   * Which COT contract speaks for this symbol.
   *
   * FX pairs carry no `cotContract` of their own — the matrix differences the
   * two legs — so fall back to the BASE currency's contract. Long GBPUSD is long
   * sterling, so sterling's weekly flow is the one that either agrees with the
   * call or does not. Reading it off the raw series the pipeline already fetched
   * keeps this and /cot working from identical numbers.
   */
  const contract = def.cotContract ?? (def.base ? CURRENCY_COT_CONTRACT[def.base] : undefined);
  const series = contract ? cot.get(contract) : undefined;

  const alignment = buildAlignment({
    row: selected,
    structure: view,
    flow: series ? readCotFlow(series) : null,
    events: upcomingEventRisk([def.base, def.quote, def.macroEconomy], events),
    cluster: clusters.find((c) => c.members.some((m) => m.symbol === selected.symbol)) ?? null,
    minScore,
  });

  const brief = buildSetupBrief({
    symbol: selected.symbol,
    label: def.label,
    row: selected,
    view,
    alignment,
    timeframe,
    structureTimeframe,
  });

  /**
   * The same entry/stop/target the rest of the app shows, so the markers on the
   * chart cannot drift from the numbers in the trade panel — one function, one
   * set of levels. Null below the conviction floor, in which case nothing is
   * drawn rather than something approximate being drawn.
   */
  const idea = buildTradeIdea(selected, tech);

  return (
    <ChartWorkspace
      brief={brief}
      row={selected}
      label={def.label}
      candidates={qualifying}
      minScore={minScore}
      timeframe={timeframe}
      structureTimeframe={structureTimeframe}
      bars={bars}
      view={view}
      idea={idea}
      alignment={alignment}
      tradingViewSymbol={tradingViewSymbol(def)}
    />
  );
}
