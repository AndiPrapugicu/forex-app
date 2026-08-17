/**
 * Scorecard pipeline: history + COT + technicals -> the Top Setups matrix.
 *
 * Kept separate from lib/pipeline.ts because the two have genuinely different
 * shapes. The news pipeline wants a 48-hour window and runs every 10 minutes;
 * this one wants 150 days and barely changes between runs. Sharing a fetch would
 * force one of them to be wrong.
 *
 * Same failure policy throughout: every source degrades independently. Losing
 * COT costs two columns, not the page.
 */

import { ALL_SYMBOLS, TECHNICALS_TARGETS } from '@/config/symbols.config';
import { MAJORS } from '@/lib/types';
import { resolvePolicyRates } from '@/lib/scoring/rates';
import { resolveSeries } from '@/lib/scoring/discrete';
import { SLOTS } from '@/config/setups.config';
import {
  buildRiskGauge,
  buildSmartMoney,
  buildStrengthIndex,
  type RiskGauge,
  type SmartMoneyRow,
  type StrengthRow,
} from '@/lib/scoring/market';
import { fetchCotData, type CotSeries } from '@/lib/connectors/cftc';
import { fetchConferenceBoard } from '@/lib/connectors/conference-board';
import { fetchFxStreetHistory } from '@/lib/connectors/fxstreet';
import { backfillConsensus, fetchTradingViewForecasts } from '@/lib/connectors/tradingview';
import { fetchPrices } from '@/lib/connectors/prices';
import {
  fetchDailyBars,
  fetchTechnicals,
  fetchYield2y,
  type DailyBars,
  type Technicals,
} from '@/lib/connectors/technicals';
import {
  fetchSovereignYields,
  fetchYieldCurve,
  type SovereignYield,
  type YieldCurve,
} from '@/lib/connectors/yields';
import { buildSetupsMatrix, scoreAllCurrencies, type SetupsMatrix } from '@/lib/scoring/setups';
import { clusterSetups, type Cluster } from '@/lib/scoring/correlation';
import type { Currency, NormalizedEvent, Result, SourceHealth } from '@/lib/types';

export interface SetupsPayload {
  matrix: SetupsMatrix;
  health: SourceHealth[];
  /** Retained so the scorecard page can show per-slot release detail. */
  events: NormalizedEvent[];
  cot: Map<string, CotSeries>;
  technicals: Map<string, Technicals>;
  sovereignYields: Map<Currency, SovereignYield>;
  /** US 10y-2y, for the inversion read. Null fields when FRED is unreachable. */
  yieldCurve: YieldCurve;
  /** Cross-market reads, derived from the same fetch rather than a second one. */
  risk: RiskGauge;
  smartMoney: SmartMoneyRow[];
  strength: StrengthRow[];
  policyRates: Map<Currency, number>;
  /**
   * Directional setups grouped into the trades they actually are. The ranking
   * puts correlated symbols next to each other by construction, so this is what
   * stops the top five reading as five ideas when it is one.
   */
  clusters: Cluster[];
}

function toHealth(res: Result<unknown>): SourceHealth {
  return {
    source: res.source,
    ok: res.ok,
    detail: res.ok ? res.degraded : res.error,
    fetchedAtUtc: res.fetchedAtUtc,
  };
}

