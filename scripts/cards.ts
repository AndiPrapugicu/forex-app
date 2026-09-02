/**
 * Our per-country heatmap beside A1's published card, row by row.
 *
 *   npm run cards                 all eight majors
 *   npm run cards -- CHF JPY      just those
 *
 * WHY THIS IS NOT `npm run legs`. That table is the one every pair is built
 * from and it iterates the SCORING slots, which excludes the three rows this
 * comparison exists for — Household Spending, Employment Change and Wage Growth
 * are on their cards and off their board. This goes through
 * `buildCurrencyHeatmap`, the same function `/heatmap`, `/surprise` and the
 * Economic Surprise Meter use, so what it prints is what the card renders.
 *
 * WHY IT IS NOT `npm run parity` EITHER. Parity compares SCORES; this compares
 * the four numbers behind a score. A board total is the sum of eighteen cells,
 * so reading a rule out of one is an inference. Reading their Actual, Forecast,
 * Previous and Surprise beside ours is a direct comparison of both models.
 *
 * READ THE SECTIONS IN ORDER, AND STOP AT THE THIRD.
 *
 *   ROW SET   which rows each side carries. Date-independent, so it is
 *             attributable no matter when the frames were taken. Actionable.
 *   BASIS     forecast or previous, split into INTENT (what the config asks
 *             for) and OUTCOME (what the run actually got). Only an intent
 *             mismatch is a config bug; an outcome-only mismatch is consensus
 *             coverage on the day, and setting `compareByCurrency` from one is
 *             how a snapshot becomes a permanent rule.
 *   VALUES    printed for context and NOT evidence of anything. The card
 *             capture has no recoverable date.
 */

import heatmaps from '@/fixtures/a1-heatmaps.json';
import { SLOTS } from '@/config/setups.config';
import { compareFor } from '@/lib/scoring/discrete';
import { buildCurrencyHeatmap, bullishShare } from '@/lib/scoring/heatmap';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { MAJORS, type Currency } from '@/lib/types';

interface CardRow {
  label: string;
  slotKey: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  surprise: number;
  currencyImpact: number;
  stocksImpact: number;
  /** Cells that could not be read off the frame. Never confused with blank. */
  illegible?: string[];
}

interface Card {
  country: string;
  scored?: boolean;
  impactPct: { currency: number; stocks: number };
  rows: CardRow[];
}

const capture = (heatmaps as { captures: { capturedUtc: string | null; provenance: string; cards: Record<string, Card> }[] })
  .captures[0];

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padStart = (s: string | number, n: number) => String(s).padStart(n);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const num = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : String(Math.round(v * 1000) / 1000);
const impact = (v: number | null) => (v === null ? '-' : v > 0 ? 'bull' : v < 0 ? 'bear' : 'neut');

