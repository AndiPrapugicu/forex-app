/**
 * Price structure: swings, breaks, Fibonacci retracements and confluence.
 *
 * This module encodes the step the user performs after reading the board —
 * find the closest support or resistance where price broke previous structure,
 * lay a retracement over the impulse that broke it, and see what lines up. The
 * scorecard says WHAT to trade; nothing until now said whether price was
 * anywhere sensible to trade it from. `lib/scoring/trade-ideas.ts` sizes stops
 * from volatility and admits in its own explanation that it knows nothing about
 * support or liquidity. This is that missing half.
 *
 * THE GOVERNING RULE, and the reason for the null returns everywhere below: a
 * wrong level is worse than no level. A trader who sees no support drawn goes
 * and looks; a trader who sees a confidently-drawn line that is not really there
 * puts a stop under it. So every function here refuses rather than approximates
 * — no break in a range, no retracement of a move too small to retrace, no
 * swings until there are enough bars to confirm one.
 *
 * Pure and synchronous, in the shape of `lib/scoring/correlation.ts`: it takes
 * bars that someone else fetched and returns typed results. Nothing here reads
 * the clock or the network, so the whole module is directly testable and can be
 * replayed at a past date by slicing the bars.
 *
 * Nothing here feeds a score. A1's bias bands are absolute, so a new input would
 * silently redefine "Bullish" — structure is shown beside the score, never
 * folded into it.
 */

import {
  ATR_PERIOD,
  BREAK_BUFFER_ATR,
  CONFLUENCE_ATR,
  FIB_RATIOS,
  FIB_ZONE_TOLERANCE,
  MIN_CONFLUENCE_SOURCES,
  MAX_ZONE_ATR,
  MAX_ZONES,
  MIN_LEG_ATR,
  MIN_SWING_ATR,
  RANGE_LOOKBACK_BARS,
  RETEST_ATR,
  ROUND_STEP_ATR,
  STALE_BREAK_BARS,
  STRUCTURE_MIN_BARS,
  SWING_LOOKBACK,
} from '@/config/setups.config';
import type { DailyBars } from '@/lib/connectors/technicals';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Swing {
  /** Index into the bar arrays. */
  index: number;
  timestamp: number;
  price: number;
  kind: 'high' | 'low';
}

export interface StructureBreak {
  direction: 'bullish' | 'bearish';
  /**
   * The broken swing's price. After a bullish break this is support, after a
   * bearish one resistance — the level the user is looking for.
   */
  level: number;
  /** The swing that gave way. */
  brokenSwing: Swing;
  /** Bar on which a close cleared it. */
  breakIndex: number;
  breakTimestamp: number;
  /** Bars elapsed since. A break twenty bars old is a different fact from a fresh one. */
  barsSince: number;
  /** Has price come back within RETEST_ATR of the level since breaking it? */
  retested: boolean;
  /**
   * A later bar closed back through the level: the break FAILED.
   *
   * A reclaimed level is not support any more, and calling it support after
   * price has closed below it would be the worst single output this module could
   * produce. Kept in the history, never reported as current structure.
   */
  reclaimed: boolean;
  /** Older than STALE_BREAK_BARS — real history, but no longer the live read. */
  stale: boolean;
}

export interface StructureState {
  /** The live break, or null in a range. */
  latest: StructureBreak | null;
  /** Direction of the live break. Null means the market has not chosen. */
  direction: 'bullish' | 'bearish' | null;
  /** The break before it, so continuation can be told from a reversal. */
  previous: StructureBreak | null;
  /** Latest and previous disagree — structure has just changed character. */
  changeOfCharacter: boolean;
  /** Every break found, oldest first, including stale and reclaimed ones. */
  breaks: StructureBreak[];
  /**
   * Populated only when there is no live break. The band price has held, from
   * confirmed swings. The honest answer to "no clean break": here are the edges.
   */
  range: { high: number; low: number; bars: number } | null;
}

export interface FibLevel {
  ratio: number;
  price: number;
}

