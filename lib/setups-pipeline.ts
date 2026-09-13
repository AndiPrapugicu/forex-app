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
import { DEFAULT_PROFILE, type BoardProfile } from '@/config/profiles.config';
import { FAIRECONOMY } from '@/config/sources.config';
import {
  buildRiskGauge,
  buildSmartMoney,
  buildStrengthIndex,
  type RiskGauge,
  type SmartMoneyRow,
  type StrengthRow,
} from '@/lib/scoring/market';
import {
  buildEcoStrengthInputs,
  computeEcoStrength,
  type EcoStrengthRow,
} from '@/lib/scoring/eco-strength';
import { fetchCotData, type CotSeries } from '@/lib/connectors/cftc';
import { fetchRetailPositioning } from '@/lib/connectors/crowd';
import type { RetailPositioning, RetailPositioningFeed } from '@/lib/scoring/crowd';
import { fetchConferenceBoard } from '@/lib/connectors/conference-board';
import { fetchFairEconomyCalendar, toForecastRows } from '@/lib/connectors/faireconomy';
import { fetchFxStreetHistory } from '@/lib/connectors/fxstreet';
import {
  accumulatePmiActuals,
  fetchPmiHistory,
  pmiHistoryNote,
  unionPmiHistory,
} from '@/lib/connectors/pmi-history';
import { dropSupersededSeed } from '@/lib/scoring/pmi-seed-precedence';
import {
  backfillConsensus,
  fetchTradingViewActuals,
  fetchTradingViewForecasts,
} from '@/lib/connectors/tradingview';
import { fetchPrices } from '@/lib/connectors/prices';
import {
  fetchDailyBars,
  fetchTechnicals,
  fetchYield2y,
  type DailyBars,
  type Technicals,
  type Yield2y,
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
  /**
   * Echoed so a caller that rebuilds the matrix from this payload builds the
   * SAME board — the `yield2y` lesson, applied before it can bite.
   */
  profile: BoardProfile;
  health: SourceHealth[];
  /** Retained so the scorecard page can show per-slot release detail. */
  events: NormalizedEvent[];
  /**
   * The pool BEFORE the PMI seed's precedence was settled against today — what
   * a rewinding caller must pass to `asOf`.
   *
   * `events` has already dropped every seed row a live print supersedes, which
   * is right for the live board and wrong for a replay: rewind it to
   * 2026-09-02 and the seed rows that were the only reading that day are
   * already gone. `asOf` re-applies the precedence rule for its own frame.
   */
  rewindPool: NormalizedEvent[];
  cot: Map<string, CotSeries>;
  technicals: Map<string, Technicals>;
  sovereignYields: Map<Currency, SovereignYield>;
  /**
   * The US 2-year against its 21-day average — the input to the rate column for
   * DXY and every non-FX asset.
   *
   * ON THE PAYLOAD BECAUSE ANYONE WHO REBUILDS THE MATRIX NEEDS IT. It was
   * fetched here, passed into the `buildSetupsMatrix` call below, and then
   * dropped, so the pages were right and every consumer that rebuilt the matrix
   * from this payload was not. `scripts/parity.ts` is one, and the consequence
   * was that fifteen rows scored their rate column BLANK in every parity run
   * while the live page scored them +/-1 — the diagnostic and the app disagreeing
   * about the same board, with DXY reading -7 in one and -8 in the other.
   *
   * Null when the fetch failed, which `health` already reports.
   */
  yield2y: Yield2y | null;
  /**
   * Per-symbol retail positioning, for the same reason `yield2y` is here: any
   * caller that rebuilds the matrix from this payload must be fed the SAME
   * reading, or the diagnostic and the app disagree about the Crowd column.
   *
   * Empty when no provider is configured, which is the default.
   */
  retailPositioning: RetailPositioningFeed;
  /** US 10y-2y, for the inversion read. Null fields when FRED is unreachable. */
  yieldCurve: YieldCurve;
  /** Cross-market reads, derived from the same fetch rather than a second one. */
  risk: RiskGauge;
  smartMoney: SmartMoneyRow[];
  strength: StrengthRow[];
  /** Where each economy STANDS, as against how it surprised. See eco-strength.ts. */
  ecoStrength: EcoStrengthRow[];
  policyRates: Map<Currency, number>;
  /**
   * Directional setups grouped into the trades they actually are. The ranking
   * puts correlated symbols next to each other by construction, so this is what
   * stops the top five reading as five ideas when it is one.
   */
  clusters: Cluster[];
}

/**
 * The same board under A1's proven data gaps, for the mirror's coverage tier.
 *
 * Rebuilt from the payload rather than fetched twice: every input is already in
 * hand, so this is CPU only. Never stored and never measured — mirror mode is
 * presentation (see `lib/scoring/a1-mirror.ts`).
 */
