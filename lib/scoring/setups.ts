/**
 * Builds the Top Setups matrix: every symbol scored across every slot.
 *
 * The composition rule differs by slot kind, and that difference is the heart of
 * the whole thing:
 *
 *   economic   per CURRENCY, so a pair cell is base minus quote. A GDP beat in
 *              the euro area and a miss in the US both argue for EURUSD upside.
 *   technical  per SYMBOL. EURUSD trending up says nothing about EURJPY, so
 *              these are never derived from legs.
 *   sentiment  per CONTRACT — but the two sentiment columns are not the same
 *              shape. COT is differenced across a pair's legs, because each
 *              currency has its own contract and A1's own card reconciles that
 *              way. Crowd is resolved PER SYMBOL in `lib/scoring/crowd.ts` and
 *              is never differenced; a cross with no contract goes unscored
 *              rather than being built out of two dollar pairs.
 */

import {
  MATRIX_SLOTS,
  SLOTS,
  biasFromScore,
  type Bias,
  type SlotCategory,
} from '@/config/setups.config';
import { ALL_SYMBOLS, CURRENCY_COT_CONTRACT, type SymbolDefinition } from '@/config/symbols.config';
import type { CotSeries } from '@/lib/connectors/cftc';
import type { Technicals } from '@/lib/connectors/technicals';
import type { SovereignYield } from '@/lib/connectors/yields';
import { scoreCot, type CotScore } from '@/lib/scoring/cot';
import { resolveCrowd, type CrowdBasis, type RetailPositioningFeed } from '@/lib/scoring/crowd';
import {
  PAIR_CELL_MAX,
  combinePairCells,
  normalizeZero,
  priorPrint,
  scoreSlot,
  type CellStatus,
  type SlotResult,
} from '@/lib/scoring/discrete';
import projectionSnapshots from '@/fixtures/a1-rate-projections.json';
import { scoreRateExpectation, type RateExpectation } from '@/lib/scoring/rates';
import {
  resolveConsensusProjectionLegs,
  type RateProjectionSnapshot,
} from '@/lib/scoring/rate-projections';
import { scoreSeasonality, scoreTrend, scoreYield2y } from '@/lib/scoring/technical';
import { MAJORS, type Currency, type NormalizedEvent } from '@/lib/types';

/**
 * One economy's contribution to a cell, kept in structured form.
 *
 * The scorecard needs actual / forecast / previous as COLUMNS, not prose. All of
 * this was already computed and then thrown away in favour of a concatenated
 * string, which is how the detail column ended up reading
 * "EUR: Consumer Confidence: -15.9 vs -15.9 forecast (0.00σ) | USD: Michigan…".
 */
export interface CellLeg {
  /** The currency whose release this is. */
  currency: Currency;
  /** The resolved series name — "Harmonized Index of Consumer Prices (YoY)". */
  seriesName: string | null;
  actual: number | null;
  /** What the score compared against: forecast normally, previous for PMI. */
  reference: number | null;
  referenceLabel: 'forecast' | 'previous';
  consensus: number | null;
  previous: number | null;
  unit: string | null;
  sigma: number | null;
  dateUtc: string | null;
  /** This leg's own ±1 before it is differenced or inverted. */
  cell: number | null;
  status: CellStatus;
  /**
   * Who published the forecast, when it was not the calendar of record.
   *
   * Null for the ordinary case. Set when `backfillConsensus` lent one, because
   * "beat forecast" invites the question whose forecast, and until now the
   * answer was written into the event and read by nothing.
   */
  consensusSource?: string | null;
  /**
   * Who published the ACTUAL, when it was not FXStreet — the allowlisted series
   * in `TRADINGVIEW.actualSeries`. A reader comparing this cell against the
   * calendar of record has to be able to see that it is not in there.
   */
  actualSource?: string | null;
}

