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
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function SurprisePage() {
  const { events, health } = await runSetupsPipeline();

  if (events.length === 0) {
    const failed = health.find((h) => !h.ok);
    return (
      <div className="px-4 py-4">
        <h1 className="mb-4 text-lg font-bold">Economic Surprise Meter</h1>
        <Panel title="Unavailable">
          <EmptyState message="Could not load calendar history" hint={failed?.detail} />
        </Panel>
      </div>
    );
  }

  const cards = MAJORS.map((currency) => {
    const heatmap = buildCurrencyHeatmap(currency, events);
    const directional = heatmap.rows.filter(
      (r) => r.currencyImpact !== null && r.currencyImpact !== 0,
    ).length;

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
    <div className="px-4 py-4">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-bold">Economic Surprise Meter</h1>
        <span className="text-[11px] text-[var(--color-faint)]">
          Share of each economy&apos;s recent releases that beat expectations
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Panel title="All currencies">
            <div className="grid grid-cols-2 gap-x-2 gap-y-4 p-3 sm:grid-cols-4">
              {cards.map((c) => (
                <Link
                  key={c.currency}
                  href={`/heatmap?currency=${c.currency}`}
                  className="rounded-md py-1 transition-colors hover:bg-[var(--color-surface-2)]/50"
                  title={`${c.currency}: ${c.directional} directional of ${c.scored} scored releases. Open the heatmap.`}
                >
                  <PercentGauge
                    pct={c.pct}
                    label={c.currency}
                    sublabel={
                      c.pct === null
                        ? 'no directional data'
                        : c.thin
                          ? `thin (${c.directional})`
                          : `${c.directional} releases`
                    }
                  />
                </Link>
              ))}
            </div>
          </Panel>

          <Panel title="Global Economic Surprise Score">
            <div className="flex flex-col items-center gap-4 p-4 sm:flex-row sm:items-center">
              <p className="flex-1 text-xs leading-relaxed text-[var(--color-muted)]">
                The average outperformance or underperformance across the eight major
                economies above. A higher score means a more robust global outlook — and
                because the dollar is one of the eight, a reading well above 50 with a weak
                USD dial says the rest of the world is carrying it.
                {known.length < MAJORS.length && (
                  <span className="mt-2 block text-[var(--color-faint)]">
                    Averaged over {known.length} of {MAJORS.length} currencies; the rest had
                    no release that came in either side of forecast.
                  </span>
                )}
              </p>
              <PercentGauge pct={globalPct} label="AVG" size={170} />
            </div>
          </Panel>
        </div>

        <Panel title="About this meter">
          <div className="space-y-3 p-3 text-xs leading-relaxed text-[var(--color-muted)]">
            <p>
              A <span className="font-semibold text-[var(--color-bull)]">higher</span> score
              means most of that economy&apos;s key metrics — GDP, PMIs, CPI, retail sales,
              employment — have recently come in <span className="font-semibold">stronger</span>{' '}
              than forecast.
            </p>
            <p>
              A <span className="font-semibold text-[var(--color-bear)]">lower</span> score
              means most of them have <span className="font-semibold">missed</span>.
            </p>
            <p>
              Releases that landed exactly on forecast are excluded from the calculation
              rather than counted as half a beat. A currency with nothing on either side of
              forecast reads <span className="tnum">—</span>, not 50%.
            </p>
            <p>
              Where a series carries no published forecast at all — several Australasian
              surveys never do — the direction is read against the previous print instead.
            </p>
            <p className="text-[var(--color-faint)]">
              Each dial links to that currency&apos;s heatmap, where every release behind the
              number is listed with its actual, forecast and surprise.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
