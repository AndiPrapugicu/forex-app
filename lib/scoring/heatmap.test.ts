/**
 * Economic heatmap.
 *
 * Three things here are easy to get subtly wrong and invisible once wrong: the
 * two impact columns must disagree where the market disagrees, the surprise must
 * be measured against whatever the score actually used, and an indicator an
 * economy never publishes must not look like missing data.
 */

import { describe, expect, it } from 'vitest';
import { bullishShare, buildCurrencyHeatmap } from '@/lib/scoring/heatmap';
import { SLOTS } from '@/config/setups.config';
import heatmaps from '@/fixtures/a1-heatmaps.json';
import type { NormalizedEvent } from '@/lib/types';

interface A1CardRow {
  label: string;
  slotKey: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  surprise: number;
  currencyImpact: number;
  stocksImpact: number;
  illegible?: string[];
}

interface A1Capture {
  cards: Record<string, { impactPct: { currency: number; stocks: number }; rows: A1CardRow[] }>;
}

function makeEvent(o: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: Math.random().toString(36).slice(2),
    seriesId: null,
    name: 'Consumer Price Index (YoY)',
    currency: 'USD',
    countryCode: 'US',
    dateUtc: '2026-08-07T12:30:00.000Z',
    impact: 'HIGH',
    actual: 3.5,
    consensus: 3.8,
    previous: 4.2,
    revised: null,
    unit: '%',
    ratioDeviation: -1,
    isBetterThanExpected: false,
    isSpeech: false,
    isPreliminary: false,
    source: 'fxstreet',
    actualSource: 'fxstreet',
    sourceUrl: null,
    lastUpdated: null,
    ...o,
  } as NormalizedEvent;
}

const NOW = new Date('2026-08-09T00:00:00.000Z');

const rowFor = (map: ReturnType<typeof buildCurrencyHeatmap>, key: string) =>
  map.rows.find((r) => r.slotKey === key);

describe('the two impact columns', () => {
  it('reads a cooler CPI as bearish currency and BULLISH stocks', () => {
    /**
     * The headline case. Softer inflation means less room to hike — bad for the
     * currency, good for equities. A single impact column has to pick one and be
     * wrong about half the market, which is why A1 shows both.
     */
    const map = buildCurrencyHeatmap('USD', [makeEvent()], NOW);
    const cpi = rowFor(map, 'cpi')!;

    expect(cpi.currencyImpact).toBe(-1);
    expect(cpi.stocksImpact).toBe(1);
  });

  it('reads a hotter CPI the other way round', () => {
    const map = buildCurrencyHeatmap('USD', [makeEvent({ actual: 4.1, consensus: 3.8 })], NOW);
    const cpi = rowFor(map, 'cpi')!;

    expect(cpi.currencyImpact).toBe(1);
    expect(cpi.stocksImpact).toBe(-1);
  });

  it('AGREES on growth, where currency and stocks want the same thing', () => {
    // The two columns are not simply inverses of one another — only inflation
    // flips. A strong economy is good for both the currency and its equities.
    const gdp = makeEvent({
      name: 'Gross Domestic Product Annualized',
      actual: 2.8,
      consensus: 2.1,
      previous: 2.1,
    });
    const row = rowFor(buildCurrencyHeatmap('USD', [gdp], NOW), 'gdp')!;

    expect(row.currencyImpact).toBe(1);
    expect(row.stocksImpact).toBe(1);
  });

  it('agrees on jobs too', () => {
    const jobs = makeEvent({
      name: 'Nonfarm Payrolls',
      actual: 180,
      consensus: 120,
      previous: 100,
      unit: 'K',
    });
    const row = rowFor(buildCurrencyHeatmap('USD', [jobs], NOW), 'employment')!;

    expect(row.currencyImpact).toBe(1);
    expect(row.stocksImpact).toBe(1);
  });
});

