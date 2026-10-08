/**
 * Evaluates the user's open positions against their thesis. All I/O lives here;
 * the judgement is `evaluateThesis` (thesis.ts), which is pure.
 *
 * Used by the /narrative page, the /ai panel and dossier, and the ingest run
 * that sends the Telegram alerts — one implementation, so the page and the
 * alert can never disagree about why a position is RED.
 */

import { findSymbol } from '@/config/symbols.config';
import { fetchDailyBars, type DailyBars } from '@/lib/connectors/technicals';
import { getStore, PositionsTableMissing } from '@/lib/db/client';
import type { SetupsPayload } from '@/lib/setups-pipeline';
import type { Currency, Position, ScoreSnapshot } from '@/lib/types';
import { buildLevels, toBarList } from '@/lib/analysis/levels';
import { pairFromBundle, type NarrativeBundle } from '@/lib/analysis/narrative-load';
import { valueAt } from '@/lib/analysis/series';
import type { PairNarrative } from '@/lib/analysis/state';
import { evaluateThesis, firedConditions, rememberFired, type FiredFlip, type FlipData, type ThesisReport } from '@/lib/analysis/thesis';

const DAY_MS = 86_400_000;
/** A board capture further than this from the entry date is no basis for "at entry". */
const ENTRY_SNAPSHOT_MAX_DAYS = 3;
const HISTORY_DAYS = 45;

export interface PositionView {
  position: Position;
  report: ThesisReport | null;
  /** Why there is no report. */
  gap: string | null;
}

export interface PositionsResult {
  views: PositionView[];
  /** Set when the positions could not be read at all (missing table, store down). */
  error: string | null;
  /** False on the memory store: positions vanish with the process. */
  durable: boolean;
}

/** Latest closes for every key a flip condition can name. */
export function flipDataFrom(bundle: NarrativeBundle, symbolCloses: Record<string, number | null>, at: Date): FlipData {
  return {
    events: bundle.inputs.events,
    close(key) {
      if (key in symbolCloses) return symbolCloses[key];
      const contract = bundle.inputs.fed.contracts.find((c) => c.ticker === key);
      return valueAt(contract ? contract.closes : bundle.inputs.series[key], at);
    },
    yield2y(currency: Currency) {
      return valueAt(bundle.inputs.twoYearHistory[currency], at);
    },
  };
}

