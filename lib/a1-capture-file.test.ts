import { describe, expect, it } from 'vitest';

import { captureMoment, isCaptureFresh, MIRROR_CAPTURE_MAX_AGE_DAYS } from '@/lib/a1-capture-file';

describe('capture freshness for the mirror', () => {
  it('reads the moment from the filename parts, untimed as midnight UTC', () => {
    expect(captureMoment('2026-09-02', '1446').toISOString()).toBe('2026-09-02T14:46:00.000Z');
    expect(captureMoment('2026-09-01', '0000').toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  /** The case that prompted it: the 09-02 board was still being mirrored on 09-15. */
  it('refuses the 2026-09-02 14:46 capture on 2026-09-15', () => {
    expect(isCaptureFresh('2026-09-02', '1446', new Date('2026-09-15T12:00:00Z'))).toBe(false);
  });

  it('accepts a capture up to the maximum age, and not a minute beyond', () => {
    const at = captureMoment('2026-09-10', '0900');
    const edge = new Date(at.getTime() + MIRROR_CAPTURE_MAX_AGE_DAYS * 86_400_000);
    expect(isCaptureFresh('2026-09-10', '0900', edge)).toBe(true);
    expect(isCaptureFresh('2026-09-10', '0900', new Date(edge.getTime() + 60_000))).toBe(false);
  });
});
