/**
 * Refreshes fixtures/ from live sources.
 *
 * Fixtures back USE_FIXTURES=true offline mode, so they should be real captured
 * payloads rather than hand-written samples — that way offline mode exercises
 * the same parsing paths as production, including the awkward real-world rows.
 */

import { writeFileSync } from 'node:fs';
import { fetchNews } from '@/lib/connectors/rss';
import { fetchPrices } from '@/lib/connectors/prices';

async function main() {
  const [news, prices] = await Promise.all([fetchNews(), fetchPrices()]);

  if (news.ok) {
    writeFileSync('fixtures/sample-news.json', JSON.stringify(news.data.slice(0, 60), null, 2));
  }
  if (prices.ok) {
    writeFileSync('fixtures/sample-prices.json', JSON.stringify(prices.data, null, 2));
  }

  console.log('news:', news.ok ? news.data.length : 'FAIL');
  console.log('prices:', prices.ok ? prices.data.length : 'FAIL');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
