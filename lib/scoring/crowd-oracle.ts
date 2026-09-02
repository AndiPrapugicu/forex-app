/**
 * A1's own retail long share, replayed through the PRODUCTION crowd scorer.
 *
 * WHAT THIS IS FOR. Every previous check of the Crowd column compared our
 * number against theirs and found a difference, which said only that CFTC small
 * traders are not a retail broker book — true, unfixable in code, and not the
 * question. This asks the other question: HOLDING A1'S OWN INPUT FIXED, does
 * `lib/scoring/crowd.ts` return A1's own cell? That isolates the transformation
 * from the data, so a failure here would be a rule we got wrong rather than a
 * feed we do not have.
 *
 * IT CALLS THE REAL SCORER. `feedForDate` builds a `RetailPositioningFeed` out
 * of A1's published percentages and hands it to `resolveCrowd` unchanged — the
 * same function `buildSetupsMatrix` calls. Nothing here re-implements the 40/60
 * bands or the index derivation, so the tests over it cannot pass while
 * production is wrong.
 *
 * IT IS NOT A DATA SOURCE. `fixtures/a1-retail-sentiment-history.json` is a
 * frozen reading of A1's free dashboard, kept as evidence. Nothing imports this
 * module from the scoring path, and nothing should: the standing rule is no
 * scraping and no undocumented endpoint as a production dependency.
 *
 * DATE SCOPING IS STRUCTURAL, NOT A CONVENTION. `feedForDate` takes one date
 * and returns only that date's observations; there is no "latest available"
 * fallback, because a crowd share four days stale silently turns a mismatch
 * into a match. A symbol with no observation on the asked-for date is simply
 * absent from the feed, and `resolveCrowd` then falls through exactly as it
 * does in production.
 */

import ORACLE from '@/fixtures/a1-retail-sentiment-history.json';
import TOP_SETUPS_0824 from '@/fixtures/a1-top-setups-2026-08-24.json';
import TOP_SETUPS_0825 from '@/fixtures/a1-top-setups-2026-08-25.json';
import { ALL_SYMBOLS, type SymbolDefinition } from '@/config/symbols.config';
import type { CotSeries } from '@/lib/connectors/cftc';
import { resolveCrowd, type RetailPositioningFeed } from '@/lib/scoring/crowd';

/**
 * A1's instrument names are not ours, and only the ones that differ are listed.
 *
 * Their dashboard calls the metals GOLD and SILVER; every FX row already uses
 * the six-letter name we use. The map is deliberately tiny and explicit rather
 * than a fuzzy matcher — an unrecognised name should stay unrecognised.
 */
export const A1_INSTRUMENT_TO_SYMBOL: Readonly<Record<string, string>> = {
  GOLD: 'XAUUSD',
  SILVER: 'XAGUSD',
};

const SOURCE = 'A1 Retail Sent. History (oracle fixture)';

export type OracleSeries = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** Every date the oracle carries an observation for, ascending. */
export function oracleDates(series: OracleSeries = ORACLE.series): string[] {
  const dates = new Set<string>();
  for (const byDate of Object.values(series)) {
    for (const date of Object.keys(byDate)) dates.add(date);
  }
  return [...dates].sort();
}

/**
 * The feed A1's own numbers would have produced on ONE date.
 *
 * Keyed by OUR symbol so `resolveCrowd`'s first rung can find it, which is why
 * the metals are renamed on the way in. Symbols with no observation on that
 * date are absent, never carried forward from a neighbouring day.
 */
export function feedForDate(date: string, series: OracleSeries = ORACLE.series): RetailPositioningFeed {
  const feed: RetailPositioningFeed = new Map();
  for (const [instrument, byDate] of Object.entries(series)) {
    const longPct = byDate[date];
    if (longPct === undefined) continue;
    const symbol = A1_INSTRUMENT_TO_SYMBOL[instrument] ?? instrument;
    feed.set(symbol, {
      symbol,
      longPct,
      shortPct: 100 - longPct,
      source: SOURCE,
      observedAt: date,
    });
  }
  return feed;
}

export interface OracleJoinRow {
  symbol: string;
  date: string;
  /** A1's own long share, or the one derived from their dollar pair for an index. */
  longPct: number | null;
  /** What `resolveCrowd` returns when fed A1's own numbers for that date. */
  ourCell: number | null;
  /** Which rung of `resolveCrowd` answered. */
  basis: string;
  /** A1's published Top Setups crowd cell for that symbol and date. */
  a1Cell: number;
  match: boolean;
  explanation: string;
}

/** The A1 Top Setups crowd cells this repo holds, date-scoped. */
export function a1CrowdCells(): { symbol: string; date: string; cell: number }[] {
  const out: { symbol: string; date: string; cell: number }[] = [];
  // `bias` is a string alongside the numeric cells, so the row type is wider
  // than Record<string, number> and only `crowd` is read here.
  const sources: [string, Record<string, Record<string, unknown>>][] = [
    ['2026-08-24', TOP_SETUPS_0824.cells],
    ['2026-08-25', TOP_SETUPS_0825.cells],
  ];
  for (const [date, cells] of sources) {
    for (const [symbol, row] of Object.entries(cells)) {
      if (typeof row.crowd === 'number') out.push({ symbol, date, cell: row.crowd });
    }
  }
  return out;
}

/**
 * Join A1's long shares to A1's Top Setups crowd cells, through our scorer.
 *
 * One row per (symbol, date) where BOTH exist. A pair we hold a cell for but no
 * same-date observation is dropped rather than matched against the nearest day —
 * see the module header on date scoping.
 */
export function crowdOracleJoin(series: OracleSeries = ORACLE.series): OracleJoinRow[] {
  const bySymbol = new Map<string, SymbolDefinition>(ALL_SYMBOLS.map((d) => [d.symbol, d]));
  const noCot = new Map<string, CotSeries>();
  const rows: OracleJoinRow[] = [];

  for (const { symbol, date, cell } of a1CrowdCells()) {
    const def = bySymbol.get(symbol);
    if (!def) continue;
    const feed = feedForDate(date, series);
    const resolved = resolveCrowd(def, noCot, feed);
    // Only rows the ORACLE can answer belong in this join. A fall-through to
    // the contract read is a different measurement and would quietly turn this
    // into the CFTC-vs-retail comparison it exists to replace.
    if (resolved.basis !== 'retail-feed') continue;

    const direct = feed.get(symbol);
    const dollarPair = def.macroEconomy ? feed.get(`${def.macroEconomy}USD`) : undefined;
    const inverted = def.macroEconomy ? feed.get(`USD${def.macroEconomy}`) : undefined;
    const longPct =
      direct?.longPct ?? dollarPair?.longPct ?? (inverted ? 100 - inverted.longPct : null);

    rows.push({
      symbol,
      date,
      longPct,
      ourCell: resolved.cell,
      basis: resolved.basis,
      a1Cell: cell,
      match: resolved.cell === cell,
      explanation: resolved.explanation,
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
}

export interface OracleJoinSummary {
  total: number;
  matched: number;
  mismatched: OracleJoinRow[];
}

export function summarizeOracleJoin(rows: OracleJoinRow[]): OracleJoinSummary {
  return {
    total: rows.length,
    matched: rows.filter((r) => r.match).length,
    mismatched: rows.filter((r) => !r.match),
  };
}
