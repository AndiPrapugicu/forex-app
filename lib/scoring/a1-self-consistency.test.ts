/**
 * The failure this file exists to prevent is a false accusation.
 *
 * Round thirteen compared A1's `aug. 2026` PPI bucket against a board captured
 * 2026-08-24 — a release that had not happened — and concluded that A1's page
 * contradicted A1's board. The first draft of `a1-self-consistency.ts` made the
 * identical mistake on the identical series before the selection step existed.
 * Every test below is about picking the right release before comparing.
 */

import { describe, expect, it } from 'vitest';

import {
  boardsReleases,
  checkSelfConsistency,
  impliedLeg,
  wasPublishedBy,
  type A1Release,
} from '@/lib/scoring/a1-self-consistency';
import type { Leg } from '@/lib/scoring/a1-legs';
import type { Currency } from '@/lib/types';

const release = (over: Partial<A1Release>): A1Release => ({
  slotKey: 'mpmi',
  currency: 'EUR',
  date: '2026-08-03',
  actual: 52,
  forecast: 51,
  ...over,
});

const legs = (byCurrency: Record<string, Partial<Record<string, Leg>>>) =>
  new Map(Object.entries(byCurrency)) as Map<Currency, Partial<Record<string, Leg>>>;

describe('wasPublishedBy', () => {
  it('admits a release dated on or before the capture', () => {
    expect(wasPublishedBy('2026-08-24', '2026-08-24')).toBe('PUBLISHED');
    expect(wasPublishedBy('2026-08-23', '2026-08-24')).toBe('PUBLISHED');
    expect(wasPublishedBy('2026-08-25', '2026-08-24')).toBe('NOT_YET');
  });

  it('settles a month bucket outside the capture month in both directions', () => {
    expect(wasPublishedBy('2026-07', '2026-08-01')).toBe('PUBLISHED');
    expect(wasPublishedBy('2026-09', '2026-08-31')).toBe('NOT_YET');
  });

  /**
   * THE TRAP, AND IT HAS NOW SPRUNG BOTH WAYS. This case first produced a false
   * accusation (August bucket scored against an August board); the fix asserted
   * that a bucket is never published inside its own month, which is only true if
   * the bucket is a REFERENCE month. A1's are RELEASE months — their GBP PPI
   * `2026-08` pair is our 2026-08-19 release, five days before the board — so
   * the flat denial hid a real disagreement instead.
   *
   * Neither boolean is available. The month is not the day.
   */
  it('refuses to guess a month bucket from the capture month itself', () => {
    expect(wasPublishedBy('2026-08', '2026-08-24')).toBe('AMBIGUOUS');
    expect(wasPublishedBy('2026-08', '2026-08-01')).toBe('AMBIGUOUS');
    expect(wasPublishedBy('2026-08', '2026-08-31')).toBe('AMBIGUOUS');
  });
});

describe('boardsReleases', () => {
  it('keeps only the newest published release per series', () => {
    const older = release({ date: '2026-07-01' });
    const newer = release({ date: '2026-08-03' });
    const future = release({ date: '2026-08-25' });
    const picked = boardsReleases([older, newer, future], '2026-08-24');
    expect([...picked]).toEqual([newer]);
  });

  it('keeps one release per slot AND currency, not one overall', () => {
    const eur = release({ currency: 'EUR', date: '2026-08-03' });
    const gbp = release({ currency: 'GBP', date: '2026-07-01' });
    const picked = boardsReleases([eur, gbp], '2026-08-24');
    expect(picked.size).toBe(2);
  });
});

describe('impliedLeg', () => {
  it('is the raw sign of actual minus forecast, with no dead band', () => {
    expect(impliedLeg(release({ actual: 51.5, forecast: 51.6 }))).toBe(-1);
    expect(impliedLeg(release({ actual: 51.6, forecast: 51.5 }))).toBe(1);
  });

  it('scores an exact match as its own category', () => {
    // Their PPI chart renders Met as a third series, not as a tail.
    expect(impliedLeg(release({ actual: 4, forecast: 4 }))).toBe(0);
  });

  it('inverts for unemployment, where a higher print is worse', () => {
    expect(impliedLeg(release({ slotKey: 'unemployment', actual: 3.2, forecast: 3.0 }))).toBe(-1);
  });

  it('declines to score a release their page gives no forecast for', () => {
    expect(impliedLeg(release({ forecast: null }))).toBeNull();
  });
});

