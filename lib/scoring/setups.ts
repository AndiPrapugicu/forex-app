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
import { scoreCot, scoreCrowd, type CotScore, type CrowdScore } from '@/lib/scoring/cot';
import { combinePairCells, scoreSlot, type CellStatus, type SlotResult } from '@/lib/scoring/discrete';
import { scoreSeasonality, scoreTrend, scoreYield2y } from '@/lib/scoring/technical';
import { MAJORS, type Currency, type NormalizedEvent } from '@/lib/types';

export interface MatrixCell {
  slotKey: string;
  cell: number | null;
  status: CellStatus;
  /** Rendered on hover; the reason the cell reads the way it does. */
  explanation: string;
  /** Per-leg detail, so the scorecard can show where a pair cell came from. */
  baseCell?: number | null;
  quoteCell?: number | null;
}

export interface SymbolRow {
  symbol: string;
  label: string;
  kind: SymbolDefinition['kind'];
  base?: Currency;
  quote?: Currency;
  /** Sum of every populated cell. */
  totalScore: number;
  bias: Bias;
  /** Subtotals by category, for the scorecard breakdown. */
  categoryScores: Record<SlotCategory, number>;
  cells: Record<string, MatrixCell>;
  /** How many slots actually produced a score — thin rows deserve less trust. */
  populated: number;
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

/** COT and crowd scores per currency, from each currency's own contract. */
function scoreCurrencySentiment(cot: Map<string, CotSeries>) {
  const cotByCurrency = new Map<Currency, CotScore | null>();
  const crowdByCurrency = new Map<Currency, CrowdScore | null>();

  for (const currency of MAJORS) {
    const series = cot.get(CURRENCY_COT_CONTRACT[currency]);
    cotByCurrency.set(currency, scoreCot(series));
    crowdByCurrency.set(currency, scoreCrowd(series));
  }

  return { cotByCurrency, crowdByCurrency };
}

function emptyCategoryScores(): Record<SlotCategory, number> {
  return { technical: 0, sentiment: 0, growth: 0, inflation: 0, jobs: 0 };
}

export interface BuildMatrixInput {
  events: NormalizedEvent[];
  cot: Map<string, CotSeries>;
  technicals: Map<string, Technicals>;
  prices?: Map<string, { price: number; changePct: number | null }>;
  /** 2-year Treasury yield and its 21-day average. Scored for the dollar. */
  yield2y?: { current: number; sma: number } | null;
  now?: Date;
}

export function buildSetupsMatrix(input: BuildMatrixInput): SetupsMatrix {
  const now = input.now ?? new Date();

  const currencyScores = scoreAllCurrencies(input.events, now);
  const { cotByCurrency, crowdByCurrency } = scoreCurrencySentiment(input.cot);

  const rows: SymbolRow[] = [];

  for (const def of ALL_SYMBOLS) {
    const cells: Record<string, MatrixCell> = {};
    const categoryScores = emptyCategoryScores();
    let total = 0;
    let populated = 0;

    const tech = input.technicals.get(def.symbol);

    for (const slot of SLOTS) {
      let cell: MatrixCell;

      if (slot.kind === 'yield') {
        /**
         * The 2-year yield is a USD reading, so it enters a pair the same way any
         * other dollar indicator does: straight through when USD is the base,
         * inverted when USD is the quote (which is what makes it bearish for gold).
         */
        const score = input.yield2y
          ? scoreYield2y(input.yield2y.current, input.yield2y.sma)
          : null;

        if (!score) {
          cell = { slotKey: slot.key, cell: null, status: 'no-data', explanation: '2-year yield unavailable' };
        } else {
          const usdSide = def.base === 'USD' ? 1 : def.quote === 'USD' ? -1 : 0;
          cell = {
            slotKey: slot.key,
            cell: usdSide === 0 ? null : score.cell * usdSide,
            status: usdSide === 0 ? 'no-data' : 'scored',
            explanation:
              usdSide === 0
                ? 'No USD leg — the 2-year yield does not apply'
                : score.explanation + (usdSide === -1 ? ' Inverted: USD is the quote leg.' : ''),
          };
        }
      } else if (slot.kind === 'technical') {
        // Per-symbol, never derived from legs.
        const score = slot.key === 'trend' ? scoreTrend(tech) : scoreSeasonality(tech, now);
        cell = score
          ? { slotKey: slot.key, cell: score.cell, status: 'scored', explanation: score.explanation }
          : { slotKey: slot.key, cell: null, status: 'no-data', explanation: 'Insufficient price history' };
      } else if (slot.kind === 'sentiment') {
        // Commodities have their own contract; pairs combine two legs.
        if (def.cotContract && !def.base) {
          const series = input.cot.get(def.cotContract);
          const score = slot.key === 'cot' ? scoreCot(series) : scoreCrowd(series);
          cell = score
            ? { slotKey: slot.key, cell: score.cell, status: 'scored', explanation: score.explanation }
            : { slotKey: slot.key, cell: null, status: 'no-data', explanation: 'No COT data' };
        } else {
          const lookup = slot.key === 'cot' ? cotByCurrency : crowdByCurrency;
          const baseScore = def.base ? (lookup.get(def.base)?.cell ?? null) : null;
          const quoteScore = def.quote ? (lookup.get(def.quote)?.cell ?? null) : null;
          const combined = combinePairCells(baseScore, quoteScore);

          cell = {
            slotKey: slot.key,
            cell: combined.cell,
            status: combined.status,
            baseCell: baseScore,
            quoteCell: quoteScore,
            explanation:
              combined.cell === null
                ? 'No COT data for either leg'
                : `${def.base ?? '—'} ${baseScore ?? 0} vs ${def.quote ?? '—'} ${quoteScore ?? 0}`,
          };
        }
      } else {
        // Economic: base minus quote.
        const baseResult = def.base ? currencyScores.get(def.base)?.get(slot.key) : undefined;
        const quoteResult = def.quote ? currencyScores.get(def.quote)?.get(slot.key) : undefined;

        const baseCell = baseResult?.cell ?? null;
        const quoteCell = quoteResult?.cell ?? null;
        const combined = combinePairCells(baseCell, quoteCell);

        // A cell is only stale if EVERY contributing leg is stale — one fresh
        // leg is still information.
        const statuses = [baseResult?.status, quoteResult?.status].filter(Boolean) as CellStatus[];
        const status: CellStatus =
          combined.cell !== null
            ? 'scored'
            : statuses.length > 0 && statuses.every((s) => s === 'stale')
              ? 'stale'
              : 'no-data';

        const parts = [
          baseResult?.status === 'scored' ? `${def.base}: ${baseResult.explanation}` : null,
          quoteResult?.status === 'scored' ? `${def.quote}: ${quoteResult.explanation}` : null,
        ].filter(Boolean);

        cell = {
          slotKey: slot.key,
          cell: combined.cell,
          status,
          baseCell,
          quoteCell,
          explanation:
            parts.length > 0
              ? parts.join('  |  ')
              : (baseResult?.explanation ?? quoteResult?.explanation ?? 'No data'),
        };
      }

      cells[slot.key] = cell;

      if (cell.cell !== null) {
        total += cell.cell;
        categoryScores[slot.category] += cell.cell;
        populated++;
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