/** The capture nearest midday of the entry date, if one is close enough to mean "at entry". */
export function entrySnapshot(history: ScoreSnapshot[], entryDate: string): ScoreSnapshot | null {
  const target = Date.parse(`${entryDate}T12:00:00Z`);
  let best: ScoreSnapshot | null = null;
  let bestGap = Infinity;
  for (const s of history) {
    const gap = Math.abs(Date.parse(s.capturedAtUtc) - target);
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best && bestGap <= ENTRY_SNAPSHOT_MAX_DAYS * DAY_MS ? best : null;
}

/** Positions from the store, with a sentence instead of an exception. */
export async function readOpenPositions(): Promise<{ positions: Position[]; error: string | null; durable: boolean }> {
  const store = getStore();
  try {
    return { positions: await store.listPositions({ open: true }), error: null, durable: store.durable };
  } catch (err) {
    const error = err instanceof PositionsTableMissing ? err.message : `Positions could not be read: ${err instanceof Error ? err.message : String(err)}`;
    return { positions: [], error, durable: store.durable };
  }
}

export interface EvaluateContext {
  now: Date;
  payload: SetupsPayload;
  bundle: NarrativeBundle | null;
  /** Fired flips to remember on top of the bundle's snapshot (the ingest's fresh hits). */
  fired?: FiredFlip[];
}

/**
 * Fresh hits: conditions stored in the latest snapshot for this symbol that the
 * data now meets. Stamped `now`; the ingest run persists them, a page render
 * only shows them.
 */
export function freshFired(bundle: NarrativeBundle | null, symbol: string, data: FlipData | null, now: Date): FiredFlip[] {
  if (!bundle?.latest || !data) return [];
  return firedConditions(bundle.latest.flips[symbol] ?? [], data).map(({ condition, value }) => ({
    id: condition.id,
    symbol,
    text: condition.text,
    favours: condition.favours,
    firedAtUtc: now.toISOString(),
    value,
  }));
}

export async function evaluatePositions(positions: Position[], ctx: EvaluateContext): Promise<{ views: PositionView[]; pairs: Map<string, PairNarrative>; fired: FiredFlip[] }> {
  const { now, payload, bundle } = ctx;
  const store = getStore();
  const symbols = [...new Set(positions.map((p) => p.symbol))];
  const earliestEntry = positions.reduce((min, p) => (p.entryDate < min ? p.entryDate : min), now.toISOString().slice(0, 10));
  const since = new Date(Math.min(Date.parse(`${earliestEntry}T00:00:00Z`) - ENTRY_SNAPSHOT_MAX_DAYS * DAY_MS, now.getTime() - HISTORY_DAYS * DAY_MS)).toISOString();

  const perSymbol = await Promise.all(
    symbols.map(async (symbol) => {
      const def = findSymbol(symbol);
      if (!def) return { symbol, def: null, bars: null, history: [] as ScoreSnapshot[] };
      const [bars, history] = await Promise.all([
        fetchDailyBars(def.yahoo).catch((): DailyBars | null => null),
        store.getSnapshots(symbol, since).catch((): ScoreSnapshot[] => []),
      ]);
      return { symbol, def, bars, history };
    }),
  );

  const pairs = new Map<string, PairNarrative>();
  const allFired: FiredFlip[] = [...(ctx.fired ?? [])];
  const bySymbol = new Map<string, { report: ((p: Position) => ThesisReport) | null; gap: string | null }>();

  for (const s of perSymbol) {
    if (!s.def) {
      bySymbol.set(s.symbol, { report: null, gap: `${s.symbol} is not a symbol this app scores` });
      continue;
    }
    const def = s.def;
    const row = payload.matrix.rows.find((r) => r.symbol === def.symbol) ?? null;
    const price = payload.technicals.get(def.symbol)?.price ?? row?.price ?? null;
    const bars = s.bars ? toBarList(s.bars) : [];
    const levels = buildLevels(s.bars, price, now);
    const pair = bundle ? pairFromBundle(bundle, def, levels) : null;
    if (pair) pairs.set(def.symbol, pair);

    const lastClose = bars.length ? bars[bars.length - 1].c : null;
    const data = bundle ? flipDataFrom(bundle, { [def.yahoo]: price ?? lastClose }, now) : null;
    const fired = rememberFired([...(bundle?.latest?.fired ?? []), ...allFired].filter((f) => f.symbol === def.symbol), freshFired(bundle, def.symbol, data, now), now);
    for (const f of fired) if (!allFired.some((a) => a.symbol === f.symbol && a.id === f.id)) allFired.push(f);

    const history = s.history.map((h) => ({ atUtc: h.capturedAtUtc, score: h.totalScore }));
    bySymbol.set(def.symbol, {
      gap: bars.length === 0 ? `no daily bars for ${def.symbol}, so structure and ATR could not be read` : null,
      report: (p) =>
        evaluateThesis({
          position: p,
          bars,
          price,
          boardScore: row?.totalScore ?? null,
          entryScore: entrySnapshot(s.history, p.entryDate)?.totalScore ?? null,
          boardHistory: history,
          narrative: pair,
          fired,
          now,
        }),
    });
  }

  const views = positions.map((p): PositionView => {
    const e = bySymbol.get(p.symbol);
    return { position: p, report: e?.report ? e.report(p) : null, gap: e?.gap ?? null };
  });
  return { views, pairs, fired: allFired };
}

/** Everything a page needs: read, evaluate, never throw. */
export async function loadPositions(now: Date, payload: SetupsPayload, bundle: NarrativeBundle | null): Promise<PositionsResult> {
  const read = await readOpenPositions();
  if (read.error || read.positions.length === 0) return { views: [], error: read.error, durable: read.durable };
  try {
    const { views } = await evaluatePositions(read.positions, { now, payload, bundle });
    return { views, error: null, durable: read.durable };
  } catch (err) {
    console.error('[positions] thesis evaluation failed', err);
    return { views: read.positions.map((position) => ({ position, report: null, gap: 'thesis check failed on this run' })), error: null, durable: read.durable };
  }
}

// ---------------------------------------------------------------------------
// Text, for the dossier and Telegram
// ---------------------------------------------------------------------------

const px = (v: number | null) => (v === null ? 'n/a' : Number(v.toPrecision(6)).toString());
const r = (v: number | null) => (v === null ? 'n/a' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}R`);
const signedScore = (v: number | null) => (v === null ? 'n/a' : v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');

export function positionLines(view: PositionView): string[] {
  const p = view.position;
  const rep = view.report;
  const out = [
    `### Open position on ${p.symbol} (the user's own — check the thesis point by point)`,
    `- ${p.side.toUpperCase()} from ${px(p.entryPrice)} on ${p.entryDate}; stop ${px(p.stopLoss)}, target ${px(p.takeProfit)}${rep?.rTarget != null ? ` (${r(rep.rTarget)})` : ''}` +
      `${p.size ? `; size ${p.size}` : ''}${p.riskPct !== null ? `; risk ${p.riskPct}%` : ''}.`,
  ];
  if (rep) {
    out.push(
      `- Now ${px(rep.price)} (${r(rep.rNow)}). Board ${signedScore(rep.boardScore)}${rep.entryScore !== null ? ` (at entry ${signedScore(rep.entryScore)})` : ' (no capture near entry)'}` +
        `${rep.daysOnSide !== null ? `; ${rep.daysOnSide} days in band` : ''}.`,
      `- Structure: ${rep.structure ? `last ${rep.structure.kind} ${px(rep.structure.price)} (${rep.structure.date})` : 'no swing found'}` +
        `${rep.lastClose ? `; last daily close ${px(rep.lastClose.price)} (${rep.lastClose.date})` : ''}${rep.atr !== null ? `; ATR(14) ${px(rep.atr)}` : ''}.`,
      `- THESIS STATUS: ${rep.status.toUpperCase()}${rep.signals.length ? '' : ' — no signal against it.'}`,
      ...rep.signals.map((s) => `  - ${s.level.toUpperCase()}: ${s.text}`),
    );
  }
  if (view.gap) out.push(`- Gap: ${view.gap}.`);
  out.push(p.thesis ? `- The user's thesis, in their words: "${p.thesis.replace(/\s+/g, ' ')}"` : '- The user wrote no thesis for this trade.');
  return out;
}
