/**
 * Thursday 2026-10-08, the way it really went: the Nasdaq broke around 16:00Z
 * on a report about OpenAI's revenue, the bond rally came with the strong
 * 30-year auction at 17:00Z, and a bigger morning rally sat in the same day.
 * The reader must find the move the user described, time stocks and bonds
 * apart, and let the after-the-fact headlines attribute each one.
 */

import { describe, expect, it } from 'vitest';
import { REACTION_PANEL } from '@/config/reaction.config';
import type { IntradaySeries } from '@/lib/connectors/intraday';
import {
  attributeMove,
  buildPanel,
  firstSeen,
  matchMove,
  measuredDirections,
  onsetOf,
  parseExplainer,
  reactionLines,
  scheduledInside,
  splitNote,
  type Onset,
} from './reaction';

const DAY_FROM = Date.parse('2026-10-07T21:00:00Z');
const DAY_TO = Date.parse('2026-10-08T21:00:00Z');
const NOW = Date.parse('2026-10-09T09:12:00Z');
const M5 = 5 * 60_000;
const at = (hhmm: string) => Date.parse(`2026-10-08T${hhmm}:00Z`);

/** 5-minute closes from piecewise-linear knots [time, value]. */
function series(ticker: string, knots: [string, number][]): IntradaySeries {
  const pts = knots.map(([t, v]) => [at(t), v] as const);
  const t: number[] = [];
  const c: number[] = [];
  for (let ms = pts[0][0]; ms <= pts[pts.length - 1][0]; ms += M5) {
    let k = 0;
    while (k < pts.length - 2 && ms > pts[k + 1][0]) k++;
    const [t0, v0] = pts[k];
    const [t1, v1] = pts[k + 1];
    t.push(ms);
    c.push(v0 + ((v1 - v0) * (ms - t0)) / (t1 - t0 || 1));
  }
  return { ticker, t, c };
}

const NQ = series('NQ=F', [
  ['00:00', 30500],
  ['09:00', 30500],
  ['11:00', 31300], // the morning rally: +2.6%, bigger than the fall
  ['15:50', 31300],
  ['17:30', 30830], // the fall the user means: −1.5%
  ['20:55', 30830],
]);
const ZT = series('ZT=F', [
  ['00:00', 101.7],
  ['16:55', 101.7],
  ['18:00', 101.79], // price up → 2Y yield down ≈ −4.6bp, from 17:00
  ['20:55', 101.79],
]);
const TNX = series('^TNX', [
  ['13:30', 5.24],
  ['16:55', 5.24],
  ['18:00', 5.17],
  ['20:55', 5.17],
]);
const ES = series('ES=F', [
  ['00:00', 7800],
  ['15:50', 7800],
  ['17:30', 7770],
  ['20:55', 7770],
]);
const map = new Map([NQ, ZT, TNX, ES].map((s) => [s.ticker, s]));

describe('finding the move the user described', () => {
  it('takes the afternoon fall, not the larger morning rally', () => {
    const m = matchMove(NQ, DAY_FROM, DAY_TO, { direction: -1, pct: 2, minutes: 120 });
    expect(m.status).toBe('match');
    expect(new Date(m.move!.startMs).toISOString()).toBe('2026-10-08T15:50:00.000Z');
    expect(new Date(m.move!.endMs).toISOString()).toBe('2026-10-08T17:30:00.000Z');
    expect(m.move!.changePct).toBeCloseTo(-1.5, 1);
    expect(m.largest!.changePct).toBeGreaterThan(2.5);
  });

  it('prefers a sharp move to a day-long drift when no length is given', () => {
    const drift = series('NQ=F', [
      ['01:00', 31400],
      ['15:00', 31250],
      ['17:00', 30850],
      ['20:55', 30850],
    ]);
    const m = matchMove(drift, DAY_FROM, DAY_TO, { direction: -1, pct: 2, minutes: null });
    // Four hours back from the end at most, never the 01:00 start of the drift.
    expect(new Date(m.move!.startMs).toISOString()).toBe('2026-10-08T13:00:00.000Z');
  });

  it('says NO MATCH when the bars hold no move that way, and never swaps in another', () => {
    const upOnly = series('NQ=F', [
      ['00:00', 30500],
      ['20:55', 31000],
    ]);
    const m = matchMove(upOnly, DAY_FROM, DAY_TO, { direction: -1, pct: 2, minutes: 120 });
    expect(m.status).toBe('no-match');
    expect(m.move).toBeNull();
    const text = reactionLines({
      symbol: 'NAS100',
      primaryTicker: 'NQ=F',
      window: { fromMs: DAY_FROM, toMs: DAY_TO, label: 'yesterday, Thu 08 Oct (Europe/Bucharest)' },
      match: { status: 'no-match', described: { direction: -1, pct: 2, minutes: 120, source: 'question' }, largest: m.largest },
      move: null,
      rows: [],
      fingerprint: null,
      catalysts: [],
      links: [],
      fit: [],
      gaps: [],
      computedAtMs: NOW,
    }).join('\n');
    expect(text).toContain('NO MATCH: the user described a move down ~2% in ~120 minutes (from their words)');
    expect(text).toContain('Do NOT explain a different move instead.');
  });
});