describe('the surprise column', () => {
  it('measures against the forecast for an ordinary release', () => {
    const row = rowFor(buildCurrencyHeatmap('USD', [makeEvent()], NOW), 'cpi')!;
    expect(row.referenceLabel).toBe('forecast');
    expect(row.reference).toBe(3.8);
    expect(row.surprise).toBeCloseTo(-0.3, 5);
  });

  it('measures PMI against the FORECAST, which is what scores it', () => {
    /**
     * A1's PMI page says "change from previous data to latest data", which reads
     * like a previous-print comparison. Their product does not do that: on one
     * day's live figures, scoring against forecast reproduces all four of their
     * published PMI cells and scoring against previous reproduces two. The
     * sentence describes the change they display, not the one they score.
     *
     * ISM Services is the case that separates them — 54.1 beat the 54.0 previous
     * but MISSED the 54.5 forecast, and A1 scores it as a miss.
     */
    const services = makeEvent({
      name: 'ISM Services PMI',
      actual: 54.1,
      consensus: 54.5,
      previous: 54.0,
      unit: null,
    });
    const row = rowFor(buildCurrencyHeatmap('USD', [services], NOW), 'spmi')!;

    expect(row.referenceLabel).toBe('forecast');
    expect(row.reference).toBe(54.5);
    expect(row.surprise).toBeCloseTo(-0.4, 5);
    expect(row.currencyImpact).toBe(-1); // a miss, despite being up on the month
  });

  it('carries manufacturing and services as separate rows', () => {
    // Two independent columns in A1's table, not one composite. Collapsing them
    // hides which half of the economy is moving — and on their EURUSD the two
    // point opposite ways (-2 and +2) on the same day.
    const events = [
      makeEvent({ name: 'ISM Manufacturing PMI', actual: 55.6, consensus: 54, previous: 53.3, unit: null }),
      makeEvent({ name: 'ISM Services PMI', actual: 54.1, consensus: 54.5, previous: 54, unit: null }),
    ];
    const map = buildCurrencyHeatmap('USD', events, NOW);

    // Both scored against forecast, and they point OPPOSITE ways on this day —
    // which is precisely what a single merged column would have hidden.
    expect(rowFor(map, 'mpmi')?.currencyImpact).toBe(1); // 55.6 beat 54.0
    expect(rowFor(map, 'spmi')?.currencyImpact).toBe(-1); // 54.1 missed 54.5
  });
});

describe('which rows appear at all', () => {
  it('drops indicators the economy never publishes', () => {
    /**
     * The euro area has no payrolls, no JOLTS and no PCE. Listing them as empty
     * rows is what made the EUR heatmap look broken — nine blanks reading as
     * missing data when the series simply does not exist.
     */
    const hicp = makeEvent({
      name: 'Harmonized Index of Consumer Prices (YoY)',
      currency: 'EUR',
      countryCode: 'EMU',
    });
    const map = buildCurrencyHeatmap('EUR', [hicp], NOW);

    expect(rowFor(map, 'cpi')).toBeDefined();
    for (const absent of ['pce', 'jolts', 'adp', 'claims']) {
      expect(rowFor(map, absent), absent).toBeUndefined();
    }
  });

  it('KEEPS an aged-out row, SCORES it, and marks how old it is', () => {
    /*
     * This test used to assert the opposite - status 'stale' and a null impact -
     * and the reason it flipped is A1. Their board carries a Canada services PMI
     * from 1 May and scores it 125 days later; our 60-day window blanked the
     * equivalent cell. The window was ours, no captured A1 surface has ever
     * shown a resolved row suppressed for age, so enforcing it scored a
     * different board than the one being reproduced.
     *
     * What survives is the distinction the old test was really defending: "we
     * had this and it aged out" and "this economy has no such series" still must
     * not render the same. They now differ by `stale` and `ageDays` rather than
     * by one of them being blank.
     */
    const old = makeEvent({ dateUtc: '2026-01-01T00:00:00.000Z' });
    const map = buildCurrencyHeatmap('USD', [old], NOW);

    const cpi = rowFor(map, 'cpi')!;
    expect(cpi.status).toBe('scored');
    expect(cpi.currencyImpact).not.toBeNull();
    expect(cpi.stale).toBe(true);
    expect(cpi.ageDays).toBeGreaterThan(60);

    // And it counts, which is the whole behavioural change: the currency's own
    // macro score now includes the reading rather than ignoring it.
    expect(map.scored).toBe(1);
    expect(map.macroScore).toBe(cpi.currencyImpact);
  });
});

describe('impact percentages', () => {
  /**
   * TRANSCRIBED FROM A1's OWN CARDS, not reasoned about.
   *
   * This rule was wrong for as long as it was argued rather than checked: the
   * previous version counted neutral rows in the denominator and cited "their EU
   * card reads 57.14%, which is 4 bullish of 7 rows" to justify it. The EU card
   * reads 50%. 57.14% is the AU card. One number attributed to the wrong
   * screenshot, and a test written to match it.
   *
   * So each case below names its card and its row counts. Any future change to
   * `bullishShare` has to reproduce all seven or explain which published card it
   * is calling wrong.
   */
  it.each([
    ['EU', [1, 1, -1, -1, 0, 0, 0, 0], 50],
    ['CN', [1, 1, 1, 1, -1, -1, 0], 66.67],
    ['JP', [1, 1, 1, 1, -1, -1, 0, 0], 66.67],
    ['UK', [1, 1, -1, -1, -1, -1, 0], 33.33],
    ['NZ', [1, 1, 1, 1, -1, 0, 0], 80],
    ['NZ stocks', [1, 1, 1, 1, 1, 0, 0], 100],
    ['UK stocks', [1, -1, -1, -1, -1, -1, 0], 16.67],
  ])("reproduces A1's published %s card", (_card, impacts, expected) => {
    expect(bullishShare(impacts as number[])).toBeCloseTo(expected, 2);
  });

  it('excludes neutral rows from the denominator', () => {
    // 1 bullish, 0 bearish, 3 neutral. Counting the neutrals gives 25%, which
    // reproduces none of the cards above.
    expect(bullishShare([1, 0, 0, 0])).toBe(100);
  });

  it('is null rather than 0 when nothing DIRECTIONAL resolved', () => {
    // 0% would read as "everything is bearish", which is a claim we cannot make.
    expect(bullishShare([])).toBeNull();
    expect(bullishShare([null, null])).toBeNull();
    // All-neutral is a currency with no signal, not a uniformly bearish one.
    expect(bullishShare([0, 0, 0])).toBeNull();
  });

  it('reports both columns off the same rows', () => {
    const map = buildCurrencyHeatmap('USD', [makeEvent()], NOW);
    // One cooler CPI: bearish for the currency, bullish for stocks.
    expect(map.currencyImpactPct).toBe(0);
    expect(map.stocksImpactPct).toBe(100);
  });
});

