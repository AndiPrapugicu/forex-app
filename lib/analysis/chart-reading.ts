/**
 * The vision model's reading of an attached chart, as data.
 *
 * `VISION_PROMPT` (lib/ai/openrouter.ts) asks for a fixed header per image —
 * SYMBOL, TIMEFRAME, TIMEZONE, CROSSHAIR_TIME, MEASURE, X_AXIS_DATES,
 * LAST_PRICE — before its free-text bullets. This file turns that header into
 * typed fields, so the chart's date and the move the user measured can choose
 * the window the reaction reader looks at. A field the model could not read is
 * null; nothing is guessed.
 */

import { INSTRUMENT_ALIASES } from '@/config/reaction.config';
import { findSymbol } from '@/config/symbols.config';
import { dayBounds, dayLabel, localDay, monthNumber, type LocalDay, type Zone } from '@/lib/analysis/tz';

export interface ChartReading {
  /** 1-based, in the order the images were attached. */
  index: number;
  /** As printed on the chart ("NDQ100", "US02Y"). */
  symbol: string | null;
  /** The app symbol or panel ticker it names, if any. */
  resolved: { symbol?: string; ticker?: string } | null;
  timeframeMinutes: number | null;
  /** The chart's own clock, from "UTC+3" etc. */
  utcOffsetMinutes: number | null;
  /** The date (and time, if printed) under the crosshair, in the chart's clock. */
  crosshair: { y: number; m: number; d: number; hh: number | null; mm: number | null } | null;
  /** What the user's measuring tool reads. */
  measure: { change: number | null; pct: number | null; bars: number | null } | null;
  lastPrice: number | null;
}

const UNREADABLE = /^(not (visible|legible|shown|present)|n\/?a|none|unknown|-|—)\.?$/i;
const MINUS = /[−–]/g;

function field(block: string, key: string): string | null {
  const m = block.match(new RegExp(`^[\\s*>-]*\\**${key}\\**\\s*:\\s*(.+)$`, 'im'));
  if (!m) return null;
  const v = m[1].replace(/\*\*/g, '').trim();
  return v && !UNREADABLE.test(v) ? v : null;
}

const num = (s: string) => Number(s.replace(MINUS, '-').replace(/,/g, ''));

export function parseTimeframe(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/\s+/g, '');
  let m = s.match(/^(\d+)(m|min|mins|minute|minutes)$/) ?? s.match(/^m(\d+)$/);
  if (m) return +m[1];
  m = s.match(/^(\d+)(h|hr|hrs|hour|hours)$/) ?? s.match(/^h(\d+)$/);
  if (m) return +m[1] * 60;
  if (/^(1?d|d1|daily|day|1day)$/.test(s)) return 1440;
  if (/^(1?w|w1|weekly|week)$/.test(s)) return 10_080;
  m = s.match(/^(\d+)$/);
  if (m) return +m[1]; // TradingView's bare "60" is minutes
  return null;
}

export function parseOffset(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.replace(MINUS, '-').match(/(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i);
  if (m) return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + (m[3] ? +m[3] : 0));
  if (/^(UTC|GMT|Z)$/i.test(raw.trim())) return 0;
  return null;
}

const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|ian|iun|iul|noi)[a-z]*\\.?';

/** "Thu 08 Oct '26 12:00", "2026-10-08 12:00", "Oct 8, 2026", "08 Oct". The year defaults to the current one. */
export function parseChartDate(raw: string | null, currentYear: number): ChartReading['crosshair'] {
  if (!raw) return null;
  const time = raw.match(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/);
  const hh = time ? +time[1] : null;
  const mm = time ? +time[2] : null;
  let m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3], hh, mm };
  const year = (s: string | undefined) => (s ? (s.length === 2 ? 2000 + +s : +s) : currentYear);
  m = raw.match(new RegExp(`(?<!\\d)(\\d{1,2})\\s+${MONTH}(?:\\s*'?(\\d{4}|\\d{2})(?!:))?`, 'i'));
  if (m) {
    const month = monthNumber(m[2]);
    if (month) return { y: year(m[3]), m: month, d: +m[1], hh, mm };
  }
  m = raw.match(new RegExp(`${MONTH}\\s+(\\d{1,2})(?!\\d)(?:,?\\s*'?(\\d{4}|\\d{2})(?!:))?`, 'i'));
  if (m) {
    const month = monthNumber(m[1]);
    if (month) return { y: year(m[3]), m: month, d: +m[2], hh, mm };
  }
  return null;
}

export function parseMeasure(raw: string | null): ChartReading['measure'] {
  if (!raw) return null;
  const s = raw.replace(MINUS, '-');
  const pct = s.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/);
  const bars = s.match(/(\d+)\s*bars?/i);
  const change = s.match(/^\s*([+-]?\d[\d,]*(?:\.\d+)?)(?!\s*%)/);
  const out = {
    change: change ? num(change[1]) : null,
    pct: pct ? num(pct[1].replace(',', '.')) : null,
    bars: bars ? +bars[1] : null,
  };
  return out.change === null && out.pct === null && out.bars === null ? null : out;
}

