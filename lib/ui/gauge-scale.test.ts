import { describe, expect, it } from 'vitest';
import { BIAS_THRESHOLDS } from '@/config/setups.config';
import { bandStrength, bandedFraction, biasBandEdges } from '@/lib/ui/gauge-scale';

const MINIMA = BIAS_THRESHOLDS.map((t) => t.min);

describe('biasBandEdges', () => {
  it('puts a boundary half a point below each cut', () => {
    expect(biasBandEdges(34, MINIMA)).toEqual([-34, -6.5, -3.5, 3.5, 6.5, 34]);
  });

  it('drops the open-ended band and keeps the edges ascending', () => {
    const edges = biasBandEdges(34, MINIMA);
    expect(edges).toHaveLength(6);
    for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
  });

  it('clamps cuts that sit outside a small dial', () => {
    const edges = biasBandEdges(5, MINIMA);
    expect(edges).toEqual([-5, -5, -3.5, 3.5, 5, 5]);
    for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThanOrEqual(edges[i - 1]);
  });
});

describe('bandedFraction', () => {
  const edges = biasBandEdges(34, MINIMA);

  it('puts zero in the middle', () => {
    expect(bandedFraction(0, edges)).toBeCloseTo(0.5, 10);
  });

  it('is antisymmetric', () => {
    for (const score of [1, 4, 7, 12, 30]) {
      expect(bandedFraction(score, edges) + bandedFraction(-score, edges)).toBeCloseTo(1, 10);
    }
  });

  it('gives each band a fifth of the dial', () => {
    // The boundaries themselves land exactly on the band divisions.
    expect(bandedFraction(-6.5, edges)).toBeCloseTo(0.2, 10);
    expect(bandedFraction(-3.5, edges)).toBeCloseTo(0.4, 10);
    expect(bandedFraction(3.5, edges)).toBeCloseTo(0.6, 10);
    expect(bandedFraction(6.5, edges)).toBeCloseTo(0.8, 10);
  });

  it('moves a Very Bearish score well off centre, which the linear dial did not', () => {
    // -9 on a linear ±34 dial sat at 0.37 — barely left of the middle.
    expect(bandedFraction(-9, edges)).toBeLessThan(0.2);
    expect(bandedFraction(-9, edges)).toBeGreaterThan(0.1);
  });

  it('clamps beyond the model maximum', () => {
    expect(bandedFraction(-99, edges)).toBe(0);
    expect(bandedFraction(99, edges)).toBe(1);
  });

  it('never divides by a collapsed band', () => {
    const tight = biasBandEdges(5, MINIMA);
    for (const score of [-9, -5, -4, 0, 4, 5, 9]) {
      const f = bandedFraction(score, tight);
      expect(Number.isFinite(f)).toBe(true);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe('bandStrength', () => {
  it('is zero in the middle and full at the ends', () => {
    expect(bandStrength(2, 5)).toBe(0);
    expect(bandStrength(0, 5)).toBe(1);
    expect(bandStrength(4, 5)).toBe(1);
  });

  it('is symmetric around the middle', () => {
    expect(bandStrength(1, 5)).toBeCloseTo(bandStrength(3, 5), 10);
  });
});