describe('the reported basis is the one the cell was scored on', () => {
  /**
   * `slot.compare` says what was ASKED for; `SlotResult.referenceLabel` says
   * what was USED. They part company when no consensus exists and the score
   * falls back to the prior print, which is A1's rule.
   *
   * This is pinned because re-deriving the label from the slot did not merely
   * mislabel a column — a diagnostic built on it reported that NO cell scored
   * against the prior print while five of sixty-six were doing exactly that,
   * including the JPY services PMI that reads +1 where A1 reads -1. The bug
   * concealed its own symptom, so the honest label is the load-bearing part.
   */
  it('says "previous" and measures against it when the forecast is missing', () => {
    const map = buildCurrencyHeatmap(
      'USD',
      [makeEvent({ actual: 3.4, consensus: null, previous: 3.1 })],
      NOW,
    );
    const cpi = map.rows.find((r) => r.slotKey === 'cpi')!;

    expect(cpi.referenceLabel).toBe('previous');
    expect(cpi.reference).toBe(3.1);
    // 3.4 beats the prior 3.1, so the surprise is measured off that same number.
    expect(cpi.surprise).toBeCloseTo(0.3, 5);
    expect(cpi.currencyImpact).toBe(1);
  });

  it('still says "forecast" when there is one', () => {
    const map = buildCurrencyHeatmap(
      'USD',
      [makeEvent({ actual: 3.4, consensus: 3.6, previous: 3.1 })],
      NOW,
    );
    const cpi = map.rows.find((r) => r.slotKey === 'cpi')!;

    expect(cpi.referenceLabel).toBe('forecast');
    expect(cpi.reference).toBe(3.6);
    // A miss against forecast even though it rose against the prior print —
    // which is the whole reason the two labels must not be conflated.
    expect(cpi.currencyImpact).toBe(-1);
  });
});

/**
 * The card transcription in `fixtures/a1-heatmaps.json`, checked against itself.
 *
 * These assert a TRANSCRIPTION, not our scoring — the same job
 * `edgefinder-parity.test.ts` does for the board fixture. A failure here means
 * go and re-read a cell off the screenshot; it does not mean the code broke.
 *
 * The second check is the load-bearing one. Counting neutral rows in the
 * denominator reproduces NONE of these nine percentages, which is how the rule
 * in `bullishShare` was settled after a version that counted them shipped behind
 * a test that made it look verified.
 */
describe("A1's published country cards", () => {
  const capture = (heatmaps as { captures: A1Capture[] }).captures[0];
  const cards = Object.entries(capture.cards);

  it('covers every major plus China', () => {
    expect(cards).toHaveLength(9);
  });

  it.each(cards)('%s: every surprise is actual minus forecast, or minus previous', (_currency, card) => {
    for (const row of card.rows) {
      if (row.actual === null) continue;
      const reference = row.forecast ?? row.previous;
      if (reference === null) continue;
      expect(Math.round((row.actual - reference) * 100) / 100).toBeCloseTo(row.surprise, 6);
    }
  });

  it.each(cards)('%s: the published Impact percentage is bullish over directional', (_currency, card) => {
    expect(bullishShare(card.rows.map((r) => r.currencyImpact))).toBeCloseTo(card.impactPct.currency, 2);
    expect(bullishShare(card.rows.map((r) => r.stocksImpact))).toBeCloseTo(card.impactPct.stocks, 2);
  });

  it.each(cards)('%s: every row maps to a slot we carry', (_currency, card) => {
    const known = new Set(SLOTS.map((s) => s.key));
    for (const row of card.rows) {
      expect(known.has(row.slotKey), `${row.label} -> ${row.slotKey}`).toBe(true);
    }
  });

  /**
   * A blank Forecast is the evidence for `compareByCurrency`, so it must mean
   * BLANK and never "could not read it". An unreadable cell is declared.
   */
  it('never records an illegible cell as a blank forecast', () => {
    for (const [, card] of cards) {
      for (const row of card.rows) {
        if (row.illegible?.includes('forecast')) expect(row.forecast).toBeNull();
      }
    }
  });
});
