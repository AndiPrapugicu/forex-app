/**
 * A compact read of a market the question names besides the page's own —
 * gold on the NAS100 page, or both sides of "EURUSD vs GBPUSD". Not a second
 * dossier: the board row (from the run already in flight), the price and its
 * 1-day and 1-week change, and the four nearest levels.
 */

import { findSymbol, type SymbolDefinition } from '@/config/symbols.config';
import { buildLevels, type LevelSet } from '@/lib/analysis/levels';
import { fetchDailyBars, type DailyBars } from '@/lib/connectors/technicals';
import type { SymbolRow } from '@/lib/scoring/setups';
import type { SetupsPayload } from '@/lib/setups-pipeline';

/** At most this many other markets per question. */
export const OTHER_MARKETS_MAX = 2;

export interface OtherMarket {
  def: SymbolDefinition;
  row: SymbolRow | null;
  price: number | null;
  change1dPct: number | null;
  change1wPct: number | null;
  levels: LevelSet | null;
}

function changes(bars: DailyBars | null): { price: number | null; d1: number | null; w1: number | null } {
  const closes = (bars?.closes ?? []).filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  const last = closes.at(-1) ?? null;
  const back = (n: number) => (closes.length > n ? closes[closes.length - 1 - n] : null);
  const pct = (from: number | null) => (from === null || last === null || from === 0 ? null : ((last - from) / from) * 100);
  return { price: last, d1: pct(back(1)), w1: pct(back(5)) };
}

export async function loadOtherMarkets(symbols: string[], board: Promise<SetupsPayload>, now = new Date()): Promise<OtherMarket[]> {
  const defs = symbols.map((s) => findSymbol(s)).filter((d): d is SymbolDefinition => !!d).slice(0, OTHER_MARKETS_MAX);
  if (defs.length === 0) return [];
  const [payload, bars] = await Promise.all([board.catch(() => null), Promise.all(defs.map((d) => fetchDailyBars(d.yahoo).catch(() => null)))]);
  return defs.map((def, k) => {
    const row = payload?.matrix.rows.find((r) => r.symbol === def.symbol) ?? null;
    const { price, d1, w1 } = changes(bars[k]);
    const ref = payload?.technicals.get(def.symbol)?.price ?? row?.price ?? price;
    return { def, row, price: ref ?? price, change1dPct: d1, change1wPct: w1, levels: buildLevels(bars[k], ref ?? null, now) };
  });
}

const signed = (v: number | null, digits = 2, unit = '%') => (v === null ? 'n/a' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}${unit}`);
const price = (v: number) => Number(v.toPrecision(6)).toString();

export function otherMarketLines(list: OtherMarket[]): string[] {
  if (list.length === 0) return [];
  const out = ['## O. OTHER MARKETS THE USER NAMED (compact; the full dossier below is for the page symbol only)'];
  for (const m of list) {
    const r = m.row;
    const top = r
      ? Object.entries(r.cells)
          .filter(([, c]) => c && typeof c.cell === 'number' && c.cell !== 0)
          .sort((a, b) => Math.abs(b[1].cell as number) - Math.abs(a[1].cell as number))
          .slice(0, 4)
          .map(([k, c]) => `${k} ${signed(c.cell as number, 0, '')}`)
          .join(', ')
      : '';
    out.push(
      `- ${m.def.symbol} (${m.def.label}): board ${r ? `${signed(r.totalScore, 0, '')} → ${r.bias}${top ? ` (largest cells: ${top})` : ''}` : 'no row on this run'}; ` +
        `price ${m.price === null ? 'n/a' : price(m.price)}, 1 day ${signed(m.change1dPct)}, 1 week ${signed(m.change1wPct)}.`,
    );
    const near = (m.levels?.levels ?? []).slice().sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct)).slice(0, 4);
    if (near.length) out.push(`  Nearest levels: ${near.map((l) => `${price(l.price)} ${l.label} (${signed(l.distancePct)})`).join('; ')}.`);
  }
  return out;
}
