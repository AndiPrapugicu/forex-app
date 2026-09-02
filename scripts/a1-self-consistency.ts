/**
 * Does A1's board agree with A1's own published data?
 *
 *   npm run self-consistency
 *
 * Scores every release we have captured off their free economic pages under
 * their own stated comparison, and checks it against the leg their board
 * actually prints. See `lib/scoring/a1-self-consistency.ts` for why that is the
 * question that decides who has to fix what.
 */

import { readFileSync } from 'node:fs';

import { SCORING_SLOTS } from '@/config/setups.config';
import { solvePerCapture, type Leg } from '@/lib/scoring/a1-legs';
import {
  checkSelfConsistency,
  summarize,
  type A1Release,
  type OurRelease,
} from '@/lib/scoring/a1-self-consistency';
import { scoreSlot } from '@/lib/scoring/discrete';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { asOf } from '@/lib/scoring/backtest';
import { CURRENCIES, type Currency } from '@/lib/types';

const RULE = '='.repeat(118);

/** Their page section -> our slot key. */
const SECTION_TO_SLOT: Record<string, string> = {
  consumerConfidence: 'consumer-confidence',
  manufacturingPmi: 'mpmi',
  servicesPmi: 'spmi',
  ppiYoY: 'ppi',
  gdpGrowth: 'gdp',
  retailSales: 'retail-sales',
};

function loadReleases(path: string): A1Release[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    series?: Record<string, Record<string, unknown>>;
  };
  const out: A1Release[] = [];
  for (const [section, byCurrency] of Object.entries(raw.series ?? {})) {
    const slotKey = SECTION_TO_SLOT[section];
    if (!slotKey) continue;
    for (const [currency, entries] of Object.entries(byCurrency)) {
      if (!CURRENCIES.includes(currency as Currency) || !Array.isArray(entries)) continue;
      for (const e of entries as { date: string; actual: number | null; forecast: number | null; a1Label?: string }[]) {
        out.push({
          slotKey,
          currency: currency as Currency,
          date: e.date,
          actual: e.actual ?? null,
          forecast: e.forecast ?? null,
          a1Label: e.a1Label ?? null,
        });
      }
    }
  }
  return out;
}

function pad(v: number | null, w = 6): string {
  return (v === null ? '-' : String(v)).padStart(w);
}

async function main() {
  const releases = loadReleases('fixtures/a1-free-economic-2026-08-30.json');

  // Their board, solved into legs — one solve per capture date, never merged.
  const top24 = JSON.parse(readFileSync('fixtures/a1-top-setups-2026-08-24.json', 'utf8'));
  const top25 = JSON.parse(readFileSync('fixtures/a1-top-setups-2026-08-25.json', 'utf8'));
  const solved = solvePerCapture([
    { date: '2026-08-24', rows: top24.cells },
    { date: '2026-08-25', rows: top25.cells },
  ]);

  /**
   * Legs merged across the two dates, and a currency whose leg DIFFERS between
   * them is dropped rather than resolved. A column that moved between the two
   * boards is exactly the case this check must not pretend to have an answer
   * for — and on CHF consumer confidence it genuinely does move, with no
   * release in between.
   */
  const printedLegs = new Map<Currency, Partial<Record<string, Leg>>>();
  const disagreed: string[] = [];
  for (const { result } of solved) {
    for (const [currency, byslot] of result.legs) {
      const acc = printedLegs.get(currency) ?? {};
      for (const [slotKey, leg] of Object.entries(byslot)) {
        if (acc[slotKey] !== undefined && acc[slotKey] !== leg) {
          disagreed.push(`${currency} ${slotKey}: ${acc[slotKey]} vs ${leg}`);
          delete acc[slotKey];
        } else if (acc[slotKey] === undefined) {
          acc[slotKey] = leg as Leg;
        }
      }
      printedLegs.set(currency, acc);
    }
  }

  // Our own inputs, resolved at the capture date so the comparison is dated.
  const at = new Date('2026-08-24T23:59:59.000Z');
  const payload = await runSetupsPipeline(new Date(), { pricesAsOf: at });
  const trimmed = asOf(
    { events: payload.events, cot: payload.cot, bars: new Map(), seasonality: new Map() } as never,
    at,
  );
  const ours = new Map<string, OurRelease>();
  for (const slot of SCORING_SLOTS) {
    if (slot.kind !== 'economic') continue;
    for (const currency of CURRENCIES) {
      const res = scoreSlot(slot, currency, trimmed.events, at);
      if (!res.event) continue;
      const label = res.referenceLabel ?? 'forecast';
      ours.set(`${slot.key}|${currency}`, {
        actual: res.event.actual ?? null,
        reference: (label === 'previous' ? res.event.previous : res.event.consensus) ?? null,
        referenceLabel: label,
      });
    }
  }

  const rows = checkSelfConsistency({ releases, printedLegs, ours, capturedOn: '2026-08-24' });

  console.log(RULE);
  console.log('A1 AGAINST A1 -- their published data scored under their own rule, vs the cell they printed');
  console.log(RULE);
  console.log();
  console.log(
    'slot                currency date        a1 act  a1 fcst  implied  printed | our act  our ref | verdict',
  );
  console.log('-'.repeat(118));

  const order: Record<string, number> = {
    A1_CONTRADICTS_ITSELF: 0, A1_RELEASE_DATE_AMBIGUOUS: 1, A1_SELF_CONSISTENT: 2,
    A1_NO_FORECAST: 3, NO_LEG_SOLVED: 4, NOT_THE_BOARDS_RELEASE: 5,
  };
  const sorted = [...rows].sort(
    (a, b) => order[a.verdict] - order[b.verdict] || a.slotKey.localeCompare(b.slotKey),
  );

  for (const r of sorted) {
    console.log(
      `${r.slotKey.padEnd(20)}${r.currency.padEnd(9)}${r.date.padEnd(12)}` +
        `${pad(r.a1Actual)}  ${pad(r.a1Forecast, 7)}  ${pad(r.impliedLeg, 7)}  ${pad(r.printedLeg, 7)} | ` +
        `${pad(r.ourActual, 7)}  ${pad(r.ourReference, 7)} | ${r.verdict}`,
    );
    if (r.verdict !== 'A1_SELF_CONSISTENT' || r.source !== 'SAME_INPUTS') {
      console.log(`${' '.repeat(20)}${r.source} -- ${r.note}`);
    }
  }

  const counts = summarize(rows);
  console.log();
  console.log('-'.repeat(118));
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(24)} ${v}`);

  if (disagreed.length > 0) {
    console.log();
    console.log('LEGS THAT MOVED BETWEEN THE TWO CAPTURES (dropped rather than guessed):');
    for (const d of disagreed) console.log(`  ${d}`);
    console.log(
      '  A leg that moves with no release between the two boards is A1 disagreeing with itself\n' +
        '  across one day, and no single value of ours can match both cells.',
    );
  }
  console.log(RULE);
  console.log('A cell their own data contradicts is not a target. Do not reproduce it.');
}

main();