describe('checkSelfConsistency', () => {
  const ours = new Map();

  it('neither accuses nor exonerates A1 over an undated month bucket', () => {
    // The historical false positive AND its overcorrection, on one series.
    // Their August PPI bucket implies -1 and their board printed +1; whether
    // that is a contradiction turns on a release DAY their chart never prints.
    // The verdict must say exactly that and no more.
    const rows = checkSelfConsistency({
      releases: [
        release({ slotKey: 'ppi', currency: 'GBP', date: '2026-08', actual: 3.1, forecast: 3.2 }),
        release({ slotKey: 'ppi', currency: 'GBP', date: '2026-07', actual: 3.5, forecast: null }),
      ],
      printedLegs: legs({ GBP: { ppi: 1 } }),
      ours,
      capturedOn: '2026-08-24',
    });
    const august = rows.find((r) => r.date === '2026-08')!;
    expect(august.verdict).toBe('A1_RELEASE_DATE_AMBIGUOUS');
    expect(august.impliedLeg).toBe(-1);
    expect(august.note).toContain('CONTRADICT');
    // Still no accusation: an ambiguous row is not a condemnation.
    expect(rows.some((r) => r.verdict === 'A1_CONTRADICTS_ITSELF')).toBe(false);
  });

  it('does not let an ambiguous bucket promote an older release in its place', () => {
    // The older July bucket must NOT become "the board's release" just because
    // the August one could not be resolved — that substitution is what made the
    // previous rule report a clean bill of health.
    const rows = checkSelfConsistency({
      releases: [
        release({ slotKey: 'ppi', currency: 'GBP', date: '2026-08', actual: 3.1, forecast: 3.2 }),
        release({ slotKey: 'ppi', currency: 'GBP', date: '2026-07', actual: 3.5, forecast: null }),
      ],
      printedLegs: legs({ GBP: { ppi: 1 } }),
      ours,
      capturedOn: '2026-08-24',
    });
    expect(rows.find((r) => r.date === '2026-07')!.verdict).toBe('NOT_THE_BOARDS_RELEASE');
  });

  it('reports a missing forecast rather than treating it as a zero', () => {
    const [row] = checkSelfConsistency({
      releases: [release({ slotKey: 'ppi', currency: 'GBP', date: '2026-07', forecast: null })],
      printedLegs: legs({ GBP: { ppi: 1 } }),
      ours,
      capturedOn: '2026-08-24',
    });
    expect(row.verdict).toBe('A1_NO_FORECAST');
    expect(row.impliedLeg).toBeNull();
  });

  it('condemns a cell their own dated release genuinely contradicts', () => {
    const [row] = checkSelfConsistency({
      releases: [release({ actual: 51.9, forecast: 52 })],
      printedLegs: legs({ EUR: { mpmi: 1 } }),
      ours,
      capturedOn: '2026-08-24',
    });
    expect(row.verdict).toBe('A1_CONTRADICTS_ITSELF');
    expect(row.impliedLeg).toBe(-1);
    expect(row.printedLeg).toBe(1);
  });

  it('calls a matching cell with differing inputs a feed difference, not a rule difference', () => {
    // GBP mPMI: their 51.6 forecast against our 51.5. Their cell is right by
    // their data, so nothing in our scoring is wrong — only the number it read.
    const [row] = checkSelfConsistency({
      releases: [release({ currency: 'GBP', date: '2026-08-21', actual: 51.5, forecast: 51.6 })],
      printedLegs: legs({ GBP: { mpmi: -1 } }),
      ours: new Map([
        ['mpmi|GBP', { actual: 51.5, reference: 51.5, referenceLabel: 'forecast' as const }],
      ]),
      capturedOn: '2026-08-24',
    });
    expect(row.verdict).toBe('A1_SELF_CONSISTENT');
    expect(row.source).toBe('REFERENCE_DIFFERS');
  });

  it('says so when the board pins no leg to check against', () => {
    const [row] = checkSelfConsistency({
      releases: [release({ currency: 'CHF' })],
      printedLegs: legs({}),
      ours,
      capturedOn: '2026-08-24',
    });
    expect(row.verdict).toBe('NO_LEG_SOLVED');
  });
});
