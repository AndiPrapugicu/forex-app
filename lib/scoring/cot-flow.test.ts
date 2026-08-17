/**
 * COT weekly flow.
 *
 * The failures worth guarding against are all interpretive rather than
 * arithmetic: reading a two-sided build as buying because the long book grew,
 * calling a short-covering rally a fresh long, and ranking gold above the kiwi
 * every week because gold trades more contracts.
 */

import { describe, expect, it } from 'vitest';
import { COT_FLOW_BANDS } from '@/config/setups.config';
import { readCotFlow } from '@/lib/scoring/cot-flow';
import type { CotReport, CotSeries } from '@/lib/connectors/cftc';

function report(o: Partial<CotReport> & { specLong: number; specShort: number }): CotReport {
  const specNet = o.specLong - o.specShort;
  const total = o.specLong + o.specShort;
  return {
    contract: 'TEST',
    reportDate: '2026-08-04',
    specNet,
    specLongPct: total > 0 ? (o.specLong / total) * 100 : 50,
    commLong: 0,
    commShort: 0,
    commNet: 0,
    retailLong: 0,
    retailShort: 0,
    retailNet: 0,
    retailLongPct: 50,
    openInterest: null,
    openInterestChange: null,
    specNetChange: (o.specLongChange ?? 0) - (o.specShortChange ?? 0),
    specLongChange: 0,
    specShortChange: 0,
    specLongPctChange: null,
    ...o,
  } as CotReport;
}

/** A latest report plus `weeks` of prior history at a given typical net change. */
function series(latest: CotReport, weeks = 100, typicalChange = 1000): CotSeries {
  const history = Array.from({ length: weeks }, (_, i) =>
    report({
      specLong: 50_000,
      specShort: 50_000,
      specLongChange: i % 2 === 0 ? typicalChange : -typicalChange,
      specShortChange: 0,
      specNetChange: i % 2 === 0 ? typicalChange : -typicalChange,
    }),
  );
  return { contract: 'TEST', reports: [latest, ...history] };
}

describe('the four quadrants', () => {
  const cases = [
    { longChange: 5_000, shortChange: -5_000, kind: 'accumulation', direction: 'buying' },
    { longChange: -5_000, shortChange: 5_000, kind: 'distribution', direction: 'selling' },
    { longChange: 9_000, shortChange: 4_000, kind: 'expansion', direction: 'buying' },
    { longChange: -9_000, shortChange: -4_000, kind: 'liquidation', direction: 'selling' },
  ] as const;

  for (const c of cases) {
    it(`reads Δlong ${c.longChange} / Δshort ${c.shortChange} as ${c.kind}`, () => {
      const flow = readCotFlow(
        series(
          report({
            specLong: 60_000,
            specShort: 40_000,
            specLongChange: c.longChange,
            specShortChange: c.shortChange,
            specNetChange: c.longChange - c.shortChange,
          }),
        ),
      )!;

      expect(flow.kind).toBe(c.kind);
      expect(flow.direction).toBe(c.direction);
    });
  }

  it('does NOT call a two-sided build where shorts grew faster "buying"', () => {
    /**
     * The SPX case from the live board: +24,848 longs and +34,910 shorts. The
     * long book grew, so a naive Δlong-only reading calls this bullish. Net is
     * −10,062 — specs sold.
     */
    const flow = readCotFlow(
      series(
        report({
          specLong: 282_551,
          specShort: 309_809,
          specLongChange: 24_848,
          specShortChange: 34_910,
          specNetChange: -10_062,
        }),
      ),
    )!;

    expect(flow.kind).toBe('expansion');
    expect(flow.direction).toBe('selling');
    expect(flow.longChange).toBeGreaterThan(0);
  });
});

describe('strength is relative to the contract, not absolute', () => {
  const week = report({
    specLong: 60_000,
    specShort: 40_000,
    specLongChange: 5_000,
    specShortChange: 0,
    specNetChange: 5_000,
  });

  it('calls 5,000 contracts extreme in a market that normally moves 1,000', () => {
    expect(readCotFlow(series(week, 100, 1_000))!.strength).toBe('extreme');
  });

  it('calls the SAME 5,000 contracts routine in a market that normally moves 50,000', () => {
    // Identical filing, opposite verdict — which is the entire point.
    expect(readCotFlow(series(week, 100, 50_000))!.strength).toBe('routine');
  });

  it('ranks against prior weeks only, so the top band is reachable', () => {
    /**
     * Including this week in its own comparison set caps the percentile below
     * 100 and makes `extreme` unreachable for a contract with long history.
     */
    const flow = readCotFlow(series(week, 200, 1_000))!;
    expect(flow.percentile).toBeGreaterThanOrEqual(COT_FLOW_BANDS.extreme);
    expect(flow.sampleWeeks).toBe(200);
  });
});