async function main() {
  const requested = process.argv.slice(2).map((a) => a.toUpperCase());
  const currencies = (requested.length > 0 ? requested : [...MAJORS]) as Currency[];

  const { events } = await runSetupsPipeline();
  const slotByKey = new Map(SLOTS.map((s) => [s.key, s]));

  console.log(
    `\nA1 cards captured ${capture.capturedUtc ?? 'DATE UNKNOWN'} (${capture.provenance})`,
  );
  console.log('Values below are stale and prove nothing. The ROW SET and the BASIS do.\n');

  const summary: { cur: Currency; theirs: number; ours: number; matched: number; theirsOnly: number; oursOnly: number; basis: number }[] = [];

  for (const cur of currencies) {
    const card = capture.cards[cur];
    if (!card) {
      console.log(`=== ${cur} === no published card in the capture\n`);
      continue;
    }

    const ours = buildCurrencyHeatmap(cur, events);
    const ourByKey = new Map(ours.rows.map((r) => [r.slotKey, r]));
    const theirByKey = new Map(card.rows.map((r) => [r.slotKey, r]));

    console.log(`=== ${cur} (${card.country}) ===`);

    const theirsOnly = card.rows.filter((r) => !ourByKey.has(r.slotKey));
    const oursOnly = ours.rows.filter((r) => !theirByKey.has(r.slotKey));
    const matched = card.rows.filter((r) => ourByKey.has(r.slotKey));

    console.log(
      `\n  ROW SET   theirs ${card.rows.length}, ours ${ours.rows.length}, matched ${matched.length}`,
    );
    if (theirsOnly.length > 0) {
      for (const r of theirsOnly) console.log(`    THEIRS ONLY  ${r.label}  (${r.slotKey})`);
    }
    if (oursOnly.length > 0) {
      for (const r of oursOnly) console.log(`    OURS ONLY    ${r.label}  (${r.slotKey})`);
    }
    if (theirsOnly.length === 0 && oursOnly.length === 0) console.log('    identical');

    /**
     * INTENT is what the config asks for and is a property of the code. OUTCOME
     * is what this run got, and flips whenever a consensus does or does not
     * arrive. Only the first is a bug worth a config change.
     */
    let basisMismatch = 0;
    const basisLines: string[] = [];
    for (const r of matched) {
      const slot = slotByKey.get(r.slotKey);
      const mine = ourByKey.get(r.slotKey)!;
      if (!slot) continue;
      /**
       * An UNREADABLE Forecast is not a blank one. Only a cell we could see was
       * empty is evidence they scored against the prior print, and treating a
       * bad screenshot as evidence is precisely how `compareByCurrency` would
       * acquire a rule nobody meant.
       */
      if (r.illegible?.includes('forecast')) continue;
      const theirIntent = r.forecast === null ? 'previous' : 'forecast';
      const ourIntent = compareFor(slot, cur);
      if (theirIntent === ourIntent) continue;
      basisMismatch++;
      basisLines.push(
        `    ${pad(r.label, 22)} theirs ${pad(theirIntent, 9)} ours ${pad(ourIntent, 9)}` +
          ` (this run resolved: ${mine.referenceLabel})`,
      );
    }
    console.log(`\n  BASIS     ${basisMismatch} intent mismatch${basisMismatch === 1 ? '' : 'es'}`);
    for (const line of basisLines) console.log(line);
    if (basisMismatch === 0) console.log('    every matched row reads against the same reference');

    console.log('\n  VALUES — stale on their side; for orientation only\n');
    console.log(
      `    ${pad('row', 22)}${padStart('their act', 10)}${padStart('vs', 9)}` +
        `${padStart('surp', 8)}${padStart('imp', 6)}   |${padStart('our act', 10)}${padStart('vs', 9)}${padStart('surp', 8)}${padStart('imp', 6)}${padStart('age', 6)}`,
    );
    console.log(`    ${'-'.repeat(105)}`);
    for (const r of card.rows) {
      const mine = ourByKey.get(r.slotKey);
      const theirRef = r.forecast ?? r.previous;
      const left =
        `    ${pad(r.label, 22)}${padStart(num(r.actual), 10)}${padStart(num(theirRef), 9)}` +
        `${padStart(signed(r.surprise), 8)}${padStart(impact(r.currencyImpact), 6)}   |`;
      const right = mine
        ? `${padStart(num(mine.actual), 10)}${padStart(num(mine.reference), 9)}` +
          `${padStart(mine.surprise === null ? '-' : signed(mine.surprise), 8)}` +
          `${padStart(impact(mine.currencyImpact), 6)}${padStart(mine.ageDays === null ? '-' : `${mine.ageDays}d`, 6)}`
        : `${padStart('MISSING', 10)}`;
      console.log(left + right);
    }

    /**
     * Three percentages, and the third is the only one that means anything here.
     * Ours over OUR rows differs from theirs for two reasons at once — a
     * different row set and different values — and recomputing ours over the
     * shared rows separates them. With an undated card, only the row-set half
     * is attributable.
     */
    const sharedKeys = new Set(matched.map((r) => r.slotKey));
    const overShared = bullishShare(
      ours.rows.filter((r) => sharedKeys.has(r.slotKey)).map((r) => r.currencyImpact),
    );
    console.log(
      `\n  IMPACT %  theirs ${card.impactPct.currency}   ours ${ours.currencyImpactPct ?? '-'}` +
        `   ours over the shared rows ${overShared ?? '-'}\n`,
    );

    summary.push({
      cur,
      theirs: card.rows.length,
      ours: ours.rows.length,
      matched: matched.length,
      theirsOnly: theirsOnly.length,
      oursOnly: oursOnly.length,
      basis: basisMismatch,
    });
  }

  console.log('\nSUMMARY\n');
  console.log(
    `  ${pad('cur', 5)}${padStart('theirs', 7)}${padStart('ours', 6)}${padStart('matched', 9)}` +
      `${padStart('theirs only', 13)}${padStart('ours only', 11)}${padStart('basis', 7)}`,
  );
  console.log(`  ${'-'.repeat(58)}`);
  for (const s of summary) {
    console.log(
      `  ${pad(s.cur, 5)}${padStart(s.theirs, 7)}${padStart(s.ours, 6)}${padStart(s.matched, 9)}` +
        `${padStart(s.theirsOnly, 13)}${padStart(s.oursOnly, 11)}${padStart(s.basis, 7)}`,
    );
  }
  const rowGaps = summary.reduce((t, s) => t + s.theirsOnly + s.oursOnly, 0);
  const basisGaps = summary.reduce((t, s) => t + s.basis, 0);
  console.log(`\n  ${rowGaps} row-set mismatches, ${basisGaps} basis-intent mismatches`);
}

main().catch((err) => {
  console.error('cards run failed:', err);
  process.exitCode = 1;
});
