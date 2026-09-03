/**
 * Every currency's macro legs, with the series and numbers behind each one.
 *
 *   npm run legs                  all eight majors
 *   npm run legs -- CHF USD       just those
 *
 * THIS IS THE TABLE EVERYTHING ELSE IS DERIVED FROM. A pair cell is
 * `base − quote` over these legs and nothing else, so a wrong leg is not a wrong
 * row — it is a wrong column in every pair that currency appears in, with the
 * sign flipped depending on which side it sits. CHF alone feeds seven rows.
 *
 * `npm run parity` says how far a row is from A1's. `npm run board:diff` says
 * which currency is behind it. This says WHY: which series filled the slot, what
 * it printed, what it was measured against, and how old it is. That is the level
 * at which a fix is actually made.
 *
 * It is also the level at which A1 can be compared directly rather than reverse
 * engineered. Their per-country economic heatmaps publish Actual, Forecast,
 * Previous and Surprise per row — the same four numbers printed here. Comparing
 * this table against those cards is a direct reading of both models; comparing
 * board totals is an inference from the sum of eighteen of them.
 *
 * AGE IS PRINTED BECAUSE A STALE LEG IS THE FAILURE THAT LOOKS LIKE A SCORE.
 * Swiss GDP was filling its slot from a print 81 days old and Swiss unemployment
 * from one 46 days old, both inside their windows, both scoring a confident
 * number off data A1 had long since replaced.
 */

import { SLOTS } from '@/config/setups.config';
import { compareFor, scoreSlot } from '@/lib/scoring/discrete';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { MAJORS, type Currency } from '@/lib/types';

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padStart = (s: string | number, n: number) => String(s).padStart(n);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const num = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : String(Math.round(v * 1000) / 1000);

async function main() {
  const requested = process.argv.slice(2).map((a) => a.toUpperCase());
  const currencies = (requested.length > 0 ? requested : [...MAJORS]) as Currency[];

  const payload = await runSetupsPipeline();
  const now = new Date();
  const econ = SLOTS.filter((s) => s.kind === 'economic' && s.scoring);

  const totals: { cur: Currency; macro: number; scored: number; oldest: number }[] = [];

  for (const cur of currencies) {
    console.log(`\n=== ${cur} ===`);
    console.log(
      `  ${pad('slot', 20)}${pad('series', 40)}${padStart('actual', 9)}${padStart('vs', 9)}` +
        `${pad('  basis', 12)}${padStart('cell', 5)}${padStart('age', 6)}`,
    );
    console.log(`  ${'-'.repeat(101)}`);

    let macro = 0;
    let scored = 0;
    let oldest = 0;

    for (const slot of econ) {
      const r = scoreSlot(slot, cur, payload.events, now);
      const e = r.event;

      if (r.status === 'no-data' && !e) {
        console.log(`  ${pad(slot.label, 20)}${pad('— not published for this economy', 40)}`);
        continue;
      }

      /**
       * What the cell was ACTUALLY measured against, which is not always the
       * forecast: where no consensus exists the score falls back to the prior
       * print, and that is A1's rule rather than an approximation of it. Showing
       * the basis is the only way to tell a beat from an improvement.
       */
      const hasConsensus = e?.consensus !== null && e?.consensus !== undefined;
      /**
       * `compareFor`, never `slot.compare` — the per-currency override is the
       * whole point of this column, and reading the slot default instead prints
       * a confident "vs forecast" beside a cell that was scored off the prior
       * print. That exact bug shipped in the heatmap and hid its own symptom.
       */
      const againstPrevious = compareFor(slot, cur) === 'previous' || !hasConsensus;
      const reference = againstPrevious ? e?.previous : e?.consensus;
      const basis = againstPrevious ? 'vs PREVIOUS' : 'vs forecast';

      const age = r.ageDays ?? 0;
      if (r.status === 'scored' && r.cell !== null) {
        macro += r.cell;
        scored++;
        oldest = Math.max(oldest, age);
      }

      // No STALE case: an old print scores, and its age is already reported by
      // the `oldest` column below.
      const cellText = r.status === 'scored' && r.cell !== null ? signed(r.cell) : r.status;

      console.log(
        `  ${pad(slot.label, 20)}${pad((e?.name ?? '?').slice(0, 38), 40)}${padStart(num(e?.actual), 9)}` +
          `${padStart(num(reference), 9)}${pad(`  ${basis}`, 12)}${padStart(cellText, 5)}` +
          `${padStart(`${age}d`, 6)}${age > 45 ? '  <- old' : ''}`,
      );
    }

    console.log(`  ${'-'.repeat(101)}`);
    console.log(`  macro total ${signed(macro)} from ${scored} scored legs, oldest ${oldest}d`);
    totals.push({ cur, macro, scored, oldest });
  }

  if (totals.length > 1) {
    console.log('\n\nMACRO LEG TOTALS — the number every pair this currency touches is built from\n');
    console.log(`  ${pad('cur', 6)}${padStart('macro', 7)}${padStart('legs', 6)}${padStart('oldest', 8)}`);
    console.log(`  ${'-'.repeat(27)}`);
    for (const t of [...totals].sort((a, b) => b.macro - a.macro)) {
      console.log(
        `  ${pad(t.cur, 6)}${padStart(signed(t.macro), 7)}${padStart(t.scored, 6)}${padStart(`${t.oldest}d`, 8)}`,
      );
    }
    /**
     * The spread between the strongest and weakest leg bounds every pair cell on
     * the board. Where it is wider than A1's, every cross between those two
     * currencies is overstated — which is one defect, not fourteen rows.
     */
    const hi = totals.reduce((a, b) => (a.macro > b.macro ? a : b));
    const lo = totals.reduce((a, b) => (a.macro < b.macro ? a : b));
    console.log(
      `\n  widest spread: ${hi.cur} ${signed(hi.macro)} against ${lo.cur} ${signed(lo.macro)} ` +
        `= ${hi.macro - lo.macro} points across ${hi.cur}${lo.cur}`,
    );
  }
}

main().catch((err) => {
  console.error('legs failed:', err);
  process.exitCode = 1;
});
