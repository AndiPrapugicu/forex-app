/**
 * 24 -> 25 CROSS-DAY VALIDATION.
 *
 *   npm run cross-day
 *
 * A single day's gap cannot tell a systematic defect from live-data noise — the
 * board itself moved 29 points across 22 symbols between two frames of the SAME
 * day in an earlier capture. Two independent days can: a gap that survives with
 * the same sign and roughly the same size on both is a rule, not a moment.
 *
 * For every symbol A1 published a total for on BOTH 2026-08-24 and 2026-08-25,
 * this rewinds the engine to the close of each day and reports both boards side
 * by side, classified:
 *
 *   PERSISTENT     same sign, both days, |gap| >= 2 on each — a shared cause.
 *   TIMING         sign flips, or the gap moves by more than the input plausibly
 *                  could on its own — the live board itself moved a lot too.
 *   NOISE          |gap| <= 1 on both days — inside the documented drift floor.
 *
 * Deliberately does NOT rank by TOTAL ABS GAP. A persistent -1 on eight symbols
 * is invisible to that number and is exactly the pattern a real rule would leave.
 */

import top24 from '@/fixtures/a1-top-setups-2026-08-24.json';
import top25 from '@/fixtures/a1-top-setups-2026-08-25.json';
import { asOf } from '@/lib/scoring/backtest';
import { NAME_MAP, NOT_MODELED } from '@/lib/scoring/a1-symbol-map';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import { runSetupsPipeline } from '@/lib/setups-pipeline';

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padStart = (s: string | number, n: number) => String(s).padStart(n);

function mergeTotals(captures: { totals: Record<string, unknown> }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of captures) Object.assign(out, c.totals);
  return out;
}

async function boardAt(dateIso: string): Promise<Map<string, number>> {
  const at = new Date(dateIso);
  /**
   * One run per date, with the price series cut at that date. This script's
   * whole purpose is to separate a persistent disagreement from a timing one,
   * and until 2026-08-30 both boards it compares carried TODAY's trend cell —
   * so a real day-to-day move in the technicals could not show up here at all.
   */
  const payload = await runSetupsPipeline(new Date(), { pricesAsOf: at });
  const trimmed = asOf({ events: payload.events, cot: payload.cot, bars: new Map(), seasonality: new Map() }, at);
  const matrix = buildSetupsMatrix({
    events: trimmed.events,
    cot: trimmed.cot,
    technicals: payload.technicals,
    sovereignYields: payload.sovereignYields,
    yield2y: payload.yield2y,
    retailPositioning: payload.retailPositioning,
    now: at,
  });
  return new Map(matrix.rows.map((r) => [r.symbol, r.totalScore]));
}

async function main() {
  const a1_24 = mergeTotals(top24.captures);
  const a1_25 = mergeTotals(top25.captures);

  const ours24 = await boardAt('2026-08-24T23:59:59.000Z');
  const ours25 = await boardAt('2026-08-25T23:59:59.000Z');

  const shared = Object.keys(a1_24).filter((name) => name in a1_25 && !NOT_MODELED.has(name));

  console.log('='.repeat(112));
  console.log('CROSS-DAY VALIDATION -- symbols A1 published on BOTH 2026-08-24 and 2026-08-25');
  console.log('='.repeat(112));
  console.log(
    pad('symbol', 12) + padStart('A1 24', 7) + padStart('A1 25', 7) + padStart('A1 d', 6) +
      '  |' + padStart('our24', 7) + padStart('our25', 7) + '  |' +
      padStart('gap24', 7) + padStart('gap25', 7) + '  ' + 'class',
  );

  const rows: { name: string; sym: string; a24: number; a25: number; o24: number | null; o25: number | null; g24: number | null; g25: number | null; cls: string }[] = [];

  for (const name of shared) {
    const sym = NAME_MAP[name] ?? name;
    const o24 = ours24.get(sym) ?? null;
    const o25 = ours25.get(sym) ?? null;
    const a24 = a1_24[name];
    const a25 = a1_25[name];
    const g24 = o24 === null ? null : o24 - a24;
    const g25 = o25 === null ? null : o25 - a25;

    let cls = 'INSUFFICIENT';
    if (g24 !== null && g25 !== null) {
      const sameSign = Math.sign(g24) === Math.sign(g25) && g24 !== 0;
      const bothSmall = Math.abs(g24) <= 1 && Math.abs(g25) <= 1;
      if (bothSmall) cls = 'NOISE';
      else if (sameSign && Math.abs(g24) >= 2 && Math.abs(g25) >= 2) cls = 'PERSISTENT';
      else cls = 'TIMING';
    }
    rows.push({ name, sym, a24, a25, o24, o25, g24, g25, cls });
  }

  rows.sort((a, b) => (b.g24 !== null && b.g25 !== null ? Math.abs(b.g24) + Math.abs(b.g25) : 0) -
    (a.g24 !== null && a.g25 !== null ? Math.abs(a.g24) + Math.abs(a.g25) : 0));

  for (const r of rows) {
    console.log(
      pad(`${r.name}(${r.sym})`, 12) + padStart(signed(r.a24), 7) + padStart(signed(r.a25), 7) +
        padStart(signed(r.a25 - r.a24), 6) + '  |' +
        padStart(r.o24 === null ? '-' : signed(r.o24), 7) + padStart(r.o25 === null ? '-' : signed(r.o25), 7) + '  |' +
        padStart(r.g24 === null ? '-' : signed(r.g24), 7) + padStart(r.g25 === null ? '-' : signed(r.g25), 7) +
        '  ' + r.cls,
    );
  }

  console.log(`\n${'-'.repeat(112)}\nSUMMARY`);
  for (const cls of ['PERSISTENT', 'TIMING', 'NOISE', 'INSUFFICIENT']) {
    const names = rows.filter((r) => r.cls === cls).map((r) => r.name);
    console.log(`  ${pad(cls, 14)}${names.length}   ${names.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
