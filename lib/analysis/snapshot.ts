/**
 * The narrative's daily memory, kept in the existing `ai_cache` table.
 *
 * Two keys: `narrative:latest` (overwritten every ingest run) and
 * `narrative:day:YYYY-MM-DD` (the last run of each UTC day). No new table and
 * no SQL: the rows are small JSON, and the narrative only ever needs the latest
 * one and the one from a week ago.
 *
 * What it buys:
 *   - the week-ago state for "what changed", including the headline themes the
 *     48-hour feeds cannot rebuild;
 *   - a 2-year history for the six currencies whose only source (TradingView)
 *     serves today's quote and nothing before it;
 *   - the previous verdict, which is what hysteresis and the "verdict changed"
 *     alert compare against;
 *   - the flip conditions that were live, so the next run can tell which fired.
 */

import { NARRATIVE_CACHE_KIND } from '@/config/narrative.config';
import type { DatedObservation, SovereignYield } from '@/lib/connectors/yields';
import type { Currency } from '@/lib/types';
import type { FlipCondition, PairNarrative, SubjectEffects, Verdict } from '@/lib/analysis/state';
import type { MarketState } from '@/lib/analysis/themes';
import type { FiredFlip } from '@/lib/analysis/thesis';

export const SNAPSHOT_VERSION = 1;
export const LATEST_KEY = 'narrative:latest';
export const dayKey = (date: string) => `narrative:day:${date}`;
/** Days of 2-year history the snapshot carries forward. */
const YIELD_HISTORY_DAYS = 30;

export interface StoredVerdict {
  tactical: Verdict;
  structural: Verdict;
  text: string;
}

export interface NarrativeSnapshot {
  version: number;
  capturedAtUtc: string;
  /** UTC date of the capture. */
  date: string;
  effects: SubjectEffects;
  verdicts: Record<string, StoredVerdict>;
  /** Live flip conditions, per symbol, for the symbols with an open position. */
  flips: Record<string, FlipCondition[]>;
  twoYearHistory: Partial<Record<Currency, DatedObservation[]>>;
  stance: Partial<Record<Currency, { hawkish: number; dovish: number; hold: number; net: string }>>;
  /** Set once the day's digest went out, so a second run that day does not resend it. */
  digestSentFor?: string | null;
  /** Flip conditions that fired in the last few days, which keep a position RED. */
  fired?: FiredFlip[];
}

export function isSnapshot(v: unknown): v is NarrativeSnapshot {
  return !!v && typeof v === 'object' && (v as NarrativeSnapshot).version === SNAPSHOT_VERSION && typeof (v as NarrativeSnapshot).date === 'string';
}

/** Yesterday's carried history plus today's levels, one row per date, newest window only. */
export function mergeYieldHistory(
  previous: Partial<Record<Currency, DatedObservation[]>> | undefined,
  current: Map<Currency, SovereignYield>,
  at: Date,
): Partial<Record<Currency, DatedObservation[]>> {
  const out: Partial<Record<Currency, DatedObservation[]>> = {};
  const cutoff = new Date(at.getTime() - YIELD_HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const currencies = new Set<Currency>([...(Object.keys(previous ?? {}) as Currency[]), ...current.keys()]);
  for (const c of currencies) {
    const byDate = new Map<string, number>();
    for (const o of previous?.[c] ?? []) byDate.set(o.date, o.value);
    const now = current.get(c);
    if (now && Number.isFinite(now.value)) byDate.set(now.observedOn, now.value);
    out[c] = [...byDate.entries()]
      .filter(([d]) => d >= cutoff)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
  }
  return out;
}

export function buildSnapshot(args: {
  state: MarketState;
  effects: SubjectEffects;
  pairs: PairNarrative[];
  /** Symbols whose flip conditions are kept (the open positions). */
  keepFlipsFor: Set<string>;
  previous: NarrativeSnapshot | null;
  twoYear: Map<Currency, SovereignYield>;
  /** Already merged with the previous memory (`rememberFired`). */
  fired?: FiredFlip[];
  at: Date;
}): NarrativeSnapshot {
  const { state, effects, pairs, keepFlipsFor, previous, twoYear, at } = args;
  const verdicts: Record<string, StoredVerdict> = {};
  const flips: Record<string, FlipCondition[]> = {};
  for (const p of pairs) {
    verdicts[p.symbol] = { tactical: p.tactical.label, structural: p.structural.label, text: p.tactical.text };
    if (keepFlipsFor.has(p.symbol)) flips[p.symbol] = p.flips;
  }
  const stance: NarrativeSnapshot['stance'] = {};
  for (const [c, s] of Object.entries(state.stance)) {
    if (s) stance[c as Currency] = { hawkish: s.hawkish, dovish: s.dovish, hold: s.hold, net: s.net };
  }
  const date = at.toISOString().slice(0, 10);
  return {
    version: SNAPSHOT_VERSION,
    capturedAtUtc: at.toISOString(),
    date,
    effects,
    verdicts,
    flips,
    twoYearHistory: mergeYieldHistory(previous?.twoYearHistory, twoYear, at),
    stance,
    digestSentFor: previous?.digestSentFor ?? null,
    fired: args.fired ?? previous?.fired ?? [],
  };
}

export const SNAPSHOT_MODEL = 'deterministic';
export { NARRATIVE_CACHE_KIND };