export interface FibRetracement {
  direction: 'up' | 'down';
  /** Impulse anchors. `low` is always the lower price, whichever way the leg ran. */
  low: number;
  high: number;
  lowIndex: number;
  highIndex: number;
  levels: FibLevel[];
  /** How far price has retraced the leg, 0 = no retracement, 1 = fully undone. */
  positionRatio: number;
  /** Within FIB_ZONE_TOLERANCE of 0.618. */
  inGoldenZone: boolean;
  /** Between the 0.5 and 0.786 retracements — the wider pocket. */
  inDiscountZone: boolean;
  /**
   * False when the extreme anchor is not yet a confirmed swing.
   *
   * The impulse may still be extending, in which case every level below will
   * move. Surfaced rather than hidden: an order placed at a level that is about
   * to relocate is worse than no order.
   */
  legComplete: boolean;
  /**
   * Retraced past the origin — the impulse is void.
   *
   * The object is still returned, because "this move has fully reversed" is
   * information the trader needs. Returning null would read as "no impulse
   * found", which is a different and wrong statement.
   */
  invalidated: boolean;
}

export type LevelKind = 'bos' | 'range' | 'fib' | 'sma' | 'swing' | 'round';

export interface LevelSource {
  kind: LevelKind;
  /** Human label, e.g. "fib 0.618", "SMA 50", "broken high". */
  label: string;
  price: number;
  /**
   * Swings only: how many pivots were merged into this one candidate.
   *
   * A double bottom is one level the market has defended twice, not two
   * independent reasons to expect support. Merging first and counting the
   * touches keeps that distinction — the strength shows up as a touch count
   * rather than by inflating the confluence score.
   */
  touches?: number;
}

export interface ConfluenceZone {
  /** Mean of the member prices. */
  price: number;
  low: number;
  high: number;
  sources: LevelSource[];
  side: 'support' | 'resistance';
  /** Signed distance from current price, in percent. */
  distancePct: number;
  /** Absolute distance in ATR — the comparable measure across symbols. */
  distanceAtr: number;
}

// ---------------------------------------------------------------------------
// Average true range
// ---------------------------------------------------------------------------

/**
 * Mean true range over `period` bars.
 *
 * True range rather than high-minus-low so an overnight gap counts as movement;
 * on FX that matters most at the Sunday open, where a plain range would report a
 * quiet bar through a large move.
 *
 * Simple mean rather than Wilder's smoothing. Wilder's is the convention, but it
 * carries an infinite tail, which would make a level's tolerance depend faintly
 * on data from two years ago. For a tolerance band, a flat window is easier to
 * defend and easier to test.
 */
