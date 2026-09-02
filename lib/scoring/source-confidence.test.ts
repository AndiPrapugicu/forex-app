/**
 * The ledger's own invariants.
 *
 * These do not check that a grade is RIGHT — no test can. They check that a
 * grade cannot be written down without the thing that earns it, which is the
 * failure mode this file exists to prevent: a claim recorded confidently with
 * nothing behind it.
 */

import { describe, expect, it } from 'vitest';

import { SCORING_SLOTS } from '@/config/setups.config';
import {
  SOURCE_CONFIDENCE,
  byConfidence,
  slotsWithoutSource,
  sourceFor,
} from '@/lib/scoring/source-confidence';

describe('the source-confidence ledger', () => {
  it('covers every scoring slot', () => {
    expect(slotsWithoutSource()).toEqual([]);
    expect(SCORING_SLOTS.length).toBe(18);
  });

  it('has no duplicate keys', () => {
    const keys = SOURCE_CONFIDENCE.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('requires a dated observation behind anything but UNKNOWN', () => {
    for (const entry of SOURCE_CONFIDENCE) {
      if (entry.confidence === 'UNKNOWN') continue;
      expect(entry.evidenceDates.length, entry.key).toBeGreaterThan(0);
    }
  });

  it('requires every evidence date to be a real ISO date', () => {
    for (const entry of SOURCE_CONFIDENCE) {
      for (const date of entry.evidenceDates) {
        expect(date, `${entry.key} ${date}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(date)), `${entry.key} ${date}`).toBe(false);
      }
    }
  });

  it('requires BLOCKED to name what is missing', () => {
    for (const entry of byConfidence().BLOCKED) {
      expect(entry.blocker, entry.key).toBeTruthy();
    }
  });

  it('requires every entry to say something specific about the evidence', () => {
    for (const entry of SOURCE_CONFIDENCE) {
      // A one-line "matches" is how a SUPPORTED claim becomes a CONFIRMED one
      // in the retelling. The entry has to carry the measurement.
      expect(entry.evidence.length, entry.key).toBeGreaterThan(60);
    }
  });

  it('keeps the two rates entries separate, and names the asset instrument exactly', () => {
    // The whole point of splitting them: the 21-day-SMA rule is attested for
    // asset rows and IS falsified for FX legs. One row in this ledger could not
    // hold both facts, and collapsing them is exactly how the rejected theory
    // came back twice.
    expect(sourceFor('rates')?.confidence).toBe('SUPPORTED');
    expect(sourceFor('rates:assets')?.a1Source).toContain('US02Yield (21 day SMA)');
    // The FX entry has to keep naming both falsified candidates, or one of them
    // comes back a third time.
    expect(sourceFor('rates')?.evidence).toContain('FALSIFIED');
    expect(sourceFor('rates')?.evidence).toContain('21-day');
  });

  it('does not let the asset rates entry drift back to CONFIRMED unexamined', () => {
    // It WAS CONFIRMED, on an input that turned out to be the wrong instrument:
    // a futures quote 24bp from the constant-maturity yield their label names,
    // compared against twelve sessions of stalled closes. The grade came back
    // down when the series was corrected and the board-date cell stopped
    // matching. Restoring it needs a second dated Asset Scorecard row, not a
    // reread of this file.
    const assets = sourceFor('rates:assets');
    expect(assets?.confidence).toBe('SUPPORTED');
    expect(assets?.a1Source).toContain('CONSTANT-MATURITY');
    expect(assets?.ourSource).toContain('DGS2');
    expect(assets?.evidence).toContain('DOWNGRADED');
  });
  it('grades the crowd column CONFIRMED on more than one date', () => {
    const crowd = sourceFor('crowd');
    expect(crowd?.confidence).toBe('CONFIRMED');
    expect(crowd?.evidenceDates.length).toBeGreaterThan(1);
  });

  it('keeps DXY crowd BLOCKED rather than derived', () => {
    const dxy = sourceFor('crowd:dxy');
    expect(dxy?.confidence).toBe('BLOCKED');
    expect(dxy?.blocker).toContain('dollar index');
  });

  it('claims leg-differencing is confirmed only on the over-determined proof', () => {
    // Upgraded SUPPORTED -> CONFIRMED on 2026-08-30, and NOT because more
    // columns fitted. "Sixteen of eighteen columns solve consistently" is a fit,
    // and a fit is what this grade is supposed to refuse. What earned the
    // upgrade is a measurement that does not assume the conclusion: the metals
    // read the dollar leg DIRECTLY, so comparing them against EURX - EURUSD
    // tests differencing instead of presupposing it.
    const entry = sourceFor('structure:leg-differencing');
    expect(entry?.confidence).toBe('CONFIRMED');
    expect(entry?.evidence).toContain('13 of');
    // The grade covers the economic block only. Trend, seasonality, COT and
    // crowd come from the index instrument and are not differenced.
    expect(entry?.evidence).toContain('ECONOMIC block');
  });
});
