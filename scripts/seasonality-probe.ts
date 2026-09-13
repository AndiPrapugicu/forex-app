/**
 * WHICH MONTH IS A1'S SEASONALITY COLUMN ACTUALLY READING?
 *
 * `npm run delta-parity` found seasonality to be our single largest source of
 * spurious movement: across the 2026-08-31 -> 2026-09-01 month turn our cell
 * changed on 23 symbols and A1's changed on 4 of 54. Both boards crossed the
 * same boundary, so one of three things is true, and they need different fixes:
 *
 *   1. A1 lags. Their column had not yet turned to September when captured.
 *   2. A1's underlying 10-year averages differ from ours.
 *   3. A1's rule is not "sign of the current month's average" despite their
 *      scorecard saying `Current month's 10yr seasonality`.
 *
 * The test is direct: score A1's September board against OUR August signs and
 * against OUR September signs. Whichever it matches better says which month
 * their column was on.
 *
 * WHY THIS IS WORTH A SCRIPT. A sign-only rule on a near-zero mean is a coin
 * flip, and half this board is near zero — 25 of 50 symbols carry a September
 * 10-year mean under 0.5%, and 72% have a win rate between 40% and 60%. AUDCAD
 * scores +1 on a +0.02% average that rose in three of ten Septembers. Those
 * votes are noise, and noise re-rolls every month, which is exactly the shape
 * of the drift delta-parity measured.
 *
 *   npm run seasonality-probe
 */

import fs from 'node:fs';
import path from 'node:path';

import { NAME_MAP, NOT_MODELED } from '@/lib/scoring/a1-symbol-map';
import { buildSetupsMatrix, type SymbolRow } from '@/lib/scoring/setups';
import { asOf } from '@/lib/scoring/backtest';
import { runSetupsPipeline } from '@/lib/setups-pipeline';

const AUGUST = new Date('2026-08-31T23:59:59.000Z');
const SEPTEMBER = new Date('2026-09-01T09:44:00.000Z');

const pad = (s: unknown, n: number) => String(s ?? '').padEnd(n);
const padS = (s: unknown, n: number) => String(s ?? '').padStart(n);

async function boardAt(at: Date): Promise<Map<string, SymbolRow>> {
  const payload = await runSetupsPipeline(new Date(), { pricesAsOf: at });
  const trimmed = asOf(
    { events: payload.rewindPool, cot: payload.cot, bars: new Map(), seasonality: new Map() },
    at,
  );
  const matrix = buildSetupsMatrix({
    events: trimmed.events,
    cot: trimmed.cot,
    technicals: payload.technicals,
    sovereignYields: payload.sovereignYields,
    yield2y: payload.yield2y,
    retailPositioning: payload.retailPositioning,
    now: at,
  });
  return new Map(matrix.rows.map((r) => [r.symbol, r]));
}

function readBoard(file: string): Map<string, Record<string, string>> {
  const lines = fs.readFileSync(path.join(process.cwd(), 'fixtures', file), 'utf8')
    .trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return new Map(
    lines.slice(1).map((l) => {
      const row = Object.fromEntries(l.split(',').map((v, i) => [head[i], v]));
      return [row.Symbol, row] as [string, Record<string, string>];
    }),
  );
}

async function main() {
  const a1Sep = readBoard('a1-top-setups-2026-09-01.csv');
  const ourAug = await boardAt(AUGUST);
  const ourSep = await boardAt(SEPTEMBER);

  console.log('='.repeat(96));
  console.log("WHICH MONTH IS A1'S SEASONALITY ON?  their 2026-09-01 board against our two months");
  console.log('='.repeat(96));
  console.log(`\n${pad('symbol', 10)}${padS('A1 Sep', 8)}${padS('our Aug', 9)}${padS('our Sep', 9)}   matches`);
  console.log('-'.repeat(96));

  let matchesAug = 0;
  let matchesSep = 0;
  let both = 0;
  let neither = 0;
  let compared = 0;

  for (const [name, row] of a1Sep) {
    if (NOT_MODELED.has(name)) continue;
    const symbol = NAME_MAP[name] ?? name;
    const aug = ourAug.get(symbol)?.cells['seasonality']?.cell;
    const sep = ourSep.get(symbol)?.cells['seasonality']?.cell;
    if (aug === null || aug === undefined || sep === null || sep === undefined) continue;
    const theirs = Number.parseInt(row.Seasonality, 10);
    compared++;

    // Compare SIGN, not magnitude: A1 gives indices and commodities +/-2 and FX
    // +/-1, so an FX row and an index row are not on the same scale.
    const sAug = Math.sign(aug) === Math.sign(theirs);
    const sSep = Math.sign(sep) === Math.sign(theirs);
    if (sAug) matchesAug++;
    if (sSep) matchesSep++;
    if (sAug && sSep) both++;
    if (!sAug && !sSep) neither++;

    const label = sAug && sSep ? 'both' : sAug ? 'AUGUST' : sSep ? 'September' : 'neither';
    console.log(
      pad(symbol, 10) + padS(theirs, 8) + padS(aug, 9) + padS(sep, 9) + `   ${label}`,
    );
  }

  const pct = (n: number) => `${((n / compared) * 100).toFixed(1)}%`;
  console.log('-'.repeat(96));
  console.log(`\n${compared} symbols compared on SIGN`);
  console.log(`  matches our AUGUST sign:     ${matchesAug}  ${pct(matchesAug)}`);
  console.log(`  matches our SEPTEMBER sign:  ${matchesSep}  ${pct(matchesSep)}`);
  console.log(`  agree either way:            ${both}   (uninformative — the two months share a sign)`);
  console.log(`  match neither:               ${neither}`);

  /**
   * The discriminating rows are the ONLY ones that carry information. Where our
   * August and September signs agree, A1 matching us says nothing about which
   * month they are on, and including those rows drags both percentages toward
   * each other and hides the answer.
   */
  const decisive = compared - both - neither;
  const augOnly = matchesAug - both;
  const sepOnly = matchesSep - both;
  console.log(`\n  DECISIVE ROWS (our two months disagree): ${decisive}`);
  console.log(`     A1 sided with our August:     ${augOnly}`);
  console.log(`     A1 sided with our September:  ${sepOnly}`);
}

main().catch((err) => {
  console.error('seasonality-probe failed:', err);
  process.exit(1);
});