describe('timing stocks and bonds apart', () => {
  const move = matchMove(NQ, DAY_FROM, DAY_TO, { direction: -1, pct: 2, minutes: 120 }).move!;
  const own = { ticker: 'NQ=F', label: 'NAS100', group: 'equities' as const, unit: 'pct' as const };
  const onsets = [
    onsetOf(NQ, own, move),
    ...REACTION_PANEL.filter((i) => i.ticker === 'ZT=F' || i.ticker === '^TNX').map((i) => onsetOf(map.get(i.ticker), i, move)),
  ].filter((o): o is Onset => !!o);

  it('finds when each broke', () => {
    const byTicker = Object.fromEntries(onsets.map((o) => [o.inst.ticker, new Date(o.brokeMs).toISOString().slice(11, 16)]));
    expect(byTicker).toEqual({ 'NQ=F': '16:15', 'ZT=F': '17:15', '^TNX': '17:15' });
  });

  it('calls them SPLIT, an hour apart', () => {
    expect(splitNote(onsets, 'NQ=F', NOW)).toBe(
      'SPLIT: NAS100 broke at 10-08 16:15Z, US 2Y (from ZT futures) at 10-08 17:15Z (60 minutes apart; the symbol moved first). ' +
        'They may have separate drivers: explain the symbol and the bond move each on its own evidence.',
    );
  });

  it('puts the 30-year auction inside the move', () => {
    const inside = scheduledInside(
      [
        { ms: at('17:00'), label: 'US 30-Year Bond auction ($22bn)', detail: 'STRONG demand' },
        { ms: at('12:30'), label: 'USD Initial Jobless Claims' },
      ],
      move,
    );
    expect(inside).toEqual([{ ms: at('17:00'), label: 'US 30-Year Bond auction ($22bn)', detail: 'STRONG demand', minutesFromStart: 70 }]);
  });
});

/** Real headline titles from 2026-10-08/09 (Google News), trimmed to what the reader uses. */
const HEADLINES = [
  ['2026-10-08T22:28:43Z', 'bloomingbit.io', 'S&P 500, Nasdaq Fall After Report Says OpenAI Revenue Missed Expectations [New York Market Briefing]'],
  ['2026-10-09T00:54:40Z', 'ndtvprofit.com', 'Wall Street Highlights: S&P 500, Nasdaq Falls As Reports On OpenAI Sink Chipmakers'],
  ['2026-10-09T07:50:41Z', 'dimsumdaily.hk', 'Nasdaq declines by one per cent as artificial intelligence stocks retreat after OpenAI revenue disappointment'],
  ['2026-10-09T08:00:26Z', 'moneyweb.co.za', 'Nasdaq 100 drops 1.4% as OpenAI warning deepens bubble fears'],
  ['2026-10-09T04:40:00Z', 'au.finance.yahoo.com', 'Asia stocks mixed; chipmakers slide on OpenAI revenue concerns'],
  ['2026-10-08T20:50:13Z', 'reuters.com', 'US bonds rally after 30-year auction finds solid demand'],
  ['2026-10-08T22:30:53Z', 'indexbox.io', 'Treasuries Rally on Strong 30-Year Auction, Yields Fall'],
  ['2026-10-09T00:48:19Z', 'financialexpress.com', 'US Treasury yields retreat as 30-year auction draws unexpectedly firm demand'],
  ['2026-10-08T19:34:28Z', 'nypost.com', 'Oil prices jump 5%, pushing Treasury yields higher and stocks lower as Iranian attacks disrupt tanker traffic'],
  ['2026-10-08T16:08:27Z', 'marketscreener.com', 'TREASURIES-US bonds fall, lifting yields for 2nd day, as oil weighs, 30-year auction looms'],
  ['2026-10-08T09:00:00Z', 'example.com', 'Nasdaq falls as yesterday’s story repeats'], // before the move: not an explanation of it
].map(([publishedUtc, domain, title]) => ({ title, domain, url: domain, publishedUtc }));

