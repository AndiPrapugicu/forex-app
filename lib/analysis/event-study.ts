/**
 * "What does gold / the Nasdaq do on CPI?" — answered from the record.
 *
 * The last few releases of one series from the calendar we already hold
 * (FXStreet, ~150 days back), each with its actual and forecast, against the
 * symbol's hourly bars: where price was just before the release, and an hour
 * and four hours after. Split by whether the print came in above or below the
 * forecast. A handful of releases is a tendency, not a rule, and the text says
 * so. Pure; the loader is at the bottom.
 */

import { INTRADAY_TICKER, type EventAlias } from '@/config/reaction.config';
import type { SymbolDefinition } from '@/config/symbols.config';
import { fetchIntraday, type IntradaySeries } from '@/lib/connectors/intraday';
import type { NormalizedEvent } from '@/lib/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Releases studied. */
const STUDY_LAST = 8;
/** A bar further than this from the moment it stands for is not a reading of it. */
const BAR_SLACK = 3 * HOUR;

export interface StudyRow {
  dateUtc: string;
  actual: number;
  consensus: number;
  /** 1 above the forecast, −1 below, 0 in line. */
  surprise: 1 | -1 | 0;
  move1h: number | null;
  move4h: number | null;
}

export interface EventStudy {
  label: string;
  currency: string;
  seriesName: string;
  symbol: string;
  ticker: string;
  rows: StudyRow[];
  next: { dateUtc: string; consensus: number | null; previous: number | null } | null;
}

/** The series to study: the first calendar name, in the alias's order, with at least three scored releases. */
export function pickSeries(events: NormalizedEvent[], alias: EventAlias, currency: string): { name: string; list: NormalizedEvent[] } | null {
  let best: { name: string; list: NormalizedEvent[] } | null = null;
  for (const pattern of alias.names) {
    const matching = events.filter((e) => e.currency === currency && pattern.test(e.name));
    if (matching.length === 0) continue;
    // One series per pattern: the most frequent exact name, so "CPI (MoM)" does not mix with "CPI (YoY)".
    const counts = new Map<string, number>();
    for (const e of matching) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
    const name = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const list = matching.filter((e) => e.name === name);
    const scored = list.filter((e) => e.actual !== null && e.consensus !== null).length;
    if (scored >= 3) return { name, list };
    if (!best || list.length > best.list.length) best = { name, list };
  }
  return best;
}

/** The close of the last hourly bar that ENDED at or before `ms` (a bar is stamped at its open). */
function closeBefore(s: IntradaySeries, ms: number, barMs: number): number | null {
  for (let k = s.t.length - 1; k >= 0; k--) {
    const end = s.t[k] + barMs;
    if (end <= ms) return ms - end <= BAR_SLACK ? s.c[k] : null;
  }
  return null;
}

/** The close of the first hourly bar that ended at or after `ms`. */
function closeAfter(s: IntradaySeries, ms: number, barMs: number): number | null {
  for (let k = 0; k < s.t.length; k++) {
    const end = s.t[k] + barMs;
    if (end >= ms) return end - ms <= BAR_SLACK ? s.c[k] : null;
  }
  return null;
}

export function studyEvent(list: NormalizedEvent[], bars: IntradaySeries, nowMs: number, barMs = HOUR): StudyRow[] {
  return list
    .filter((e) => e.actual !== null && e.consensus !== null && Date.parse(e.dateUtc) < nowMs - 4 * HOUR)
    .sort((a, b) => b.dateUtc.localeCompare(a.dateUtc))
    .slice(0, STUDY_LAST)
    .map((e) => {
      const t = Date.parse(e.dateUtc);
      const before = closeBefore(bars, t, barMs);
      const pct = (after: number | null) => (before === null || after === null || before === 0 ? null : ((after - before) / before) * 100);
      const diff = e.actual! - e.consensus!;
      return {
        dateUtc: e.dateUtc,
        actual: e.actual!,
        consensus: e.consensus!,
        surprise: (Math.abs(diff) < 1e-9 ? 0 : diff > 0 ? 1 : -1) as 1 | -1 | 0,
        move1h: pct(closeAfter(bars, t + HOUR, barMs)),
        move4h: pct(closeAfter(bars, t + 4 * HOUR, barMs)),
      };
    });
}

const fmt = (v: number | null) => (v === null ? 'n/a' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);

function average(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function eventStudyLines(st: EventStudy): string[] {
  const out = [
    `## E. HOW ${st.symbol} MOVED ON ${st.currency} ${st.seriesName} (deterministic; hourly bars of ${st.ticker}; restate it, do not re-derive it)`,
    'From the last close before each release to the close about 1h and 4h after. Above/below = the actual against the forecast.',
  ];
  if (st.rows.length === 0) {
    out.push('No scored releases of this series in the calendar window (about 150 days), or no hourly bars: say so; do not estimate a typical reaction.');
  } else {
    for (const r of st.rows) {
      out.push(
        `- ${r.dateUtc.slice(0, 16).replace('T', ' ')}Z: actual ${r.actual} vs forecast ${r.consensus} (${r.surprise > 0 ? 'ABOVE' : r.surprise < 0 ? 'BELOW' : 'IN LINE'}) → 1h ${fmt(r.move1h)}, 4h ${fmt(r.move4h)}`,
      );
    }
    const group = (sign: 1 | -1 | 0, name: string) => {
      const g = st.rows.filter((r) => r.surprise === sign);
      return g.length ? `${name} (n=${g.length}): average 1h ${fmt(average(g.map((r) => r.move1h)))}, 4h ${fmt(average(g.map((r) => r.move4h)))}` : null;
    };
    out.push([group(1, 'Above forecast'), group(-1, 'Below forecast'), group(0, 'In line')].filter(Boolean).join('. ') + '.');
    out.push(
      `Sample: ${st.rows.length} release${st.rows.length === 1 ? '' : 's'} — ${st.rows.length < 6 ? 'too few to call a pattern; say "tendency" at most' : 'a tendency, not a rule'}.`,
    );
  }
  if (st.next) {
    out.push(
      `Next release: ${st.next.dateUtc.slice(0, 16).replace('T', ' ')}Z, forecast ${st.next.consensus ?? 'not yet published'}${st.next.previous !== null ? `, previous ${st.next.previous}` : ''}.`,
    );
  } else {
    out.push('Next release: not in the calendar window.');
  }
  return out;
}

/** Loads the hourly bars and studies the asked-about series; null when nothing matches. */
export async function loadEventStudy(
  def: SymbolDefinition,
  event: EventAlias & { currency: string },
  events: NormalizedEvent[],
  now = new Date(),
): Promise<EventStudy | null> {
  const picked = pickSeries(events, event, event.currency);
  if (!picked) return null;
  const ticker = INTRADAY_TICKER[def.symbol] ?? def.yahoo;
  const bars = (await fetchIntraday([ticker], { range: '1y', interval: '60m', cacheTtlSeconds: 3600 }).catch(() => new Map<string, IntradaySeries>())).get(ticker);
  const nowIso = now.toISOString();
  const next = picked.list.filter((e) => e.dateUtc > nowIso && e.actual === null).sort((a, b) => a.dateUtc.localeCompare(b.dateUtc))[0];
  return {
    label: event.label,
    currency: event.currency,
    seriesName: picked.name,
    symbol: def.symbol,
    ticker,
    rows: bars ? studyEvent(picked.list, bars, now.getTime()) : [],
    next: next ? { dateUtc: next.dateUtc, consensus: next.consensus, previous: next.previous } : null,
  };
}