export function buildA1ProfileRows(
  payload: Pick<
    Awaited<ReturnType<typeof runSetupsPipeline>>,
    'events' | 'cot' | 'technicals' | 'sovereignYields' | 'yield2y' | 'retailPositioning'
  >,
) {
  return buildSetupsMatrix({
    events: payload.events,
    cot: payload.cot,
    technicals: payload.technicals,
    sovereignYields: payload.sovereignYields,
    yield2y: payload.yield2y,
    retailPositioning: payload.retailPositioning,
    profile: 'a1',
  }).rows;
}

function toHealth(res: Result<unknown>): SourceHealth {
  return {
    source: res.source,
    ok: res.ok,
    detail: res.ok ? res.degraded : res.error,
    fetchedAtUtc: res.fetchedAtUtc,
  };
}

/**
 * Why the price cutoff is NOT just `now`.
 *
 * `now` is what the CALENDAR connectors fetch around, and rewinding it narrows
 * the window: at `now = 2026-08-25` the RBNZ's 2026-09-02 decision is not
 * downloaded at all, and NZD's rates cell drops from +1 to 0. That event was
 * public knowledge on the day, which is exactly why `asOf` keeps future-dated
 * rows that still have no actual — filtering is its job, and it happens after
 * the fetch.
 *
 * The PRICE series needs the opposite treatment: a moving average has to be cut
 * at the moment being reproduced or it is not that moment's average.
 *
 * Measured 2026-08-30: conflating the two cost NZDX's rates cell while fixing
 * the trend cells. Two parameters, because they are two questions.
 */
export interface PipelineOptions {
  /** Drop price bars after this instant. Defaults to `now`, which drops none. */
  pricesAsOf?: Date;
  /** Which board to build. `ours` unless a parity script asks for `a1`. */
  profile?: BoardProfile;
}

