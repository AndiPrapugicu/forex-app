/**
 * The coverage table's invariants.
 *
 * The third block is the one that matters. Every entry is re-derived from the
 * committed capture of A1's board, so an entry that stops being true — or one
 * that was never true, like blanking CAD services PMI, which A1 scores +1 —
 * fails here instead of quietly moving parity.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { A1_COVERAGE, coverageFor } from '@/config/profiles.config';
import { SCORING_SLOTS } from '@/config/setups.config';
import { applyCoverage } from '@/lib/scoring/coverage';
import type { SlotResult } from '@/lib/scoring/discrete';
import { parseCapture } from '@/lib/scoring/a1-pair-legs';
import { NAME_MAP } from '@/lib/scoring/a1-symbol-map';
import { ledgerEntry } from '@/lib/scoring/parity-ledger';
import type { CurrencySlotScores } from '@/lib/scoring/setups';
import { MAJORS, type Currency } from '@/lib/types';

const CAPTURE = 'fixtures/a1-top-setups-2026-09-02-1446.csv';

/** Their single-economy row name for a currency, via the shared symbol map. */
function indexRowName(currency: Currency): string {
  const symbol = `${currency}X`;
  const name = Object.entries(NAME_MAP).find(([, s]) => s === symbol)?.[0];
  if (!name) throw new Error(`no A1 index row mapped for ${symbol}`);
  return name;
}

function result(currency: Currency, slotKey: string, cell: number | null): SlotResult {
  return {
    slotKey,
    currency,
    cell,
    status: cell === null ? 'no-data' : 'scored',
    event: null,
    sigma: null,
    ageDays: null,
    explanation: `${currency} ${slotKey}`,
  };
}

function scores(): CurrencySlotScores {
  const out: CurrencySlotScores = new Map();
  MAJORS.forEach((currency, i) => {
    out.set(
      currency,
      new Map(['spmi', 'retail-sales', 'cpi'].map((k) => [k, result(currency, k, (i % 3) - 1)])),
    );
  });
  return out;
}

describe('the coverage table is well-formed', () => {
  const slotKeys = new Set(SCORING_SLOTS.map((s) => s.key));

  it.each(A1_COVERAGE.map((e) => [`${e.slotKey}/${e.currency}`, e] as const))(
    '%s names a scoring slot, a major, and a written finding',
    (_label, entry) => {
      expect(slotKeys.has(entry.slotKey)).toBe(true);
      expect(MAJORS).toContain(entry.currency);
      expect(ledgerEntry(entry.ledgerKey), `ledger has no ${entry.ledgerKey}`).toBeDefined();
    },
  );
});

describe('every entry re-derives from the captured board', () => {
  const capture = parseCapture(readFileSync(path.join(process.cwd(), CAPTURE), 'utf8'), CAPTURE);

  it.each(A1_COVERAGE.map((e) => [`${e.slotKey}/${e.currency}`, e] as const))('%s', (_label, entry) => {
    const recipient = capture.rows.get(indexRowName(entry.currency))?.[entry.slotKey];
    expect(recipient, `capture has no ${entry.currency} index cell for ${entry.slotKey}`).toBeDefined();

    if (entry.rule.kind === 'blank') {
      expect(recipient).toBe(0);
    } else {
      const donor = capture.rows.get(indexRowName(entry.rule.currency))?.[entry.slotKey];
      expect(recipient).toBe(donor);
    }
  });
});

describe('applyCoverage', () => {
  it('is a proven no-op under the ours profile', () => {
    const input = scores();
    expect(applyCoverage(input, coverageFor('ours'))).toBe(input);
  });

  it('changes exactly the cells the table names under the a1 profile', () => {
    const input = scores();
    const got = applyCoverage(input, coverageFor('a1'));
    const named = new Set(A1_COVERAGE.map((e) => `${e.slotKey}|${e.currency}`));

    for (const [currency, slots] of input) {
      for (const [slotKey, before] of slots) {
        const after = got.get(currency)!.get(slotKey)!;
        if (named.has(`${slotKey}|${currency}`)) continue;
        expect(after, `${slotKey}|${currency}`).toBe(before);
      }
    }
  });

  it('blanks a leg with an explanation citing the ledger', () => {
    const got = applyCoverage(scores(), coverageFor('a1')).get('AUD')!.get('retail-sales')!;
    expect(got.cell).toBeNull();
    expect(got.status).toBe('no-data');
    expect(got.explanation).toMatch(/retail-sales:AUD-a1-has-no-series/);
  });

  it("substitutes the donor's result, re-stamped with the recipient's currency", () => {
    const input = scores();
    const got = applyCoverage(input, coverageFor('a1')).get('CHF')!.get('spmi')!;
    expect(got.cell).toBe(input.get('EUR')!.get('spmi')!.cell);
    expect(got.currency).toBe('CHF');
  });

  it('never mutates the input, which the strength tables also read', () => {
    const input = scores();
    const chfBefore = input.get('CHF')!.get('spmi');
    applyCoverage(input, coverageFor('a1'));
    expect(input.get('CHF')!.get('spmi')).toBe(chfBefore);
  });
});
