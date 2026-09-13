/**
 * Net Options Volume — call volume minus put volume per market.
 */

import { loadOptionsPageData } from '@/lib/options-page-data';
import { DivergingRow } from '@/components/charts';
import { VolumeTable, type VolumeRow } from '@/components/OptionsTables';
import { MetricDescription, PageHeader } from '@/components/primitives';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

const pct = (net: number, total: number) => (total > 0 ? Math.round((net / total) * 1000) / 10 : null);

export default async function NetOptionsVolumePage() {
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
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Panel title="Net %" subtitle="Blue: more calls than puts. Red: more puts." padded>
            <div className="flex flex-col gap-1">
              {[...rows]
                .sort((a, b) => (b.netPct ?? -999) - (a.netPct ?? -999))
                .map((r) => (
                  <DivergingRow key={r.symbol} label={r.symbol} value={r.netPct} max={60} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`} />
                ))}
            </div>
          </Panel>
          <Panel title="Volume" subtitle="Contracts traded today">
            <VolumeTable rows={rows} />
          </Panel>
        </div>
      )}
      <MetricDescription>
        Net volume is what traders did today, where open interest is what they still hold. Net % divides by all option volume
        so a thinly traded currency ETF and SPY can be read on one scale. Context only; it does not score.
      </MetricDescription>
    </div>
  );
}
