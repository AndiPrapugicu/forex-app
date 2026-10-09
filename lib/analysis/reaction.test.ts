/**
 * The user's own question, as a fixture: Nasdaq futures down about 2% in two
 * hours on 2026-10-08, every Treasury yield falling with them, after a
 * "Trump having productive discussions with Iran" headline.
 */

import { describe, expect, it } from 'vitest';
import { REACTION_PANEL } from '@/config/reaction.config';
import { parseSpark, type IntradaySeries } from '@/lib/connectors/intraday';
import { checkImages } from '@/lib/analysis/attachments';
import { answerMode } from '@/lib/analysis/prompt';
import {
  buildPanel,
  changeBetween,
  findMove,
  fingerprint,
  fitNotes,
  linkQueries,
  rankCatalysts,
  reactionLines,
  tagHeadline,
} from './reaction';

const START = Date.parse('2026-10-08T14:00:00Z');
const NOW = Date.parse('2026-10-08T17:00:00Z');
const M5 = 5 * 60_000;

/** 5-minute closes: flat until 14:30, then linear from `a` to `b` by 16:30, then flat. */
function path(ticker: string, a: number, b: number): IntradaySeries {
  const t: number[] = [];
  const c: number[] = [];
  for (let ms = START; ms <= NOW; ms += M5) {
    const k = Math.min(1, Math.max(0, (ms - (START + 30 * 60_000)) / (120 * 60_000)));
    t.push(ms);
    c.push(a + (b - a) * k);
  }
  return { ticker, t, c };
}

const series = new Map<string, IntradaySeries>(
  [
    path('NQ=F', 30870, 30250), // −2.0%
    path('ES=F', 7800, 7700),
    path('ZT=F', 101.7, 101.9), // price up → 2Y yield down ≈ −10bp
    path('^FVX', 5.0, 4.92),
    path('^TNX', 5.24, 5.17), // −7bp
    path('^TYX', 5.62, 5.57), // −5bp → front end led: bull steepener
    path('DX-Y.NYB', 102.3, 102.0),
    path('JPY=X', 158.2, 157.4), // yen bid
    path('CHF=X', 0.80, 0.798),
    path('GC=F', 4120, 4160), // gold bid
    path('CL=F', 94, 90.5), // oil −3.7%
    path('^VIX', 15, 18),
  ].map((s) => [s.ticker, s]),
);

const headlines = [
  { title: 'Trump says having productive discussions with Iran, we will see', url: 'u1', domain: 'reuters.com', publishedUtc: '2026-10-08T14:20:00Z' },
  { title: 'Oil slides as US-Iran talks raise hopes of de-escalation', url: 'u2', domain: 'bloomberg.com', publishedUtc: '2026-10-08T15:10:00Z' },
  { title: 'Fed speakers flag downside risks to growth', url: 'u3', domain: 'ft.com', publishedUtc: '2026-10-08T13:40:00Z' },
  { title: 'Old story from yesterday', url: 'u4', domain: 'cnbc.com', publishedUtc: '2026-10-07T10:00:00Z' },
];

describe('the move', () => {
  const move = findMove(series.get('NQ=F'), NOW)!;

  it('finds the largest swing and its times', () => {
    expect(new Date(move.startMs).toISOString()).toBe('2026-10-08T14:30:00.000Z');
    expect(new Date(move.endMs).toISOString()).toBe('2026-10-08T16:30:00.000Z');
    expect(move.changePct).toBeCloseTo(-2.008, 2);
  });

  it('reads a yield in bp, and a note future as an approximate yield', () => {
    const tenY = REACTION_PANEL.find((i) => i.ticker === '^TNX')!;
    const twoY = REACTION_PANEL.find((i) => i.ticker === 'ZT=F')!;
    expect(changeBetween(series.get('^TNX'), tenY, move.startMs, move.endMs)!.value).toBeCloseTo(-7, 6);
    const zt = changeBetween(series.get('ZT=F'), twoY, move.startMs, move.endMs)!;
    expect(zt.approx).toBe(true);
    expect(zt.value).toBeCloseTo(-10.35, 1);
  });

  it('refuses a bar too far from the moment asked for', () => {
    const inst = REACTION_PANEL[0];
    expect(changeBetween(series.get('NQ=F'), inst, START - 3 * 3_600_000, NOW)).toBeNull();
  });
});

