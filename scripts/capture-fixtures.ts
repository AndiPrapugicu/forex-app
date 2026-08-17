/**
 * Refreshes fixtures/ from live sources.
 *
 * Fixtures back USE_FIXTURES=true offline mode, so they should be real captured
 * payloads rather than hand-written samples — that way offline mode exercises
 * the same parsing paths as production, including the awkward real-world rows.
 *
 * TWO SHAPES, and mixing them up produces an offline mode that silently serves
 * nothing:
 *
 *   raw     fxstreet, faireconomy — captured BEFORE parsing, because their
 *           loaders feed the fixture straight into parsePayload(). Writing a
 *           normalized array here would parse to zero events.
 *   parsed  cot, technicals, yields, news, prices — captured AFTER parsing,
 *           because their loaders cast the fixture straight to the domain type.
 *
 * Every source is captured independently and a failure in one leaves the others
 * refreshed, so a single dead upstream cannot wipe the offline corpus.
 */

import { writeFileSync } from 'node:fs';
import { FAIRECONOMY, FXSTREET } from '@/config/sources.config';
import { ALL_SYMBOLS } from '@/config/symbols.config';
import { fetchCotData } from '@/lib/connectors/cftc';
import { fetchConferenceBoard } from '@/lib/connectors/conference-board';
import { fetchNews } from '@/lib/connectors/rss';
import { fetchPrices } from '@/lib/connectors/prices';
import { fetchTechnicals } from '@/lib/connectors/technicals';
import { fetchSovereignYields } from '@/lib/connectors/yields';

/** Guards against capturing while offline mode is on — that would write fixtures from fixtures. */
if (process.env.USE_FIXTURES === 'true') {
  console.error('USE_FIXTURES=true — refusing to capture fixtures from fixtures.');
  process.exit(1);
}

const results: { name: string; detail: string; ok: boolean }[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
}

function write(file: string, data: unknown) {
  writeFileSync(`fixtures/${file}`, JSON.stringify(data, null, 2));
}

/** Raw JSON straight off the wire, bypassing the connector's caching and parsing. */
async function fetchRawJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function captureFxStreet(now: Date) {
  // The same window fetchFxStreetHistory uses, so the fixture can serve both the
  // scorecard and the 48-hour ingest path.
  const from = new Date(now.getTime() - FXSTREET.historyLookbackDays * 86_400_000);
  const to = new Date(now.getTime() + 7 * 86_400_000);
  const url = `${FXSTREET.base}/${from.toISOString()}/${to.toISOString()}`;

  const payload = await fetchRawJson(url, { ...FXSTREET.headers });
  write('sample-fxstreet.json', payload);
  record('fxstreet', true, `${Array.isArray(payload) ? payload.length : '?'} events (raw)`);
}

async function captureFairEconomy() {
  const payload = await fetchRawJson(FAIRECONOMY.url, { ...FAIRECONOMY.headers });
  write('sample-faireconomy.json', payload);
  record('faireconomy', true, `${Array.isArray(payload) ? payload.length : '?'} events (raw)`);
}

async function captureCot() {
  const cot = await fetchCotData();
  if (!cot.ok) throw new Error(cot.error);
  write('sample-cot.json', [...cot.data.values()]);
  record('cot', true, `${cot.data.size} contracts`);
}

async function captureTechnicals() {
  const tech = await fetchTechnicals(ALL_SYMBOLS.map((s) => ({ symbol: s.symbol, yahoo: s.yahoo })));
  if (!tech.ok) throw new Error(tech.error);

  const rows = [...tech.data.values()];
  write('sample-technicals.json', rows);

  // The trend score reads smaFast/smaSlow/smaSlowPrior. A fixture captured
  // before those existed parses fine and then scores every trend cell as null,
  // which is invisible unless it is counted here.
  const withTrend = rows.filter((t) => t.smaFast !== null && t.smaSlowPrior !== null).length;
  record('technicals', true, `${rows.length} symbols, ${withTrend} with trend averages`);
}

async function captureConferenceBoard() {
  const cb = await fetchConferenceBoard();
  if (!cb.ok) throw new Error(cb.error);
  if (cb.data.length === 0) throw new Error('no releases parsed');
  write('sample-conference-board.json', cb.data);
  const latest = cb.data[0];
  record('conference-board', true, `${cb.data.length} releases, latest ${latest.dateUtc.slice(0, 10)} a=${latest.actual} f=${latest.consensus}`);
}

async function captureYields() {
  const yields = await fetchSovereignYields();
  if (!yields.ok) throw new Error(yields.error);
  write('sample-yields.json', [...yields.data.values()]);
  record('yields', true, [...yields.data.values()].map((y) => `${y.currency} ${y.value}%`).join(', ') || 'none');
}

async function captureNews() {
  const news = await fetchNews();
  if (!news.ok) throw new Error(news.error);
  write('sample-news.json', news.data.slice(0, 60));
  record('news', true, `${news.data.length} items (60 written)`);
}

async function capturePrices() {
  const prices = await fetchPrices();
  if (!prices.ok) throw new Error(prices.error);
  write('sample-prices.json', prices.data);
  record('prices', true, `${prices.data.length} quotes`);
}

async function main() {
  const now = new Date();

  const tasks: [string, () => Promise<void>][] = [
    ['fxstreet', () => captureFxStreet(now)],
    ['faireconomy', captureFairEconomy],
    ['cot', captureCot],
    ['technicals', captureTechnicals],
    ['yields', captureYields],
    ['conference-board', captureConferenceBoard],
    ['news', captureNews],
    ['prices', capturePrices],
  ];

  // Sequential rather than parallel: several of these hit the same undocumented
  // hosts the connectors do, and FairEconomy in particular rate-limits hard.
  for (const [name, run] of tasks) {
    try {
      await run();
    } catch (err) {
      record(name, false, err instanceof Error ? err.message : String(err));
    }
  }

  console.log();
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name.padEnd(13)} ${r.detail}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log(`\n${failed.length} source(s) failed — their fixtures are unchanged, not emptied.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
