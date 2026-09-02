/**
 * WHAT DID THE BOARD ACTUALLY READ? — the run-context diagnostic.
 *
 * Every other script in here answers "what should the board be", against a
 * dated capture. This answers a different and more basic question that kept
 * being assumed: when the board is scored RIGHT NOW, how old is each input?
 *
 * The distinction matters because production-readiness and data freshness are
 * separate properties. A pipeline can be correct, hardened, tested and green,
 * and still be scoring yesterday's calendar because one connector quietly served
 * a cached payload. Nothing in the health table says so on its own: it reports
 * whether a fetch SUCCEEDED, not how old the newest row inside it is.
 *
 * So this prints the DATA HORIZON per source — the newest observation actually
 * present — beside the fetch result. A source can be `ok` and hours stale, and
 * that combination is the one worth being able to see.
 *
 *   npm run freshness
 *   npm run freshness -- EURUSD GOLD     also print those rows cell by cell
 */

import { MATRIX_SLOTS } from '@/config/setups.config';
import { publicationDate } from '@/lib/connectors/cftc';
import { auditBoardConsistency, formatViolations } from '@/lib/scoring/consistency';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import { runSetupsPipeline } from '@/lib/setups-pipeline';

const pad = (s: unknown, n: number) => String(s ?? '-').padEnd(n);
const padS = (s: unknown, n: number) => String(s ?? '-').padStart(n);
const signed = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : n > 0 ? `+${n}` : String(n);

