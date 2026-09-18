import { describe, expect, it } from 'vitest';
import { axisTicks, scaleDomain } from '@/lib/ui/chart-scale';

describe('scaleDomain', () => {
  it('uses a fixed domain verbatim, which is what put-call needs', () => {
    // The live bug: two sessions at 1.48 and 1.55 auto-scaled to an axis that
    // put the 1.07 and 1.20 bands off the bottom of the plot.
    expect(scaleDomain([1.48, 1.55], { domain: [0, 1.6] })).toEqual([0, 1.6]);
  });

  it('pads the data extent when no domain is given', () => {
    const [lo, hi] = scaleDomain([0, 10], { pad: 0.1 });
    expect(lo).toBeCloseTo(-1);
    expect(hi).toBeCloseTo(11);
  });

  it('keeps a band inside the axis through `include`', () => {
    const [lo, hi] = scaleDomain([1.48, 1.55], { include: [1.07, 1.2], pad: 0 });
    expect(lo).toBe(1.07);
    expect(hi).toBe(1.55);
  });

  it('gives a flat series a range instead of dividing by zero', () => {
    expect(scaleDomain([3, 3], { pad: 0 })).toEqual([2, 4]);
  });

  it('falls back to 0..1 with nothing to scale', () => {
    expect(scaleDomain([])).toEqual([0, 1]);
  });
});

describe('axisTicks', () => {
  it('rounds to steps a person would pick', () => {
    expect(axisTicks(0, 1.6, 5)).toEqual([0, 0.5, 1, 1.5]);
    expect(axisTicks(0, 100, 5)).toEqual([0, 50, 100]);
  });

  it('spans a negative-to-positive axis through zero', () => {
    expect(axisTicks(-100, 100, 5)).toContain(0);
  });

  it('never returns a broken axis', () => {
    expect(axisTicks(5, 5)).toEqual([5, 5]);
    expect(axisTicks(Number.NaN, 1)).toEqual([Number.NaN, 1]);
  });
});