export function atr(bars: DailyBars, period = ATR_PERIOD): number | null {
  const n = bars.closes.length;
  if (n < period + 1) return null;

  let sum = 0;
  for (let i = n - period; i < n; i++) {
    const prevClose = bars.closes[i - 1];
    sum += Math.max(
      bars.highs[i] - bars.lows[i],
      Math.abs(bars.highs[i] - prevClose),
      Math.abs(bars.lows[i] - prevClose),
    );
  }

  const value = sum / period;
  return value > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Swings
// ---------------------------------------------------------------------------

/**
 * Confirmed swing highs and lows, alternating, noise filtered out.
 *
 * Three stages, each earning its place:
 *
 * 1. FRACTAL. A bar is a candidate swing high when its high exceeds the
 *    `SWING_LOOKBACK` bars to the left and is at least equal to the ones to the
 *    right. Strict on the left and non-strict on the right resolves a double top
 *    to exactly one swing — the first — rather than two competing levels at the
 *    same price, and does so deterministically.
 *
 * 2. SIGNIFICANCE. A candidate is dropped unless it is `MIN_SWING_ATR` away from
 *    the last kept swing of the opposite kind. Without this every minor wiggle
 *    is a swing, and the break detection ends up "breaking" a level nobody would
 *    have drawn.
 *
 * 3. ALTERNATION. Highs and lows must alternate. Two highs in a row collapse to
 *    the higher one, which is what makes the result a zigzag the break detection
 *    can walk unambiguously.
 *
 * THE LAST `SWING_LOOKBACK` BARS CAN NEVER BE CONFIRMED. A pivot needs bars to
 * its right to be a pivot at all; the most recent turn is only a candidate. The
 * UI has to say so rather than draw today's high as a swing that might not
 * survive tomorrow.
 */
export function findSwings(bars: DailyBars, lookback = SWING_LOOKBACK): Swing[] {
  const n = bars.closes.length;
  if (n < STRUCTURE_MIN_BARS) return [];

  const range = atr(bars);
  if (range === null) return [];

  const minGap = range * MIN_SWING_ATR;

  const candidates: Swing[] = [];
  for (let i = lookback; i < n - lookback; i++) {
    let isHigh = true;
    let isLow = true;

    for (let k = 1; k <= lookback; k++) {
      if (bars.highs[i] <= bars.highs[i - k] || bars.highs[i] < bars.highs[i + k]) isHigh = false;
      if (bars.lows[i] >= bars.lows[i - k] || bars.lows[i] > bars.lows[i + k]) isLow = false;
    }

    if (!isHigh && !isLow) continue;

    /**
     * An OUTSIDE bar satisfies both tests — it engulfs its neighbours on both
     * sides. Skipping it would lose the pivot entirely when the outside bar IS
     * the turn, which is common at reversals; marking it as both would break the
     * alternation the break detection depends on. So take the side that
     * travelled further beyond its neighbours, which is the side that actually
     * defines the level.
     */
    let kind: 'high' | 'low';
    if (isHigh && isLow) {
      const upside = bars.highs[i] - Math.max(bars.highs[i - 1], bars.highs[i + 1]);
      const downside = Math.min(bars.lows[i - 1], bars.lows[i + 1]) - bars.lows[i];
      kind = upside >= downside ? 'high' : 'low';
    } else {
      kind = isHigh ? 'high' : 'low';
    }

    candidates.push({
      index: i,
      timestamp: bars.timestamps[i],
      price: kind === 'high' ? bars.highs[i] : bars.lows[i],
      kind,
    });
  }

  const kept: Swing[] = [];
  for (const c of candidates) {
    const last = kept[kept.length - 1];

    if (!last) {
      kept.push(c);
      continue;
    }

    if (last.kind === c.kind) {
      // Same side twice: keep the more extreme, which is the one that actually
      // marks the turn.
      const moreExtreme = c.kind === 'high' ? c.price > last.price : c.price < last.price;
      if (moreExtreme) kept[kept.length - 1] = c;
      continue;
    }

    if (Math.abs(c.price - last.price) < minGap) continue;

    kept.push(c);
  }

  return kept;
}

// ---------------------------------------------------------------------------
// Structure break
// ---------------------------------------------------------------------------

/**
 * The most recent break of structure.
 *
 * A break is a CLOSE beyond the last confirmed swing on that side — not a wick.
 * Wicks pierce levels constantly and are the main source of false breaks; a
 * close is the standard confirmation, and it also keeps this consistent with
 * `scoreTrend`, which reads closes. If the two disagreed about whether a level
 * had broken, one of the app's own screens would be contradicting another.
 *
 * Returns `null` for a range with no clean break, and deliberately does NOT fall
 * back to the nearest swing. Labelling an arbitrary pivot "where price broke
 * previous structure" would be the single most misleading output this module
 * could produce — the user would trade a level the market never respected.
 */
export function findStructureBreaks(bars: DailyBars, swings: Swing[]): StructureBreak[] {
  if (swings.length < 2) return [];

  const range = atr(bars);
  if (range === null) return [];

  const buffer = range * BREAK_BUFFER_ATR;
  const retestTolerance = range * RETEST_ATR;
  const last = bars.closes.length - 1;

  const breaks: StructureBreak[] = [];

  for (const swing of swings) {
    /**
     * Only bars after the swing was CONFIRMED can break it.
     *
     * A pivot is not known to be a pivot until SWING_LOOKBACK bars have printed
     * to its right. Testing earlier bars against it would mean using a level
     * nobody could have drawn yet — the same look-ahead class of bug that
     * `lib/scoring/backtest.ts` exists to defend against, and just as invisible:
     * every historical break would look perfectly timed.
     */
    const from = swing.index + SWING_LOOKBACK + 1;

    for (let i = from; i <= last; i++) {
      const broke =
        swing.kind === 'high'
          ? bars.closes[i] > swing.price + buffer
          : bars.closes[i] < swing.price - buffer;
      if (!broke) continue;

      const direction = swing.kind === 'high' ? 'bullish' : 'bearish';

      let retested = false;
      let reclaimed = false;
      for (let k = i + 1; k <= last; k++) {
        if (
          direction === 'bullish'
            ? bars.lows[k] <= swing.price + retestTolerance
            : bars.highs[k] >= swing.price - retestTolerance
        ) {
          retested = true;
        }
        if (
          direction === 'bullish'
            ? bars.closes[k] < swing.price - buffer
            : bars.closes[k] > swing.price + buffer
        ) {
          reclaimed = true;
        }
      }

      breaks.push({
        direction,
        level: swing.price,
        brokenSwing: swing,
        breakIndex: i,
        breakTimestamp: bars.timestamps[i],
        barsSince: last - i,
        retested,
        reclaimed,
        stale: last - i > STALE_BREAK_BARS,
      });
      break;
    }
  }

  return breaks.sort((a, b) => a.breakIndex - b.breakIndex);
}

/**
 * The structure read: which break is live, and what to say when none is.
 *
 * "Live" means the most recent break that has neither been reclaimed nor gone
 * stale. Both exclusions matter and both were missing from the first cut of this
 * module: a reclaimed break is a level price has closed back through, and a
 * stale one is a level the market has since ranged across. Either would be
 * presented to the user as current support.
 *
 * When nothing is live the answer is a RANGE, not the nearest swing. Naming an
 * arbitrary pivot "where price broke previous structure" would invent a
 * direction the market has not chosen.
 */
export function readStructure(bars: DailyBars, swings: Swing[]): StructureState {
  const breaks = findStructureBreaks(bars, swings);
  const live = breaks.filter((b) => !b.reclaimed && !b.stale);

  const latest = live[live.length - 1] ?? null;
  const previous = live.length > 1 ? live[live.length - 2] : null;

  let range: StructureState['range'] = null;
  if (!latest) {
    const cutoff = bars.closes.length - RANGE_LOOKBACK_BARS;
    const recent = swings.filter((s) => s.index >= cutoff);
    if (recent.length >= 2) {
      range = {
        high: Math.max(...recent.map((s) => s.price)),
        low: Math.min(...recent.map((s) => s.price)),
        bars: Math.min(RANGE_LOOKBACK_BARS, bars.closes.length),
      };
    }
  }

  return {
    latest,
    direction: latest?.direction ?? null,
    previous,
    changeOfCharacter: latest !== null && previous !== null && previous.direction !== latest.direction,
    breaks,
    range,
  };
}

// ---------------------------------------------------------------------------
// Fibonacci
// ---------------------------------------------------------------------------

/**
 * Retracement of the impulse leg that produced the break.
 *
 * Anchors, for a bullish break: the low is the last confirmed swing low before
 * the break, and the high is the highest high reached since that low. Taking the
 * running extreme rather than the next confirmed swing high matters — the leg is
 * usually still extending, and anchoring to a confirmed pivot would draw the
 * grid off a level three bars stale.
 *
 * `positionRatio` is how much of the leg price has given back: 0 at the extreme,
 * 1 back at the origin. Values outside 0..1 are real and kept — above 1 the move
 * has fully reversed, below 0 it has extended past the prior extreme — because
 * clamping would hide exactly the two states worth noticing.
 *
 * Returns `null` for a leg shorter than `MIN_LEG_ATR`. A retracement grid over a
 * move smaller than three days' range puts every level inside the noise, where
 * hitting one means nothing.
 */
export function fibRetracement(
  bars: DailyBars,
  brk: StructureBreak,
  swings: Swing[],
): FibRetracement | null {
  const range = atr(bars);
  if (range === null) return null;

  const wanted = brk.direction === 'bullish' ? 'low' : 'high';

  /**
   * The last opposite swing before THE BREAK — not before the broken swing.
   *
   * This distinction is the whole anchoring bug. In L1 -> H1 -> L2 -> break
   * above H1, the impulse that did the breaking started at L2, which comes
   * AFTER H1. Anchoring at or before H1 finds L1, stretches the leg across the
   * entire prior swing, and puts every retracement far below anything the market
   * will respect — while still drawing a perfectly plausible grid.
   */
  let anchor: Swing | null = null;
  for (const s of swings) {
    if (s.kind === wanted && s.index < brk.breakIndex) anchor = s;
  }
  if (!anchor) return null;

  let extreme = anchor.price;
  let extremeIndex = anchor.index;
  for (let i = anchor.index; i < bars.closes.length; i++) {
    if (brk.direction === 'bullish' && bars.highs[i] > extreme) {
      extreme = bars.highs[i];
      extremeIndex = i;
    } else if (brk.direction === 'bearish' && bars.lows[i] < extreme) {
      extreme = bars.lows[i];
      extremeIndex = i;
    }
  }

  const low = brk.direction === 'bullish' ? anchor.price : extreme;
  const high = brk.direction === 'bullish' ? extreme : anchor.price;
  const height = high - low;

  if (height < range * MIN_LEG_ATR) return null;

  const up = brk.direction === 'bullish';

  const levels: FibLevel[] = FIB_RATIOS.map((ratio) => ({
    ratio,
    // Retracing an up-leg walks down from the high; a down-leg walks up from the low.
    price: up ? high - ratio * height : low + ratio * height,
  }));

  const last = bars.closes.length - 1;
  const price = bars.closes[last];
  const positionRatio = up ? (high - price) / height : (price - low) / height;
  const invalidated = positionRatio > 1;

  return {
    direction: up ? 'up' : 'down',
    low,
    high,
    lowIndex: up ? anchor.index : extremeIndex,
    highIndex: up ? extremeIndex : anchor.index,
    levels,
    positionRatio,
    // A void impulse has no zone to be in, whatever the arithmetic says.
    inGoldenZone: !invalidated && Math.abs(positionRatio - 0.618) <= FIB_ZONE_TOLERANCE,
    inDiscountZone: !invalidated && positionRatio >= 0.5 && positionRatio <= 0.786,
    legComplete: last - extremeIndex >= SWING_LOOKBACK,
    invalidated,
  };
}

// ---------------------------------------------------------------------------
// Confluence
// ---------------------------------------------------------------------------

/**
 * Round numbers near price, which act as levels for reasons unrelated to charts
 * — resting orders cluster there.
 *
 * The step scales with the quote's magnitude so the idea means the same thing
 * for a 1.15 currency pair and a 4,400 gold price: roughly 1% of price, snapped
 * to the nearest power of ten.
 */
export function roundNumbers(price: number, range: number, count = 2): number[] {
  if (!(price > 0) || !(range > 0)) return [];

  /**
   * The grid spacing is derived from ATR, not from the price's magnitude.
   *
   * Smallest 1-2-5 x 10^k step that is at least `ROUND_STEP_ATR` ATR wide. That
   * guarantees `step / 2 > CONFLUENCE_ATR`, so a round number is never
   * automatically within tolerance of wherever price happens to be. A fixed grid
   * breaks this: on EURUSD a 0.005 grid puts a round number within 25 pips of
   * any price, which on a 60-pip ATR is always inside the tolerance — the
   * round-number vote becomes free and every confluence score gains a point.
   */
  const target = range * ROUND_STEP_ATR;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= target) ?? magnitude * 10;

  const base = Math.round(price / step) * step;

  const out: number[] = [];
  for (let k = -count; k <= count; k++) {
    const level = base + k * step;
    if (level > 0) out.push(level);
  }
  return out;
}

