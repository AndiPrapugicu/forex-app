/**
 * Put-Call Ratio — A1's 5-day moving average, banded at 1.07 and 1.20.
 */

import {
  OPTIONS_UNDERLYINGS,
  PUT_CALL_BANDS,
  PUT_CALL_CHART_DOMAIN,
  PUT_CALL_MA_DAYS,
} from '@/config/options.config';
import { loadOptionsPageData } from '@/lib/options-page-data';
import { putCallSeries, readPutCall } from '@/lib/scoring/options';
import { BandedLine } from '@/components/charts';
import { OptionsSymbolNav } from '@/components/OptionsSymbolNav';
import { PutCallTable, type PutCallRow } from '@/components/OptionsTables';
import { MetricDescription, PageHeader } from '@/components/primitives';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function PutCallPage({ searchParams }: { searchParams: Promise<{ symbol?: string | string[] }> }) {
  const requested = (await searchParams).symbol;
  const data = await loadOptionsPageData();

  const rows: PutCallRow[] = data.chains.map((c) => {
    const u = OPTIONS_UNDERLYINGS.find((x) => x.symbol === c.symbol)!;
    const series = putCallSeries(data.history, c.symbol, { date: data.today, summary: c });
    const last = series.at(-1);
    return {
      symbol: c.symbol,
      label: u.label,
      etf: c.etf,
      group: u.group,
      ratio: c.putCallVolume,
      movingAverage: last?.movingAverage ?? null,
      reading: readPutCall(last?.movingAverage ?? null),
      sessions: series.filter((p) => p.ratio !== null).length,
      history: series.map((p) => p.ratio),
    };
  });

  const selected = rows.find((r) => r.symbol === requested) ?? rows.find((r) => r.symbol === 'SPX500') ?? rows[0];
  const selectedSeries = selected
    ? putCallSeries(data.history, selected.symbol, {
        date: data.today,
        summary: data.chains.find((c) => c.symbol === selected.symbol)!,
      })
    : [];

  /**
   * The chart, minus its size. Both breakpoints draw the same series against the
   * same bands; only the viewBox differs, and writing that twice is how the two
   * quietly drift apart.
   */
  const chart = {
    label: `${selected?.symbol ?? ''} put-call ratio`,
    points: selectedSeries.map((p) => ({ label: p.date.slice(5), value: p.movingAverage ?? p.ratio })),
    bands: [
      { value: PUT_CALL_BANDS.highPutVolume, label: 'High Put Volume', tone: 'bear' as const },
      { value: PUT_CALL_BANDS.highCallVolume, label: 'High Call Volume', tone: 'bull' as const },
    ],
    domain: PUT_CALL_CHART_DOMAIN,
    variant: 'sentiment' as const,
    cornerLabels: { top: 'BEARISH SENTIMENT', bottom: 'BULLISH SENTIMENT' },
  };

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Put-Call Ratio"
        description={`${rows.length} markets · put volume over call volume on the nearest expiries`}
        updated={`Chains read ${data.fetchedAtUtc.slice(11, 16)} UTC${data.failed.length ? ` · unavailable: ${data.failed.join(', ')}` : ''}`}
        info={
          <>
            A1&rsquo;s rule: a {PUT_CALL_MA_DAYS}-day moving average of the ratio. At or below {PUT_CALL_BANDS.highCallVolume}{' '}
            calls dominate (&ldquo;High Call Volume&rdquo;); at or above {PUT_CALL_BANDS.highPutVolume} puts do (&ldquo;High Put
            Volume&rdquo;). Each market is read through the US ETF that tracks it, from Yahoo option chains. Those two numbers
            are the ones their page published; their own Gold chart bands nearer 0.39 and 0.71, so they appear to vary the
            bands per market by a rule we have not been able to read — see the ledger entry{' '}
            <code>put-call:bands-are-not-one-pair-of-numbers</code>. Nothing here feeds a score.
          </>
        }
      />

      {rows.length === 0 ? (
        <Panel title="Unavailable">
          <EmptyState message="No option chains could be read" hint="Yahoo refused the session. Try again in a few minutes." />
        </Panel>
      ) : (
        /*
          ONE COLUMN: the chart full width, the table under it, which is how A1
          lays this page out. Side by side, the chart got two fifths of the page
          for a series read against two horizontal lines — the one shape that
          needs width — while the table, which is mostly a symbol and two
          numbers, got the rest.
        */
        <div className="flex flex-col gap-4">
          <Panel
            title={`${selected.symbol} · ${selected.label}`}
            subtitle={`Read through ${selected.etf}. ${data.historyNote ?? `${selectedSeries.length} sessions`}`}
            padded
          >
            <OptionsSymbolNav
              symbols={rows.map((r) => r.symbol)}
              selected={selected.symbol}
              href={(symbol) => `/options/put-call?symbol=${symbol}`}
            />
            {/*
              TWO VIEWBOXES, one design. An SVG keeps its aspect ratio, so a
              single one is either a letterbox on a phone or a chart taller than
              the screen on a desktop — and its text scales with it, which is
              what made the axis unreadable at either end. Only the one its
              breakpoint shows is in the layout, so only that one is in the
              accessibility tree.
            */}
            <div className="md:hidden">
              <BandedLine {...chart} width={460} height={400} />
            </div>
            <div className="hidden md:block">
              <BandedLine {...chart} width={1200} height={520} />
            </div>
            <p className="mt-2 text-caption text-[var(--color-faint)]">
              The line is the {PUT_CALL_MA_DAYS}-day average where five sessions exist, and the daily ratio before that.
              The axis is fixed at {PUT_CALL_CHART_DOMAIN[0]}–{PUT_CALL_CHART_DOMAIN[1]}, as A1 draws it, so a reading is
              always placed against the two bands. {selectedSeries.length} session
              {selectedSeries.length === 1 ? '' : 's'} stored so far.
            </p>
          </Panel>

          <Panel title="All markets" subtitle="Shaded where a band is crossed">
            <PutCallTable rows={rows} />
          </Panel>
        </div>
      )}

      <MetricDescription>
        The put-call ratio compares bearish option bets (puts) with bullish ones (calls). A high ratio means traders are
        paying up for protection, which contrarians read as fear near a bottom; a low ratio means call buying and
        complacency. It is context and does not feed any score on the board.
      </MetricDescription>
    </div>
  );
}
