/**
 * Per-currency economic heatmap rows.
 *
 * Built from `scoreSlot`, the same function that fills the Top Setups matrix, so
 * the heatmap and the matrix can never disagree about which release a slot
 * resolved to or which way it read.
 *
 * The design point here is that ONE release has TWO readings. A cooler-than-
 * forecast CPI is bearish for the currency (less room to hike) and bullish for
 * stocks (cheaper money). A1 shows both side by side, and so do we — it is the
 * clearest illustration in the whole app that "good news" is not a property of a
 * number, it is a property of a number and an asset.
 */

import { SLOTS, type SlotCategory, type SlotDefinition } from '@/config/setups.config';
import { RISK_ASSET_POLARITY } from '@/config/symbols.config';
import { scoreSlot, type SlotResult } from '@/lib/scoring/discrete';
import type { Currency, NormalizedEvent } from '@/lib/types';

export interface HeatmapRow {
  slotKey: string;
  label: string;
  category: SlotCategory;
  /** The release that filled the slot. */
  eventName: string | null;
  dateUtc: string | null;
  actual: number | null;
  /** What the score was measured against — forecast, or previous for PMI. */
  reference: number | null;
  referenceLabel: 'forecast' | 'previous';
  consensus: number | null;
  previous: number | null;
  unit: string | null;
  /** actual − reference, in the release's own units. */
  surprise: number | null;
  /** −1 / 0 / +1 for the CURRENCY. */
  currencyImpact: number | null;
  /** −1 / 0 / +1 for equities. The same print, read as a risk asset. */
  stocksImpact: number | null;
  status: string;
  ageDays: number | null;
  explanation: string;
}

export interface CurrencyHeatmap {
  currency: Currency;
  rows: HeatmapRow[];
  /** Sum of the scored currency impacts — the currency's own macro score. */
  macroScore: number;
  scored: number;
  total: number;
  /**
   * Share of scored rows that are bullish, 0..100, per column.
   *
   * A1 publishes this beside their heatmap (their EU card reads 57.14% on both
   * columns, which is 4 bullish of 7 rows). Neutral rows count in the
   * denominator — "the data came in exactly as expected" is a real outcome and
   * dropping it would let a single beat read as 100%.
   */
  currencyImpactPct: number | null;
  stocksImpactPct: number | null;
}

/**
 * How equities read a currency's macro cell.
 *
 * Reuses the same polarity table the scorecard scores indices with, rather than
 * a second copy — if these two ever disagreed, the heatmap would be telling a
 * different story from the SPX500 card built off the same release.
 */
function toStocksImpact(currencyImpact: number | null, category: SlotCategory): number | null {
  if (currencyImpact === null) return null;
  const polarity = RISK_ASSET_POLARITY[category as 'growth' | 'inflation' | 'jobs'] ?? 1;
  const value = currencyImpact * polarity;
  return value === 0 ? 0 : value; // collapse -0
}

/** One display row from a resolved slot result. */
function toRow(
  slot: SlotDefinition,
  result: SlotResult,
  label: string,
  event: NormalizedEvent | null,
): HeatmapRow {
  const againstPrevious = slot.compare === 'previous';
  const reference = (againstPrevious ? event?.previous : event?.consensus) ?? null;

  /**
   * Measured against whatever the SCORE used. This was previously always
   * `actual − consensus`, so the PMI row displayed a surprise-vs-forecast beside
   * a cell that had been scored against the previous print — the number and the
   * badge were answering different questions.
   */
  const surprise =
    event?.actual !== null && event?.actual !== undefined && reference !== null
      ? Math.round((event.actual - reference) * 1000) / 1000
      : null;

  const currencyImpact = result.cell;

  return {
    slotKey: slot.key,
    label,
    category: slot.category,
    eventName: event?.name ?? null,
    dateUtc: event?.dateUtc ?? null,
    actual: event?.actual ?? null,
    reference,
    referenceLabel: againstPrevious ? 'previous' : 'forecast',
    consensus: event?.consensus ?? null,
    previous: event?.previous ?? null,
    unit: event?.unit ?? null,
    surprise,
    currencyImpact,
    stocksImpact: toStocksImpact(currencyImpact, slot.category),
    status: result.status,
    ageDays: result.ageDays,
    explanation: result.explanation,
  };
}

/**
 * Expands a composite slot into one display row per sub-series.
 *
 * PMI scores as a single column but A1 lists Manufacturing and Services
 * separately, and so does every economic calendar — collapsing them on screen
 * hides which half of the economy is actually moving. The rows carry the
 * sub-series' own impact, so they sum to more than the column contributes; the
 * column total is the score, these are the evidence.
 */
function expandComposite(slot: SlotDefinition, result: SlotResult): HeatmapRow[] {
  return (result.components ?? []).map((component) => {
    const sub: SlotResult = {
      ...result,
      cell: component.cell,
      event: component.event,
      explanation: component.explanation,
    };
    return toRow(slot, sub, `${slot.label} · ${component.label}`, component.event);
  });
}

export function buildCurrencyHeatmap(
  currency: Currency,
  events: NormalizedEvent[],
  now = new Date(),
): CurrencyHeatmap {
  const rows: HeatmapRow[] = [];
  let macroScore = 0;
  let scored = 0;

  for (const slot of SLOTS) {
    // Technical, sentiment and rate slots are per-symbol or per-contract, not
    // per-currency, so they have no place on a currency heatmap.
    if (slot.kind !== 'economic') continue;

    const result = scoreSlot(slot, currency, events, now);

    /**
     * DROP indicators this economy does not publish.
     *
     * The euro area has no nonfarm payrolls, no JOLTS and no PCE, and listing
     * them as empty rows is what made the EUR heatmap look broken — nine blanks
     * reading as missing data when the series simply does not exist. A stale row
     * stays, because "we had this and it aged out" IS information.
     */
    if (result.status === 'no-data' && result.event === null) continue;

    if (result.status === 'scored' && result.cell !== null) {
      macroScore += result.cell;
      scored++;
    }

    // A composite with resolved sub-series shows them individually.
    if (slot.components && (result.components?.length ?? 0) > 0) {
      rows.push(...expandComposite(slot, result));
    } else {
      rows.push(toRow(slot, result, slot.label, result.event));
    }
  }

  // Most recent release first — a heatmap is read as "what has just happened".
  rows.sort((a, b) => (b.dateUtc ?? '').localeCompare(a.dateUtc ?? ''));

  return {
    currency,
    rows,
    macroScore,
    scored,
    total: rows.length,
    currencyImpactPct: bullishShare(rows.map((r) => r.currencyImpact)),
    stocksImpactPct: bullishShare(rows.map((r) => r.stocksImpact)),
  };
}

/**
 * Share of resolved readings that are bullish, 0..100.
 *
 * Null when nothing resolved — a percentage off an empty set is not 0%, it is
 * unknown, and rendering 0% would read as "everything is bearish".
 */
export function bullishShare(impacts: (number | null)[]): number | null {
  const resolved = impacts.filter((v): v is number => v !== null);
  if (resolved.length === 0) return null;
  const bullish = resolved.filter((v) => v > 0).length;
  return Math.round((bullish / resolved.length) * 10000) / 100;
}