export async function runSetupsPipeline(
  now = new Date(),
  options: PipelineOptions = {},
): Promise<SetupsPayload> {
  const [
    history, cot, technicals, prices, yield2y, yields, curve,
    conferenceBoard, tvForecasts, ffCalendar, tvActuals, retail, pmiHistory,
  ] =
    await Promise.all([
      fetchFxStreetHistory(now),
      fetchCotData(),
      /**
       * Scored symbols plus the aux instruments the risk gauge needs.
       *
       * The price cutoff was not passed until 2026-08-30. Without it the moving
       * averages — and the trend cell over them — were always the tail of the
       * series, so a rewound board mixed today's technicals with the frame's
       * economics. See `seriesAsOf` for the measurement.
       */
      fetchTechnicals(TECHNICALS_TARGETS, options.pricesAsOf ?? now),
      fetchPrices(),
      /**
       * Never throws; a failure just leaves the non-FX rate column blank — and
       * now says so in the health table, which it did not before.
       *
       * REWOUND WITH THE PRICES, as of 2026-08-31. This was the last
       * price-derived input still reading live on a replayed board. The cutoff
       * was tried on 2026-08-30 and reverted then for a good reason: Yahoo's
       * 2YY=F closes stalled for weeks, so cutting them replaced a live quote
       * with a stale close rather than reproducing the past yield. The source
       * is now FRED DGS2, which moves, so the cutoff does what it says.
       */
      fetchYield2y(options.pricesAsOf ?? now),
      fetchSovereignYields(),
      fetchYieldCurve(),
      fetchConferenceBoard(),
      // Forecast backfill only. Never contributes a release, an actual or a date.
      fetchTradingViewForecasts(now),
      // Second forecast source, same contract. Current week only, by design.
      fetchFairEconomyCalendar(),
      // The allowlisted series FXStreet does not carry at all. Served from the
      // same cached responses as the forecasts above.
      fetchTradingViewActuals(now),
      /**
       * Per-symbol retail positioning — A1's actual Crowd input.
       *
       * Fails closed and cheaply: with no credentials configured this resolves
       * to an error Result in a few microseconds without touching the network,
       * every symbol falls back to the CFTC contract read, and the health table
       * says why the column is blank on crosses.
       */
      fetchRetailPositioning(),
      /**
       * PMI actuals the calendar has nulled out: a committed seed from A1's
       * captured charts, plus every print this app has since observed and
       * stored. A store read, so it stays parallel with the fetches.
       */
      fetchPmiHistory(now),
    ]);

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
    /**
     * Appended on the same terms as the Conference Board rows above: they
     * publish under a name only their own slot matches, so the ordinary
     * resolver finds them without special-casing, and if the source is down the
     * list is empty and the column goes quietly blank.
     */
    ...(tvActuals.ok ? tvActuals.data : []),
  ];
  const backfill = backfillConsensus(merged, tvForecasts.ok ? tvForecasts.data : []);

  /**
   * Then ForexFactory, over whatever TradingView could not reach.
   *
   * CHAINED RATHER THAN COMBINED, and the order is the precedence: the pass
   * only writes where `consensus` is still null, so it is idempotent and the
   * first source to offer a number keeps it. TradingView goes first because it
   * spans the full 150-day window; ForexFactory publishes only the current week
   * and would otherwise win the newest rows on nothing but ordering.
   */
  const ffForecasts = ffCalendar.ok ? toForecastRows(ffCalendar.data) : [];
  const ffBackfill = backfillConsensus(backfill.events, ffForecasts, FAIRECONOMY.name);
  /**
   * PMI history is appended AFTER both forecast backfills, so neither can lend
   * a borrowed consensus to a seeded row. Precedence is then settled for the
   * live board only; `rewindPool` keeps the unsettled pool for replays.
   */
  const rewindPool = unionPmiHistory(ffBackfill.events, pmiHistory.ok ? pmiHistory.data : []);
  const events = dropSupersededSeed(rewindPool);

  /**
   * How many forecasts actually landed, next to how many were offered.
   *
   * This count was computed and thrown away, and that is precisely why the
   * backfill could sit broken without anyone noticing: it fetched 1,526 rows,
   * lent 64, and reported a confident green tick either way. A source that is
   * reachable and useless looks exactly like a source that is working unless
   * something counts the difference out loud.
   */
  const offered = tvForecasts.ok ? tvForecasts.data.length : 0;
  const tvHealth = toHealth(tvForecasts);
  tvHealth.note = `lent ${backfill.filled} consensus of ${offered} offered`;

  const ffHealth = toHealth(ffCalendar);
  ffHealth.note = `lent ${ffBackfill.filled} consensus of ${ffForecasts.length} offered (current week only)`;

  /**
   * Say how many symbols the retail feed actually answered for.
   *
   * The same lesson as the forecast-backfill count above: a provider that
   * authenticates and returns nothing useful looks identical to a working one
   * unless something reports the coverage out loud. This is the number that
   * decides whether the Crowd column is fixed or merely wired.
   */
  const retailFeed = retail.ok ? retail.data : new Map<string, RetailPositioning>();
  const retailHealth = toHealth(retail);
  retailHealth.note = retail.ok
    ? `${retailFeed.size} symbols covered`
    : 'crosses unscored on the Crowd column; dollar pairs fall back to CFTC';

  /**
   * Every source that can move a cell has a row here.
   *
   * `yield2y` was the omission that mattered: it was fetched, allowed to fail
   * silently, and never reported — yet losing it moves every commodity, index
   * and crypto row by ±1. A score that changes for a reason the health table
   * cannot name is exactly the flicker this phase exists to remove.
   *
   * Built after the backfill rather than beside the fetches, because the
   * TradingView row reports what it LENT, which is not known until then.
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
    tvHealth,
    ffHealth,
    toHealth(tvActuals),
    retailHealth,
    { ...toHealth(pmiHistory), note: pmiHistoryNote(pmiHistory.counts) },
  ];
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

  /**
   * Hoisted so the matrix built here and the one a caller rebuilds from the
   * payload are fed the SAME reading. Inlining it into the call below is what
   * let this value stay invisible to every other consumer.
   */
  const yield2yData = yield2y.ok ? yield2y.data : null;

  const matrix = buildSetupsMatrix({
    events,
    cot: cotData,
    technicals: techData,
    prices: priceMap,
    yield2y: yield2yData,
    sovereignYields: yieldData,
    retailPositioning: retailFeed,
    now,
    profile: options.profile,
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

  /**
   * Hoisted out of the `buildStrengthIndex` call below because two readings now
   * need it. Scoring every currency twice would not just cost time - it would
   * let the strength table and the eco strength index resolve different
   * releases if the clock ticked between them.
   */
  const currencyScores = scoreAllCurrencies(events, now);

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

  // Fire-and-forget: persisting what we observed must never delay or fail a
  // render. The laundering guard inside refuses every A1-sourced row.
  void accumulatePmiActuals(events, now).catch(() => {});

  return {
    matrix,
    profile: options.profile ?? DEFAULT_PROFILE,
    health,
    events,
    rewindPool,
    cot: cotData,
    technicals: techData,
    sovereignYields: yieldData,
    yield2y: yield2yData,
    retailPositioning: retailFeed,
    yieldCurve: curveData,
    risk: buildRiskGauge(techData),
    smartMoney: buildSmartMoney(cotData, labels),
    strength: buildStrengthIndex(MAJORS, currencyScores, policyRates, cpiByCurrency, events, now),
    /**
     * A SEPARATE READING FROM `strength`, and deliberately not folded into it.
     *
     * `strength` ranks on SURPRISE - the sum of a currency's economic cells,
     * which is how each release compared to what was expected. This ranks on
     * LEVEL: where the economy actually stands. A country can beat a low bar
     * and lead the first table while sitting last in this one, and both are
     * true answers to different questions. Adding them would double count the
     * same release, which is why `totalScore` never sees this.
     */
    ecoStrength: computeEcoStrength(buildEcoStrengthInputs(MAJORS, currencyScores, policyRates)),
    policyRates,
    clusters: clusterSetups(matrix.rows, bars),
  };
}
