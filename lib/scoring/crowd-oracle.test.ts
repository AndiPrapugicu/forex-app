/**
 * The Crowd column, checked against A1's OWN input rather than against ours.
 *
 * These are the regression tests that pin the section-1E result: given A1's
 * published long share for a date, `resolveCrowd` returns A1's published Top
 * Setups crowd cell for that same date. They call the production scorer, so
 * they fail if the 40/60 bands move, if the index derivation is removed, or if
 * crosses go back to being differenced.
 */

import { describe, expect, it } from 'vitest';

import ORACLE from '@/fixtures/a1-retail-sentiment-history.json';
import { ALL_SYMBOLS } from '@/config/symbols.config';
import {
  A1_INSTRUMENT_TO_SYMBOL,
  a1CrowdCells,
  crowdOracleJoin,
  feedForDate,
  oracleDates,
  summarizeOracleJoin,
} from '@/lib/scoring/crowd-oracle';

describe('feedForDate', () => {
  it('renames A1 instruments onto our symbols', () => {
    const feed = feedForDate('2026-08-24');
    expect(feed.get('XAUUSD')?.longPct).toBe(95.08);
    expect(feed.get('XAGUSD')?.longPct).toBe(91.05);
    // Their names must not leak through as symbols nothing else knows about.
    expect(feed.has('GOLD')).toBe(false);
    expect(feed.has('SILVER')).toBe(false);
  });

  it('carries the short share as the complement of the long one', () => {
    const eurusd = feedForDate('2026-08-24').get('EURUSD');
    expect(eurusd?.longPct).toBe(25);
    expect(eurusd?.shortPct).toBe(75);
  });

  it('never carries an observation forward from a neighbouring day', () => {
    // GOLD has no 2026-08-29 row; NZDUSD does. A "latest available" fallback
    // would put a five-day-old metals share into a 29 Aug feed and turn a
    // missing measurement into a confident one.
    const feed = feedForDate('2026-08-29');
    expect(feed.get('NZDUSD')?.longPct).toBe(48);
    expect(feed.has('XAUUSD')).toBe(false);
  });

  it('returns an empty feed for a date the oracle never covered', () => {
    expect(feedForDate('2026-01-01').size).toBe(0);
  });

  it('stamps every entry with the date asked for, not the date read', () => {
    for (const entry of feedForDate('2026-08-25').values()) {
      expect(entry.observedAt).toBe('2026-08-25');
    }
  });
});

describe('oracleDates', () => {
  it('covers both Top Setups capture dates', () => {
    const dates = oracleDates();
    expect(dates).toContain('2026-08-24');
    expect(dates).toContain('2026-08-25');
    expect([...dates]).toEqual([...dates].sort());
  });
});

describe('the Crowd transformation against A1 Top Setups', () => {
  const rows = crowdOracleJoin();

  it('reproduces every A1 crowd cell the oracle can answer', () => {
    const summary = summarizeOracleJoin(rows);
    expect(summary.mismatched).toEqual([]);
    expect(summary.matched).toBe(summary.total);
    expect(summary.total).toBe(8);
  });

  it('spans both dates, both metals, a cross and three currency indices', () => {
    const seen = new Set(rows.map((r) => `${r.symbol}@${r.date}`));
    expect(seen).toEqual(
      new Set([
        'EURUSD@2026-08-24',
        'GBPUSD@2026-08-24',
        'EURCHF@2026-08-24',
        'EURX@2026-08-24',
        'XAUUSD@2026-08-24',
        'XAGUSD@2026-08-24',
        'NZDX@2026-08-25',
        'CHFX@2026-08-25',
      ]),
    );
  });

  it('answers every row from the retail feed, never from a contract', () => {
    // The join is fed an EMPTY COT map, so a row resolving any other way would
    // be a null cell counted as agreement.
    for (const row of rows) expect(row.basis).toBe('retail-feed');
  });

  it('reads EURCHF, a cross, off its own book rather than differencing', () => {
    const eurchf = rows.find((r) => r.symbol === 'EURCHF');
    expect(eurchf?.longPct).toBe(32);
    expect(eurchf?.ourCell).toBe(1);
    expect(eurchf?.a1Cell).toBe(1);
  });

  it('reads CHFX inverted out of USDCHF', () => {
    const chfx = rows.find((r) => r.symbol === 'CHFX');
    // A1's USDCHF long share on 2026-08-25 is 74, so the franc's own book is 26.
    expect(chfx?.longPct).toBe(26);
    expect(chfx?.ourCell).toBe(1);
    expect(chfx?.explanation).toContain('USDCHF');
    expect(chfx?.explanation).toContain('inverted');
  });

  it('reads EURX and NZDX the right way up out of their dollar pairs', () => {
    expect(rows.find((r) => r.symbol === 'EURX')?.longPct).toBe(25);
    expect(rows.find((r) => r.symbol === 'NZDX')?.longPct).toBe(31);
    for (const symbol of ['EURX', 'NZDX']) {
      expect(rows.find((r) => r.symbol === symbol)?.explanation).not.toContain('inverted');
    }
  });

  it('scores the metals from A1 s own retail share, not only from COT', () => {
    // A prior round recorded that metals used a put/call ratio instead. They
    // appear in this dataset with per-day long shares that produce A1's cell.
    for (const symbol of ['XAUUSD', 'XAGUSD']) {
      const row = rows.find((r) => r.symbol === symbol);
      expect(row?.longPct).toBeGreaterThan(90);
      expect(row?.ourCell).toBe(-1);
      expect(row?.a1Cell).toBe(-1);
    }
  });
});

describe('the oracle fixture itself', () => {
  it('records only long shares inside 0..100', () => {
    for (const byDate of Object.values(ORACLE.series as Record<string, Record<string, number>>)) {
      for (const value of Object.values(byDate)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('agrees cell for cell with the join table written into the fixture', () => {
    const computed = new Map(crowdOracleJoin().map((r) => [`${r.symbol}@${r.date}`, r]));
    for (const row of ORACLE.topSetupsJoin.rows) {
      const actual = computed.get(`${row.symbol}@${row.date}`);
      expect(actual, `${row.symbol}@${row.date}`).toBeDefined();
      expect(actual?.longPct).toBe(row.longPct);
      expect(actual?.ourCell).toBe(row.expectedCell);
      expect(actual?.a1Cell).toBe(row.a1Cell);
    }
    expect(ORACLE.topSetupsJoin.rows).toHaveLength(computed.size);
  });

  it('maps exactly the instruments whose A1 name is not already one of ours', () => {
    // SILVER is six letters, so a shape test would call it an FX pair. The
    // question is only ever whether the name resolves to a symbol we define.
    const ours = new Set(ALL_SYMBOLS.map((d) => d.symbol));
    for (const instrument of Object.keys(ORACLE.series)) {
      const mapped = A1_INSTRUMENT_TO_SYMBOL[instrument];
      if (ours.has(instrument)) expect(mapped, instrument).toBeUndefined();
      else expect(mapped && ours.has(mapped), instrument).toBe(true);
    }
  });

  it('still holds a crowd cell for every symbol the join claims', () => {
    const cells = new Set(a1CrowdCells().map((c) => `${c.symbol}@${c.date}`));
    for (const row of ORACLE.topSetupsJoin.rows) {
      expect(cells.has(`${row.symbol}@${row.date}`), `${row.symbol}@${row.date}`).toBe(true);
    }
  });
});
