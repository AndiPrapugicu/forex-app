/**
 * Net Options Volume — call volume minus put volume per market.
 *
 * Two readings of the same day, and the split is deliberate: one market over
 * its stored sessions (A1's "Call-Put Volume Spread"), and every market against
 * each other today. Only the second existed, which left the page unable to
 * answer "what has SPX been doing all week".
 */

import { OPTIONS_UNDERLYINGS } from '@/config/options.config';
import { loadOptionsPageData } from '@/lib/options-page-data';
import { DivergingBars, DivergingRow } from '@/components/charts';
import { OptionsSymbolNav } from '@/components/OptionsSymbolNav';
import { VolumeTable, type VolumeRow } from '@/components/OptionsTables';
import { MetricDescription, PageHeader } from '@/components/primitives';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

const pct = (net: number, total: number) => (total > 0 ? Math.round((net / total) * 1000) / 10 : null);

export default async function NetOptionsVolumePage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string | string[] }>;
}) {
  const requested = (await searchParams).symbol;
  const data = await loadOptionsPageData();

  const rows: VolumeRow[] = data.chains.map((c) => {
    const stored = data.history
      .filter((h) => h.symbol === c.symbol)
      .map((h) => pct(h.callVolume - h.putVolume, h.callVolume + h.putVolume));
    return {
      symbol: c.symbol,
      etf: c.etf,
      callVolume: c.callVolume,
      putVolume: c.putVolume,
      net: c.callVolume - c.putVolume,
      netPct: pct(c.callVolume - c.putVolume, c.callVolume + c.putVolume),
      history: stored,
    };
  });

  const selected = rows.find((r) => r.symbol === requested) ?? rows.find((r) => r.symbol === 'SPX500') ?? rows[0];
  /**
   * Stored sessions, then today's live reading appended — the same shape the
   * put-call series has, so the two pages tell one story about one day.
   */
  const sessions = selected
    ? [
        ...data.history
          .filter((h) => h.symbol === selected.symbol && h.date !== data.today)
          .map((h) => ({
            label: h.date.slice(5),
            value: pct(h.callVolume - h.putVolume, h.callVolume + h.putVolume),
          })),
        { label: `${data.today.slice(5)} (live)`, value: selected.netPct },
      ]
    : [];
  const selectedLabel = OPTIONS_UNDERLYINGS.find((u) => u.symbol === selected?.symbol)?.label ?? '';

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Net Options Volume"
        description="Call volume minus put volume, nearest expiries"
        updated={`Chains read ${data.fetchedAtUtc.slice(11, 16)} UTC${data.historyNote ? ` · ${data.historyNote}` : ''}`}
      />
      {rows.length === 0 ? (
        <Panel title="Unavailable">
          <EmptyState message="No option chains could be read" hint="Yahoo refused the session. Try again in a few minutes." />
        </Panel>
      ) : (
        <>
          <Panel
            title={`${selected.symbol} · ${selectedLabel}`}
            subtitle={`Read through ${selected.etf}. Net % per session, calls over puts above the line.`}
            padded
          >
            <OptionsSymbolNav
              symbols={rows.map((r) => r.symbol)}
              selected={selected.symbol}
              href={(symbol) => `/options/volume?symbol=${symbol}`}
            />
            <DivergingBars
              label={`${selected.symbol} net options volume by session`}
              points={sessions}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
            />
            <p className="mt-2 text-caption text-[var(--color-faint)]">
              {sessions.length === 1
                ? 'Today only — the ingest job stores one session after each US close, so this fills in daily.'
                : `${sessions.length} sessions, oldest first.`}
            </p>
          </Panel>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Panel title="Net % today" subtitle="Blue: more calls than puts. Red: more puts." padded>
              <div className="flex flex-col gap-1">
                {[...rows]
                  .sort((a, b) => (b.netPct ?? -999) - (a.netPct ?? -999))
                  .map((r) => (
                    <DivergingRow key={r.symbol} label={r.symbol} value={r.netPct} max={60} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`} />
                  ))}
              </div>
            </Panel>
            <Panel title="Volume" subtitle="Contracts traded today · click a symbol for its sessions">
              <VolumeTable rows={rows} />
            </Panel>
          </div>
        </>
      )}
      <MetricDescription>
        Net volume is what traders did today, where open interest is what they still hold. Net % divides by all option volume
        so a thinly traded currency ETF and SPY can be read on one scale. Context only; it does not score.
      </MetricDescription>
    </div>
  );
}