/**
 * Collapses swings sitting at effectively the same price into one candidate.
 *
 * Run BEFORE clustering, and it is the difference between a double bottom
 * reading as "one level, defended twice" and as "two independent reasons".
 * Without it, five old pivots at the same price carry a zone to a score of five
 * on their own — the exact fake-confluence the whole scheme exists to avoid.
 */
export function mergeSwings(swings: Swing[], range: number): LevelSource[] {
  if (!(range > 0)) return [];

  const tolerance = range * CONFLUENCE_ATR;
  const sorted = [...swings].sort((a, b) => a.price - b.price);
  const groups: Swing[][] = [];

  for (const swing of sorted) {
    const current = groups[groups.length - 1];
    if (current && Math.abs(swing.price - current[0].price) <= tolerance) current.push(swing);
    else groups.push([swing]);
  }

  return groups.map((group) => {
    const price = group.reduce((s, g) => s + g.price, 0) / group.length;
    const kind = group[0].kind;
    const noun = kind === 'high' ? 'high' : 'low';
    return {
      kind: 'swing' as const,
      label: group.length > 1 ? `${noun} tested ${group.length}x` : `untested ${noun}`,
      price,
      touches: group.length,
    };
  });
}

/** Seed order. The broken level anchors a zone before anything else can. */
const SEED_PRIORITY: Record<LevelKind, number> = {
  bos: 0,
  range: 0,
  fib: 1,
  sma: 2,
  swing: 3,
  round: 4,
};

