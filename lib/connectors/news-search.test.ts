import { describe, expect, it } from 'vitest';
import { parseSearchFeed, sanitizeQuery, searchUrl } from '@/lib/connectors/news-search';

const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>
<item><title>Euro zone inflation surges more than expected - Reuters</title><link>https://news.google.com/rss/articles/a</link><pubDate>Fri, 02 Oct 2026 09:57:23 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
<item><title>Eurozone inflation hits 3.8% - Morningstar</title><link>https://news.google.com/rss/articles/b</link><pubDate>Fri, 02 Oct 2026 10:44:41 GMT</pubDate><source url="https://www.morningstar.com">Morningstar</source></item>
<item><title>No date here - Nobody</title><link>x</link><source url="https://nobody.com">Nobody</source></item>
</channel></rss>`;

describe('parseSearchFeed', () => {
  it('reads headline, publisher and time, newest first, and drops undated items', () => {
    const hits = parseSearchFeed(FEED);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      title: 'Eurozone inflation hits 3.8%',
      source: 'Morningstar',
      domain: 'morningstar.com',
      publishedUtc: '2026-10-02T10:44:41.000Z',
    });
    expect(hits[1].title).toBe('Euro zone inflation surges more than expected');
    expect(hits[1].domain).toBe('reuters.com');
  });

  it('caps the count and survives garbage', () => {
    expect(parseSearchFeed(FEED, 1)).toHaveLength(1);
    expect(parseSearchFeed('not xml at all')).toEqual([]);
  });
});

describe('sanitizeQuery', () => {
  it('keeps a plain query and strips operators and punctuation', () => {
    expect(sanitizeQuery('European gas prices')).toBe('European gas prices');
    expect(sanitizeQuery('ECB "rate" site:evil.com OR (x)')).toBe('ECB rate site evil.com OR x');
  });

  it('caps the length', () => {
    expect(sanitizeQuery('a'.repeat(200))).toHaveLength(80);
  });

  it('pins the window into the URL', () => {
    expect(searchUrl('ECB rate')).toBe(
      'https://news.google.com/rss/search?q=ECB%20rate%20when%3A2d&hl=en-US&gl=US&ceid=US:en',
    );
  });
});
