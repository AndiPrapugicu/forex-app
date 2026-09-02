/**
 * The rate-projection seam, and the two things it must never do: serve a
 * snapshot to a date that predates it, and get wired into production before a
 * historical snapshot exists.
 *
 * Both failures would LOOK like progress. Using today's projection for the
 * 2026-08-24 board closes the EURCHF rates mismatch outright — and the number it
 * closes it with was measured six days after the board, which is the same defect
 * `trend:as-of` and `cot:publication-lag` already cost this repo two rounds to
 * find. The tests below exist so that closing it that way fails loudly.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import snapshotsFixture from '@/fixtures/a1-rate-projections.json';
import {
  PROJECTION_MAX_STALENESS_DAYS,
  quarterOf,
  resolveConsensusProjectionLegs,
  resolveProjection,
  snapshotFor,
  type RateProjectionSnapshot,
} from '@/lib/scoring/rate-projections';
import type { Currency } from '@/lib/types';

const HELD = (snapshotsFixture as { snapshots: RateProjectionSnapshot[] }).snapshots;

const snap = (over: Partial<RateProjectionSnapshot> = {}): RateProjectionSnapshot => ({
  observedAt: '2026-08-30',
  sourceUpdatedAt: null,
  source: 'test',
  provenance: 'test',
  policyRates: { EUR: 2.4, CHF: 0, USD: 3.75 },
  projectionsByQuarter: { '2026Q3': { EUR: 2.65, CHF: 0, USD: 3.75 } },
  ...over,
});

describe('quarterOf', () => {
  it('maps a date to the quarter their page publishes it under', () => {
    expect(quarterOf('2026-01-01')).toBe('2026Q1');
    expect(quarterOf('2026-03-31')).toBe('2026Q1');
    expect(quarterOf('2026-08-24')).toBe('2026Q3');
    expect(quarterOf('2026-12-31')).toBe('2026Q4');
  });
});

describe('snapshotFor', () => {
  it('reads strictly backwards and never forwards', () => {
    const older = snap({ observedAt: '2026-08-10' });
    const newer = snap({ observedAt: '2026-08-30' });
    expect(snapshotFor([older, newer], '2026-08-24')).toBe(older);
    expect(snapshotFor([older, newer], '2026-09-01')).toBe(newer);
    expect(snapshotFor([newer], '2026-08-24')).toBeNull();
  });
});

describe('resolveProjection', () => {
  it("scores A1's own rule where a snapshot covers the date", () => {
    const on = '2026-09-01';
    expect(resolveProjection([snap()], 'EUR', on).cell).toBe(1);
    // A projection level with the standing rate is a genuine 0, not a missing
    // answer — no deadband, exactly as the economic columns work.
    expect(resolveProjection([snap()], 'USD', on).cell).toBe(0);
    expect(resolveProjection([snap()], 'CHF', on).cell).toBe(0);
  });

  /**
   * THE CENTRAL GUARD. Today's snapshot must not answer for a past board, and
   * the refusal must be a named state rather than a null that reads like "no
   * data" and gets quietly defaulted to something.
   */
  it('refuses a date that predates every snapshot held', () => {
    const lookup = resolveProjection([snap({ observedAt: '2026-08-30' })], 'EUR', '2026-08-24');
    expect(lookup.status).toBe('NO_SNAPSHOT_YET');
    expect(lookup.cell).toBeNull();
    expect(lookup.projection).toBeNull();
    expect(lookup.explanation).toContain('2026-08-30');
  });

  it('refuses a snapshot older than the staleness window', () => {
    const stale = snap({ observedAt: '2026-01-01' });
    const lookup = resolveProjection([stale], 'EUR', '2026-08-24');
    expect(lookup.status).toBe('SNAPSHOT_TOO_STALE');
    expect(lookup.cell).toBeNull();
    // The boundary itself is usable; one day past it is not.
    const edge = new Date('2026-08-24T00:00:00Z');
    edge.setUTCDate(edge.getUTCDate() - PROJECTION_MAX_STALENESS_DAYS);
    const onTheEdge = snap({ observedAt: edge.toISOString().slice(0, 10) });
    expect(resolveProjection([onTheEdge], 'EUR', '2026-08-24').status).toBe('FOUND');
  });

  it('names which part is missing rather than collapsing them into one null', () => {
    expect(resolveProjection([snap()], 'JPY', '2026-09-01').status).toBe('CURRENCY_NOT_COVERED');
    // Quarter passed explicitly: a date far enough away to fall outside the
    // snapshot's quarters is also outside its staleness window, and staleness
    // is checked first by design.
    expect(resolveProjection([snap()], 'EUR', '2026-09-01', '2027Q1').status).toBe(
      'QUARTER_NOT_COVERED',
    );
    const noPolicy = snap({ policyRates: {} });
    expect(resolveProjection([noPolicy], 'EUR', '2026-09-01').status).toBe('POLICY_RATE_NOT_COVERED');
  });

  it('reports honestly when nothing at all is held', () => {
    const lookup = resolveProjection([], 'EUR', '2026-08-24');
    expect(lookup.status).toBe('NO_SNAPSHOT_YET');
    expect(lookup.explanation).toContain('No projection snapshots are held at all');
  });
});

