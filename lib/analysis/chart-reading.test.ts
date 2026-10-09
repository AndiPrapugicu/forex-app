import { describe, expect, it } from 'vitest';
import { chartFacts, chartMove, chartWindow, parseChartDate, parseChartReadings, parseMeasure, parseOffset, parseTimeframe } from './chart-reading';

const NOW = Date.parse('2026-10-09T09:12:00Z');

/** What the vision model is asked to print for the user's two TradingView screenshots. */
const READING = [
  'IMAGE 1',
  'SYMBOL: NDQ100',
  'TIMEFRAME: 1h',
  'TIMEZONE: UTC+3',
  "CROSSHAIR_TIME: Thu 08 Oct '26 02:00",
  'MEASURE: -578.29 (-1.86%) -57,829, 2 bars, -2h',
  'X_AXIS_DATES: 22 – 16 Oct',
  'LAST_PRICE: 31,007.20',
  '- Price sold off from about 31,150 to 30,570, then recovered.',
  '',
  'IMAGE 2',
  '**SYMBOL:** US02Y',
  'TIMEFRAME: 1h',
  'TIMEZONE: UTC+3',
  "CROSSHAIR_TIME: Thu 08 Oct '26 12:00",
  'MEASURE: −0.087 (−1.80%) −87, 0 bars',
  'LAST_PRICE: 4.781',
].join('\n');

describe("the user's two screenshots", () => {
  const charts = parseChartReadings(READING, NOW);

  it('reads one header per image, as data', () => {
    expect(charts).toHaveLength(2);
    expect(charts[0]).toMatchObject({
      index: 1,
      symbol: 'NDQ100',
      resolved: { symbol: 'NAS100' },
      timeframeMinutes: 60,
      utcOffsetMinutes: 180,
      crosshair: { y: 2026, m: 10, d: 8, hh: 2, mm: 0 },
      measure: { change: -578.29, pct: -1.86, bars: 2 },
      lastPrice: 31007.2,
    });
    expect(charts[1]).toMatchObject({ symbol: 'US02Y', resolved: { ticker: 'ZT=F' }, measure: { change: -0.087, pct: -1.8, bars: 0 }, lastPrice: 4.781 });
  });

  it("points at the chart's whole day, in the chart's clock", () => {
    const w = chartWindow(charts, 'Europe/Bucharest', NOW)!;
    expect(new Date(w.fromMs).toISOString()).toBe('2026-10-07T21:00:00.000Z');
    expect(new Date(w.toMs).toISOString()).toBe('2026-10-08T21:00:00.000Z');
  });

  it("takes the move from the page symbol's chart, not the yield's", () => {
    expect(chartMove(charts, 'NAS100')).toMatchObject({ direction: -1, pct: 1.86, minutes: 120 });
    expect(chartMove(charts, 'XAUUSD')).toBeNull();
  });

  it('lists the charts for section F', () => {
    expect(chartFacts(charts)[0]).toBe('- Chart 1: NDQ100 · 1H bars · crosshair 2026-10-08 02:00 · chart clock UTC+3 · measured -578.29, -1.86%, 2 bars');
  });
});

describe('field parsers', () => {
  it('reads timeframes, clocks, dates and rulers in their usual spellings', () => {
    expect([parseTimeframe('15m'), parseTimeframe('4H'), parseTimeframe('D'), parseTimeframe('60'), parseTimeframe('H1'), parseTimeframe('weird')]).toEqual([15, 240, 1440, 60, 60, null]);
    expect([parseOffset('UTC+3'), parseOffset('(UTC-4)'), parseOffset('UTC'), parseOffset('Exchange')]).toEqual([180, -240, 0, null]);
    expect(parseChartDate('2026-10-08 16:30', 2026)).toEqual({ y: 2026, m: 10, d: 8, hh: 16, mm: 30 });
    expect(parseChartDate('Oct 7, 2026', 2026)).toEqual({ y: 2026, m: 10, d: 7, hh: null, mm: null });
    expect(parseChartDate('08 Oct', 2026)).toEqual({ y: 2026, m: 10, d: 8, hh: null, mm: null });
    expect(parseMeasure('+12.5 (+0.40%) 125, 6 bars')).toEqual({ change: 12.5, pct: 0.4, bars: 6 });
  });

  it('treats "not visible" as missing, and guesses nothing', () => {
    const [c] = parseChartReadings('SYMBOL: not legible\nTIMEZONE: not visible\nCROSSHAIR_TIME: not visible', NOW);
    expect(c).toMatchObject({ symbol: null, utcOffsetMinutes: null, crosshair: null, measure: null });
    expect(chartWindow([c], 'Europe/Bucharest', NOW)).toBeNull();
  });
});
