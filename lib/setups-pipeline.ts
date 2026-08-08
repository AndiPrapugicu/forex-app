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

import { ALL_SYMBOLS } from '@/config/symbols.config';
import { fetchCotData, type CotSeries } from '@/lib/connectors/cftc';
import { fetchFxStreetHistory } from '@/lib/connectors/fxstreet';
import { fetchPrices } from '@/lib/connectors/prices';
import { fetchTechnicals, type Technicals } from '@/lib/connectors/technicals';
import { buildSetupsMatrix, type SetupsMatrix } from '@/lib/scoring/setups';
import type { NormalizedEvent, Result, SourceHealth } from '@/lib/types';

export interface SetupsPayload {
  matrix: SetupsMatrix;
  health: SourceHealth[];
  /** Retained so the scorecard page can show per-slot release detail. */
  events: NormalizedEvent[];
  cot: Map<string, CotSeries>;
  technicals: Map<string, Technicals>;
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
  const [history, cot, technicals, prices] = await Promise.all([
    fetchFxStreetHistory(now),
    fetchCotData(),
    fetchTechnicals(ALL_SYMBOLS.map((s) => ({ symbol: s.symbol, yahoo: s.yahoo }))),
    fetchPrices(),
  ]);

  const health = [toHealth(history), toHealth(cot), toHealth(technicals), toHealth(prices)];

  const events = history.ok ? history.data : [];
  const cotData = cot.ok ? cot.data : new Map<string, CotSeries>();
  const techData = technicals.ok ? technicals.data : new Map<string, Technicals>();

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
    now,
  });

  return { matrix, health, events, cot: cotData, technicals: techData };
}
