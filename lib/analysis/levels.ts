/**
 * Price levels the analyst may name — and the ONLY ones it may name.
 *
 * Asked "where would I get into EURUSD", a language model will happily invent a
 * level that sounds right. So every zone it offers has to come from this list,
 * and every entry here is read straight off closed daily bars: prior day and
 * prior week extremes, the 20-session and 52-week range, the classic weekly
 * pivot, and swing points. Nothing is fitted, and nothing is a Fibonacci ratio.
 *
 * Pure, with the clock injected, like everything else under lib/scoring.
 */

import type { DailyBars } from '@/lib/connectors/technicals';

export interface PriceLevel {
  label: string;
  price: number;
  /** `YYYY-MM-DD` of the bar the level was read off, where it is one bar. */
  date: string | null;
  side: 'above' | 'below';
  /** Distance from the current price, in percent (signed: above is positive). */
  distancePct: number;
}

export interface LevelSet {
  price: number;
  /** True when the newest bar is still trading, and was left out of every level. */
  sessionInProgress: boolean;
  levels: PriceLevel[];
}

const DAY_MS = 86_400_000;
/** Bars on each side that a swing point must out-reach. */
const FRACTAL_SPAN = 3;
const SWING_LOOKBACK = 90;
const SWINGS_PER_SIDE = 3;

const isoDay = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/** Monday 00:00 UTC of the week containing `ms`. */
function weekStart(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY_MS;
}

export interface Bar {
  /** Bar open, epoch ms. */
  t: number;
  h: number;
  l: number;
  c: number;
}

export function toBarList(bars: DailyBars): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < bars.timestamps.length; i++) {
    const h = bars.highs[i];
    const l = bars.lows[i];
    const c = bars.closes[i];
    if (![h, l, c].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    out.push({ t: bars.timestamps[i] * 1000, h, l, c });
  }
  return out;
}

/** Drops the newest bar while it is still trading (opened inside the last 24h). */
export function closedBars(all: Bar[], now: Date): Bar[] {
  const last = all[all.length - 1];
  return last && now.getTime() - last.t < DAY_MS ? all.slice(0, -1) : all;
}

/**
 * Swing highs and lows: a bar whose high (low) out-reaches the FRACTAL_SPAN bars
 * on either side. Read over complete bars only, so a swing cannot be "confirmed"
 * by a session that has not closed.
 */
export function findSwings(bars: Bar[]): { price: number; t: number; kind: 'high' | 'low' }[] {
  const out: { price: number; t: number; kind: 'high' | 'low' }[] = [];
  for (let i = FRACTAL_SPAN; i < bars.length - FRACTAL_SPAN; i++) {
    const around = [...bars.slice(i - FRACTAL_SPAN, i), ...bars.slice(i + 1, i + 1 + FRACTAL_SPAN)];
    if (around.every((b) => bars[i].h > b.h)) out.push({ price: bars[i].h, t: bars[i].t, kind: 'high' });
    if (around.every((b) => bars[i].l < b.l)) out.push({ price: bars[i].l, t: bars[i].t, kind: 'low' });
  }
  return out;
}

export function buildLevels(bars: DailyBars | null, price: number | null, now: Date): LevelSet | null {
  if (!bars) return null;
  const all = toBarList(bars);
  if (all.length < 25) return null;

  // A bar that opened inside the last 24h is still trading: its high and low are
  // not levels yet.
  const last = all[all.length - 1];
  const sessionInProgress = now.getTime() - last.t < DAY_MS;
  const closed = sessionInProgress ? all.slice(0, -1) : all;
  const spot = price ?? last.c;
  if (!(spot > 0) || closed.length < 21) return null;

  const raw: Omit<PriceLevel, 'side' | 'distancePct'>[] = [];
  const add = (label: string, value: number, t: number | null) => {
    if (Number.isFinite(value)) raw.push({ label, price: value, date: t === null ? null : isoDay(t / 1000) });
  };

  const prior = closed[closed.length - 1];
  add('Prior day high', prior.h, prior.t);
  add('Prior day low', prior.l, prior.t);
  add('Prior day close', prior.c, prior.t);

  // The last COMPLETE calendar week, which is the one before the week `now` is in.
  const thisWeek = weekStart(now.getTime());
  const lastWeek = closed.filter((b) => b.t >= thisWeek - 7 * DAY_MS && b.t < thisWeek);
  if (lastWeek.length > 0) {
    const h = Math.max(...lastWeek.map((b) => b.h));
    const l = Math.min(...lastWeek.map((b) => b.l));
    const c = lastWeek[lastWeek.length - 1].c;
    const weekOf = lastWeek[0].t;
    add('Prior week high', h, weekOf);
    add('Prior week low', l, weekOf);
    // Classic floor pivot off that week.
    const p = (h + l + c) / 3;
    add('Weekly pivot P', p, weekOf);
    add('Weekly pivot R1', 2 * p - l, weekOf);
    add('Weekly pivot S1', 2 * p - h, weekOf);
    add('Weekly pivot R2', p + (h - l), weekOf);
    add('Weekly pivot S2', p - (h - l), weekOf);
  }

  const range = (n: number, label: string) => {
    const window = closed.slice(-n);
    const hi = window.reduce((a, b) => (b.h > a.h ? b : a));
    const lo = window.reduce((a, b) => (b.l < a.l ? b : a));
    add(`${label} high`, hi.h, hi.t);
    add(`${label} low`, lo.l, lo.t);
  };
  range(20, '20-session');
  if (closed.length >= 200) range(Math.min(252, closed.length), '52-week');

  const swings = findSwings(closed.slice(-SWING_LOOKBACK));
  const above = swings.filter((s) => s.price > spot).sort((a, b) => a.price - b.price).slice(0, SWINGS_PER_SIDE);
  const below = swings.filter((s) => s.price < spot).sort((a, b) => b.price - a.price).slice(0, SWINGS_PER_SIDE);
  for (const s of [...above, ...below]) add(`Swing ${s.kind}`, s.price, s.t);

  const levels = raw
    .map((l) => ({
      ...l,
      side: (l.price >= spot ? 'above' : 'below') as PriceLevel['side'],
      distancePct: ((l.price - spot) / spot) * 100,
    }))
    .sort((a, b) => b.price - a.price);

  return { price: spot, sessionInProgress, levels };
}