describe('the fingerprint of the user’s afternoon', () => {
  const move = findMove(series.get('NQ=F'), NOW)!;
  const rows = buildPanel(series, move, NOW);
  const fp = fingerprint(rows);

  it('reads risk-off with bonds bid, a bull steepener, havens bid and oil down', () => {
    expect(fp.pattern).toBe('risk-off');
    expect(fp.curve).toMatch(/^BULL STEEPENER/);
    expect(fp.havens).toEqual({ up: 4, of: 4 });
    expect(fp.oil).toMatch(/^Oil dropped −3\.72%/);
  });

  it('times the headlines against the start, closest first, the old one dropped', () => {
    const c = rankCatalysts(headlines, move);
    expect(c.map((x) => x.minutesFromStart)).toEqual([-10, -50, 40]);
    expect(c[0].tags).toEqual(['Middle East', 'diplomacy']);
  });

  it('says the diplomacy headline does not explain a risk-off move on its own', () => {
    const notes = fitNotes(fp, rankCatalysts(headlines, move));
    expect(notes[0]).toMatch(/^MISMATCH: the closest headline reads as de-escalation or diplomacy/);
  });

  it('calls a Nasdaq-only fall with small caps up NARROW, and a shared one BROAD', () => {
    expect(fp.breadth).toMatch(/^BROAD/);
    const narrow = new Map(series);
    narrow.set('ES=F', path('ES=F', 7800, 7770));
    narrow.set('RTY=F', path('RTY=F', 2400, 2406));
    expect(fingerprint(buildPanel(narrow, move, NOW)).breadth).toMatch(/^NARROW — the Nasdaq \(−2\.01%\) moved far more than the S&P/);
  });

  it("times the story behind the user's link against the move", () => {
    const late = fitNotes(fp, [], move, [{ publishedUtc: '2026-10-08T17:30:00Z' }]);
    expect(late[0]).toBe(
      "TIMING: the story behind the user's link first appears 180 minutes AFTER the move began and after it ended: it cannot have started the move. It may have extended it, or be a reaction to it.",
    );
    const early = fitNotes(fp, [], move, [{ publishedUtc: '2026-10-08T14:25:00Z' }]);
    expect(early[0]).toMatch(/5 minutes before the move began — consistent with it being a trigger/);
  });

  it('drops headlines that are not about markets at all', () => {
    const noise = [{ title: 'Morgan Stanley raises target for Moderna to USD 95', url: 'x', domain: 'x.com', publishedUtc: '2026-10-08T14:31:00Z' }];
    expect(rankCatalysts(noise, move)).toEqual([]);
  });

  it('writes section R for the dossier', () => {
    const lines = reactionLines({
      symbol: 'NAS100',
      primaryTicker: 'NQ=F',
      move,
      rows,
      fingerprint: fp,
      catalysts: rankCatalysts(headlines, move),
      links: [{ link: linkQueries('https://www.forexfactory.com/news/1430608-trump-having-productive-discussions-with-iran-we-will')[0], hits: [] }],
      fit: fitNotes(fp, rankCatalysts(headlines, move)),
      gaps: [],
      computedAtMs: NOW,
    });
    const text = lines.join('\n');
    expect(lines[0]).toBe('## R. WHAT JUST MOVED (deterministic, OUR 5-minute bars, computed 17:00Z — restate it; do not re-derive it)');
    expect(text).toContain('Move: NAS100 (NQ=F) −2.01% from 30870 at 14:30Z to 30250 at 16:30Z (120 minutes).');
    expect(text).toContain('- US 10Y yield: −7.0bp |');
    expect(text).toContain('Pattern: RISK-OFF WITH BONDS BID');
    expect(text).toContain('searched "trump having productive discussions with iran we will"');
    expect(text).toContain('- 14:20Z (-10 min) · reuters.com · Trump says having productive discussions with Iran, we will see [Middle East, diplomacy]');
    expect(text).toContain('Fit: MISMATCH');
  });
});

describe('helpers', () => {
  it('turns a pasted link into search words, never fetching it', () => {
    expect(linkQueries('see https://www.forexfactory.com/news/1430608-trump-having-productive-discussions-with-iran-we-will now')).toEqual([
      {
        url: 'https://www.forexfactory.com/news/1430608-trump-having-productive-discussions-with-iran-we-will',
        domain: 'forexfactory.com',
        query: 'trump having productive discussions with iran we will',
      },
    ]);
    expect(linkQueries('https://example.com/a/1234')).toEqual([]);
  });

  it('tags escalation and de-escalation apart', () => {
    expect(tagHeadline('Israel strikes Iran nuclear sites')).toEqual(['Middle East', 'escalation']);
    expect(tagHeadline('Ceasefire agreed in Gaza')).toEqual(['Middle East', 'de-escalation']);
    expect(tagHeadline('US and Iran hold productive talks')).toEqual(['Middle East', 'diplomacy']);
  });

  it('parses Yahoo spark, dropping empty bars and empty tickers', () => {
    const map = parseSpark({
      spark: {
        result: [
          { symbol: 'NQ=F', response: [{ timestamp: [1, 2, 3], indicators: { quote: [{ close: [10, null, 11] }] } }] },
          { symbol: 'ZT=F', response: [{ timestamp: [1], indicators: { quote: [{ close: [null] }] } }] },
        ],
      },
    });
    expect([...map.keys()]).toEqual(['NQ=F']);
    expect(map.get('NQ=F')).toEqual({ ticker: 'NQ=F', t: [1000, 3000], c: [10, 11] });
  });
});

describe('routing and attachments', () => {
  it("routes the user's question to REACTION, and a trade question stays a DECISION", () => {
    expect(
      answerMode('The Nasdaq just dropped for around 2% in around 2 hours, after this news: https://www.forexfactory.com/news/1430608-x-y-z. Why?'),
    ).toBe('reaction');
    expect(answerMode('De ce a scăzut aurul azi?')).toBe('reaction');
    expect(answerMode('Gold spiked — is this a good entry for a long?')).toBe('decision');
    expect(answerMode('What happened in the last 24h?')).toBe('brief');
    expect(answerMode('anything', 'reaction')).toBe('reaction');
  });

  it('accepts two small PNG/JPEG/WebP data URLs and nothing else', () => {
    expect(checkImages(undefined)).toEqual({ ok: true, images: [] });
    expect(checkImages(['data:image/png;base64,AAAA', 'data:image/webp;base64,BBB='])).toMatchObject({ ok: true });
    expect(checkImages(['data:image/svg+xml;base64,AAAA'])).toMatchObject({ ok: false });
    expect(checkImages(['https://example.com/x.png'])).toMatchObject({ ok: false });
    expect(checkImages(['data:image/png;base64,A', 'data:image/png;base64,B', 'data:image/png;base64,C'])).toMatchObject({ ok: false });
    expect(checkImages([`data:image/png;base64,${'A'.repeat(2_000_001)}`])).toMatchObject({ ok: false, reason: /too large/ });
  });
});
