import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { HEATMAP_COUNTRY, HEATMAP_ROW_TO_COLUMN } from '@/lib/scoring/a1-symbol-map';
import {
  comparePairAndIndexLegs,
  parseCapture,
  type ColumnComparison,
} from '@/lib/scoring/a1-pair-legs';
import type { Currency } from '@/lib/types';

/**
 * Both captures, deliberately.
 *
 * The round that produced this module also produced the rule that a finding
 * measured on one capture is a finding about that capture. Every assertion here
 * runs against 2026-08-31 and 2026-09-01, which were taken a day apart from a
 * board that moved 13 of 972 cells in between — so an agreement across both is
 * evidence about their model rather than about one screen.
 */
const CAPTURES = ['a1-top-setups-2026-08-31.csv', 'a1-top-setups-2026-09-01.csv'] as const;

const load = (file: string) =>
  parseCapture(readFileSync(path.join(process.cwd(), 'fixtures', file), 'utf8'), file);

const columnsFor = (file: string) => {
  const byKey = new Map<string, ColumnComparison>();
  for (const c of comparePairAndIndexLegs(load(file))) byKey.set(c.slotKey, c);
  return byKey;
};

describe.each(CAPTURES)('A1 pair legs vs index legs (%s)', (file) => {
  const columns = columnsFor(file);

  it('reads the whole board', () => {
    expect(load(file).rows.size).toBe(54);
  });

  /**
   * The headline. Four columns are one column published twice; four are not,
   * and each of the four fails in its own way. Pinning the CLASSIFICATION
   * rather than the leg values means a capture where A1 fixes PPI fails this
   * test loudly, which is the event we most want to hear about.
   */
  it.each([
    ['gdp', 'IDENTICAL'],
    ['spmi', 'IDENTICAL'],
    ['retail-sales', 'IDENTICAL'],
    ['cpi', 'IDENTICAL'],
    ['ppi', 'NEGATED'],
    ['consumer-confidence', 'INDEX_BLANK'],
    ['mpmi', 'UNSOLVABLE'],
    ['pce', 'UNSOLVABLE'],
  ])('classifies %s as %s', (slotKey, agreement) => {
    expect(columns.get(slotKey)?.agreement).toBe(agreement);
  });

  /**
   * The pair rows are NOT noise. This is the assertion that overturned
   * "A1's pair rows are broken on four columns" — on six of the eight a single
   * leg vector reproduces every pair row exactly, which a broken surface cannot
   * do. What differs is WHICH vector, not whether there is one.
   */
  it('finds a leg vector that explains every pair row on six of the eight columns', () => {
    const exact = [...columns.values()].filter((c) => c.pairsExplained === c.pairsTotal);
    expect(exact.map((c) => c.slotKey).sort()).toEqual(
      ['consumer-confidence', 'cpi', 'gdp', 'ppi', 'retail-sales', 'spmi'],
    );
  });

  it('has PPI pair legs that are the exact negation of the index legs', () => {
    const ppi = columns.get('ppi')!;
    for (const currency of Object.keys(ppi.pairLegs) as Currency[]) {
      const index = ppi.indexLegs[currency];
      if (index === undefined) continue;
      // Summed rather than negated: `toBe(-0)` fails against a `+0` leg.
      expect((ppi.pairLegs[currency] as number) + index).toBe(0);
    }
    // Not vacuous: six of the eight legs are actually non-zero and flip.
    expect(ppi.differing).toHaveLength(6);
  });

  /**
   * The number that makes the PPI finding worth acting on. Their own index
   * rows reproduce only 7 of their own 28 pair rows — and those 7 are the ones
   * where both legs are zero, so the surfaces agree only where neither says
   * anything.
   */
  it('shows the two PPI surfaces agreeing only where both legs are blank', () => {
    const ppi = columns.get('ppi')!;
    expect(ppi.pairsExplainedByIndexLegs).toBe(7);
    expect(ppi.pairsExplained).toBe(ppi.pairsTotal);
  });

  /**
   * Consumer confidence is the mirror image of PPI and the reason this module
   * is not simply "their pair board is wrong": here the INDEX rows are the
   * blank surface, and their pair board carries a leg for all eight economies.
   */
  it('has consumer-confidence legs on the pair board that the index rows omit', () => {
    const cc = columns.get('consumer-confidence')!;
    expect(cc.pairsExplained).toBe(cc.pairsTotal);
    expect(cc.differing.every((d) => d.index === 0 && d.pair !== 0)).toBe(true);
    expect(cc.differing.map((d) => d.currency).sort()).toEqual(
      ['AUD', 'CAD', 'CHF', 'GBP', 'JPY', 'NZD'],
    );
    // The one leg both surfaces carry, and they agree on it.
    expect(cc.pairLegs.USD).toBe(-1);
    expect(cc.indexLegs.USD).toBe(-1);
  });

  /**
   * mPMI is the column with no story. Recorded as a bound rather than a value
   * so a future capture that resolves it fails here and gets looked at.
   */
  it('cannot fit any leg vector to mPMI', () => {
    const mpmi = columns.get('mpmi')!;
    expect(mpmi.pairsExplained).toBeLessThan(mpmi.pairsTotal);
    expect(mpmi.differing).toHaveLength(0); // suppressed: an unsolved column names no legs
  });
});