describe('position context', () => {
  it('calls heavy buying into a net short a squeeze, not a fresh long', () => {
    /**
     * JPY's real filing. Reading +117,939 as "specs are long yen" would be
     * exactly wrong — they are still short 45,473 and covering hard.
     */
    const flow = readCotFlow(
      series(
        report({
          specLong: 147_228,
          specShort: 192_701,
          specLongChange: 45_957,
          specShortChange: -71_982,
          specNetChange: 117_939,
        }),
        150,
        20_000,
      ),
    )!;

    expect(flow.kind).toBe('accumulation');
    expect(flow.againstPosition).toBe(true);
    expect(flow.netAfter).toBeLessThan(0);
    expect(flow.sentence).toContain('Still net short');
    expect(flow.sentence).toContain('squeeze');
  });

  it('calls buying that adds to a net long exactly that', () => {
    const flow = readCotFlow(
      series(
        report({
          specLong: 227_013,
          specShort: 29_379,
          specLongChange: 7_391,
          specShortChange: -8_173,
          specNetChange: 15_564,
        }),
      ),
    )!;

    expect(flow.againstPosition).toBe(false);
    expect(flow.sentence).toContain('adds to an existing net long');
  });

  it('spots the week the book flipped sides', () => {
    // Was net short 2,000; bought 5,000; now net long 3,000.
    const flow = readCotFlow(
      series(
        report({
          specLong: 51_500,
          specShort: 48_500,
          specLongChange: 5_000,
          specShortChange: 0,
          specNetChange: 5_000,
        }),
      ),
    )!;

    expect(flow.flipped).toBe(true);
    expect(flow.sentence).toContain('flips the book net long');
  });

  it('does not claim a flip when the book merely grew from zero', () => {
    const flow = readCotFlow(
      series(
        report({
          specLong: 55_000,
          specShort: 50_000,
          specLongChange: 5_000,
          specShortChange: 0,
          specNetChange: 5_000,
        }),
      ),
    )!;
    // netBefore was exactly 0, which is not a side to have flipped from.
    expect(flow.flipped).toBe(false);
  });
});

describe('refusals', () => {
  it('returns null when there is no prior week to difference', () => {
    const only = report({
      specLong: 10_000,
      specShort: 5_000,
      specLongChange: null,
      specShortChange: null,
    });
    expect(readCotFlow({ contract: 'TEST', reports: [only] })).toBeNull();
  });

  it('returns null for an empty series', () => {
    expect(readCotFlow({ contract: 'TEST', reports: [] })).toBeNull();
  });

  it('says so plainly when nothing moved', () => {
    const flow = readCotFlow(
      series(report({ specLong: 10_000, specShort: 5_000, specLongChange: 0, specShortChange: 0 })),
    )!;

    expect(flow.kind).toBe('flat');
    expect(flow.headline).toBe('No change');
  });

  it('flags a thin history rather than claiming a record', () => {
    const flow = readCotFlow(
      series(
        report({
          specLong: 60_000,
          specShort: 40_000,
          specLongChange: 99_999,
          specShortChange: 0,
          specNetChange: 99_999,
        }),
        8,
        100,
      ),
    )!;

    expect(flow.sentence).toContain('only 8 weeks of history');
  });

  it('returns null when the weekly deltas are absent, not merely null', () => {
    /**
     * REGRESSION. `specLongChange` and `specShortChange` postdate
     * `fixtures/sample-cot.json`, so in offline mode they arrive `undefined`.
     * The old guard tested `=== null`, which `undefined` walks straight past —
     * and the subtraction downstream yields NaN without throwing, so this
     * function returned a complete, confident narrative built on nothing.
     */
    const latest = report({ specLong: 60_000, specShort: 40_000 });
    delete (latest as Partial<CotReport>).specLongChange;
    delete (latest as Partial<CotReport>).specShortChange;

    expect(readCotFlow(series(latest, 20, 500))).toBeNull();
  });

  it('returns null for a null delta as well', () => {
    const latest = report({ specLong: 60_000, specShort: 40_000 });
    latest.specLongChange = null;

    expect(readCotFlow(series(latest, 20, 500))).toBeNull();
  });
});
