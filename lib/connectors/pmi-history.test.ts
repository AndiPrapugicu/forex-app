/**
 * The PMI seed's invariants.
 *
 * The first block is the one that earns its keep. A seeded event published
 * under a name the slot's own matcher does not prefer is INVISIBLE — it reaches
 * the pool, nothing matches it, no error is raised, and the column stays blank
 * exactly as it was. There is no symptom to notice, so the only way to know the
 * seed works is to run every definition through the real `resolveSeries`.
 */

import { describe, expect, it } from 'vitest';

import { PMI_SERIES, PMI_SERIES_NOT_SEEDED, pmiSeriesFor } from '@/config/pmi-series.config';
import { PRIMARY_COUNTRY, SLOTS } from '@/config/setups.config';
import {
  accumulatePmiActuals,
  fetchPmiHistory,
  mergePmiHistory,
  pmiEventsToPersist,
  toPmiSeedEvents,
} from '@/lib/connectors/pmi-history';
import { resolveSeries } from '@/lib/scoring/discrete';
import type { Store } from '@/lib/db/client';
import type { NormalizedEvent } from '@/lib/types';

const seeded = toPmiSeedEvents();

function eventFor(def: (typeof PMI_SERIES)[number], over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: `test-${def.currency}-${def.slotKey}`,
    seriesId: 'test',
    name: def.publishAs,
    currency: def.currency,
    countryCode: def.countryCode,
    dateUtc: '2026-08-21T09:00:00.000Z',
    impact: 'MEDIUM',
    actual: 52,
    consensus: 51,
    previous: 51,
    revised: null,
    unit: null,
    ratioDeviation: null,
    isBetterThanExpected: null,
    isSpeech: false,
    isPreliminary: false,
    source: 'fxstreet',
    actualSource: 'fxstreet',
    lastUpdated: null,
    ...over,
  };
}

describe('every seeded series is reachable by the slot that needs it', () => {
  it.each(PMI_SERIES.map((d) => [`${d.currency} ${d.slotKey}`, d] as const))(
    '%s resolves to the name the seed publishes under',
    (_label, def) => {
      const slot = SLOTS.find((s) => s.key === def.slotKey);
      expect(slot, `no slot ${def.slotKey}`).toBeDefined();

      const event = eventFor(def);
      const got = resolveSeries(slot!, def.currency, [event]);

      expect(got, `${def.publishAs} is invisible to the ${def.slotKey} matcher for ${def.currency}`)
        .not.toBeNull();
      expect(got!.name).toBe(def.publishAs);
    },
  );

  it('tags every definition with the country resolveSeries scopes to', () => {
    // `resolveSeries` filters on PRIMARY_COUNTRY before a matcher ever runs, so
    // a mismatch here makes the seed invisible with no other symptom.
    for (const def of PMI_SERIES) {
      expect(def.countryCode, `${def.currency} ${def.slotKey}`).toBe(PRIMARY_COUNTRY[def.currency]);
    }
  });

  it('declines exactly the series it says it declines', () => {
    for (const skipped of PMI_SERIES_NOT_SEEDED) {
      const present = PMI_SERIES.some(
        (d) => d.currency === skipped.currency && d.slotKey === skipped.slotKey,
      );
      expect(present, `${skipped.currency} ${skipped.slotKey} is both seeded and declined`).toBe(false);
    }
  });
});

describe('the seed itself', () => {
  it('emits events for every seeded series', () => {
    expect(seeded.length).toBeGreaterThan(150);
  });

  it('dates every seeded event at midnight, so a live row on the same day is newer', () => {
    // `resolveSeries`' `newest()` uses a strict `>`, so an exact tie would be
    // resolved by array order and correctness would depend on merge ordering.
    for (const e of seeded) expect(e.dateUtc.endsWith('T00:00:00.000Z'), e.id).toBe(true);
  });

  it('marks every seeded actual as A1-sourced', () => {
    for (const e of seeded) expect(e.actualSource, e.id).toBe('a1-capture');
  });

  it('gives every seeded event a unique id', () => {
    expect(new Set(seeded.map((e) => e.id)).size).toBe(seeded.length);
  });

  it('never sets `revised`, which priorPrint would read ahead of `previous`', () => {
    for (const e of seeded) expect(e.revised, e.id).toBeNull();
  });

  it('is recognised by pmiSeriesFor, which the store read-back filters on', () => {
    for (const e of seeded) expect(pmiSeriesFor(e), e.id).not.toBeNull();
  });
});

