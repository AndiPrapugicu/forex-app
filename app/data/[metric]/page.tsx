/**
 * Economic Data — one indicator across all eight economies, A1's layout.
 *
 * /charts reads one economy at a time; this reads one METRIC at a time, which
 * is how A1's Economic Data pages are organised. Both are built by
 * `buildIndicatorSeries` over the scorecard's own event pool, so a series here
 * is exactly the series the board scored.
 *
 * DEPTH IS STATED, NOT IMPLIED. The calendar window is ~150 days, plus whatever
 * the Supabase accumulator has kept since it went live. Each card prints the
 * dates it actually holds.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SLOTS } from '@/config/setups.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { buildIndicatorSeries } from '@/lib/scoring/indicator-history';
import { MAJORS } from '@/lib/types';
import { MetricBars } from '@/components/charts';
import { Legend, MetricDescription, PageHeader } from '@/components/primitives';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** The metrics with a page, in A1's menu order. Each is a scorecard slot key. */
const DATA_METRICS = [
  'gdp',
  'mpmi',
  'spmi',
  'retail-sales',
  'consumer-confidence',
  'cpi',
  'ppi',
  'employment',
  'unemployment',
] as const;

/** Diffusion indices expand and contract around 50, not zero. */
const BASELINE: Record<string, number> = { mpmi: 50, spmi: 50 };

export default async function DataMetricPage({ params }: { params: Promise<{ metric: string }> }) {
  const { metric } = await params;
  const slot = SLOTS.find((s) => s.key === metric && s.kind === 'economic');
  if (!slot || !(DATA_METRICS as readonly string[]).includes(metric)) notFound();

  /**
   * `rewindPool`, not `events`. The live pool drops every seeded PMI row once a
   * live print of that series exists — right for scoring today's cell, wrong for
   * a history chart, which then showed one EUR services print instead of two
   * years. The seeded points are A1-captured, so each card says how many it holds.
   */
  const { rewindPool, matrix } = await runSetupsPipeline();
  const cards = MAJORS.map((currency) => {
    const series = buildIndicatorSeries(slot, currency, rewindPool);
    const captured = series
      ? rewindPool.filter(
          (e) => e.currency === currency && e.name === series.eventName && e.actualSource === 'a1-capture' && e.actual !== null,
        ).length
      : 0;
    return { currency, series, captured };
  });
  const withData = cards.filter((c) => c.series && c.series.points.length > 0).length;

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title={slot.title}
        description={`${withData} of ${MAJORS.length} economies publish a series we can read`}
        updated={`Updated ${matrix.generatedAtUtc.slice(11, 16)} UTC`}
        actions={
          <nav aria-label="Other metrics" className="flex flex-wrap gap-1">
            {DATA_METRICS.map((m) => {
              const s = SLOTS.find((x) => x.key === m);
              const active = m === metric;
              return (
                <Link
                  key={m}
                  href={`/data/${m}`}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-9 items-center rounded-[var(--radius-control)] border px-2.5 text-caption ${
                    active
                      ? 'border-[var(--color-bull)] text-[var(--color-bull)]'
                      : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {s?.label ?? m}
                </Link>
              );
            })}
          </nav>
        }
      />

      <div className="mb-3">
        <Legend
          items={[
            { label: 'Beat forecast', color: 'var(--color-bull-cell)' },
            { label: 'Missed forecast', color: 'var(--color-bear-cell)' },
            { label: 'No forecast', color: 'var(--color-muted)' },
            { label: 'Forecast', color: 'var(--color-head)', shape: 'dot' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cards.map(({ currency, series, captured }) => (
          <Panel
            key={currency}
            title={currency}
            subtitle={
              series
                ? `${series.eventName} · ${series.points.length} releases, ${series.points[0].dateUtc.slice(0, 10)} to ${series.points[
                    series.points.length - 1
                  ].dateUtc.slice(0, 10)}${series.beatRatePct === null ? '' : ` · beat ${series.beatRatePct}%`}${
                    captured > 0 ? ` · ${captured} from A1 captures` : ''
                  }`
                : 'No series'
            }
            action={
              <Link href={`/heatmap?currency=${currency}`} className="text-caption text-[var(--color-muted)] hover:text-[var(--color-text)]">
                Heatmap →
              </Link>
            }
            padded
          >
            {series ? (
              <MetricBars
                label={`${currency} ${slot.label}: actual against forecast`}
                baseline={BASELINE[metric] ?? 0}
                unit={series.unit === '%' ? '%' : ''}
                points={series.points.map((p) => ({ label: p.dateUtc.slice(2, 7), actual: p.actual, forecast: p.consensus }))}
              />
            ) : (
              <EmptyState message={`No ${slot.label} series for ${currency}`} hint="Either the economy does not publish one, or the calendar window holds no print." />
            )}
          </Panel>
        ))}
      </div>

      <MetricDescription>
        <p>{slot.title}. Bars are the published actual; the dot is the consensus forecast where one existed. A bar coloured blue
        beat its forecast and red missed it — the same comparison the board&rsquo;s cell makes.</p>
        <p className="mt-2">
          History starts where the calendar window starts, roughly five months back, and deepens as the accumulator stores
          each new release. The dates on each card are the dates it holds.
        </p>
      </MetricDescription>
    </div>
  );
}