export interface MatrixCell {
  slotKey: string;
  cell: number | null;
  status: CellStatus;
  /** Rendered on hover; the reason the cell reads the way it does. */
  explanation: string;
  /** Per-leg detail, so the scorecard can show where a pair cell came from. */
  baseCell?: number | null;
  quoteCell?: number | null;
  /**
   * Set when `status` is 'partial': the leg that was expected and did not
   * arrive. The number above is built from the other leg alone.
   */
  missingLeg?: string | null;
  /**
   * Structured legs — one for a single-economy asset, two for a pair, several
   * for a composite like PMI. Empty for technical and sentiment slots, which
   * have no calendar release behind them.
   */
  legs?: CellLeg[];
  /** Extra note the cell carries beyond its legs, e.g. the CPI level band. */
  note?: string;
  /**
   * A contributing leg's print is older than its cadence window — DISPLAY
   * ONLY, and never a reason the cell is blank.
   *
   * There used to be a `stale` STATUS here that meant blank, and removing it is
   * the point: A1 scores a 125-day-old Canadian services PMI, so suppressing
   * one was reproducing our policy instead of their board. See `maxAgeFor`.
   */
  stale?: boolean;
  /**
   * WHICH POPULATION a sentiment cell was measured on, where the column has
   * more than one and they are not interchangeable.
   *
   * Crowd only, today. `resolveCrowd` computed this from the day it was
   * written and `buildSetupsMatrix` dropped it on the floor, so the one column
   * that can silently swap a WEEKLY CME FUTURES read for a DAILY RETAIL SPOT
   * book was also the one column whose provenance never left the resolver.
   * Every economic cell already carries `referenceLabel`, `consensusSource`
   * and `actualSource` for exactly this reason; this closes the gap.
   *
   * Undefined on every non-sentiment cell, which is not the same as `'none'`
   * and must not be read as it: `'none'` is a crowd cell that RESOLVED to
   * nothing, and undefined is a column this question does not apply to.
   */
  basis?: CrowdBasis;
}

export interface SymbolRow {
  symbol: string;
  label: string;
  kind: SymbolDefinition['kind'];
  base?: Currency;
  quote?: Currency;
  /**
   * Sum of the populated SCORING cells. Context columns are rendered but never
   * counted — A1's bias bands are absolute, so an extra column would quietly
   * redefine "Bullish". See SlotDefinition.scoring.
   */
  totalScore: number;
  bias: Bias;
  /** Subtotals by category, for the scorecard breakdown. */
  categoryScores: Record<SlotCategory, number>;
  cells: Record<string, MatrixCell>;
  /**
   * How many scoring slots produced a COMPLETE score — thin rows deserve less
   * trust. A partial cell is excluded: it still contributes its known leg to
   * `totalScore`, but counting it here would let an upstream failure masquerade
   * as coverage.
   */
  populated: number;
  /** Scoring cells built from one leg because the other failed. */
  partial: number;
  price: number | null;
  changePct: number | null;
}

export interface SetupsMatrix {
  rows: SymbolRow[];
  /** Latest COT report date. Must be displayed — the data lags by design. */
  cotReportDate: string | null;
  generatedAtUtc: string;
}

/** Per-currency slot results, computed once and reused across all 28 pairs. */
export type CurrencySlotScores = Map<Currency, Map<string, SlotResult>>;

export function scoreAllCurrencies(
  events: NormalizedEvent[],
  now = new Date(),
): CurrencySlotScores {
  const out: CurrencySlotScores = new Map();

  for (const currency of MAJORS) {
    const slots = new Map<string, SlotResult>();
    for (const slot of SLOTS) {
      if (slot.kind !== 'economic') continue;
      slots.set(slot.key, scoreSlot(slot, currency, events, now));
    }
    out.set(currency, slots);
  }

  return out;
}

/**
 * COT scores per currency, from each currency's own contract.
 *
 * Scored with the 'fx' rule, which reads only the weekly change. Net positioning
 * is deliberately excluded here and included for commodities, indices and crypto
 * — that asymmetry is A1's, and it stops a pair double-counting a signal they
 * count once.
 *
 * COT ONLY. This used to return a parallel crowd map, which existed solely to be
 * differenced across a pair's two legs; the Crowd column is resolved per symbol
 * in `lib/scoring/crowd.ts` now and never touches a per-currency lookup.
 */
