/**
 * Put-Call Ratio — A1's 5-day moving average, banded at 1.07 and 1.20.
 */

import Link from 'next/link';
import { OPTIONS_UNDERLYINGS, PUT_CALL_BANDS, PUT_CALL_MA_DAYS } from '@/config/options.config';
import { loadOptionsPageData } from '@/lib/options-page-data';
import { putCallSeries, readPutCall } from '@/lib/scoring/options';
import { BandedLine } from '@/components/charts';
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
            Volume&rdquo;). Each market is read through the US ETF that tracks it, from Yahoo option chains.
          </>
        }
      />

      {rows.length === 0 ? (
        <Panel title="Unavailable">
          <EmptyState message="No option chains could be read" hint="Yahoo refused the session. Try again in a few minutes." />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Panel
            title={`${selected.symbol} · ${selected.label}`}
            subtitle={`Read through ${selected.etf}. ${data.historyNote ?? `${selectedSeries.length} sessions`}`}
            padded
          >
            <nav aria-label="Symbol" className="mb-3 flex flex-wrap gap-1">
              {rows.map((r) => (
                <Link
                  key={r.symbol}
                  href={`/options/put-call?symbol=${r.symbol}`}
                  aria-current={r.symbol === selected.symbol ? 'page' : undefined}
                  className={`flex min-h-9 items-center rounded-[var(--radius-control)] border px-2.5 text-caption ${
                    r.symbol === selected.symbol
                      ? 'border-[var(--color-bull)] text-[var(--color-bull)]'
                      : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {r.symbol}
                </Link>
              ))}
            </nav>
            <BandedLine
              label={`${selected.symbol} put-call ratio`}
              points={selectedSeries.map((p) => ({ label: p.date.slice(5), value: p.movingAverage ?? p.ratio }))}
              bands={[
                { value: PUT_CALL_BANDS.highPutVolume, label: 'High Put Volume', tone: 'bear' },
                { value: PUT_CALL_BANDS.highCallVolume, label: 'High Call Volume', tone: 'bull' },
              ]}
            />
            <p className="mt-2 text-caption text-[var(--color-faint)]">
              The line is the {PUT_CALL_MA_DAYS}-day average where five sessions exist, and the daily ratio before that.
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
