/**
 * Is an open position's thesis still intact?
 *
 * The user holds a trade for weeks while the board stays strong and price keeps
 * making higher lows (lower highs for a short). This turns that habit into
 * checks, each one named and dated, so a RED is never just a colour.
 *
 *   RED on ANY of:
 *     - a daily close beyond the last HL (long) / LH (short);
 *     - the board leaving the position's band (below +4 for a long);
 *     - the tactical narrative turning against the position;
 *     - a flip condition firing against it in the last few days.
 *   YELLOW on any of:
 *     - the board eroded 40% from its reading at entry, still in band;
 *     - a flip event against the position due within 3 days;
 *     - the structural narrative against;
 *     - price within half an ATR of the structure level.
 *
 * Pure, with the clock injected. Nothing here feeds the board.
 */

import { THESIS } from '@/config/narrative.config';
import type { Currency, NormalizedEvent, Position } from '@/lib/types';
import { closedBars, findSwings, type Bar } from '@/lib/analysis/levels';
import { rMultiple } from '@/lib/analysis/positions';
import type { FlipCheck, FlipCondition, PairNarrative, Side } from '@/lib/analysis/state';

export type ThesisStatus = 'green' | 'yellow' | 'red';

export interface ThesisSignal {
  level: 'red' | 'yellow';
  code: 'structure' | 'band' | 'tactical' | 'flip-fired' | 'erosion' | 'flip-due' | 'structural' | 'near-structure';
  text: string;
}

/** A flip condition the data has met, remembered for `THESIS.firedMemoryDays`. */
export interface FiredFlip {
  id: string;
  symbol: string;
  text: string;
  favours: Side;
  firedAtUtc: string;
  /** The reading that met it. */
  value: number;
}

export interface StructureLevel {
  kind: 'HL' | 'LH' | 'swing low' | 'swing high';
  price: number;
  date: string;
}

export interface ThesisReport {
  positionId: string;
  symbol: string;
  status: ThesisStatus;
  signals: ThesisSignal[];
  price: number | null;
  structure: StructureLevel | null;
  /** Last complete daily close. */
  lastClose: { price: number; date: string } | null;
  atr: number | null;
  /** Open P/L in R (entry to stop = 1R). */
  rNow: number | null;
  /** The target in R. */
  rTarget: number | null;
  boardScore: number | null;
  entryScore: number | null;
  /** Consecutive days the board has been inside the position's band, up to now. */
  daysOnSide: number | null;
  evaluatedAtUtc: string;
}

export interface ThesisInputs {
  position: Position;
  /** The symbol's daily bars, oldest first, the live session included or not. */
  bars: Bar[];
  price: number | null;
  boardScore: number | null;
  /** The board at the capture nearest the entry date. */
  entryScore: number | null;
  /** Board captures, oldest first, for days-on-side. */
  boardHistory: { atUtc: string; score: number }[];
  narrative: PairNarrative | null;
  /** Flips that fired for this symbol (any side; filtered here). */
  fired: FiredFlip[];
  now: Date;
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sideOf = (p: Position): Side => (p.side === 'long' ? 'bullish' : 'bearish');
const fmt = (v: number) => Number(v.toPrecision(6)).toString();
const sgn = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');

/** Wilder-free simple ATR over the last `period` complete bars. */
export function averageTrueRange(bars: Bar[], period = THESIS.atrPeriod): number | null {
  if (bars.length < period + 1) return null;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const prev = bars[i - 1].c;
    sum += Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - prev), Math.abs(bars[i].l - prev));
  }
  return sum / period;
}

/**
 * The level that defines the trend for this side: the most recent higher low
 * for a long (lower high for a short). With no such pair in the window, the
 * most recent swing on that side stands in, and says so.
 */
export function structureLevel(bars: Bar[], side: Position['side']): StructureLevel | null {
  const kind = side === 'long' ? 'low' : 'high';
  const swings = findSwings(bars.slice(-90)).filter((s) => s.kind === kind).sort((a, b) => a.t - b.t);
  if (swings.length === 0) return null;
  for (let i = swings.length - 1; i >= 1; i--) {
    if (side === 'long' ? swings[i].price > swings[i - 1].price : swings[i].price < swings[i - 1].price) {
      return { kind: side === 'long' ? 'HL' : 'LH', price: swings[i].price, date: isoDay(swings[i].t) };
    }
  }
  const last = swings[swings.length - 1];
  return { kind: side === 'long' ? 'swing low' : 'swing high', price: last.price, date: isoDay(last.t) };
}

/** Days the board has sat on the position's side of its band, counting back from the newest capture. */
export function daysOnSide(history: { atUtc: string; score: number }[], side: Position['side'], now: Date): number | null {
  if (history.length === 0) return null;
  const inBand = (s: number) => (side === 'long' ? s >= THESIS.band : s <= -THESIS.band);
  let earliest: string | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (!inBand(history[i].score)) break;
    earliest = history[i].atUtc;
  }
  return earliest === null ? 0 : Math.floor((now.getTime() - Date.parse(earliest)) / DAY_MS);
}