describe('the snapshots actually on file', () => {
  it('reproduces the six legs the rule was derived from', () => {
    // Read on their own observation date, which is the only date they answer
    // for. USD 0, EUR +1, GBP +1, CHF 0, NZD +1.
    const on = '2026-08-30';
    const cell = (c: 'USD' | 'EUR' | 'GBP' | 'CHF' | 'NZD') =>
      resolveProjection(HELD, c, on, '2026Q3').cell;
    expect(cell('USD')).toBe(0);
    expect(cell('EUR')).toBe(1);
    expect(cell('GBP')).toBe(1);
    expect(cell('CHF')).toBe(0);
    expect(cell('NZD')).toBe(1);
  });

  /**
   * The EURCHF rates cell is the one this whole seam is aimed at: A1 prints +1,
   * we print 0. EUR +1 against CHF 0 is exactly their +1 — and it is still not
   * implementable, because the snapshot that produces it was read six days after
   * the board. The two assertions belong together, in that order.
   */
  it('would close the EURCHF rates cell, and still cannot be used for it', () => {
    const eur = resolveProjection(HELD, 'EUR', '2026-08-30', '2026Q3');
    const chf = resolveProjection(HELD, 'CHF', '2026-08-30', '2026Q3');
    expect((eur.cell ?? 0) - (chf.cell ?? 0)).toBe(1);

    expect(resolveProjection(HELD, 'EUR', '2026-08-24').status).toBe('NO_SNAPSHOT_YET');
    expect(resolveProjection(HELD, 'CHF', '2026-08-24').status).toBe('NO_SNAPSHOT_YET');
  });

  it('keeps every snapshot dated, sourced and distinct', () => {
    expect(HELD.length).toBeGreaterThan(0);
    const dates = HELD.map((s) => s.observedAt);
    expect(new Set(dates).size).toBe(dates.length);
    for (const s of HELD) {
      expect(s.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.source.length).toBeGreaterThan(0);
      expect(s.provenance.length).toBeGreaterThan(0);
    }
  });
});

/**
 * WAS "production does not consume projections yet", AND IT DOES NOW.
 *
 * The old test forbade every scoring file from importing this module, on the
 * reasoning that a live projection scoring a historical board would silently
 * corrupt every parity number. It said in as many words: delete this only
 * together with a snapshot series long enough to replay a captured board.
 *
 * That happened on 2026-09-01. Two dated readings now cover the 2026-08-31 and
 * 2026-09-01 captures, the second covers all eight majors for the first time,
 * and the rule reproduces all eight of A1's published legs on both. The guard
 * against replaying a board the snapshots cannot reach did not go away — it
 * moved into `resolveProjection`, which reads strictly backwards and returns
 * NO_SNAPSHOT_YET rather than a nearest match.
 *
 * What remains structural is narrower and sharper: exactly ONE scoring file may
 * import this, and it must be the one that can resolve it once for the whole
 * board.
 */
