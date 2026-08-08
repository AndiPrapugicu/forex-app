/**
 * Connector smoke test: hits every upstream and prints a health table.
 *
 * Run with `npm run ingest:dry`. This is the fastest way to tell whether a
 * source has broken — especially FXStreet and Yahoo, which are undocumented and
 * can change without notice.
 */

import { fetchFxStreetCalendar } from '@/lib/connectors/fxstreet';
import { fetchFairEconomyCalendar } from '@/lib/connectors/faireconomy';
import { fetchNews } from '@/lib/connectors/rss';
import { fetchPrices } from '@/lib/connectors/prices';
import { fetchPolicyRates } from '@/lib/connectors/dbnomics';
import { fetchCotData, latestReportDate, reportAgeDays } from '@/lib/connectors/cftc';
import { fetchTechnicals } from '@/lib/connectors/technicals';
import { ALL_SYMBOLS } from '@/config/symbols.config';
import type { Result } from '@/lib/types';

function report(label: string, res: Result<unknown[]>) {
  if (res.ok) {
    const n = Array.isArray(res.data) ? res.data.length : 0;
    const note = res.degraded ? `  (degraded: ${res.degraded})` : '';
    console.log(`  ok    ${label.padEnd(22)} ${String(n).padStart(4)} rows${note}`);
  } else {
    console.log(`  FAIL  ${label.padEnd(22)} ${res.error}`);
  }
}

async function main() {
  console.log('\nConnector health check\n' + '-'.repeat(60));

  const [fxs, ff, news, prices, rates, cot, tech] = await Promise.all([
    fetchFxStreetCalendar(),
    fetchFairEconomyCalendar(),
    fetchNews(),
    fetchPrices(),
    fetchPolicyRates(),
    fetchCotData(),
    fetchTechnicals(ALL_SYMBOLS.map((s) => ({ symbol: s.symbol, yahoo: s.yahoo }))),
  ]);

  report('FXStreet calendar', fxs);
  report('FairEconomy calendar', ff);
  report('RSS news', news);
  report('Prices', prices);
  report('Policy rates', rates);
  // Maps, not arrays — report() wants something with a length.
  report('CFTC COT', cot.ok ? { ...cot, data: [...cot.data.values()] } : cot);
  report('Technicals', tech.ok ? { ...tech, data: [...tech.data.values()] } : tech);

  if (cot.ok) {
    const date = latestReportDate(cot.data);
    if (date) console.log(`\nCOT report ${date} (${reportAgeDays(date)} days old — 3-10 is normal)`);
  }

  console.log('-'.repeat(60));

  if (fxs.ok) {
    const withActual = fxs.data.filter((e) => e.actual !== null).length;
    const high = fxs.data.filter((e) => e.impact === 'HIGH').length;
    console.log(`\nFXStreet: ${withActual}/${fxs.data.length} with actuals, ${high} high-impact`);

    const recent = fxs.data
      .filter((e) => e.actual !== null && e.consensus !== null && e.impact === 'HIGH')
      .slice(-5);
    if (recent.length) {
      console.log('\nRecent high-impact prints:');
      for (const e of recent) {
        console.log(
          `  ${e.currency}  ${e.name.slice(0, 38).padEnd(38)} ` +
            `A:${e.actual}  C:${e.consensus}  dev:${e.ratioDeviation ?? 'n/a'}`,
        );
      }
    }
  }

  if (news.ok) {
    const flagged = news.data.filter((n) => n.matchedKeywords.length > 0);
    console.log(`\nNews: ${news.data.length} items, ${flagged.length} matched risk keywords`);
    for (const n of flagged.slice(0, 5)) {
      console.log(`  [${n.category}] ${n.title.slice(0, 60)} (${n.domain}) ${n.matchedKeywords.join(',')}`);
    }
  }

  if (prices.ok) {
    console.log('\nPrices:');
    for (const p of prices.data) {
      const chg = p.changePct === null ? 'n/a' : `${p.changePct >= 0 ? '+' : ''}${p.changePct.toFixed(2)}%`;
      console.log(`  ${p.label.padEnd(14)} ${String(p.price).padStart(10)}  ${chg}`);
    }
  }

  console.log();
  const anyFailed = [fxs, ff, news, prices].some((r) => !r.ok);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error('dry run crashed:', err);
  process.exit(1);
});