/**
 * WHY THE PPI FLIP HAPPENS, checked against their own heatmap rather than
 * asserted in a comment.
 *
 * A1's country heatmap publishes `currencyImpact` and `stocksImpact` for every
 * release. Their index rows follow the first and their pair rows follow the
 * second, and the two are opposite whenever either is non-neutral — which is
 * the whole of the "global sign flip" earlier rounds recorded as unexplained.
 */
describe('the PPI flip is A1 reading the stocks impact', () => {
  const IMPACT: Record<string, number> = { Bullish: 1, Bearish: -1, Neutral: 0 };

  const heatmap = () => {
    const text = readFileSync(
      path.join(process.cwd(), 'fixtures', 'a1-economic-heatmaps-2026-08-31.csv'),
      'utf8',
    );
    const lines = text.trim().split(/\r?\n/);
    const head = lines[0].split(',');
    return lines.slice(1).map((line) => {
      const values = line.split(',');
      return Object.fromEntries(head.map((h, i) => [h, values[i]])) as Record<string, string>;
    });
  };

  it('matches every PPI leg on both surfaces to the right impact column', () => {
    const columns = columnsFor('a1-top-setups-2026-08-31.csv');
    const ppi = columns.get('ppi')!;

    const checked: string[] = [];
    for (const row of heatmap()) {
      if (HEATMAP_ROW_TO_COLUMN[Number.parseInt(row.row, 10)] !== 'PPI') continue;
      const currency = HEATMAP_COUNTRY[row.country] as Currency | undefined;
      if (!currency) continue;

      expect(ppi.indexLegs[currency]).toBe(IMPACT[row.currencyImpact]);
      expect(ppi.pairLegs[currency]).toBe(IMPACT[row.stocksImpact]);
      checked.push(row.country);
    }

    expect(checked.sort()).toEqual(['AU', 'CA', 'CH', 'EU', 'JP', 'NZ', 'UK', 'US']);
  });

  /**
   * And the tiebreak, which is not a vote. UK PPI printed 3.1 against a 3.2
   * forecast: a miss, and a miss is bearish for the currency that missed. The
   * heatmap's own `currencyImpact` says Bearish, our engine scores -1, and only
   * their pair board disagrees. The index surface is right on the merits.
   */
  it('sides with the index surface on the release itself', () => {
    const uk = heatmap().find(
      (r) => r.country === 'UK' && HEATMAP_ROW_TO_COLUMN[Number.parseInt(r.row, 10)] === 'PPI',
    )!;
    expect(Number(uk.actual)).toBeLessThan(Number(uk.forecast));
    expect(uk.currencyImpact).toBe('Bearish');
    expect(uk.stocksImpact).toBe('Bullish');
  });
});
