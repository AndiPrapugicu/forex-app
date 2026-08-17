/**
 * Runs the score backtest and prints the result.
 *
 *   npm run backtest
 *
 * A script rather than a page because this is an experiment you run when the
 * model changes, not a number you watch. It answers one question: does a high
 * score do better than a low one, and better than doing nothing?
 *
 * READ THE BASELINE FIRST. If every symbol rose over the window, every bucket
 * shows a positive mean and none of it means anything. Only the gap between a
 * bucket and the baseline is evidence.
 */

import { fetchCotData } from '@/lib/connectors/cftc';
import { fetchConferenceBoard } from '@/lib/connectors/conference-board';
import { fetchFxStreetHistory } from '@/lib/connectors/fxstreet';
import { fetchDailyBars, fetchTechnicals, type DailyBars, type Technicals } from '@/lib/connectors/technicals';
import { ALL_SYMBOLS } from '@/config/symbols.config';
import {
  DEFAULT_HORIZONS,
  byScore,
  independentWindows,
  runBacktest,
  spreadByDate,
  summarise,
} from '@/lib/scoring/backtest';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(3)}%`;

async function main() {
  const now = new Date();
  console.log('fetching…');

  const [history, cot, conferenceBoard, technicals] = await Promise.all([
    fetchFxStreetHistory(now),
    fetchCotData(),
    fetchConferenceBoard(),
    // Only for seasonality, which is by calendar month and so date-independent.
    fetchTechnicals(ALL_SYMBOLS.map((s) => ({ symbol: s.symbol, yahoo: s.yahoo }))),
  ]);

  const events = [
    ...(history.ok ? history.data : []),
    ...(conferenceBoard.ok ? conferenceBoard.data : []),
  ];

  // Daily bars per symbol, in batches — 49 symbols at once gets us blocked.
  const bars = new Map<string, DailyBars>();
  const BATCH = 6;
  for (let i = 0; i < ALL_SYMBOLS.length; i += BATCH) {
    const batch = ALL_SYMBOLS.slice(i, i + BATCH);
    const got = await Promise.all(batch.map((s) => fetchDailyBars(s.yahoo)));
    got.forEach((b, k) => { if (b) bars.set(batch[k].symbol, b); });
  }

  const seasonality = new Map<string, Technicals['seasonality']>();
  if (technicals.ok) for (const [symbol, t] of technicals.data) seasonality.set(symbol, t.seasonality);

  console.log(
    `  ${events.length} calendar events · ${cot.ok ? cot.data.size : 0} COT contracts · ` +
    `${bars.size} symbols with bars\n`,
  );

  /**
   * The calendar is the binding constraint: 150 days of history, so the replay
   * cannot reach further back than that however many price bars we hold. Before
   * the window opens every macro cell reads "no data" and the score collapses to
   * technicals alone — which would look like a finding and would be an artefact.
   */
  const OLDEST = new Date(now.getTime() - 150 * 86_400_000);
  const reference = bars.get('EURUSD');
  if (!reference) { console.error('no EURUSD bars — cannot anchor the replay'); process.exit(1); }

  const firstUsable = reference.timestamps.findIndex((t) => t * 1000 >= OLDEST.getTime());
  const trimmed = new Map(bars);
  console.log(`replaying from ${new Date(reference.timestamps[firstUsable] * 1000).toISOString().slice(0, 10)} — the calendar's reach\n`);

  const observations = runBacktest(
    { events, cot: cot.ok ? cot.data : new Map(), bars: trimmed, seasonality, warmupBars: Math.max(firstUsable, 15) },
    'EURUSD',
  );

  if (observations.length === 0) { console.error('no observations produced'); process.exit(1); }

  const dates = [...new Set(observations.map((o) => o.dateUtc.slice(0, 10)))].sort();
  console.log(`${observations.length} observations across ${dates.length} dates (${dates[0]} -> ${dates[dates.length - 1]})\n`);

  for (const r of summarise(observations, DEFAULT_HORIZONS)) {
    console.log(`── ${r.horizon}-day forward return ─────────────────────────────`);
    console.log(`   baseline (all observations)   n=${String(r.baseline.n).padStart(5)}  mean ${pct(r.baseline.meanPct)}  median ${pct(r.baseline.medianPct)}`);
    console.log(`   ${'bias'.padEnd(14)} ${'n'.padStart(6)} ${'mean'.padStart(9)} ${'vs base'.padStart(9)} ${'median'.padStart(9)} ${'hit'.padStart(7)}`);
    for (const b of r.buckets) {
      if (b.n === 0) { console.log(`   ${b.bias.padEnd(14)} ${'0'.padStart(6)}         —`); continue; }
      const edge = b.meanPct - r.baseline.meanPct;
      console.log(
        `   ${b.bias.padEnd(14)} ${String(b.n).padStart(6)} ${pct(b.meanPct).padStart(9)} ` +
        `${pct(edge).padStart(9)} ${pct(b.medianPct).padStart(9)} ` +
        `${(b.hitRatePct === null ? '—' : `${b.hitRatePct.toFixed(1)}%`).padStart(7)}`,
      );
    }
    console.log();
  }

  /**
   * How much of the above is actually evidence.
   *
   * The observation counts look decisive and are not: 49 symbols on one date are
   * largely one dollar trade, and consecutive 20-day windows share almost all of
   * their return. This collapses to one spread per date and then samples those
   * dates a full horizon apart, which is the honest sample.
   */
  for (const h of [5, 20]) {
    const all = spreadByDate(observations, h);
    const indep = independentWindows(all, h);
    const spreads = indep.map((w) => w.spread as number);
    if (spreads.length === 0) continue;

    const mean = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    const sd = Math.sqrt(spreads.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(spreads.length - 1, 1));
    const t = sd === 0 ? 0 : mean / (sd / Math.sqrt(spreads.length));
    const positive = spreads.filter((s) => s > 0).length;

    console.log(`── ${h}-day bullish-minus-bearish spread, INDEPENDENT windows ──`);
    console.log(`   ${all.length} dates -> ${spreads.length} non-overlapping windows`);
    console.log(`   mean spread ${pct(mean)}   sd ${sd.toFixed(3)}%   t ≈ ${t.toFixed(2)}`);
    console.log(`   positive in ${positive}/${spreads.length} windows`);
    console.log(`   ${Math.abs(t) > 2 ? 'holds up at this sample size' : 'NOT significant — too few independent windows to conclude'}\n`);
  }

  console.log('── mean 5-day return by exact score ───────────────────────');
  console.log('   (is it monotonic, or are the bands just cut in the wrong place?)');
  for (const row of byScore(observations, 5)) {
    if (row.n < 5) continue; // too thin to read anything into
    const bar = '█'.repeat(Math.min(Math.round(Math.abs(row.meanPct) * 20), 30));
    console.log(`   ${String(row.score).padStart(4)}  n=${String(row.n).padStart(5)}  ${pct(row.meanPct).padStart(9)}  ${bar}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
