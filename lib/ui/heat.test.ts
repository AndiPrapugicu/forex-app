import { describe, expect, it } from 'vitest';
import { HEAT_MIN_ALPHA, heatAlpha, heatStyle } from './heat';

describe('heatStyle', () => {
  it('paints nothing for a missing value', () => {
    expect(heatStyle(null)).toEqual({});
    expect(heatStyle(undefined)).toEqual({});
    expect(heatStyle(Number.NaN)).toEqual({});
  });

  it('paints a measured zero grey by default, and nothing when asked not to', () => {
    expect(heatStyle(0).backgroundColor).toBe('var(--color-heat-zero)');
    expect(heatStyle(0, { zeroGrey: false })).toEqual({});
  });

  it('paints a discrete score solid, blue up and red down, with white text', () => {
    expect(heatStyle(1)).toEqual({ backgroundColor: 'rgb(var(--color-heat-bull-rgb) / 100%)', color: '#fff' });
    expect(heatStyle(-2)).toEqual({ backgroundColor: 'rgb(var(--color-heat-bear-rgb) / 100%)', color: '#fff' });
  });

  it('fades a continuous value by magnitude and caps at full strength', () => {
    expect(heatAlpha(0.0001, 10)).toBeCloseTo(HEAT_MIN_ALPHA, 2);
    expect(heatAlpha(5, 10)).toBeCloseTo(0.65, 2);
    expect(heatAlpha(50, 10)).toBe(1);
    expect(heatStyle(1, { max: 10 }).color).toBe('var(--color-text)');
    expect(heatStyle(9, { max: 10 }).color).toBe('#fff');
  });

  it('treats values inside the deadband as zero', () => {
    expect(heatStyle(0.04, { deadband: 0.05 }).backgroundColor).toBe('var(--color-heat-zero)');
  });
});
