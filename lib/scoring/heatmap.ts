/**
 * Per-currency economic heatmap rows.
 *
 * Deliberately built from `scoreSlot`, the same function that fills the Top
 * Setups matrix. The heatmap and the matrix must never disagree about which
 * release a slot resolved to or which way it read — if they can drift apart,
 * one of them is lying.
 */

import { SLOTS, type SlotCategory } from '@/config/setups.config';
import { scoreSlot } from '@/lib/scoring/discrete';
import type { Currency, NormalizedEvent } from '@/lib/types';

export interface HeatmapRow {
  slotKey: string;
  label: string;
  category: SlotCategory;
  /** The release that filled the slot. */
  eventName: string | null;
  dateUtc: string | null;
  actual: number | null;
  consensus: number | null;
  previous: number | null;
  unit: string | null;
  /** actual − consensus, in the release's own units. */
  surprise: number | null;
  /** −1 / 0 / +1 for this currency. Null when unscored. */
  impact: number | null;
  status: string;
  ageDays: number | null;
  explanation: string;
}

export interface CurrencyHeatmap {
  currency: Currency;
  rows: HeatmapRow[];
  /** Sum of the scored economic impacts — the currency's own macro score. */
  macroScore: number;
  scored: number;
  total: number;
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
    // Technical, sentiment and yield slots are per-symbol or per-contract, not
    // per-currency, so they have no place on a currency heatmap.
    if (slot.kind !== 'economic') continue;

    const result = scoreSlot(slot, currency, events, now);
    const event = result.event;

    const surprise =
      event?.actual !== null && event?.actual !== undefined && event?.consensus !== null && event?.consensus !== undefined
        ? Math.round((event.actual - event.consensus) * 1000) / 1000
        : null;

    if (result.status === 'scored' && result.cell !== null) {
      macroScore += result.cell;
      scored++;
    }

    rows.push({
      slotKey: slot.key,
      label: slot.label,
      category: slot.category,
      eventName: event?.name ?? null,
      dateUtc: event?.dateUtc ?? null,
      actual: event?.actual ?? null,
      consensus: event?.consensus ?? null,
      previous: event?.previous ?? null,
      unit: event?.unit ?? null,
      surprise,
      impact: result.cell,
      status: result.status,
      ageDays: result.ageDays,
      explanation: result.explanation,
    });
  }

  // Most recent release first — a heatmap is read as "what has just happened".
  rows.sort((a, b) => (b.dateUtc ?? '').localeCompare(a.dateUtc ?? ''));

  return {
    currency,
    rows,
    macroScore,
    scored,
    total: rows.length,
  };
}
