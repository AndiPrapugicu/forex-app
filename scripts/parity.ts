/**
 * Scores the whole board against A1's published numbers, in one command.
 *
 * This exists because three consecutive scoring changes made parity WORSE while
 * each looked defensible on its own. Every one was judged by opening the page
 * and reading a few rows, which is how a change that fixes two symbols and
 * breaks five gets kept. The rule this enforces is simple: run it before a
 * change, run it after, keep the change only if the numbers improved.
 *
 *   npm run parity
 *
 * Reads `fixtures/a1-board.json` — evidence transcribed from their screen, not
 * configuration. Nothing in the app reads it.
 *
 * Live network, deliberately. The point is to measure what the page actually
 * renders, so this runs the same `runSetupsPipeline` the page runs rather than a
 * fixture of our own output, which could only ever agree with itself.
 */

import board from '@/fixtures/a1-board.json';
import { SCORING_SLOTS } from '@/config/setups.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { asOf } from '@/lib/scoring/backtest';
import { buildSetupsMatrix, type SymbolRow } from '@/lib/scoring/setups';

const totals = board.totals as Record<string, number>;
const cells = board.cells as Record<string, Record<string, number>>;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padStart = (s: string | number, n: number) => String(s).padStart(n);

function summarise(rows: SymbolRow[]) {
  const compared = Object.keys(totals)
    .map((symbol) => {
      const row = rows.find((r) => r.symbol === symbol);
      if (!row) return null;
      return { symbol, ours: row.totalScore, a1: totals[symbol], gap: row.totalScore - totals[symbol] };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const exact = compared.filter((c) => c.gap === 0).length;
  const within1 = compared.filter((c) => Math.abs(c.gap) <= 1).length;
  const within2 = compared.filter((c) => Math.abs(c.gap) <= 2).length;
  const totalAbsGap = compared.reduce((t, c) => t + Math.abs(c.gap), 0);

  return { compared, exact, within1, within2, totalAbsGap };
}

/**
 * Which COLUMN a gap came from, for the rows captured cell by cell.
 *
 * The per-symbol total says a row moved; this says why. Without it a regression
 * is a number that got worse, and the next change is another guess.
 */
function attribute(row: SymbolRow, expected: Record<string, number>) {
  const lines: string[] = [];
  let accounted = 0;

  for (const slot of SCORING_SLOTS) {
    const theirs = expected[slot.key];
    if (theirs === undefined) continue;

    const ours = row.cells[slot.key]?.cell ?? 0;
    const diff = ours - theirs;
    if (diff === 0) continue;

    accounted += diff;
    lines.push(
      `      ${pad(slot.label, 18)} ours ${padStart(signed(ours), 3)}   A1 ${padStart(signed(theirs), 3)}   ` +
        `${signed(diff)}`,
    );
  }

  return { lines, accounted };
}

/**
 * The board was captured at a moment, and releases have landed since.
 *
 * This is not a detail. The morning after the capture, a new UK unemployment
 * print (4.9 against 4.8, where the day before it was 4.9 against 5.0) flipped
 * the GBP leg from +1 to -1 and moved the total gap from 48 to 56 with NO code
 * change — while the per-slot attribution reported a confident "systematic
 * unemployment gap" on two rows. Chasing that would have been chasing the
 * calendar.
 *
 * So the board is scored AS OF its capture time, reusing the backtest's
 * look-ahead guard, and every comparison is like for like. Once the drift is
 * wide enough that the fixture no longer describes a reachable state, the answer
 * is a fresh capture, not a code change.
 */
const CAPTURED_AT = new Date(`${board.capturedUtc}T23:59:59.000Z`);

async function main() {
  const started = Date.now();
  const payload = await runSetupsPipeline();

  const driftHours = (Date.now() - CAPTURED_AT.getTime()) / 3_600_000;
  const trimmed = asOf({ events: payload.events, cot: payload.cot, bars: new Map(), seasonality: new Map() }, CAPTURED_AT);
  const dropped = payload.events.length - trimmed.events.length;

  /**
   * Rebuilt from the trimmed inputs rather than reusing `payload.matrix`, which
   * was scored against now. Technicals and yields are left live: they are a
   * snapshot with no history to rewind here, and both move far less over a day
   * than a fresh macro release does.
   */
  const matrix = buildSetupsMatrix({
    events: trimmed.events,
    cot: trimmed.cot,
    technicals: payload.technicals,
    sovereignYields: payload.sovereignYields,
    now: CAPTURED_AT,
  });
  const health = payload.health;

  console.log(
    `scored as of ${board.capturedUtc} (${driftHours.toFixed(0)}h ago) — ` +
      `${dropped} release${dropped === 1 ? '' : 's'} published since then held back\n`,
  );
  if (driftHours > 96) {
    console.log('  the capture is over four days old; refresh the fixture rather than trusting a gap below\n');
  }

  const { compared, exact, within1, within2, totalAbsGap } = summarise(matrix.rows);

  const degraded = health.filter((h) => !h.ok || h.detail);
  if (degraded.length > 0) {
    console.log('SOURCES REPORTING TROUBLE — a gap below may be a fetch, not a rule\n');
    for (const h of degraded) console.log(`  ${h.ok ? 'degraded' : 'FAILED  '}  ${h.source}: ${h.detail ?? ''}`);
    console.log('');
  }

  console.log(`PARITY vs A1's board captured ${board.capturedUtc}\n`);
  console.log(`  ${pad('symbol', 9)}${padStart('ours', 5)}${padStart('A1', 5)}${padStart('gap', 6)}`);
  console.log(`  ${'-'.repeat(24)}`);

  for (const c of [...compared].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.symbol.localeCompare(b.symbol))) {
    const flag = c.gap === 0 ? ' <- exact' : '';
    console.log(`  ${pad(c.symbol, 9)}${padStart(signed(c.ours), 5)}${padStart(signed(c.a1), 5)}${padStart(signed(c.gap), 6)}${flag}`);
  }

  console.log(`\n  compared        ${compared.length} of ${Object.keys(totals).length} published symbols`);
  console.log(`  exact           ${exact}`);
  console.log(`  within 1        ${within1}`);
  console.log(`  within 2        ${within2}`);
  console.log(`  TOTAL ABS GAP   ${totalAbsGap}    <- the number to drive down`);

  console.log('\nPER-SLOT ATTRIBUTION (rows captured cell by cell)');
  for (const [symbol, expected] of Object.entries(cells)) {
    const row = matrix.rows.find((r) => r.symbol === symbol);
    if (!row) continue;

    const gap = row.totalScore - totals[symbol];
    console.log(`\n  ${symbol}  ours ${signed(row.totalScore)}  A1 ${signed(totals[symbol])}  gap ${signed(gap)}`);

    const { lines, accounted } = attribute(row, expected);
    if (lines.length === 0) console.log('      every column agrees');
    else console.log(lines.join('\n'));

    /**
     * The columns must explain the total. If they do not, the captured row is
     * misaligned against ours — which is worth knowing loudly, because every
     * conclusion drawn from it would be wrong.
     */
    if (accounted !== gap) {
      console.log(`      !! columns sum to ${signed(accounted)} but the total differs by ${signed(gap)}`);
      console.log('      !! the captured row is misaligned — do not trust the attribution above');
    }
  }

  console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('parity run failed:', err);
  process.exitCode = 1;
});
