/**
 * Economic Surprise Meter — one dial per major, plus the global average.
 *
 * Answers a narrower question than the scorecard: not "is this currency
 * strong", but "has this economy been beating or missing what was expected of
 * it lately". A currency can be bullish on the board while its data
 * disappoints, and the two disagreeing is itself the signal.
 *
 * THE NUMBER IS bullish / (bullish + bearish), NEUTRALS EXCLUDED, which is A1's
 * arithmetic read directly off seven of their published cards — the working is
 * in `bullishShare`. Prints landing exactly on forecast are dropped from the
 * denominator rather than counted as half a beat, so a currency whose releases
 * all came in on target reads "no signal" instead of a confident 50%.
 *
 * Derived from `buildCurrencyHeatmap`, the same function behind /heatmap and
 * the /macro surprise panel, so all three pages report one number per currency.
 * Three different formulas used to answer this question in this repo.
 */

import Link from 'next/link';
import { MAJORS } from '@/lib/types';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { buildCurrencyHeatmap } from '@/lib/scoring/heatmap';
import { SURPRISE_MIN_SAMPLE } from '@/lib/scoring/market';
import { PercentGauge } from '@/components/Gauge';
import { MetricDescription, PageHeader } from '@/components/primitives';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

const CONTAINER = 'mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6';

export default async function SurprisePage() {
  const { events, health, matrix } = await runSetupsPipeline();

  const header = (
    <PageHeader
      title="Economic Surprise Index"
      description="Share of each economy's recent releases that beat expectations"
      updated={`Updated ${matrix.generatedAtUtc.slice(11, 16)} UTC`}
      info={
        <>
          Beats divided by beats plus misses. Releases exactly on forecast are left out rather than counted as half a
          beat, so a currency with nothing either side of forecast reads —, not 50%.
        </>
      }
    />
  );

  if (events.length === 0) {
    const failed = health.find((h) => !h.ok);
    return (
      <div className={CONTAINER}>
        {header}
        <Panel title="Unavailable">
          <EmptyState message="Could not load calendar history" hint={failed?.detail} />
        </Panel>
      </div>
    );
  }

  const cards = MAJORS.map((currency) => {
    const heatmap = buildCurrencyHeatmap(currency, events);
    const directional = heatmap.rows.filter((r) => r.currencyImpact !== null && r.currencyImpact !== 0).length;

    return {
      currency,
      pct: heatmap.currencyImpactPct,
      scored: heatmap.scored,
      directional,
      thin: directional > 0 && directional < SURPRISE_MIN_SAMPLE,
    };
  });

  /**
   * The plain mean of the currencies that have a reading, floored.
   *
   * A1's card averages their eight gauges — 60+57+50+56+60+88+71+50 = 492, /8 =
   * 61.5, displayed as 61%. A currency with no directional release is SKIPPED
   * rather than counted as 50: treating "we cannot tell" as "exactly average"
   * would drag the global figure toward the midpoint precisely when the data is
   * thinnest.
   */
  const known = cards.filter((c) => c.pct !== null);
  const globalPct =
    known.length === 0 ? null : Math.floor(known.reduce((t, c) => t + (c.pct ?? 0), 0) / known.length);

  return (
    <div className={CONTAINER}>
      {header}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <Panel title="All currencies" subtitle="Tap a dial for every release behind it">
          <div className="grid grid-cols-2 gap-x-2 gap-y-4 p-3 sm:grid-cols-4">
            {cards.map((c) => (
              <Link
                key={c.currency}
                href={`/heatmap?currency=${c.currency}`}
                aria-label={`${c.currency}: ${c.directional} directional of ${c.scored} scored releases. Open the heatmap.`}
                className="rounded-[var(--radius-control)] py-2 transition-colors hover:bg-[var(--color-surface-2)] active:bg-[var(--color-surface-2)]"
              >
                <PercentGauge
                  pct={c.pct}
                  label={c.currency}
                  sublabel={
                    c.pct === null ? 'no directional data' : c.thin ? `thin (${c.directional})` : `${c.directional} releases`
                  }
                />
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Global score" subtitle="Average of the eight dials">
          <div className="flex flex-col items-center gap-3 p-4">
            <PercentGauge pct={globalPct} label="AVG" size={170} />
            <p className="text-caption leading-relaxed text-[var(--color-muted)]">
              Because the dollar is one of the eight, a reading well above 50 with a weak USD dial says the rest of the
              world is carrying it.
              {known.length < MAJORS.length && (
                <span className="mt-2 block text-[var(--color-faint)]">
                  Averaged over {known.length} of {MAJORS.length} currencies; the rest had no release either side of
                  forecast.
                </span>
              )}
            </p>
          </div>
        </Panel>
      </div>

      <MetricDescription>
        <p>
          A <span className="font-semibold text-[var(--color-bull)]">higher</span> score means most of that economy&apos;s
          key metrics — GDP, PMIs, CPI, retail sales, employment — have recently come in stronger than forecast; a{' '}
          <span className="font-semibold text-[var(--color-bear)]">lower</span> score means most of them missed.
        </p>
        <p className="mt-2">
          Where a series carries no published forecast at all — several Australasian surveys never do — the direction is
          read against the previous print instead.
        </p>
      </MetricDescription>
    </div>
  );
}
