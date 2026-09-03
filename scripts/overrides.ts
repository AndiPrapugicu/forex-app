/**
 * OVERRIDE AUDIT — is each per-currency basis override doing anything, and is
 * what it does still justified?
 *
 * WHY THIS EXISTS. `compareByCurrency: { CAD: 'previous' }` sat on three slots
 * for months, justified by A1 cards whose Forecast column was blank. That
 * justification only ever described the NO-CONSENSUS case — and `scoreSlot`
 * already falls back to the prior print there on its own. So the override was
 * redundant exactly where its evidence applied, and active only where it did
 * not. On 2026-08-31 it scored Canadian retail sales -1 against a +0.4
 * consensus the release had beaten.
 *
 * The class of bug is not "wrong override". It is "override whose triggering
 * condition is not the condition its evidence describes". This script answers
 * that mechanically, per currency, against the live calendar:
 *
 *   INERT   the print carries no consensus, so the generic fallback would
 *           produce the same answer and the override is doing nothing
 *   ACTIVE  a consensus exists and the override is discarding it, so the
 *           override alone decides the cell — it needs its own evidence
 *
 * ACTIVE is not automatically wrong. It means the override must be justified by
 * something other than "their forecast column was blank", because it is now
 * firing on a print where it was not.
 *
 *   npm run overrides
 */

import { MATRIX_SLOTS } from '@/config/setups.config';
import { maxAgeFor, resolveSeries, scoreSlot, priorPrint } from '@/lib/scoring/discrete';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import type { Currency, NormalizedEvent } from '@/lib/types';

const pad = (s: unknown, n: number) => String(s ?? '-').padEnd(n);
const signed = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : n > 0 ? `+${n}` : String(n);

async function main() {
  const now = new Date();
  const payload = await runSetupsPipeline(now);
  const events = payload.events;

  console.log('='.repeat(118));
  console.log('BASIS OVERRIDES (compareByCurrency) — audited against the live calendar');
  console.log('='.repeat(118));
  console.log(
    `  ${pad('slot', 18)}${pad('cur', 5)}${pad('series', 34)}${pad('actual', 9)}` +
      `${pad('consensus', 11)}${pad('prior', 8)}${pad('cell', 6)}${pad('as fcast', 9)}verdict`,
  );
  console.log('  ' + '-'.repeat(114));

  let active = 0;
  let inert = 0;

  for (const slot of MATRIX_SLOTS) {
    if (slot.kind !== 'economic') continue;
    const overrides = slot.compareByCurrency ?? {};

    for (const [cur, basis] of Object.entries(overrides) as [Currency, string][]) {
      // What the override actually selects and scores.
      const withOverride = scoreSlot(slot, cur, events, now);

      /**
       * What the SAME slot would do with no override at all. Resolution is
       * repeated too, not just the comparison: the basis changes which print is
       * considered scoreable, so a slot can reach a different release entirely.
       */
      const generic = resolveSeries(slot, cur, events, 'forecast', {
        now,
        /*
         * Through `maxAgeFor`, because this window has to be the one the real
         * resolver would use. Re-deriving it as `slot.maxAgeDays ?? 60` skipped
         * `maxAgeDaysByCurrency` entirely, so New Zealand retail sales was
         * ranked against 75 days here and 120 in production - and since the
         * window decides which candidate ranks best, the "no override" arm
         * could reach a different print than dropping the override actually
         * would. That makes the verdict below describe a slot that does not
         * exist.
         */
        maxAgeDays: maxAgeFor(slot, cur),
      });
      const genericCell = genericCellFor(slot, generic);

      const ev = withOverride.event;
      // Identity is series + date, not the feed's row id: the same release can
      // arrive twice under different ids, and a basis change can switch SERIES
      // (YoY to MoM) as well as date. Both matter; a row id matches neither.
      const idOf = (e: NormalizedEvent | null | undefined) =>
        e ? `${e.name}@${e.dateUtc.slice(0, 10)}` : 'none';
      const sameEvent = idOf(generic) === idOf(ev);

      /**
       * THE VERDICT IS THE OUTCOME, NOT THE COMPARISON.
       *
       * An earlier version of this script judged inertness from whether the
       * resolved print carried a consensus, and got two of four rows wrong. The
       * basis does not only decide what a print is measured AGAINST — it decides
       * which print is reachable at all, because `resolveSeries` prefers the most
       * recent print scoreable UNDER THAT BASIS. Drop the override and a slot can
       * silently reach past a fresh unforecast print to an older forecast one,
       * which is how GBP core PPI once scored off a release 68 days stale. So
       * compare the CELLS, and name the mechanism that moved them.
       */
      const changes = genericCell !== withOverride.cell || !sameEvent;
      const verdict = !changes
        ? 'INERT — removing it changes nothing'
        : !sameEvent
          ? `ACTIVE — holds resolution; without it: ${idOf(generic)}`
          : 'ACTIVE — same print, override alone decides the cell';
      if (changes) active += 1;
      else inert += 1;

      console.log(
        `  ${pad(slot.key, 18)}${pad(cur, 5)}${pad((ev?.name ?? 'no print').slice(0, 32), 34)}` +
          `${pad(ev?.actual, 9)}${pad(ev?.consensus, 11)}${pad(ev ? priorPrint(ev) : null, 8)}` +
          `${pad(signed(withOverride.cell), 6)}${pad(signed(genericCell), 9)}${verdict}`,
      );
      console.log(`  ${' '.repeat(23)}basis=${basis}, resolved ${ev?.dateUtc?.slice(0, 10) ?? '-'}`);
    }
  }

  console.log();
  console.log(`  ${active} ACTIVE, ${inert} INERT`);
  console.log(
    [
      '  INERT: deletable with a regression test, and the board does not move.',
      '  ACTIVE (holds resolution): NOT deletable as written. The override is standing in for a',
      '    resolver that demands a consensus while the scorer does not. Fix the resolver, not the slot.',
      '  ACTIVE (same print): needs evidence about the print it is actually firing on.',
    ].join('\n'),
  );
}

/** Scores one resolved event the way `scoreSlot` would, on a forecast basis. */
function genericCellFor(
  slot: (typeof MATRIX_SLOTS)[number],
  event: NormalizedEvent | null,
): number | null {
  if (!event || event.actual === null) return null;
  const reference = event.consensus ?? priorPrint(event);
  if (reference === null || reference === undefined) return null;
  const polarity = slot.polarity ?? 1;
  const diff = event.actual - reference;
  const sign = Math.abs(diff) < 1e-9 ? 0 : diff > 0 ? 1 : -1;
  return sign * polarity === 0 ? 0 : sign * polarity;
}

main();
