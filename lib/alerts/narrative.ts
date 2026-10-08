/**
 * The narrative engine's Telegram alerts. Pure: the ingest run gathers the
 * inputs, this decides what to say, and the existing hasAlert → sendAlerts →
 * recordAlert path delivers and dedupes.
 *
 *   narrative-flip    (high, immediately)  a stored flip condition fired against
 *                                          an open position;
 *   thesis-red        (high, immediately)  a position turned RED since the last run;
 *   narrative-digest  (medium, once a day) at the first run at or after 06:00 UTC:
 *                                          verdict changes since yesterday, the
 *                                          positions' status, and today's flip events.
 *
 * All three name the user's private positions, so `isCurrentAlert` keeps them
 * out of the public feed.
 */

import { DIGEST_HOUR_UTC } from '@/config/narrative.config';
import { findSymbol } from '@/config/symbols.config';
import { stableId } from '@/lib/connectors/base';
import type { Alert, Asset, Currency } from '@/lib/types';
import type { PositionView } from '@/lib/analysis/positions-load';
import type { StoredVerdict } from '@/lib/analysis/snapshot';
import type { FlipCondition, Side } from '@/lib/analysis/state';
import type { FiredFlip } from '@/lib/analysis/thesis';

const DAY_MS = 86_400_000;
const DIGEST_FLIPS_MAX = 8;
const DIGEST_CHANGES_MAX = 12;

const px = (v: number | null) => (v === null ? 'n/a' : Number(v.toPrecision(6)).toString());
const sideOf = (s: 'long' | 'short'): Side => (s === 'long' ? 'bullish' : 'bearish');

function affectsOf(symbol: string): (Currency | Asset)[] {
  const def = findSymbol(symbol);
  if (!def) return [];
  if (def.base || def.quote) return [def.base, def.quote].filter((c): c is Currency => !!c);
  return def.asset ? [def.asset] : [];
}

function alert(kind: Alert['kind'], severity: Alert['severity'], hashParts: string[], title: string, body: string, affects: (Currency | Asset)[], now: Date): Alert {
  const hash = stableId('alert', kind, ...hashParts);
  return { id: hash, hash, kind, severity, title, body, affects, sources: [], createdUtc: now.toISOString(), highConfidence: true, eventId: null };
}

/** A fired condition against at least one open position on its symbol. */
export function flipAlerts(fresh: FiredFlip[], views: PositionView[], now: Date): Alert[] {
  const out: Alert[] = [];
  for (const f of fresh) {
    const against = views.filter((v) => v.position.symbol === f.symbol && sideOf(v.position.side) !== f.favours);
    if (against.length === 0) continue;
    const trades = against.map((v) => `your ${v.position.side.toUpperCase()} from ${px(v.position.entryPrice)} (${v.position.entryDate})`).join('; ');
    out.push(
      alert(
        'narrative-flip',
        'high',
        [f.symbol, f.id, f.firedAtUtc.slice(0, 10)],
        `${f.symbol}: flip condition hit`,
        `${f.text}. Reading ${px(f.value)}. It favours ${f.favours}, against ${trades}.`,
        affectsOf(f.symbol),
        now,
      ),
    );
  }
  return out;
}

/** Positions whose status turned RED since the last run (`lastStatus` is the last run's). */
export function redAlerts(views: PositionView[], now: Date): Alert[] {
  const day = now.toISOString().slice(0, 10);
  return views
    .filter((v) => v.report?.status === 'red' && v.position.lastStatus !== 'red')
    .map((v) => {
      const p = v.position;
      const reasons = v.report!.signals.filter((s) => s.level === 'red').map((s) => `• ${s.text}`);
      return alert(
        'thesis-red',
        'high',
        [p.id, day],
        `${p.symbol} ${p.side.toUpperCase()}: thesis RED`,
        [`Entry ${px(p.entryPrice)} on ${p.entryDate}, now ${px(v.report!.price)}${v.report!.rNow !== null ? ` (${v.report!.rNow >= 0 ? '+' : '−'}${Math.abs(v.report!.rNow).toFixed(2)}R)` : ''}.`, ...reasons].join('\n'),
        affectsOf(p.symbol),
        now,
      );
    });
}