function ageOf(iso: string | null | undefined, from: Date): string {
  if (!iso) return '-';
  const ms = from.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '-';
  const h = ms / 3_600_000;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

async function main() {
  const requested = process.argv.slice(2).map((a) => a.toUpperCase());
  const startedAt = new Date();

  const payload = await runSetupsPipeline(startedAt);
  const matrix = buildSetupsMatrix({
    events: payload.events,
    cot: payload.cot,
    technicals: payload.technicals,
    sovereignYields: payload.sovereignYields,
    yield2y: payload.yield2y,
    now: startedAt,
  });

  // -------------------------------------------------------------------------
  // Run context
  // -------------------------------------------------------------------------
  console.log('='.repeat(100));
  console.log('RUN CONTEXT');
  console.log('='.repeat(100));
  console.log(`  wall clock (UTC)   ${startedAt.toISOString()}`);
  console.log(`  NODE_ENV           ${process.env.NODE_ENV ?? '(unset)'}`);
  console.log(`  USE_FIXTURES       ${process.env.USE_FIXTURES ?? '(unset)'}`);
  console.log(`  scoring mode       LIVE  (no pricesAsOf, no asOf trim)`);
  console.log(`  now                ${startedAt.toISOString()}`);
  console.log(`  pricesAsOf         ${startedAt.toISOString()}  (defaults to now in live mode)`);
  console.log(`  cache              cold — a script is a fresh process, so every fetch below is real`);

  // -------------------------------------------------------------------------
  // Data horizon: the newest observation actually present, per source
  // -------------------------------------------------------------------------
  const released = payload.events.filter((e) => e.actual !== null);
  const newestRelease = released.reduce<string | null>(
    (best, e) => (best === null || e.dateUtc > best ? e.dateUtc : best),
    null,
  );
  const scheduled = payload.events.filter((e) => e.actual === null && e.dateUtc > startedAt.toISOString());
  const nextScheduled = scheduled.reduce<string | null>(
    (best, e) => (best === null || e.dateUtc < best ? e.dateUtc : best),
    null,
  );

  const cotDates = [...payload.cot.values()]
    .map((s) => s.reports[0]?.reportDate)
    .filter((d): d is string => Boolean(d))
    .sort();
  const newestCot = cotDates[cotDates.length - 1] ?? null;

  const barDates = [...payload.technicals.values()]
    .map((t) => (t as { asOf?: string | null }).asOf ?? null)
    .filter((d): d is string => Boolean(d))
    .sort();

  console.log();
  console.log('='.repeat(100));
  console.log('DATA HORIZON — the newest observation actually in the payload');
  console.log('='.repeat(100));
  console.log(`  ${pad('component', 22)}${pad('newest observation', 30)}${pad('age', 9)}notes`);
  console.log('  ' + '-'.repeat(96));
  console.log(
    `  ${pad('calendar (released)', 22)}${pad(newestRelease, 30)}${pad(ageOf(newestRelease, startedAt), 9)}` +
      `${released.length} released of ${payload.events.length} events`,
  );
  console.log(
    `  ${pad('calendar (next due)', 22)}${pad(nextScheduled, 30)}${pad('-', 9)}` +
      `${scheduled.length} scheduled ahead — a live board keeps these`,
  );
  console.log(
    `  ${pad('COT survey date', 22)}${pad(newestCot, 30)}${pad(ageOf(newestCot, startedAt), 9)}` +
      `published ${newestCot ? publicationDate(newestCot) : '-'} (+3d)`,
  );
  console.log(
    `  ${pad('price bars', 22)}${pad(barDates[barDates.length - 1], 30)}` +
      `${pad(ageOf(barDates[barDates.length - 1], startedAt), 9)}${payload.technicals.size} symbols`,
  );
  console.log(
    `  ${pad('2-year yield', 22)}${pad(payload.yield2y?.observedOn, 30)}` +
      `${pad(ageOf(payload.yield2y?.observedOn, startedAt), 9)}` +
      (payload.yield2y ? `current ${payload.yield2y.current}, sma ${payload.yield2y.sma.toFixed(3)}` : 'unavailable'),
  );

  // -------------------------------------------------------------------------
  // Source health, as the pipeline itself reports it
  // -------------------------------------------------------------------------
  console.log();
  console.log('='.repeat(100));
  console.log('SOURCE HEALTH');
  console.log('='.repeat(100));
  for (const h of payload.health) {
    const flag = h.ok ? (h.detail ? 'DEGRADED' : 'ok      ') : 'FAILED  ';
    console.log(`  ${flag} ${pad(h.source, 34)}${pad(h.fetchedAtUtc, 26)}${h.detail ?? h.note ?? ''}`);
  }

  // -------------------------------------------------------------------------
  // Internal consistency: does the board agree with itself?
  //
  // Separate from source health on purpose. Every source can be `ok` and every
  // cell can still be scored against a reference it does not publish.
  // -------------------------------------------------------------------------
  const violations = auditBoardConsistency(matrix);
  console.log();
  console.log('='.repeat(100));
  console.log(`INTERNAL CONSISTENCY — ${violations.length} violation(s)`);
  console.log('='.repeat(100));
  console.log(formatViolations(violations));
  // -------------------------------------------------------------------------
  // The board
  // -------------------------------------------------------------------------
  console.log();
  console.log('='.repeat(100));
  console.log('LIVE BOARD — every scored symbol, strongest first');
  console.log('='.repeat(100));
  const ranked = [...matrix.rows].sort((a, b) => b.totalScore - a.totalScore);
  console.log(`  ${pad('symbol', 10)}${pad('bias', 14)}${padS('score', 6)}`);
  console.log('  ' + '-'.repeat(40));
  for (const row of ranked) {
    console.log(`  ${pad(row.symbol, 10)}${pad(row.bias, 14)}${padS(signed(row.totalScore), 6)}`);
  }

  if (requested.length === 0) return;

  for (const symbol of requested) {
    const row = ranked.find((r) => r.symbol === symbol);
    if (!row) {
      console.log(`\n  ${symbol}: not a scored symbol here`);
      continue;
    }
    console.log();
    console.log('='.repeat(100));
    console.log(`${symbol} — ours ${signed(row.totalScore)} (${row.bias})`);
    console.log('='.repeat(100));
    console.log(`  ${pad('slot', 22)}${padS('cell', 6)}  ${pad('status', 10)}${pad('as of', 22)}why`);
    console.log('  ' + '-'.repeat(96));
    for (const slot of MATRIX_SLOTS) {
      const cell = row.cells[slot.key];
      if (!cell) continue;
      const dates = (cell.legs ?? []).map((l) => l.dateUtc).filter(Boolean) as string[];
      const asOf = dates.sort()[dates.length - 1]?.slice(0, 10) ?? '';
      console.log(
        `  ${pad(slot.label, 22)}${padS(signed(cell.cell), 6)}  ${pad(cell.status, 10)}${pad(asOf, 22)}` +
          cell.explanation.slice(0, 90),
      );
    }
  }
}

main();