export async function runSetupsPipeline(now = new Date()): Promise<SetupsPayload> {
  const [history, cot, technicals, prices, yield2y, yields, curve, conferenceBoard, tvForecasts] =
    await Promise.all([
      fetchFxStreetHistory(now),
      fetchCotData(),
      // Scored symbols plus the aux instruments the risk gauge needs.
      fetchTechnicals(TECHNICALS_TARGETS),
      fetchPrices(),
      // Never throws; a failure just leaves the non-FX rate column blank — and now
      // says so in the health table, which it did not before.
      fetchYield2y(),
      fetchSovereignYields(),
      fetchYieldCurve(),
      fetchConferenceBoard(),
      // Forecast backfill only. Never contributes a release, an actual or a date.
      fetchTradingViewForecasts(now),
    ]);

  /**
   * Every source that can move a cell has a row here.
   *
   * `yield2y` was the omission that mattered: it was fetched, allowed to fail
   * silently, and never reported — yet losing it moves every commodity, index
   * and crypto row by ±1. A score that changes for a reason the health table
   * cannot name is exactly the flicker this phase exists to remove.
   */
  const health = [
    toHealth(history),
    toHealth(cot),
    toHealth(technicals),
    toHealth(prices),
    toHealth(yield2y),
    toHealth(yields),
    toHealth(curve),
    toHealth(conferenceBoard),
    toHealth(tvForecasts),
  ];

  /**
   * The Conference Board rows are appended to the calendar rather than merged
   * into it: they publish under the name the consumer-confidence slot already
   * prefers, so the ordinary resolver picks them ahead of Michigan with no
   * special-casing. If the source is down the list is empty and the column
   * quietly falls back, which is the whole point of appending.
   */
  /**
   * Then the forecast column is topped up from TradingView.
   *
   * Applied AFTER the merge above so a Conference Board row can be filled too,
   * and applied to the whole pool rather than per slot because the same release
   * feeds the heatmap and the indicator history as well — a cell that scores
   * against a borrowed forecast and a chart that says "no forecast" for the same
   * print would be the app disagreeing with itself.
   */
  const merged = [
    ...(history.ok ? history.data : []),
    ...(conferenceBoard.ok ? conferenceBoard.data : []),
  ];
  const backfill = backfillConsensus(merged, tvForecasts.ok ? tvForecasts.data : []);
  const events = backfill.events;
  const cotData = cot.ok ? cot.data : new Map<string, CotSeries>();
  const techData = technicals.ok ? technicals.data : new Map<string, Technicals>();
  // Losing this costs the market-implied rate read, not the column — every
  // currency falls back to the regime table and says so.
  const yieldData = yields.ok ? yields.data : new Map<Currency, SovereignYield>();
  const curveData: YieldCurve = curve.ok
    ? curve.data
    : { twoYear: null, tenYear: null, spread: null, observedOn: null, levelsLag: false };

  // Prices come keyed by display label from the existing connector; the matrix
  // wants them keyed by symbol.
  const priceMap = new Map<string, { price: number; changePct: number | null }>();
  if (prices.ok) {
    for (const def of ALL_SYMBOLS) {
      const quote = prices.data.find((p) => p.label === def.label || p.symbol === def.yahoo);
      if (quote) priceMap.set(def.symbol, { price: quote.price, changePct: quote.changePct });
    }
  }

  const matrix = buildSetupsMatrix({
    events,
    cot: cotData,
    technicals: techData,
    prices: priceMap,
    yield2y: yield2y.ok ? yield2y.data : null,
    sovereignYields: yieldData,
    now,
  });

  /**
   * Cross-market reads. All derived from data already fetched above — none of
   * these costs an extra request, which is why they are built here rather than
   * behind their own pipeline.
   */
  const policyRates = resolvePolicyRates(MAJORS, events, now);

  // CPI levels for the real-yield column. Read straight off the calendar via the
  // same resolver the CPI cell uses, so the two cannot disagree about which
  // series is the euro-area aggregate.
  const cpiSlot = SLOTS.find((s) => s.key === 'cpi')!;
  const cpiByCurrency = new Map<Currency, number>();
  for (const currency of MAJORS) {
    const event = resolveSeries(cpiSlot, currency, events);
    if (event?.actual !== null && event?.actual !== undefined) cpiByCurrency.set(currency, event.actual);
  }

  const labels = new Map(
    ALL_SYMBOLS.filter((s) => s.cotContract).map((s) => [s.cotContract as string, s.label]),
  );

  /**
   * Daily bars for the directional rows only. Clustering 49 symbols would mean
   * 49 extra Yahoo calls on every page render for rows that are Neutral and
   * therefore not positions.
   */
  const directional = matrix.rows.filter((r) => r.bias !== 'Neutral');
  const bars = new Map<string, DailyBars>();
  const BATCH = 6;
  for (let i = 0; i < directional.length; i += BATCH) {
    const batch = directional.slice(i, i + BATCH);
    const got = await Promise.all(
      batch.map((r) => {
        const def = ALL_SYMBOLS.find((s) => s.symbol === r.symbol);
        return def ? fetchDailyBars(def.yahoo).catch(() => null) : Promise.resolve(null);
      }),
    );
    got.forEach((b, k) => { if (b) bars.set(batch[k].symbol, b); });
  }

  return {
    matrix,
    health,
    events,
    cot: cotData,
    technicals: techData,
    sovereignYields: yieldData,
    yieldCurve: curveData,
    risk: buildRiskGauge(techData),
    smartMoney: buildSmartMoney(cotData, labels),
    strength: buildStrengthIndex(
      MAJORS,
      scoreAllCurrencies(events, now),
      policyRates,
      cpiByCurrency,
      events,
      now,
    ),
    policyRates,
    clusters: clusterSetups(matrix.rows, bars),
  };
}