describe('market attribution', () => {
  it('reads "asset went this way because cause" out of a headline', () => {
    expect(parseExplainer('US bonds rally after 30-year auction finds solid demand')).toEqual({ cls: 'rates', direction: -1, cause: '30-year auction finds solid demand' });
    expect(parseExplainer('Treasuries Rally on Strong 30-Year Auction, Yields Fall')).toEqual({ cls: 'rates', direction: -1, cause: 'Strong 30-Year Auction' });
    expect(parseExplainer('Nasdaq Falls Over 300 Points as Oil Prices Surge')).toEqual({ cls: 'equities', direction: -1, cause: 'Oil Prices Surge' });
    expect(parseExplainer('OpenAI Revenue Forecast Triggers Global Tech Stock Selloff')).toEqual({ cls: 'equities', direction: -1, cause: 'OpenAI Revenue Forecast' });
    expect(parseExplainer('Stocktwits AI Roundup: OpenAI Revenue Woes Rattle Chip Stocks')).toEqual({ cls: 'equities', direction: -1, cause: 'OpenAI Revenue Woes' });
    expect(parseExplainer('Stocks close mixed on Thursday')).toBeNull();
  });

  it('attributes the stock fall to OpenAI and the bond rally to the auction; Iran explains neither', () => {
    const move = matchMove(NQ, DAY_FROM, DAY_TO, { direction: -1, pct: 2, minutes: 120 }).move!;
    const rows = buildPanel(map, move, NOW);
    const measured = measuredDirections(rows);
    expect(measured).toMatchObject({ equities: -1, rates: -1 });
    const a = attributeMove(HEADLINES, move, measured);
    const stocks = a.filter((x) => x.cls === 'equities');
    const yields = a.filter((x) => x.cls === 'rates');
    // Two of the five came more than 12 hours after the move: they describe Friday's session, not Thursday's.
    expect(stocks[0]).toMatchObject({ outlets: 3, label: 'OpenAI revenue concerns' });
    expect(yields[0]).toMatchObject({ outlets: 3, label: 'Strong 30-Year Auction' });
    expect(a.some((x) => /iran/i.test(x.label))).toBe(false);
  });
});

describe('when the story itself broke', () => {
  it("finds the story's first appearance by its key word, so a report can be placed inside the move", () => {
    const hits = [
      { title: 'Nvidia, Oracle and other AI stocks sink on OpenAI revenue report', domain: 'cnbc.com', url: 'a', publishedUtc: '2026-10-08T18:14:54Z' },
      { title: 'OpenAI annualised revenues $20bn less than previously signalled', domain: 'ft.com', url: 'b', publishedUtc: '2026-10-08T16:42:34Z' },
      { title: 'Chip stocks slip with yields higher', domain: 'x.com', url: 'c', publishedUtc: '2026-10-08T14:05:00Z' },
    ];
    expect(firstSeen(hits, ['openai', 'revenue'])).toEqual({ ms: Date.parse('2026-10-08T16:42:34Z'), source: 'ft.com', title: 'OpenAI annualised revenues $20bn less than previously signalled' });
    expect(firstSeen(hits, [])).toBeNull();
  });

  it('labels the attribution by its first-seen time against the move', () => {
    const move = matchMove(NQ, DAY_FROM, DAY_TO, { direction: -1, pct: 2, minutes: 120 }).move!;
    const a = attributeMove(HEADLINES, move, measuredDirections(buildPanel(map, move, NOW))).find((x) => x.cls === 'equities')!;
    a.firstSeen = { ms: Date.parse('2026-10-08T16:42:34Z'), source: 'ft.com', title: 'OpenAI annualised revenues $20bn less than previously signalled' };
    const text = reactionLines({ symbol: 'NAS100', primaryTicker: 'NQ=F', attribution: [a], move, rows: [], fingerprint: null, catalysts: [], links: [], fit: [], gaps: [], computedAtMs: NOW }).join('\n');
    expect(text).toContain('story first seen 10-08 16:42Z (53 min INTO the move) · ft.com: OpenAI annualised revenues $20bn less than previously signalled');
  });
});
