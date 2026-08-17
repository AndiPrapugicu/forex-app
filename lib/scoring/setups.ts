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
 *   sentiment  per CONTRACT, combined from legs like the economic slots, because
 *              each currency has its own COT contract.
 */

import {
  SLOTS,
  biasFromScore,
  type Bias,
  type SlotCategory,
} from '@/config/setups.config';
import { ALL_SYMBOLS, CURRENCY_COT_CONTRACT, type SymbolDefinition } from '@/config/symbols.config';
import type { CotSeries } from '@/lib/connectors/cftc';
import type { Technicals } from '@/lib/connectors/technicals';
import type { SovereignYield } from '@/lib/connectors/yields';
import { scoreCot, scoreCrowd, type CotScore, type CrowdScore } from '@/lib/scoring/cot';
import {
  PAIR_CELL_MAX,
  combinePairCells,
  normalizeZero,
  scoreSlot,
  type CellStatus,
  type SlotResult,
} from '@/lib/scoring/discrete';
import { scoreRateExpectation, type RateExpectation } from '@/lib/scoring/rates';
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
 * COT and crowd scores per currency, from each currency's own contract.
 *
 * Scored with the 'fx' rule, which reads only the weekly change. Net positioning
 * is deliberately excluded here and included for commodities, indices and crypto
 * — that asymmetry is A1's, and it stops a pair double-counting a signal they
 * count once.
 */
function scoreCurrencySentiment(cot: Map<string, CotSeries>) {
  const cotByCurrency = new Map<Currency, CotScore | null>();
  const crowdByCurrency = new Map<Currency, CrowdScore | null>();

  for (const currency of MAJORS) {
    const series = cot.get(CURRENCY_COT_CONTRACT[currency]);
    cotByCurrency.set(currency, scoreCot(series, 'fx'));
    crowdByCurrency.set(currency, scoreCrowd(series));
  }

  return { cotByCurrency, crowdByCurrency };
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

  const referenceLabel = compare === 'previous' ? 'previous' : 'forecast';

  const build = (event: NormalizedEvent | null, cell: number | null, sigma: number | null): CellLeg => ({
    currency,
    seriesName: event?.name ?? null,
    actual: event?.actual ?? null,
    reference: (referenceLabel === 'previous' ? event?.previous : event?.consensus) ?? null,
    referenceLabel,
    consensus: event?.consensus ?? null,
    previous: event?.previous ?? null,
    unit: event?.unit ?? null,
    sigma,
    dateUtc: event?.dateUtc ?? null,
    cell,
    status: result.status,
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
  now?: Date;
}

export function buildSetupsMatrix(input: BuildMatrixInput): SetupsMatrix {
  const now = input.now ?? new Date();

  const currencyScores = scoreAllCurrencies(input.events, now);
  const { cotByCurrency, crowdByCurrency } = scoreCurrencySentiment(input.cot);

  // Rate expectations per currency, computed once and reused across all 28 pairs.
  const yields = input.sovereignYields ?? new Map<Currency, SovereignYield>();
  const ratesByCurrency = new Map<Currency, RateExpectation>();
  for (const currency of MAJORS) {
    ratesByCurrency.set(currency, scoreRateExpectation(currency, yields, input.events, now));
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

    for (const slot of SLOTS) {
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
          cell = rate
            ? { slotKey: slot.key, cell: rate.cell, status: 'scored', explanation: rate.explanation }
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
        // A symbol with its own contract and no base leg (gold, indices, crypto)
        // is scored directly, under the non-FX COT rule.
        if (def.cotContract && !def.base) {
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
          const score = slot.key === 'cot' ? scoreCot(series, 'asset') : scoreCrowd(series);
          cell = score
            ? { slotKey: slot.key, cell: score.cell, status: 'scored', explanation: score.explanation }
            : { slotKey: slot.key, cell: null, status: 'no-data', explanation: 'No COT data' };
        } else {
          const lookup = slot.key === 'cot' ? cotByCurrency : crowdByCurrency;
          const baseScore = def.base ? (lookup.get(def.base)?.cell ?? null) : null;
          const quoteScore = def.quote ? (lookup.get(def.quote)?.cell ?? null) : null;
          /**
           * Every major has its own contract, so a currency in the lookup with
           * no score means that contract failed THIS RUN — the one case the
           * matrix used to render as a confident number.
           */
          // Crowd is +/-1 for the whole symbol, not per leg.
          const combined = combinePairCells(baseScore, quoteScore, slot.maxCell, {
            base: { label: def.base, expected: !!def.base && lookup.has(def.base) },
            quote: { label: def.quote, expected: !!def.quote && lookup.has(def.quote) },
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
         * that resolved to a real series and then aged out or arrived without a
         * reference IS one: the series exists, it just is not usable today, and
         * the cell on screen is a single-economy reading wearing a pair's
         * clothes.
         */
        const expected = (result: SlotResult | undefined) =>
          result?.status === 'stale' || result?.status === 'not-released';

        const combined = combinePairCells(baseCell, quoteCell, PAIR_CELL_MAX, {
          base: { label: def.base, expected: expected(baseResult) },
          quote: { label: def.quote, expected: expected(quoteResult) },
        });

        // A cell is only stale if EVERY contributing leg is stale — one fresh
        // leg is still information.
        const statuses = [baseResult?.status, quoteResult?.status].filter(Boolean) as CellStatus[];
        const status: CellStatus =
          combined.cell !== null
            ? combined.status
            : statuses.length > 0 && statuses.every((s) => s === 'stale')
              ? 'stale'
              : 'no-data';

        const parts = [
          baseResult?.status === 'scored' ? `${def.base}: ${baseResult.explanation}` : null,
          quoteResult?.status === 'scored' ? `${def.quote}: ${quoteResult.explanation}` : null,
          missingLegNote(combined.missingLeg),
        ].filter(Boolean);

        cell = {
          slotKey: slot.key,
          cell: combined.cell,
          status,
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