describe('only the board builder consumes projections', () => {
  const root = join(__dirname, '..', '..');

  it('is imported by no scoring path except the matrix builder', () => {
    /**
     * `lib/scoring/rates.ts` takes the lookup as an ARGUMENT and imports only
     * its type, so a per-currency call site can never resolve one for itself —
     * which is the property that stops the all-or-nothing gate being bypassed
     * one currency at a time.
     */
    const rates = readFileSync(join(root, 'lib/scoring/rates.ts'), 'utf8');
    expect(rates, 'rates.ts must import only the TYPE').toContain(
      "import type { ProjectionLookup } from '@/lib/scoring/rate-projections'",
    );

    for (const file of ['lib/setups-pipeline.ts', 'lib/scoring/discrete.ts', 'lib/scoring/heatmap.ts']) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source, `${file} must not import rate-projections`).not.toContain('rate-projections');
    }
  });

  it('resolves the whole board through the all-or-nothing gate', () => {
    const setups = readFileSync(join(root, 'lib/scoring/setups.ts'), 'utf8');
    expect(setups).toContain('resolveConsensusProjectionLegs');
  });
});

/**
 * The rule itself, against the only evidence there is for it: A1's own
 * published index rows on two captures a day apart.
 */
describe('resolveConsensusProjectionLegs', () => {
  const snapshots = (snapshotsFixture as { snapshots: RateProjectionSnapshot[] }).snapshots;
  const MAJORS: Currency[] = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'];

  it('reproduces all eight of A1 published rates legs', () => {
    const result = resolveConsensusProjectionLegs(snapshots, MAJORS, '2026-09-01');
    expect(result.legs).not.toBeNull();

    // Read off the Rates column of the eight index rows in BOTH captures --
    // they are identical, which is itself the point: their board barely moves.
    const published: Record<string, number> = {
      EUR: 1, GBP: 1, JPY: 1, NZD: 1, USD: 1, AUD: 0, CAD: 0, CHF: 0,
    };
    for (const currency of MAJORS) {
      expect(result.legs!.get(currency)!.cell, currency).toBe(published[currency]);
    }
  });

  /**
   * The two zeros are not blanks and are not rounding sloppiness. AUD's 4.4 and
   * CAD's 2.3 each sit exactly half a step from their standing rate under a
   * one-decimal reading, so the reading cannot tell them from equality — and A1
   * prints 0 for both.
   */
  it('refuses to call a move it cannot read, rather than guessing one', () => {
    const result = resolveConsensusProjectionLegs(snapshots, MAJORS, '2026-09-01');
    const aud = result.legs!.get('AUD')!;
    expect(aud.projection).toBe(4.4);
    expect(aud.policyRate).toBe(4.35);
    expect(aud.cell).toBe(0);
    expect(aud.explanation).toContain('within the');
  });

  it('still calls a real quarter-point move under the same coarse reading', () => {
    const result = resolveConsensusProjectionLegs(snapshots, MAJORS, '2026-09-01');
    const nzd = result.legs!.get('NZD')!;
    expect(nzd.projection).toBe(2.8);
    expect(nzd.policyRate).toBe(2.25);
    expect(nzd.cell).toBe(1);
  });

  /**
   * THE GATE. The 2026-08-30 reading covers five majors, so a board on 2026-08-31
   * gets nothing at all rather than five legs from one rule and three from
   * another. This is the property that kept the rule out of production, and it
   * is the one most likely to be quietly removed by someone wanting more
   * coverage.
   */
  it('gives a board nothing when any single major is uncovered', () => {
    const result = resolveConsensusProjectionLegs(snapshots, MAJORS, '2026-08-31');
    expect(result.legs).toBeNull();
    expect((result as { why: string }).why).toMatch(/CURRENCY_NOT_COVERED/);
    expect((result as { why: string }).why).toMatch(/cannot mix two rules/);
  });

  it('gives a board nothing before the first snapshot was ever read', () => {
    const result = resolveConsensusProjectionLegs(snapshots, MAJORS, '2026-08-01');
    expect(result.legs).toBeNull();
    expect((result as { why: string }).why).toMatch(/NO_SNAPSHOT_YET/);
  });
});
