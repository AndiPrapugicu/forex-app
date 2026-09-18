/**
 * Put & Call Walls — open interest per strike around the current price.
 */

import { OPTIONS_UNDERLYINGS } from '@/config/options.config';
import { findWalls } from '@/lib/connectors/yahoo-options';
import { loadOptionsPageData } from '@/lib/options-page-data';
import { OptionsSymbolNav } from '@/components/OptionsSymbolNav';
import { Legend, MetricDescription, PageHeader } from '@/components/primitives';
import { EmptyState, Panel, formatPrice } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Strikes within this share of spot are drawn; the far wings are noise. */
const WINDOW = 0.15;

export default async function WallsPage({ searchParams }: { searchParams: Promise<{ symbol?: string | string[] }> }) {
  const requested = (await searchParams).symbol;
  const data = await loadOptionsPageData();
  const chain = data.chains.find((c) => c.symbol === requested) ?? data.chains.find((c) => c.symbol === 'SPX500') ?? data.chains[0];

  if (!chain) {
    return (
      <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
        <PageHeader title="Put & Call Walls" />
        <Panel title="Unavailable">
          <EmptyState message="No option chains could be read" hint="Yahoo refused the session. Try again in a few minutes." />
        </Panel>
      </div>
    );
  }

  const label = OPTIONS_UNDERLYINGS.find((u) => u.symbol === chain.symbol)?.label ?? chain.symbol;
  const { callWall, putWall } = findWalls(chain);
  const price = chain.price;
  const strikes = chain.strikes.filter(
    (s) => price === null || (s.strike >= price * (1 - WINDOW) && s.strike <= price * (1 + WINDOW)),
  );
  const maxOi = Math.max(1, ...strikes.flatMap((s) => [s.callOpenInterest, s.putOpenInterest]));

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Put & Call Walls"
        description={`${chain.symbol} · ${label}, read through ${chain.etf} · ${chain.expiries} nearest expiries`}
        updated={`Chains read ${data.fetchedAtUtc.slice(11, 16)} UTC`}
        info={<>A wall is the strike holding the most open interest. Large call walls often cap a rally and large put walls often support a fall, because dealers hedging those positions trade against the move.</>}
      />

      <OptionsSymbolNav
        symbols={data.chains.map((c) => c.symbol)}
        selected={chain.symbol}
        href={(symbol) => `/options/walls?symbol=${symbol}`}
        className="mb-4 flex flex-wrap gap-1"
      />

      <div className="mb-4 grid grid-cols-3 gap-2 md:max-w-xl">
        {[
          ['Spot', price === null ? '—' : formatPrice(price), ''],
          ['Call wall', callWall ? formatPrice(callWall.strike) : '—', 'text-[var(--color-bull)]'],
          ['Put wall', putWall ? formatPrice(putWall.strike) : '—', 'text-[var(--color-bear)]'],
        ].map(([k, v, tone]) => (
          <div key={k} className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
            <div className={`tnum text-title font-semibold ${tone}`}>{v}</div>
            <div className="text-micro tracking-wider text-[var(--color-faint)] uppercase">{k}</div>
          </div>
        ))}
      </div>

      <Panel title="Open interest by strike" subtitle={`Within ${WINDOW * 100}% of spot. Calls extend right, puts left.`} padded>
        <Legend
          items={[
            { label: 'Put open interest', color: 'rgb(var(--color-heat-bear-rgb))' },
            { label: 'Call open interest', color: 'rgb(var(--color-heat-bull-rgb))' },
          ]}
        />
        <ul className="mt-3 flex flex-col gap-0.5">
          {[...strikes].reverse().map((s) => {
            const atSpot = price !== null && Math.abs(s.strike - price) / price < 0.004;
            return (
              <li key={s.strike} className="grid grid-cols-[1fr_4.5rem_1fr] items-center gap-2 text-caption">
                <div className="flex h-4 justify-end">
                  <span
                    className="h-full rounded-l-sm"
                    style={{ width: `${(s.putOpenInterest / maxOi) * 100}%`, backgroundColor: 'rgb(var(--color-heat-bear-rgb))', opacity: s === putWall ? 1 : 0.7 }}
                    title={`${s.putOpenInterest.toLocaleString()} puts`}
                  />
                </div>
                <span className={`tnum text-center ${atSpot ? 'font-bold text-[var(--color-text)]' : 'text-[var(--color-muted)]'}`}>
                  {formatPrice(s.strike)}
                </span>
                <div className="flex h-4">
                  <span
                    className="h-full rounded-r-sm"
                    style={{ width: `${(s.callOpenInterest / maxOi) * 100}%`, backgroundColor: 'rgb(var(--color-heat-bull-rgb))', opacity: s === callWall ? 1 : 0.7 }}
                    title={`${s.callOpenInterest.toLocaleString()} calls`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <MetricDescription>
        Open interest is contracts still held, summed across the nearest expiries. Walls are a map of where positioning is
        concentrated, not a forecast, and they move as expiries roll off. Context only; nothing here scores.
      </MetricDescription>
    </div>
  );
}
