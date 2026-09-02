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

import { CARD_SLOTS, type SlotCategory, type SlotDefinition } from '@/config/setups.config';
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
   * Share of DIRECTIONAL rows that are bullish, 0..100, per column.
   *
   * A1 publishes this beside their heatmap and drives their Economic Surprise
   * Meter gauges from it. Neutral rows are excluded from the denominator — see
   * `bullishShare`, where the seven published cards that establish that are
   * listed. Yes, this means a single beat alongside six on-forecast prints reads
   * 100%; that is what their cards do, and the honest guard against it is the
   * `scored` count beside the percentage, not a quietly different formula.
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
  /**
   * READ FROM THE RESULT, NOT FROM THE SLOT.
   *
   * `SlotResult.referenceLabel` says what the cell was ACTUALLY measured
   * against; `slot.compare` says only what was asked for. They part company
   * whenever no consensus exists, because `scoreSlot` then falls back to the
   * prior print — A1's rule, and currently five of sixty-six scored cells.
   *
   * Re-deriving it here labelled every one of those five "vs forecast", which is
   * not merely a wrong caption: a diagnostic built on this column reported that
   * NO cell was scoring against the prior print, when JPY's services PMI was
   * doing exactly that and reading +1 where A1 reads -1. The bug hid its own
   * symptom.
   */
  const againstPrevious = (result.referenceLabel ?? slot.compare ?? 'forecast') === 'previous';
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

  /**
   * `CARD_SLOTS`, not `SLOTS`. Their per-country cards and their Top Setups
   * board publish different row sets in BOTH directions: the cards carry
   * Household Spending, Employment Change and Wage Growth, which the board has
   * no column for, and the board carries Cnsmr Conf, which no card shows. See
   * `matrixOnly` in `config/setups.config.ts`.
   */
  for (const slot of CARD_SLOTS) {
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
 * Share of DIRECTIONAL readings that are bullish, 0..100.
 *
 * bullish / (bullish + bearish). Neutral rows are excluded from the denominator
 * entirely, which is A1's arithmetic — read directly off six of their published
 * cards rather than inferred:
 *
 *   EU          2 bull, 2 bear, 4 neutral   they show  50%    = 2/4
 *   CN          4 bull, 2 bear, 1 neutral              66.67% = 4/6
 *   JP          4 bull, 2 bear, 2 neutral              66.67% = 4/6
 *   UK          2 bull, 4 bear, 1 neutral              33.33% = 2/6
 *   NZ          4 bull, 1 bear, 2 neutral              80%    = 4/5
 *   NZ stocks   5 bull, 0 bear, 2 neutral              100%   = 5/5
 *   UK stocks   1 bull, 5 bear, 1 neutral              16.67% = 1/6
 *
 * Counting neutrals in the denominator — which this did until the cards were
 * checked — reproduces NONE of those seven numbers. The comment defending that
 * version cited "their EU card reads 57.14%, which is 4 bullish of 7 rows"; the
 * EU card reads 50%, and 57.14% is the AU card. One rule, derived from two cards
 * mixed up, and pinned by a test that made it look verified.
 *
 * Null when nothing DIRECTIONAL resolved. That covers both the empty set and an
 * all-neutral one: "every print landed on forecast" is not 0% bullish, it is a
 * currency with no signal, and 0% would render as uniformly bearish.
 */
export function bullishShare(impacts: (number | null)[]): number | null {
  const resolved = impacts.filter((v): v is number => v !== null);
  const bullish = resolved.filter((v) => v > 0).length;
  const bearish = resolved.filter((v) => v < 0).length;

  const directional = bullish + bearish;
  if (directional === 0) return null;

  return Math.round((bullish / directional) * 10000) / 100;
}