export function evaluateThesis(x: ThesisInputs): ThesisReport {
  const { position: p, now } = x;
  const side = sideOf(p);
  const long = p.side === 'long';
  const signals: ThesisSignal[] = [];

  const closed = closedBars(x.bars, now);
  const last = closed[closed.length - 1] ?? null;
  const structure = structureLevel(closed, p.side);
  const atr = averageTrueRange(closed);
  const price = x.price ?? x.bars[x.bars.length - 1]?.c ?? null;

  // RED: structure.
  if (structure && last) {
    const broken = long ? last.c < structure.price : last.c > structure.price;
    if (broken) {
      signals.push({
        level: 'red',
        code: 'structure',
        text: `Daily close ${fmt(last.c)} (${isoDay(last.t)}) is ${long ? 'below' : 'above'} the last ${structure.kind} ${fmt(structure.price)} (${structure.date})`,
      });
    } else if (atr !== null && price !== null && Math.abs(price - structure.price) <= THESIS.atrProximity * atr) {
      signals.push({
        level: 'yellow',
        code: 'near-structure',
        text: `Price ${fmt(price)} is within ${THESIS.atrProximity} ATR (${fmt(atr)}) of the last ${structure.kind} ${fmt(structure.price)}`,
      });
    }
  }

  // RED: board band. YELLOW: erosion inside it.
  if (x.boardScore !== null) {
    const inBand = long ? x.boardScore >= THESIS.band : x.boardScore <= -THESIS.band;
    if (!inBand) {
      signals.push({
        level: 'red',
        code: 'band',
        text: `Board ${sgn(x.boardScore)} has left the ${long ? `+${THESIS.band} or higher` : `−${THESIS.band} or lower`} band a ${p.side} needs`,
      });
    } else if (x.entryScore !== null && Math.abs(x.entryScore) > 0 && Math.sign(x.entryScore) === (long ? 1 : -1)) {
      const eroded = (Math.abs(x.entryScore) - Math.abs(x.boardScore)) / Math.abs(x.entryScore);
      if (eroded >= THESIS.erosion) {
        signals.push({
          level: 'yellow',
          code: 'erosion',
          text: `Board ${sgn(x.boardScore)}, down ${Math.round(eroded * 100)}% from ${sgn(x.entryScore)} at entry`,
        });
      }
    }
  }

  // RED: tactical narrative against. YELLOW: structural against.
  if (x.narrative) {
    const against = long ? 'BEARISH' : 'BULLISH';
    if (x.narrative.tactical.label === against) {
      signals.push({ level: 'red', code: 'tactical', text: `Tactical narrative is ${x.narrative.tactical.text}` });
    }
    if (x.narrative.structural.label === against) {
      signals.push({ level: 'yellow', code: 'structural', text: `Structural narrative is ${x.narrative.structural.text}` });
    }
    // YELLOW: a scheduled flip against the position, soon.
    const soon = new Date(now.getTime() + THESIS.eventDays * DAY_MS).toISOString();
    for (const f of x.narrative.flips) {
      if (f.favours === side || !f.dueUtc || f.dueUtc <= now.toISOString() || f.dueUtc > soon) continue;
      signals.push({ level: 'yellow', code: 'flip-due', text: `Due within ${THESIS.eventDays} days: ${f.text}` });
    }
  }

  // RED: a flip that fired against the position, since entry and recently.
  const memory = new Date(now.getTime() - THESIS.firedMemoryDays * DAY_MS).toISOString();
  for (const f of x.fired) {
    if (f.symbol !== p.symbol || f.favours === side) continue;
    if (f.firedAtUtc < memory || f.firedAtUtc.slice(0, 10) < p.entryDate) continue;
    signals.push({ level: 'red', code: 'flip-fired', text: `Flip condition hit ${f.firedAtUtc.slice(0, 16).replace('T', ' ')}Z: ${f.text} (at ${fmt(f.value)})` });
  }

  const status: ThesisStatus = signals.some((s) => s.level === 'red') ? 'red' : signals.length > 0 ? 'yellow' : 'green';
  return {
    positionId: p.id,
    symbol: p.symbol,
    status,
    signals: signals.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1)),
    price,
    structure,
    lastClose: last ? { price: last.c, date: isoDay(last.t) } : null,
    atr,
    rNow: price === null ? null : rMultiple(p, price),
    rTarget: p.takeProfit === null ? null : rMultiple(p, p.takeProfit),
    boardScore: x.boardScore,
    entryScore: x.entryScore,
    daysOnSide: daysOnSide(x.boardHistory, p.side, now),
    evaluatedAtUtc: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Which flip conditions has the data met?
// ---------------------------------------------------------------------------

export interface FlipData {
  events: NormalizedEvent[];
  /** Latest close for a ticker key (a MARKET key, a fed funds contract, a symbol's Yahoo ticker). */
  close(key: string): number | null;
  yield2y(currency: Currency): number | null;
}

function reading(check: FlipCheck, data: FlipData): number | null {
  switch (check.type) {
    case 'release': {
      const e = data.events.find((ev) => ev.id === check.eventId);
      return e && e.actual !== null ? e.actual : null;
    }
    case 'close':
      return data.close(check.key);
    case 'yield2y':
      return data.yield2y(check.currency);
  }
}

/** The conditions whose check is met now, with the reading that met it. */
export function firedConditions(conditions: FlipCondition[], data: FlipData): { condition: FlipCondition; value: number }[] {
  const out: { condition: FlipCondition; value: number }[] = [];
  for (const c of conditions) {
    const v = reading(c.check, data);
    if (v === null || !Number.isFinite(v)) continue;
    if (c.check.op === '>=' ? v >= c.check.threshold : v <= c.check.threshold) out.push({ condition: c, value: v });
  }
  return out;
}

/** Yesterday's memory plus today's hits, minus anything older than the window. */
export function rememberFired(previous: FiredFlip[] | undefined, hits: FiredFlip[], now: Date): FiredFlip[] {
  const cutoff = new Date(now.getTime() - THESIS.firedMemoryDays * DAY_MS).toISOString();
  const byId = new Map<string, FiredFlip>();
  for (const f of [...(previous ?? []), ...hits]) {
    const key = `${f.symbol}|${f.id}`;
    if (f.firedAtUtc >= cutoff && !byId.has(key)) byId.set(key, f);
  }
  return [...byId.values()].sort((a, b) => a.firedAtUtc.localeCompare(b.firedAtUtc));
}