export interface DigestInput {
  now: Date;
  /** This run's verdicts, and yesterday's (the last snapshot of the previous UTC day). */
  verdicts: Record<string, StoredVerdict>;
  yesterday: Record<string, StoredVerdict> | null;
  /** Symbols whose verdict changes are worth a line: the currency indexes, the asset rows, the positions. */
  watch: string[];
  views: PositionView[];
  /** Flip conditions per symbol from this run, for "today's events". */
  flips: Record<string, FlipCondition[]>;
  /** Fired conditions in the last day, for the "confirmed" lines. */
  fired: FiredFlip[];
  digestSentFor: string | null | undefined;
}

/** True at the first run at or after 06:00 UTC that has not yet sent today's digest. */
export function digestDue(now: Date, digestSentFor: string | null | undefined): boolean {
  return now.getUTCHours() >= DIGEST_HOUR_UTC && digestSentFor !== now.toISOString().slice(0, 10);
}

export function digestAlert(x: DigestInput): Alert | null {
  if (!digestDue(x.now, x.digestSentFor)) return null;
  const today = x.now.toISOString().slice(0, 10);
  const sections: string[] = [];

  if (x.yesterday) {
    const changes: string[] = [];
    for (const symbol of x.watch) {
      const was = x.yesterday[symbol];
      const is = x.verdicts[symbol];
      if (!was || !is) continue;
      if (was.tactical !== is.tactical) changes.push(`• ${symbol} tactical ${was.tactical} → ${is.tactical}`);
      if (was.structural !== is.structural) changes.push(`• ${symbol} structural ${was.structural} → ${is.structural}`);
    }
    if (changes.length) sections.push(['Verdict changes since yesterday:', ...changes.slice(0, DIGEST_CHANGES_MAX), ...(changes.length > DIGEST_CHANGES_MAX ? [`• …and ${changes.length - DIGEST_CHANGES_MAX} more`] : [])].join('\n'));
  }

  if (x.views.length) {
    const lines = x.views.map((v) => {
      const p = v.position;
      const status = v.report?.status.toUpperCase() ?? 'UNCHECKED';
      const first = v.report?.signals[0]?.text ?? v.gap ?? 'no signal against it';
      return `• ${p.symbol} ${p.side.toUpperCase()} — ${status}: ${first}`;
    });
    sections.push(['Your positions:', ...lines].join('\n'));

    const since = new Date(x.now.getTime() - DAY_MS).toISOString();
    const confirmed = x.fired.filter((f) => f.firedAtUtc >= since && x.views.some((v) => v.position.symbol === f.symbol && sideOf(v.position.side) === f.favours));
    if (confirmed.length) sections.push(['Confirmed in your favour:', ...confirmed.map((f) => `• ${f.symbol}: ${f.text}`)].join('\n'));
  }

  const horizon = new Date(x.now.getTime() + DAY_MS).toISOString();
  const nowIso = x.now.toISOString();
  const seen = new Set<string>();
  const events: string[] = [];
  const positionSymbols = new Set(x.views.map((v) => v.position.symbol));
  for (const symbol of positionSymbols.size ? positionSymbols : new Set(x.watch)) {
    for (const f of x.flips[symbol] ?? []) {
      if (!f.dueUtc || f.dueUtc <= nowIso || f.dueUtc > horizon || seen.has(f.text)) continue;
      seen.add(f.text);
      events.push(`• ${positionSymbols.size ? `${symbol} ${f.role}: ` : ''}${f.text}`);
    }
  }
  if (events.length) sections.push(['Due in the next 24h:', ...events.slice(0, DIGEST_FLIPS_MAX)].join('\n'));

  if (sections.length === 0) return null;
  const affects = [...new Set([...positionSymbols].flatMap(affectsOf))];
  return alert('narrative-digest', 'medium', [today], `Market narrative — ${today}`, sections.join('\n\n'), affects, x.now);
}
