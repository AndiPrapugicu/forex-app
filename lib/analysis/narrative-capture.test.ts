/**
 * The ingest's narrative step end to end, against the memory store, with the
 * network loaders mocked and Telegram replaced by a counter. Never sends.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/connectors/technicals', async (orig) => ({
  ...(await orig<typeof import('@/lib/connectors/technicals')>()),
  fetchDailyBars: vi.fn(async () => {
    const t0 = Date.parse('2026-08-25T00:00:00Z') / 1000;
    const closes = Array.from({ length: 30 }, (_, i) => 1.05 + 0.04 * Math.sin(i / 3));
    return {
      timestamps: closes.map((_, i) => t0 + i * 86_400),
      opens: closes,
      highs: closes.map((c) => c + 0.002),
      lows: closes.map((c) => c - 0.002),
      closes,
    };
  }),
}));

vi.mock('@/lib/analysis/narrative-load', async (orig) => ({
  ...(await orig<typeof import('@/lib/analysis/narrative-load')>()),
  loadNarrative: vi.fn(),
}));

import { loadNarrative, type NarrativeBundle } from '@/lib/analysis/narrative-load';
import { buildMarketState, type NarrativeInputs } from '@/lib/analysis/themes';
import { isSnapshot, LATEST_KEY, dayKey, type NarrativeSnapshot } from '@/lib/analysis/snapshot';
import type { FlipCondition } from '@/lib/analysis/state';
import { __setStore, getStore } from '@/lib/db/client';
import type { SetupsPayload } from '@/lib/setups-pipeline';
import type { Alert, NormalizedEvent } from '@/lib/types';
import { captureNarrative } from './narrative-capture';

const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };

const cpi = {
  id: 'us-cpi',
  name: 'Consumer Price Index (MoM)',
  currency: 'USD',
  countryCode: 'US',
  dateUtc: '2026-10-03T08:00:00Z',
  impact: 'HIGH',
  actual: null,
  consensus: 0.3,
  previous: 0.4,
  revised: null,
  ratioDeviation: null,
  isBetterThanExpected: null,
  isSpeech: false,
  isPreliminary: false,
  source: 'fixture',
  actualSource: null,
} as NormalizedEvent;

function inputs(events: NormalizedEvent[]): NarrativeInputs {
  return {
    events,
    policyRates: new Map(),
    twoYear: new Map(),
    twoYearHistory: {},
    fed: { effr: [], contracts: [] },
    series: {},
    headlines: [],
    headlinesAvailable: false,
    ecoStrength: [],
  };
}

let events: NormalizedEvent[] = [cpi];
vi.mocked(loadNarrative).mockImplementation(async (now = new Date()) => {
  const latest = await getStore().getAiCache(LATEST_KEY);
  const i = inputs(events);
  return { now, inputs: i, state: buildMarketState(i, now), latest: isSnapshot(latest) ? latest : null, past: null } as NarrativeBundle;
});

const payload = (score: number) =>
  Promise.resolve({
    matrix: { rows: [{ symbol: 'EURUSD', totalScore: score, price: 1.06 }] },
    technicals: new Map(),
    sovereignYields: new Map(),
  } as unknown as SetupsPayload);

const sent: Alert[][] = [];
const deliver = async (alerts: Alert[]) => {
  sent.push(alerts);
  return { sent: alerts.length, failed: 0, skipped: false };
};

beforeAll(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  __setStore(null);
});

afterAll(() => {
  if (saved.url !== undefined) process.env.SUPABASE_URL = saved.url;
  if (saved.key !== undefined) process.env.SUPABASE_SERVICE_KEY = saved.key;
  __setStore(null);
});

describe('captureNarrative', () => {
  it('runs a day: RED and the digest once, a fired flip once, and remembers status', async () => {
    const store = getStore();
    expect(store.kind).toBe('memory');
    const pos = await store.savePosition({ symbol: 'EURUSD', side: 'long', entryDate: '2026-09-29', entryPrice: 1.05, stopLoss: 1.0, takeProfit: 1.2, size: null, riskPct: null, thesis: null });

    // 05:30 — before the digest hour. The board at +3 is outside a long's band: RED.
    const first = await captureNarrative(store, payload(3), new Date('2026-10-03T05:30:00Z'), deliver);
    expect(first).toMatchObject({ saved: true, positions: 1, alerts: 1, digest: false });
    expect(sent[0].map((a) => a.kind)).toEqual(['thesis-red']);
    expect((await store.listPositions())[0]).toMatchObject({ id: pos.id, lastStatus: 'red' });

    const latest = (await store.getAiCache(LATEST_KEY)) as NarrativeSnapshot;
    expect(latest.verdicts.EURUSD).toBeDefined();
    expect(Object.keys(latest.flips)).toEqual(['EURUSD']);
    expect(await store.getAiCache(dayKey('2026-10-03'))).toEqual(latest);

    // Plant a live flip for the position, as a previous run would have stored it.
    const flip: FlipCondition = {
      id: 'cal:us-cpi:up',
      kind: 'calendar',
      theme: 'inflation',
      dueUtc: cpi.dateUtc,
      text: 'USD CPI at or above 0.4%',
      favours: 'bearish',
      role: 'flip',
      check: { type: 'release', eventId: 'us-cpi', op: '>=', threshold: 0.4 },
    };
    await store.setAiCache(LATEST_KEY, 'narrative:snapshot', 'deterministic', { ...latest, flips: { EURUSD: [flip] } });

    // 08:10 — CPI printed hot (bearish for EURUSD), and it is past 06:00: flip + digest, no repeat RED.
    events = [{ ...cpi, actual: 0.5 }];
    const second = await captureNarrative(store, payload(3), new Date('2026-10-03T08:10:00Z'), deliver);
    expect(second).toMatchObject({ alerts: 2, digest: true });
    expect(sent[1].map((a) => a.kind)).toEqual(['narrative-flip', 'narrative-digest']);
    expect(sent[1][0].body).toContain('USD CPI at or above 0.4%. Reading 0.5.');
    const afterSecond = (await store.getAiCache(LATEST_KEY)) as NarrativeSnapshot;
    expect(afterSecond.digestSentFor).toBe('2026-10-03');
    expect(afterSecond.fired?.map((f) => f.id)).toEqual(['cal:us-cpi:up']);

    // 11:10 — nothing new: the flip is remembered, the digest went out, still RED.
    await store.setAiCache(LATEST_KEY, 'narrative:snapshot', 'deterministic', { ...afterSecond, flips: { EURUSD: [flip] } });
    const third = await captureNarrative(store, payload(3), new Date('2026-10-03T11:10:00Z'), deliver);
    expect(third.alerts).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it('reports instead of throwing when the board run failed', async () => {
    const r = await captureNarrative(getStore(), Promise.reject(new Error('board down')), new Date(), deliver);
    expect(r).toMatchObject({ saved: false, error: 'board down' });
  });
});
