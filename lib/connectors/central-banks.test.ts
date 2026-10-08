import { describe, expect, it } from 'vitest';
import { BANK_FEEDS, extractPageText, pickPolicyItems } from '@/lib/connectors/central-banks';

const fed = BANK_FEEDS.find((f) => f.currency === 'USD')!;
const boe = BANK_FEEDS.find((f) => f.currency === 'GBP')!;
const NOW = new Date('2026-10-03T12:00:00Z');

const FED_FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>Fed</title>
<item><title><![CDATA[Federal Reserve issues FOMC statement]]></title><link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm]]></link><pubDate>Wed, 16 Sep 2026 18:00:00 GMT</pubDate></item>
<item><title><![CDATA[Minutes of the Board's discount rate meetings on July 20 and July 29, 2026]]></title><link>https://x/a.htm</link><pubDate>Tue, 25 Aug 2026 18:00:00 GMT</pubDate></item>
<item><title><![CDATA[Minutes of the Federal Open Market Committee, July 28-29, 2026]]></title><link>https://x/b.htm</link><pubDate>Wed, 19 Aug 2026 18:00:00 GMT</pubDate></item>
<item><title><![CDATA[Federal Reserve issues FOMC statement]]></title><link>https://x/old.htm</link><pubDate>Wed, 29 Jul 2026 18:00:00 GMT</pubDate></item>
</channel></rss>`;

describe('pickPolicyItems', () => {
  it('takes the newest statement and the minutes, and skips the discount-rate minutes and the older repeat', () => {
    const items = pickPolicyItems(FED_FEED, fed, NOW);
    expect(items.map((i) => i.title)).toEqual([
      'Federal Reserve issues FOMC statement',
      'Minutes of the Federal Open Market Committee, July 28-29, 2026',
    ]);
    expect(items[0].publishedUtc).toBe('2026-09-16T18:00:00.000Z');
  });

  it('ignores the bank’s non-policy news', () => {
    const feed = `<rss><channel>
<item><title>Appointment of members of the EDMC</title><link>https://b/1</link><pubDate>Fri, 02 Oct 2026 09:00:00 GMT</pubDate></item>
<item><title>Bank rate maintained at 3.75% - September 2026 Monetary Policy Summary and Minutes</title><link>https://b/2</link><pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`;
    const items = pickPolicyItems(feed, boe, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://b/2');
  });

  it('drops documents older than its window and anything dated in the future', () => {
    const feed = `<rss><channel>
<item><title>Federal Reserve issues FOMC statement</title><link>https://x/1</link><pubDate>Wed, 01 Jan 2025 18:00:00 GMT</pubDate></item>
<item><title>Federal Reserve issues FOMC statement</title><link>https://x/2</link><pubDate>Wed, 01 Jan 2031 18:00:00 GMT</pubDate></item>
</channel></rss>`;
    expect(pickPolicyItems(feed, fed, NOW)).toEqual([]);
  });

  it('records the RBA as a gap rather than a source', () => {
    const rba = BANK_FEEDS.find((f) => f.currency === 'AUD')!;
    expect(rba.url).toBeNull();
    expect(rba.gap).toMatch(/403/);
  });
});

describe('extractPageText', () => {
  it('keeps the main text, drops scripts and furniture, decodes entities', () => {
    const html = `<html><body><nav>Menu Home About</nav><main><h1>FOMC statement</h1>
<script>var x = 1;</script><p>Inflation has moved up &amp; remains somewhat elevated.</p>
<p>The Committee decided to maintain the target range at 3&#189; to 3&frac34; percent.</p></main>
<footer>Last update</footer></body></html>`;
    const text = extractPageText(html);
    expect(text).toContain('FOMC statement');
    expect(text).toContain('Inflation has moved up & remains somewhat elevated.');
    expect(text).not.toContain('var x');
    expect(text).not.toContain('Menu');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('caps the length', () => {
    expect(extractPageText(`<main><p>${'a'.repeat(50)}</p></main>`, 10)).toBe('aaaaaaaaaa…');
  });
});