describe('the laundering guard', () => {
  const now = new Date('2026-09-12T00:00:00.000Z');

  it('refuses to persist an A1-sourced actual', () => {
    // Without this, seed rows round-trip through the store and come back
    // looking live, and the clean parity headline silently stops excluding
    // anything.
    expect(pmiEventsToPersist(seeded, now)).toEqual([]);
  });

  it('persists a live PMI actual', () => {
    const live = eventFor(PMI_SERIES[0], { dateUtc: '2026-09-01T14:00:00.000Z' });
    expect(pmiEventsToPersist([live], now).map((e) => e.id)).toEqual([live.id]);
  });

  it('refuses a scheduled release that has not printed yet', () => {
    const future = eventFor(PMI_SERIES[0], { dateUtc: '2026-10-01T14:00:00.000Z' });
    expect(pmiEventsToPersist([future], now)).toEqual([]);
  });

  it('refuses an event that is not a seeded PMI series', () => {
    const other = eventFor(PMI_SERIES[0], { name: 'Consumer Price Index (YoY)' });
    expect(pmiEventsToPersist([other], now)).toEqual([]);
  });

  it('writes nothing to a store that is not durable', async () => {
    const memory = { durable: false, kind: 'memory', upsertEvents: async () => {} } as unknown as Store;
    const live = eventFor(PMI_SERIES[1], { dateUtc: '2026-09-01T14:00:00.000Z' });
    const got = await accumulatePmiActuals([live], now, memory);
    expect(got.written).toBe(0);
    expect(got.durable).toBe(false);
  });
});

describe('mergePmiHistory — the seed is a backfill, never an override', () => {
  const def = PMI_SERIES.find((d) => d.currency === 'EUR' && d.slotKey === 'spmi')!;
  const history = [
    eventFor(def, {
      id: 'seed-old',
      dateUtc: '2026-08-05T00:00:00.000Z',
      actualSource: 'a1-capture',
      source: 'a1-capture',
    }),
    eventFor(def, {
      id: 'seed-new',
      dateUtc: '2026-08-21T00:00:00.000Z',
      actualSource: 'a1-capture',
      source: 'a1-capture',
    }),
  ];

  it('supplies history when the live calendar has no actual at all', () => {
    // The measured case: FXStreet carries the rows with `actual: null`, so the
    // pool is empty and the column is blank without this.
    const live = [eventFor(def, { id: 'live-null', actual: null, dateUtc: '2026-09-03T08:00:00.000Z' })];
    const merged = mergePmiHistory(live, history);
    expect(merged.map((e) => e.id).sort()).toEqual(['live-null', 'seed-new', 'seed-old']);
  });

  it('drops every seed row once a live actual is newer', () => {
    const live = [eventFor(def, { id: 'live', dateUtc: '2026-09-03T08:00:00.000Z' })];
    expect(mergePmiHistory(live, history).map((e) => e.id)).toEqual(['live']);
  });

  it('drops a seed row the live calendar already covers on the same day, and everything older', () => {
    // A live actual on the seed's newest day is ALSO the newest live actual, so
    // rule 2 removes the older seed rows too. The live row is the record.
    const live = [eventFor(def, { id: 'live', dateUtc: '2026-08-21T09:00:00.000Z' })];
    expect(mergePmiHistory(live, history).map((e) => e.id)).toEqual(['live']);
  });

  it('keeps seed rows for a series the live calendar covers for a DIFFERENT currency', () => {
    const gbp = PMI_SERIES.find((d) => d.currency === 'GBP' && d.slotKey === 'spmi')!;
    const live = [eventFor(gbp, { id: 'live-gbp', dateUtc: '2026-09-03T08:00:00.000Z' })];
    const merged = mergePmiHistory(live, history);
    expect(merged.map((e) => e.id).sort()).toEqual(['live-gbp', 'seed-new', 'seed-old']);
  });

  it('is a no-op on an empty history', () => {
    const live = [eventFor(def, { id: 'live' })];
    expect(mergePmiHistory(live, [])).toBe(live);
  });
});

describe('fetchPmiHistory degradation', () => {
  it('returns the seed alone and says so when the store is in-memory', async () => {
    const memory = { durable: false, kind: 'memory' } as unknown as Store;
    const got = await fetchPmiHistory(new Date('2026-09-12T00:00:00.000Z'), memory);
    expect(got.ok).toBe(true);
    expect(got.data.length).toBe(seeded.length);
    expect(got.degraded).toMatch(/seed-only/);
    expect(got.counts.accumulated).toBe(0);
  });

  it('survives a store that throws, rather than taking the board down', async () => {
    const broken = {
      durable: true,
      kind: 'supabase',
      getEvents: async () => {
        throw new Error('schema not migrated');
      },
    } as unknown as Store;
    const got = await fetchPmiHistory(new Date('2026-09-12T00:00:00.000Z'), broken);
    expect(got.ok).toBe(true);
    expect(got.data.length).toBe(seeded.length);
    expect(got.degraded).toMatch(/schema not migrated/);
  });

  it('lets a stored row supersede its seeded twin', async () => {
    const def = PMI_SERIES.find((d) => d.currency === 'EUR' && d.slotKey === 'spmi')!;
    const stored = eventFor(def, { id: 'stored', dateUtc: '2026-08-21T09:00:00.000Z' });
    const store = {
      durable: true,
      kind: 'supabase',
      getEvents: async () => [stored],
    } as unknown as Store;

    const got = await fetchPmiHistory(new Date('2026-09-12T00:00:00.000Z'), store);
    expect(got.counts.superseded).toBe(1);
    const eurAug21 = got.data.filter(
      // EUR manufacturing ALSO has a 21 August flash, so scope by series name.
      (e) => e.currency === 'EUR' && e.name === def.publishAs && e.dateUtc.startsWith('2026-08-21'),
    );
    expect(eurAug21).toHaveLength(1);
    expect(eurAug21[0].actualSource).toBe('fxstreet');
  });
});
