/**
 * Trade Ideas: turning a bias into concrete levels.
 *
 * A1 shows entry min/max, a target, a stop and trend lines per symbol. Nothing
 * here needs a new data source — the levels come from volatility we already
 * compute in lib/connectors/technicals.ts plus the same 3/14 averages the trend
 * score reads.
 *
 * THE HONEST FRAMING: these are arithmetic, not analysis. They say "if you
 * traded this bias, here is where the recent daily range puts a sensible entry
 * band and stop" — they do not know about support, liquidity, or the event
 * calendar. The UI must present them as derived levels, never as advice.
 *
 * Deliberately returns null for a Neutral bias. A score of 0 has no direction,
 * and inventing a long setup for it would be the single most misleading thing
 * this app could do.
 */

import type { Technicals } from '@/lib/connectors/technicals';
import type { SymbolRow } from '@/lib/scoring/setups';
import type { Currency, Impact, NormalizedEvent } from '@/lib/types';

/** Entry band width, as a multiple of the average daily move. */
export const ENTRY_BAND_ATR = 0.5;
/** Stop distance, as a multiple of the average daily move. */
export const STOP_ATR = 1.5;
/**
 * Reward-to-risk. Fixed at 2:1 rather than derived, because deriving a target
 * from the same volatility that set the stop just restates the stop.
 */
export const REWARD_RISK = 2;

/** Below this the bias is too weak to justify levels at all. */
export const MIN_ABS_SCORE = 4; // A1's own Bullish threshold

export interface TradeIdea {
  symbol: string;
  direction: 'long' | 'short';
  /** Current price, the anchor for every level below. */
  price: number;
  entryMin: number;
  entryMax: number;
  stop: number;
  target: number;
  /** Distance from mid-entry to stop, in price units. */
  risk: number;
  rewardRisk: number;
  /** The average daily move the levels were sized from, in percent. */
  dailyMovePct: number;
  explanation: string;
}

/** Price rounding that respects how the instrument is quoted. */
function roundFor(price: number): (n: number) => number {
  // JPY crosses quote to 3dp, most FX to 5, indices and crypto to 2.
  const dp = price >= 1000 ? 2 : price >= 10 ? 3 : 5;
  const factor = 10 ** dp;
  return (n: number) => Math.round(n * factor) / factor;
}

/**
 * Levels for one symbol, or null when there is no defensible setup.
 *
 * Null cases are all deliberate: no conviction, no price, or no volatility
 * estimate to size against. Sizing a stop without a volatility measure would
 * mean inventing a distance.
 */
export function buildTradeIdea(row: SymbolRow, tech: Technicals | undefined): TradeIdea | null {
  if (Math.abs(row.totalScore) < MIN_ABS_SCORE) return null;

  const price = row.price ?? tech?.price ?? null;
  if (price === null || price <= 0) return null;

  // 90-day average daily move, falling back to the 7-day. The long window is
  // preferred because a stop sized off one turbulent week is a stop that gets
  // hit in a calm one.
  const dailyMovePct = tech?.avgDailyMove90Pct ?? tech?.avgDailyMove7Pct ?? null;
  if (dailyMovePct === null || dailyMovePct <= 0) return null;

  const direction = row.totalScore > 0 ? 'long' : 'short';
  const sign = direction === 'long' ? 1 : -1;
  const move = (price * dailyMovePct) / 100;
  const round = roundFor(price);

  /**
   * The entry band straddles current price rather than sitting below it. A
   * pullback entry sounds better but silently assumes one arrives; this says
   * "anywhere in here is a reasonable fill", which is what the band is for.
   */
  const half = move * ENTRY_BAND_ATR;
  const entryMin = round(price - half);
  const entryMax = round(price + half);

  const risk = move * STOP_ATR;
  const stop = round(price - sign * risk);
  const target = round(price + sign * risk * REWARD_RISK);

  return {
    symbol: row.symbol,
    direction,
    price: round(price),
    entryMin,
    entryMax,
    stop,
    target,
    risk: round(risk),
    rewardRisk: REWARD_RISK,
    dailyMovePct,
    explanation:
      `${row.bias} at ${row.totalScore > 0 ? '+' : ''}${row.totalScore}, so ${direction}. ` +
      `Levels are sized from a ${dailyMovePct}% average daily move: entry within ` +
      `${ENTRY_BAND_ATR}x of that, stop at ${STOP_ATR}x, target at ${REWARD_RISK}:1. ` +
      `Derived from volatility alone — no support, liquidity or calendar awareness.`,
  };
}

/** Trade ideas for every symbol that has enough conviction, strongest first. */
export function buildTradeIdeas(
  rows: SymbolRow[],
  technicals: Map<string, Technicals>,
): TradeIdea[] {
  return rows
    .map((row) => buildTradeIdea(row, technicals.get(row.symbol)))
    .filter((idea): idea is TradeIdea => idea !== null);
}

// ---------------------------------------------------------------------------
// Event risk
// ---------------------------------------------------------------------------

/** How far ahead a release still counts as "about to happen". */
export const EVENT_RISK_HOURS = 48;

export interface UpcomingEvent {
  name: string;
  currency: Currency;
  dateUtc: string;
  hoursAway: number;
  impact: Impact;
}

/**
 * High-impact releases due for a symbol's currencies.
 *
 * A LONG with a stop 1.5x the average daily move away means something different
 * six hours before non-farm payrolls than six hours after. The levels above are
 * sized from realised volatility, which by definition has not seen the event
 * yet — so the number that invalidates them is the one thing the trade idea
 * cannot know about itself.
 *
 * HIGH impact only, and only the currencies the symbol actually reads. A list
 * that includes every medium-impact print is a list nobody scans.
 */
export function upcomingEventRisk(
  currencies: (Currency | undefined)[],
  events: NormalizedEvent[],
  now = new Date(),
  withinHours = EVENT_RISK_HOURS,
): UpcomingEvent[] {
  const wanted = new Set(currencies.filter((c): c is Currency => !!c));
  if (wanted.size === 0) return [];

  const horizon = now.getTime() + withinHours * 3_600_000;

  return events
    .filter(
      (e) =>
        wanted.has(e.currency) &&
        e.impact === 'HIGH' &&
        // Not yet printed: an actual means it has already happened.
        e.actual === null &&
        !e.isSpeech &&
        new Date(e.dateUtc).getTime() > now.getTime() &&
        new Date(e.dateUtc).getTime() <= horizon,
    )
    .map((e) => ({
      name: e.name,
      currency: e.currency,
      dateUtc: e.dateUtc,
      hoursAway: Math.round(((new Date(e.dateUtc).getTime() - now.getTime()) / 3_600_000) * 10) / 10,
      impact: e.impact,
    }))
    .sort((a, b) => a.hoursAway - b.hoursAway);
}