/** The app symbol or panel ticker a printed chart symbol names. */
export function resolveChartSymbol(raw: string | null): ChartReading['resolved'] {
  if (!raw) return null;
  const s = raw.split(/[\s,·•(]/)[0].replace(/^[A-Z]+:/, '');
  const own = findSymbol(s.replace('/', ''));
  if (own) return { symbol: own.symbol };
  for (const a of INSTRUMENT_ALIASES) if (a.pattern.test(s)) return a.symbol ? { symbol: a.symbol } : { ticker: a.ticker };
  return null;
}

/** One reading per image; the blocks are split on "IMAGE n" lines when there are several. */
export function parseChartReadings(text: string, nowMs: number): ChartReading[] {
  const currentYear = new Date(nowMs).getUTCFullYear();
  const blocks = text.split(/^\s*[#*]*\s*IMAGE\s*(\d+)\b.*$/im);
  const parts: { index: number; body: string }[] = [];
  if (blocks.length === 1) parts.push({ index: 1, body: text });
  else for (let k = 1; k < blocks.length; k += 2) parts.push({ index: +blocks[k], body: blocks[k + 1] ?? '' });

  return parts.map(({ index, body }) => {
    const symbol = field(body, 'SYMBOL');
    return {
      index,
      symbol,
      resolved: resolveChartSymbol(symbol),
      timeframeMinutes: parseTimeframe(field(body, 'TIMEFRAME')),
      utcOffsetMinutes: parseOffset(field(body, 'TIMEZONE')),
      crosshair: parseChartDate(field(body, 'CROSSHAIR_TIME'), currentYear),
      measure: parseMeasure(field(body, 'MEASURE')),
      lastPrice: (() => {
        const v = field(body, 'LAST_PRICE');
        const m = v?.match(/-?\d[\d,]*(?:\.\d+)?/);
        return m ? num(m[0]) : null;
      })(),
    };
  });
}

export interface ChartWindow {
  fromMs: number;
  toMs: number;
  label: string;
}

/**
 * The day the chart points at, in the chart's own clock (or the user's when
 * the chart prints none). A whole day, not the crosshair's hour: where the
 * cursor rests when the screenshot is taken says little about when the move was.
 */
export function chartWindow(readings: ChartReading[], fallbackZone: Zone, nowMs: number): ChartWindow | null {
  const r = readings.find((x) => x.crosshair);
  if (!r?.crosshair) return null;
  const zone: Zone = r.utcOffsetMinutes ?? fallbackZone;
  const day: LocalDay = { ...localDay(Date.UTC(r.crosshair.y, r.crosshair.m - 1, r.crosshair.d, 12), 0) };
  const { fromMs, toMs } = dayBounds(day, zone);
  if (fromMs > nowMs) return null;
  const tf = r.timeframeMinutes ? `, ${r.timeframeMinutes >= 60 ? `${r.timeframeMinutes / 60}H` : `${r.timeframeMinutes}m`}` : '';
  return { fromMs, toMs: Math.min(toMs, nowMs), label: `${dayLabel(day)} (from your chart${tf}${r.symbol ? `, ${r.symbol}` : ''})` };
}

/**
 * The move the user measured on the chart of THIS symbol: its direction, size
 * and length. A yield chart's percent is a percent of the yield, not of the
 * symbol, so only a chart of the page's own market counts.
 */
export function chartMove(
  readings: ChartReading[],
  pageSymbol: string,
): { direction: 1 | -1; pct: number | null; minutes: number | null; label: string } | null {
  const own = readings.find((r) => r.resolved?.symbol === pageSymbol && r.measure) ?? (readings.length === 1 && !readings[0].resolved ? readings[0] : undefined);
  const m = own?.measure;
  if (!own || !m) return null;
  const sign = m.pct ?? m.change;
  if (sign === null || sign === 0) return null;
  const minutes = m.bars && own.timeframeMinutes ? m.bars * own.timeframeMinutes : null;
  return {
    direction: sign > 0 ? 1 : -1,
    pct: m.pct === null ? null : Math.abs(m.pct),
    minutes,
    label: `${own.symbol ?? 'your chart'} ${m.pct !== null ? `${m.pct > 0 ? '+' : '−'}${Math.abs(m.pct)}%` : ''}${m.bars ? ` over ${m.bars} bars` : ''}`.trim(),
  };
}

/** One line per chart for the dossier: what the user is looking at, as read. */
export function chartFacts(readings: ChartReading[]): string[] {
  return readings.map((r) => {
    const bits = [
      r.symbol ?? 'symbol not legible',
      r.timeframeMinutes ? `${r.timeframeMinutes >= 60 ? `${r.timeframeMinutes / 60}H` : `${r.timeframeMinutes}m`} bars` : null,
      r.crosshair ? `crosshair ${r.crosshair.y}-${String(r.crosshair.m).padStart(2, '0')}-${String(r.crosshair.d).padStart(2, '0')}${r.crosshair.hh !== null ? ` ${String(r.crosshair.hh).padStart(2, '0')}:${String(r.crosshair.mm).padStart(2, '0')}` : ''}` : null,
      r.utcOffsetMinutes !== null ? `chart clock UTC${r.utcOffsetMinutes >= 0 ? '+' : '−'}${Math.abs(r.utcOffsetMinutes) / 60}` : null,
      r.measure
        ? `measured ${[r.measure.change !== null ? String(r.measure.change) : null, r.measure.pct !== null ? `${r.measure.pct}%` : null, r.measure.bars !== null ? `${r.measure.bars} bars` : null].filter(Boolean).join(', ')}`
        : null,
    ].filter(Boolean);
    return `- Chart ${r.index}: ${bits.join(' · ')}`;
  });
}
