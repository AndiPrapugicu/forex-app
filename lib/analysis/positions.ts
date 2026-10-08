/**
 * Validation for the user's positions. Pure: the API route parses JSON, this
 * decides whether it is a position, and the store writes it.
 *
 * Every rejection says which field and why, in words the form can show.
 */

import { THESIS } from '@/config/narrative.config';
import { findSymbol } from '@/config/symbols.config';
import type { NewPosition, Position, PositionPatch } from '@/lib/types';

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

const SIZE_CHARS = 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function finitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** Undefined, null and '' all mean "not given". */
function blank(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

function optionalPrice(v: unknown, field: string): Checked<number | null> {
  if (blank(v)) return { ok: true, value: null };
  const n = typeof v === 'string' ? Number(v) : v;
  return finitePositive(n) ? { ok: true, value: n } : { ok: false, reason: `${field} must be a positive number` };
}

function optionalText(v: unknown, field: string, max: number): Checked<string | null> {
  if (blank(v)) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, reason: `${field} must be text` };
  const t = v.trim();
  if (t.length > max) return { ok: false, reason: `${field} is ${t.length} characters; the limit is ${max}` };
  return { ok: true, value: t || null };
}

function optionalRisk(v: unknown): Checked<number | null> {
  if (blank(v)) return { ok: true, value: null };
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100
    ? { ok: true, value: n }
    : { ok: false, reason: 'risk % must be above 0 and at most 100' };
}

/** A stop below entry for a long, above for a short; a target the other way. */
export function sideCheck(side: Position['side'], entry: number, stop: number | null, target: number | null): string | null {
  const long = side === 'long';
  if (stop !== null && (long ? stop >= entry : stop <= entry)) {
    return `stop loss ${stop} must be ${long ? 'below' : 'above'} entry ${entry} for a ${side}`;
  }
  if (target !== null && (long ? target <= entry : target >= entry)) {
    return `take profit ${target} must be ${long ? 'above' : 'below'} entry ${entry} for a ${side}`;
  }
  return null;
}

export function validateNewPosition(body: unknown, now: Date, openCount: number): Checked<NewPosition> {
  if (typeof body !== 'object' || body === null) return { ok: false, reason: 'expected a JSON object' };
  const b = body as Record<string, unknown>;

  if (openCount >= THESIS.maxOpen) return { ok: false, reason: `at most ${THESIS.maxOpen} open positions; close one first` };

  const def = typeof b.symbol === 'string' ? findSymbol(b.symbol.trim()) : undefined;
  if (!def) return { ok: false, reason: 'unknown symbol' };

  if (b.side !== 'long' && b.side !== 'short') return { ok: false, reason: 'side must be long or short' };
  const side = b.side;

  if (typeof b.entryDate !== 'string' || !DATE.test(b.entryDate) || Number.isNaN(Date.parse(`${b.entryDate}T00:00:00Z`))) {
    return { ok: false, reason: 'entry date must be YYYY-MM-DD' };
  }
  if (b.entryDate > now.toISOString().slice(0, 10)) return { ok: false, reason: 'entry date is in the future' };

  const entryRaw = typeof b.entryPrice === 'string' ? Number(b.entryPrice) : b.entryPrice;
  if (!finitePositive(entryRaw)) return { ok: false, reason: 'entry price must be a positive number' };

  const stop = optionalPrice(b.stopLoss, 'stop loss');
  if (!stop.ok) return stop;
  const target = optionalPrice(b.takeProfit, 'take profit');
  if (!target.ok) return target;
  const wrongSide = sideCheck(side, entryRaw, stop.value, target.value);
  if (wrongSide) return { ok: false, reason: wrongSide };

  const size = optionalText(b.size, 'size', SIZE_CHARS);
  if (!size.ok) return size;
  const risk = optionalRisk(b.riskPct);
  if (!risk.ok) return risk;
  const thesis = optionalText(b.thesis, 'thesis', THESIS.thesisChars);
  if (!thesis.ok) return thesis;

  return {
    ok: true,
    value: {
      symbol: def.symbol,
      side,
      entryDate: b.entryDate,
      entryPrice: entryRaw,
      stopLoss: stop.value,
      takeProfit: target.value,
      size: size.value,
      riskPct: risk.value,
      thesis: thesis.value,
    },
  };
}

/**
 * An edit or a close. Only the fields present are changed; `close` with a
 * price stamps the close time. Status fields are the server's, never the form's.
 */
export function validatePatch(body: unknown, current: Position, now: Date): Checked<PositionPatch> {
  if (typeof body !== 'object' || body === null) return { ok: false, reason: 'expected a JSON object' };
  const b = body as Record<string, unknown>;
  const patch: PositionPatch = {};

  if (b.close !== undefined) {
    if (current.closedAtUtc) return { ok: false, reason: 'this position is already closed' };
    const price = optionalPrice(b.closePrice, 'close price');
    if (!price.ok) return price;
    patch.closedAtUtc = now.toISOString();
    patch.closePrice = price.value;
    return { ok: true, value: patch };
  }

  if ('stopLoss' in b) {
    const v = optionalPrice(b.stopLoss, 'stop loss');
    if (!v.ok) return v;
    patch.stopLoss = v.value;
  }
  if ('takeProfit' in b) {
    const v = optionalPrice(b.takeProfit, 'take profit');
    if (!v.ok) return v;
    patch.takeProfit = v.value;
  }
  const wrongSide = sideCheck(
    current.side,
    current.entryPrice,
    patch.stopLoss !== undefined ? patch.stopLoss : current.stopLoss,
    patch.takeProfit !== undefined ? patch.takeProfit : current.takeProfit,
  );
  if (wrongSide) return { ok: false, reason: wrongSide };

  if ('size' in b) {
    const v = optionalText(b.size, 'size', SIZE_CHARS);
    if (!v.ok) return v;
    patch.size = v.value;
  }
  if ('riskPct' in b) {
    const v = optionalRisk(b.riskPct);
    if (!v.ok) return v;
    patch.riskPct = v.value;
  }
  if ('thesis' in b) {
    const v = optionalText(b.thesis, 'thesis', THESIS.thesisChars);
    if (!v.ok) return v;
    patch.thesis = v.value;
  }

  if (Object.keys(patch).length === 0) return { ok: false, reason: 'nothing to change' };
  return { ok: true, value: patch };
}

/** Distance from entry in units of the initial risk (entry to stop). Null without a stop. */
export function rMultiple(p: Pick<Position, 'side' | 'entryPrice' | 'stopLoss'>, price: number): number | null {
  if (p.stopLoss === null) return null;
  const risk = Math.abs(p.entryPrice - p.stopLoss);
  if (risk === 0) return null;
  const move = p.side === 'long' ? price - p.entryPrice : p.entryPrice - price;
  return move / risk;
}