function scoreCotByCurrency(cot: Map<string, CotSeries>) {
  const cotByCurrency = new Map<Currency, CotScore | null>();

  for (const currency of MAJORS) {
    cotByCurrency.set(currency, scoreCot(cot.get(CURRENCY_COT_CONTRACT[currency]), 'fx'));
  }

  return cotByCurrency;
}

function emptyCategoryScores(): Record<SlotCategory, number> {
  return { technical: 0, sentiment: 0, growth: 0, inflation: 0, jobs: 0 };
}

/**
 * Flattens a scored slot into the structured legs the scorecard renders.
 *
 * A composite slot (PMI) expands into one leg per sub-series, because
 * "Manufacturing 55.6 vs 53.3, Services 54.1 vs 54.0" is the readable form and
 * a single merged row would have to pick one set of numbers.
 */
function toLegs(currency: Currency, result: SlotResult | undefined, compare?: 'forecast' | 'previous'): CellLeg[] {
  if (!result) return [];

  /**
   * What the cell was measured against, reported by the RESULT rather than
   * re-derived from the slot's request.
   *
   * These agree today. They are read this way round so that they cannot quietly
   * disagree later: `scoreSlot` decides the basis, and anything that changes
   * that decision — a fallback, a per-currency rule — would otherwise leave
   * this label describing the intent instead of the arithmetic.
   */
  const referenceLabel = result.referenceLabel ?? (compare === 'previous' ? 'previous' : 'forecast');

  const build = (event: NormalizedEvent | null, cell: number | null, sigma: number | null): CellLeg => ({
    currency,
    seriesName: event?.name ?? null,
    actual: event?.actual ?? null,
    reference: (event === null ? null : referenceLabel === 'previous' ? priorPrint(event) : event.consensus) ?? null,
    referenceLabel,
    consensus: event?.consensus ?? null,
    previous: event?.previous ?? null,
    unit: event?.unit ?? null,
    sigma,
    dateUtc: event?.dateUtc ?? null,
    cell,
    status: result.status,
    consensusSource: event?.consensusSource ?? null,
    actualSource: event?.actualSource ?? null,
  });

  if (result.components?.length) {
    return result.components.map((c) => build(c.event, c.cell, null));
  }

  // A slot with no resolved release still produces a leg, so the table can show
  // WHY it is blank rather than omitting the row entirely.
  return [build(result.event, result.cell, result.sigma)];
}

/**
 * Why a single-economy asset reads a print upside down.
 *
 * Category-specific because the REASON differs, and one generic sentence gets it
 * wrong: gold inverts growth because it is a haven, but every non-FX asset
 * inverts inflation for a completely different reason — the rates channel.
 * "A stronger economy weighs on this asset" is simply false next to a CPI row.
 */
/**
 * The sentence a partial cell owes the reader.
 *
 * Without it the number looks like every other number. With it, the tooltip
 * says which half of the comparison is missing, which is exactly what someone
 * asking "why did this move overnight?" needs to know.
 */
function missingLegNote(missingLeg: string | null): string | null {
  if (!missingLeg) return null;
  return `Partial: the ${missingLeg} leg is missing, so this reads from the other leg alone.`;
}

function invertedNote(category: SlotCategory): string {
  if (category === 'inflation') {
    return 'Inverted: a hotter print prices in tighter policy, which weighs on this asset.';
  }
  return 'Inverted: a stronger economy weighs on this asset.';
}

export interface BuildMatrixInput {
  events: NormalizedEvent[];
  cot: Map<string, CotSeries>;
  technicals: Map<string, Technicals>;
  prices?: Map<string, { price: number; changePct: number | null }>;
  /**
   * US 2-year yield and its 7-day average. Drives the rate cell for NON-FX
   * assets only; currency pairs use `sovereignYields` below.
   */
  yield2y?: { current: number; sma: number } | null;
  /** 2-year government yields per currency, for the FX rate-expectation cell. */
  sovereignYields?: Map<Currency, SovereignYield>;
  /**
   * Per-symbol retail long/short, keyed by symbol — the Crowd column's most
   * direct source and the only one that reaches a cross.
   *
   * Absent in production today: no free retail-positioning provider has been
   * accepted into this repo, so every symbol falls through to its own futures
   * contract and crosses go unscored. Supplying it is what makes crosses score,
   * and `lib/scoring/crowd.ts` documents why nothing else is used in its place.
   */
  retailPositioning?: RetailPositioningFeed;
  now?: Date;
}