/** Levels that stay on the list however little agrees with them. */
const ALWAYS_KEEP: LevelKind[] = ['bos', 'range'];

/**
 * Groups levels that sit close enough together to be one level.
 *
 * FIXED-SEED ABSORPTION, not a running mean. Each zone is anchored by its seed's
 * price and absorbs candidates within `CONFLUENCE_ATR` OF THAT SEED. A moving
 * centroid chains: A within tolerance of B and B within tolerance of C merges A
 * and C even though they sit two tolerances apart, producing a "zone" too wide
 * to place an order in and a source count that includes levels the user can
 * plainly see are separate. Seeding in a fixed priority order also makes the
 * output independent of candidate ordering, so the same bars always give the
 * same zones.
 *
 * ONE FIB PER ZONE. The four ratios come from a single pair of anchors, so two
 * of them landing together is arithmetic, not agreement — counting both would
 * manufacture confluence out of one piece of evidence. Same reason duplicates of
 * a kind at the same price are dropped.
 *
 * Zones are returned nearest-first, which is the order they are read in.
 */
export function confluence(
  candidates: LevelSource[],
  price: number,
  range: number,
): ConfluenceZone[] {
  if (!(range > 0) || !(price > 0)) return [];

  const seen = new Set<string>();
  const pool = candidates
    .filter((c) => Number.isFinite(c.price) && c.price > 0)
    .filter((c) => {
      const key = `${c.kind}:${c.price.toFixed(8)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        SEED_PRIORITY[a.kind] - SEED_PRIORITY[b.kind] ||
        Math.abs(a.price - price) - Math.abs(b.price - price),
    );

  const tolerance = range * CONFLUENCE_ATR;
  const used = new Set<LevelSource>();
  const groups: LevelSource[][] = [];

  for (const seed of pool) {
    if (used.has(seed)) continue;
    used.add(seed);

    const group = [seed];
    let hasFib = seed.kind === 'fib';

    for (const other of pool) {
      if (used.has(other)) continue;
      if (Math.abs(other.price - seed.price) > tolerance) continue;
      if (other.kind === 'fib' && hasFib) continue;

      if (other.kind === 'fib') hasFib = true;
      used.add(other);
      group.push(other);
    }

    groups.push(group);
  }

  return groups
    .map((sources) => {
      const mean = sources.reduce((s, m) => s + m.price, 0) / sources.length;
      return {
        price: mean,
        low: Math.min(...sources.map((s) => s.price)),
        high: Math.max(...sources.map((s) => s.price)),
        sources,
        side: mean <= price ? ('support' as const) : ('resistance' as const),
        distancePct: ((mean - price) / price) * 100,
        distanceAtr: Math.abs(mean - price) / range,
      };
    })
    .sort((a, b) => a.distanceAtr - b.distanceAtr);
}

// ---------------------------------------------------------------------------
// The whole picture
// ---------------------------------------------------------------------------

export interface StructureView {
  price: number;
  atr: number;
  atrPct: number;
  swings: Swing[];
  structure: StructureState;
  fib: FibRetracement | null;
  /** Zones with at least MIN_CONFLUENCE_SOURCES, plus the broken level whatever its count. */
  zones: ConfluenceZone[];
  /** Nearest zone below price, and above. Either may be absent. */
  nearestSupport: ConfluenceZone | null;
  nearestResistance: ConfluenceZone | null;
  /**
   * Bars at the end that cannot yet contain a confirmed swing. Surfaced so the
   * UI can say the most recent turn is unconfirmed rather than imply otherwise.
   */
  unconfirmedBars: number;
}

/**
 * Everything above, assembled for one symbol on one timeframe.
 *
 * `smas` comes from `Technicals`, which the pipeline already computes — the
 * moving averages are free confluence inputs and recomputing them here would
 * risk the chart disagreeing with the scorecard about where the 50-day sits.
 */
export function analyseStructure(
  bars: DailyBars,
  smas: Partial<Record<20 | 50 | 100 | 200, number | null>> = {},
): StructureView | null {
  if (bars.closes.length < STRUCTURE_MIN_BARS) return null;

  const range = atr(bars);
  if (range === null) return null;

  const price = bars.closes[bars.closes.length - 1];
  const swings = findSwings(bars);
  const structure = readStructure(bars, swings);
  const brk = structure.latest;
  const fib = brk ? fibRetracement(bars, brk, swings) : null;

  const candidates: LevelSource[] = [];

  if (brk) {
    candidates.push({
      kind: 'bos',
      label: brk.direction === 'bullish' ? 'broken high' : 'broken low',
      price: brk.level,
    });
  } else if (structure.range) {
    /**
     * In a range the EDGES are the levels — they are where the market has
     * repeatedly turned, and they are what a trader actually works with while
     * waiting for a break. Leaving them out was the gap: a ranging symbol
     * produced a nearly empty levels table despite having two obvious lines.
     */
    candidates.push({ kind: 'range', label: 'range high', price: structure.range.high });
    candidates.push({ kind: 'range', label: 'range low', price: structure.range.low });
  }

  // A void impulse's levels are history, not levels — they must not vote.
  if (fib && !fib.invalidated) {
    for (const level of fib.levels) {
      candidates.push({ kind: 'fib', label: `fib ${level.ratio}`, price: level.price });
    }
  }

  for (const period of [20, 50, 100, 200] as const) {
    const value = smas[period];
    if (typeof value === 'number' && Number.isFinite(value)) {
      candidates.push({ kind: 'sma', label: `SMA ${period}`, price: value });
    }
  }

  /**
   * Untested swings only. A swing price has already done its work once price has
   * traded back through it; leaving it in would pad the confluence count with
   * levels the market has demonstrably ignored.
   */
  const untested = swings.filter((swing) => {
    // The broken swing is already in as `bos`; letting it in again would have
    // the primary level scoring two votes against itself.
    if (brk && swing.index === brk.brokenSwing.index) return false;

    return !bars.closes
      .slice(swing.index + 1)
      .some((c) => (swing.kind === 'high' ? c > swing.price : c < swing.price));
  });

  for (const merged of mergeSwings(untested, range)) candidates.push(merged);

  for (const level of roundNumbers(price, range)) {
    candidates.push({ kind: 'round', label: 'round number', price: level });
  }

  const all = confluence(candidates, price, range);

  /**
   * Two filters, then a cap.
   *
   * Singletons go, because one source is not confluence and publishing every
   * lone level fills the panel with fifteen "levels" nobody reads. Anything
   * beyond MAX_ZONE_ATR goes too: a level twenty-four ATR away is arithmetic,
   * not a trade, and it pushes the reachable levels off the list.
   *
   * The broken level and the range edges survive both. They are what the whole
   * read is anchored to, and they stay whether or not anything agrees.
   */
  const zones = all
    .filter((z) => {
      if (z.sources.some((s) => ALWAYS_KEEP.includes(s.kind))) return true;
      return z.sources.length >= MIN_CONFLUENCE_SOURCES && z.distanceAtr <= MAX_ZONE_ATR;
    })
    .slice(0, MAX_ZONES);

  return {
    price,
    atr: range,
    atrPct: (range / price) * 100,
    swings,
    structure,
    fib,
    zones,
    nearestSupport: zones.find((z) => z.side === 'support') ?? null,
    nearestResistance: zones.find((z) => z.side === 'resistance') ?? null,
    unconfirmedBars: SWING_LOOKBACK,
  };
}