export function buildSetupsMatrix(input: BuildMatrixInput): SetupsMatrix {
  const now = input.now ?? new Date();

  const currencyScores = scoreAllCurrencies(input.events, now);
  const cotByCurrency = scoreCotByCurrency(input.cot);

  // Rate expectations per currency, computed once and reused across all 28 pairs.
  const yields = input.sovereignYields ?? new Map<Currency, SovereignYield>();

  /**
   * THE QUARTERLY CONSENSUS, RESOLVED ONCE FOR THE WHOLE BOARD.
   *
   * Resolved here rather than inside `scoreRateExpectation` because it is
   * all-or-nothing: a rates cell is a DIFFERENCE, and a leg from this rule
   * differenced against a leg from the fallback ladder is two models subtracted.
   * `resolveConsensusProjectionLegs` returns null the moment any major is
   * uncovered, and then no currency uses it. That is the seam four earlier
   * rounds recorded as the reason this rule could not ship.
   *
   * Snapshots are dated readings of a page with no history of its own, so a
   * board wound back before the earliest reading gets nothing and falls through
   * — correctly. See `lib/scoring/rate-projections.ts`.
   */
  const consensus = resolveConsensusProjectionLegs(
    (projectionSnapshots as { snapshots: RateProjectionSnapshot[] }).snapshots,
    MAJORS,
    now.toISOString().slice(0, 10),
  );

  const ratesByCurrency = new Map<Currency, RateExpectation>();
  for (const currency of MAJORS) {
    ratesByCurrency.set(
      currency,
      scoreRateExpectation(currency, yields, input.events, now, consensus.legs?.get(currency)),
    );
  }

  const rows: SymbolRow[] = [];

  for (const def of ALL_SYMBOLS) {
    const cells: Record<string, MatrixCell> = {};
    const categoryScores = emptyCategoryScores();
    let total = 0;
    let populated = 0;
    let partialCount = 0;

    const tech = input.technicals.get(def.symbol);
    // A pair has two currency legs; gold, indices and crypto have none, and that
    // distinction is what selects the COT, seasonality and rate rules below.
    const isFx = def.kind === 'fx';

    // MATRIX_SLOTS, not SLOTS: the heatmap-only columns are scored per currency
    // above but have no place on this board — A1's Top Setups has no column for
    // them either.
    for (const slot of MATRIX_SLOTS) {
      let cell: MatrixCell;

      if (slot.kind === 'rates') {
        /**
         * Three rules under one column, which is A1's design rather than a
         * shortcut of ours:
         *
         *   FX        each leg's rate expectation, then base minus quote — a
         *             rate DIFFERENTIAL.
         *   DXY       the US 2-year against its 21-day average, INVERTED. Their
         *             card labels this row "2 Yr Yield (21 day SMA)" verbatim.
         *   other     that currency's own rate expectation, the same single-leg
         *   currency   read a pair uses for its base.
         *   indices
         *   non-FX    the US 2-year against its 21-day average, because what
         *             moves gold and indices is the level of US financial
         *             conditions, not a differential they have no second leg for.
         *
         * The middle two used to fall through to the last one, which was wrong
         * twice over — see the DXY and currency-index branches below.
         */
        if (isFx) {
          const baseRate = def.base ? (ratesByCurrency.get(def.base)?.cell ?? null) : null;
          const quoteRate = def.quote ? (ratesByCurrency.get(def.quote)?.cell ?? null) : null;
          // Expected iff the currency was scored at all. A currency outside
          // MAJORS (ZAR) has no rate read by design and must not read partial.
          const combined = combinePairCells(baseRate, quoteRate, PAIR_CELL_MAX, {
            base: { label: def.base, expected: !!def.base && ratesByCurrency.has(def.base) },
            quote: { label: def.quote, expected: !!def.quote && ratesByCurrency.has(def.quote) },
          });

          const detail = [
            def.base ? ratesByCurrency.get(def.base)?.explanation : null,
            def.quote ? ratesByCurrency.get(def.quote)?.explanation : null,
          ].filter(Boolean);

          cell = {
            slotKey: slot.key,
            cell: combined.cell,
            status: combined.status,
            missingLeg: combined.missingLeg,
            baseCell: baseRate,
            quoteCell: quoteRate,
            explanation: [
              detail.length > 0 ? detail.join('  |  ') : 'No rate data for either leg',
              missingLegNote(combined.missingLeg),
            ]
              .filter(Boolean)
              .join('  |  '),
          };
        } else if (def.symbol === 'DXY') {
          /**
           * THE DOLLAR SITS ON THE OPPOSITE SIDE OF THIS YIELD.
           *
           * `scoreYield2y` returns A1's rule already signed for a RISK asset —
           * a falling 2-year eases financial conditions, which lifts gold,
           * indices and crypto. The dollar is the other side of that trade: a
           * falling short yield is dovish and therefore bearish USD, which is
           * exactly what their own card says ("The 2yr yield is falling
           * (dovish)" -> Bearish). So the same reading enters here negated.
           *
           * DXY previously fell through to the branch below and read +1 on a
           * falling yield, against their -1 — a 2-point error on every run.
           */
          const score = input.yield2y ? scoreYield2y(input.yield2y.current, input.yield2y.sma) : null;
          cell = score
            ? {
                slotKey: slot.key,
                cell: normalizeZero(-score.cell),
                status: 'scored',
                explanation: score.dollarExplanation,
              }
            : { slotKey: slot.key, cell: null, status: 'no-data', explanation: '2-year yield unavailable' };
        } else if (def.kind === 'currency' && def.macroEconomy) {
          /**
           * A pound or yen index scoring off US financial conditions is not a
           * rule A1 has, and it is what the old fall-through did. Each currency's
           * own rate expectation is already computed above and was going unused.
           *
           * Scores 0 for every non-USD major today, because only the Fed
           * publishes a numeric projection — the same honest 0 the FX path
           * gives those legs, rather than a US number wearing their label.
           */
          const rate = ratesByCurrency.get(def.macroEconomy);
          // `status` follows the CELL, not the presence of a reading. A rate
          // expectation with a null cell is the no-calendar case, and calling
          // that 'scored' would put a blank cell behind a confident label.
          cell = rate
            ? {
                slotKey: slot.key,
                cell: rate.cell,
                status: rate.cell === null ? 'no-data' : 'scored',
                explanation: rate.explanation,
              }
            : {
                slotKey: slot.key,
                cell: null,
                status: 'no-data',
                explanation: `No rate expectation for ${def.macroEconomy}`,
              };
        } else {
          const score = input.yield2y ? scoreYield2y(input.yield2y.current, input.yield2y.sma) : null;
          cell = score
            ? { slotKey: slot.key, cell: score.cell, status: 'scored', explanation: score.explanation }
            : { slotKey: slot.key, cell: null, status: 'no-data', explanation: '2-year yield unavailable' };
        }
      } else if (slot.kind === 'technical') {
        // Per-symbol, never derived from legs.
        const score =
          slot.key === 'trend' ? scoreTrend(tech) : scoreSeasonality(tech, now, def.kind);
        cell = score
          ? { slotKey: slot.key, cell: score.cell, status: 'scored', explanation: score.explanation }
          : { slotKey: slot.key, cell: null, status: 'no-data', explanation: 'Insufficient price history' };
      } else if (slot.kind === 'sentiment') {
        if (slot.key === 'crowd') {
          /**
           * ONE RESOLUTION ORDER FOR EVERY SYMBOL, in lib/scoring/crowd.ts.
           *
           * This branch used to be three: a standalone contract read, a
           * dollar-pair contract read, and a leg difference for everything
           * else. The first two agreed and the third was a construct with no
           * instrument behind it, so the split is now retail feed -> own
           * contract -> nothing, and crosses land on `nothing` rather than on
           * a difference of two dollar pairs. See that module's header for the
           * EURCHF measurement that settled it.
           *
           * COT IS DELIBERATELY LEFT DIFFERENCED BELOW. Their EURUSD card reads
           * COT Net Positioning Neutral with a Bullish Weekly Change and a
           * subtotal of +2, which is exactly `EUR change (+1) - USD change
           * (-1)`. That column really is differenced, and their card says so —
           * the two sentiment columns are not the same shape and must not be
           * unified just because they sit next to each other.
           */
          const crowd = resolveCrowd(def, input.cot, input.retailPositioning);
          cell = {
            slotKey: slot.key,
            cell: crowd.cell,
            status: crowd.status,
            explanation: crowd.explanation,
            basis: crowd.basis,
          };
        } else if (def.cotContract && !def.base) {
          /**
           * The split is STANDALONE SYMBOL vs LEG OF A PAIR, not currency vs
           * asset. Anything reading one contract directly scores both
           * components; only the legs differenced inside a pair are held to the
           * weekly change, so a signal A1 counts once is not counted twice.
           *
           * A currency index used to take the FX rule here, on the reading that
           * A1's EURO row (43.7% long, +1.22% change, cell +1) was the change
           * alone. Their US-DOLLAR card rules that out: it shows BOTH COT rows
           * scoring, and its Sentiment+COT subtotal of +1 reconciles only as
           * (+1 +1 -1). Both cards hold once the long-share band is 60/40 — 43.7%
           * then sits in the neutral band and contributes nothing, which is what
           * made the euro cell look like a change-only read.
           */
          const series = input.cot.get(def.cotContract);
          const score = scoreCot(series, 'asset');
          cell = score
            ? { slotKey: slot.key, cell: score.cell, status: 'scored', explanation: score.explanation }
            : { slotKey: slot.key, cell: null, status: 'no-data', explanation: 'No COT data' };
        } else {
          const baseScore = def.base ? (cotByCurrency.get(def.base)?.cell ?? null) : null;
          const quoteScore = def.quote ? (cotByCurrency.get(def.quote)?.cell ?? null) : null;
          /**
           * Every major has its own contract, so a currency in the lookup with
           * no score means that contract failed THIS RUN — the one case the
           * matrix used to render as a confident number.
           */
          const combined = combinePairCells(baseScore, quoteScore, slot.maxCell, {
            base: { label: def.base, expected: !!def.base && cotByCurrency.has(def.base) },
            quote: { label: def.quote, expected: !!def.quote && cotByCurrency.has(def.quote) },
          });

          cell = {
            slotKey: slot.key,
            cell: combined.cell,
            status: combined.status,
            missingLeg: combined.missingLeg,
            baseCell: baseScore,
            quoteCell: quoteScore,
            explanation:
              combined.cell === null
                ? 'No COT data for either leg'
                : [
                    `${def.base ?? '—'} ${baseScore ?? 0} vs ${def.quote ?? '—'} ${quoteScore ?? 0}`,
                    missingLegNote(combined.missingLeg),
                  ]
                    .filter(Boolean)
                    .join('  |  '),
          };
        }
      } else if (def.macroEconomy) {
        /**
         * A single-economy symbol: gold, an index, a crypto. There is nothing to
         * difference, so the home economy's reading passes through with a sign
         * that depends on the asset class — strong US growth lifts the S&P and
         * weighs on gold, and both of those are the same underlying print.
         */
        const result = currencyScores.get(def.macroEconomy)?.get(slot.key);
        const raw = result?.cell ?? null;
        const polarity = def.macroPolarity?.[slot.category as 'growth' | 'inflation' | 'jobs'] ?? 1;
        /**
         * ONE component, not two.
         *
         * Their inflation page describes a second, level-based component for
         * non-FX assets (indices want CPI <=3%, gold gains at both extremes).
         * Their product does not apply it: the GOLD Asset Scorecard shows CPI
         * contributing +1, and its Inflation subtotal of +1 only reconciles
         * without a level term — with one it would read +2.
         *
         * Documented but not shipped, so we do not ship it either.
         */
        const combined = raw === null ? null : normalizeZero(raw * polarity);

        cell = {
          slotKey: slot.key,
          cell: combined,
          status: combined === null ? (result?.status ?? 'no-data') : 'scored',
          legs: toLegs(def.macroEconomy, result, slot.compare),
          note: polarity === -1 ? invertedNote(slot.category) : undefined,
          explanation:
            combined === null
              ? (result?.explanation ?? `No ${slot.label} data for ${def.macroEconomy}`)
              : [
                  raw === null ? null : `${def.macroEconomy}: ${result?.explanation}`,
                  polarity === -1 ? invertedNote(slot.category) : null,
                ]
                  .filter(Boolean)
                  .join('  |  '),
        };
      } else {
        // Economic: base minus quote.
        const baseResult = def.base ? currencyScores.get(def.base)?.get(slot.key) : undefined;
        const quoteResult = def.quote ? currencyScores.get(def.quote)?.get(slot.key) : undefined;

        const baseCell = baseResult?.cell ?? null;
        const quoteCell = quoteResult?.cell ?? null;

        /**
         * A leg the economy simply never publishes ('no-data') is not a
         * failure — that is what lets NZDUSD read the NFP column at all. A leg
         * that resolved to a real series and then arrived without any reference
         * to read it against IS one: the series exists, it just is not usable
         * today, and the cell on screen is a single-economy reading wearing a
         * pair's clothes.
         *
         * Aging out USED to be the other half of this test, and is no longer a
         * way to be unusable — an old print scores. `not-released` is what is
         * left: no forecast and no prior print, so there is nothing to compare.
         */
        const expected = (result: SlotResult | undefined) => result?.status === 'not-released';

        const combined = combinePairCells(baseCell, quoteCell, PAIR_CELL_MAX, {
          base: { label: def.base, expected: expected(baseResult) },
          quote: { label: def.quote, expected: expected(quoteResult) },
        });

        const status: CellStatus = combined.cell !== null ? combined.status : 'no-data';

        // Noted if EITHER leg is old, because either is enough to make the
        // difference on screen older than it looks. Display only.
        const stale = (baseResult?.stale ?? false) || (quoteResult?.stale ?? false);

        const parts = [
          baseResult?.status === 'scored' ? `${def.base}: ${baseResult.explanation}` : null,
          quoteResult?.status === 'scored' ? `${def.quote}: ${quoteResult.explanation}` : null,
          missingLegNote(combined.missingLeg),
        ].filter(Boolean);

        cell = {
          slotKey: slot.key,
          cell: combined.cell,
          status,
          stale,
          missingLeg: combined.missingLeg,
          baseCell,
          quoteCell,
          legs: [
            ...(def.base ? toLegs(def.base, baseResult, slot.compare) : []),
            ...(def.quote ? toLegs(def.quote, quoteResult, slot.compare) : []),
          ],
          explanation:
            parts.length > 0
              ? parts.join('  |  ')
              : (baseResult?.explanation ?? quoteResult?.explanation ?? 'No data'),
        };
      }

      cells[slot.key] = cell;

      // Context columns are resolved and rendered but never counted. Summing
      // them would shift what A1's absolute +/-4 and +/-7 bands mean.
      if (cell.cell !== null && slot.scoring) {
        total += cell.cell;
        categoryScores[slot.category] += cell.cell;
        /**
         * A partial cell still votes — dropping it would swing the score
         * further than the failure did — but it does not count as coverage.
         * That split is the whole fix: the score stays defensible while
         * `populated` stops overstating what the row is built on.
         */
        if (cell.status === 'partial') partialCount++;
        else populated++;
      }
    }

    const price = input.prices?.get(def.symbol) ?? (tech ? { price: tech.price, changePct: null } : null);

    rows.push({
      symbol: def.symbol,
      label: def.label,
      kind: def.kind,
      base: def.base,
      quote: def.quote,
      totalScore: total,
      bias: biasFromScore(total),
      categoryScores,
      cells,
      populated,
      partial: partialCount,
      price: price?.price ?? null,
      changePct: price?.changePct ?? null,
    });
  }

  // Strongest conviction first — the ranking IS the product.
  rows.sort((a, b) => b.totalScore - a.totalScore);

  let cotReportDate: string | null = null;
  for (const series of input.cot.values()) {
    const date = series.reports[0]?.reportDate;
    if (date && (!cotReportDate || date > cotReportDate)) cotReportDate = date;
  }

  return { rows, cotReportDate, generatedAtUtc: now.toISOString() };
}
