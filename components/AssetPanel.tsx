'use client';

/**
 * Metals and oil.
 *
 * Every asset score expands into its contributing factors, because an
 * unattributable commodity score is worthless — "gold +4.2" tells you nothing,
 * "gold +4.2, mostly escalation risk (+2.4) and a soft dollar (+1.8)" tells you
 * what to watch and when the thesis breaks.
 */

import { useState } from 'react';
import type { AssetScore, PriceQuote } from '@/lib/types';
import { ScoreBar } from '@/components/Gauge';
import { DIRECTION_STYLE, EmptyState, Panel, formatScore, scoreColor } from '@/components/ui';

function PriceTag({ quote }: { quote: PriceQuote | undefined }) {
  if (!quote) {
    return <span className="text-[11px] text-[var(--color-faint)]">price unavailable</span>;
  }

  const chg = quote.changePct;
  const color =
    chg === null
      ? 'text-[var(--color-faint)]'
      : chg > 0
        ? 'text-[var(--color-bull)]'
        : chg < 0
          ? 'text-[var(--color-bear)]'
          : 'text-[var(--color-muted)]';

  return (
    <span className="tnum text-[11px]">
      <span className="text-[var(--color-muted)]">{quote.price.toLocaleString()}</span>{' '}
      <span className={color}>
        {chg === null ? '' : `${chg > 0 ? '+' : ''}${chg.toFixed(2)}%`}
      </span>
    </span>
  );
}

export function AssetPanel({
  assets,
  prices,
}: {
  assets: AssetScore[];
  prices: PriceQuote[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const priceBySymbol = new Map(prices.map((p) => [p.label, p]));
  const labelFor: Record<string, string> = {
    XAU: 'Gold',
    XAG: 'Silver',
    XPT: 'Platinum',
    WTI: 'WTI Crude',
  };

  if (!assets.length) {
    return (
      <Panel title="Metals & energy">
        <EmptyState message="No asset scores available" />
      </Panel>
    );
  }

  return (
    <Panel title="Metals & energy" subtitle="Scored from named factors — tap to see why">
      <div className="divide-y divide-[var(--color-border)]">
        {assets.map((a) => {
          const isOpen = expanded === a.asset;
          const style = DIRECTION_STYLE[a.direction];
          const label = labelFor[a.asset] ?? a.asset;

          return (
            <div key={a.asset}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : a.asset)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
                aria-expanded={isOpen}
              >
                <div className="flex w-24 shrink-0 flex-col">
                  <span className="text-sm font-semibold text-[var(--color-text)]">{label}</span>
                  <PriceTag quote={priceBySymbol.get(label)} />
                </div>

                <div className="flex-1">
                  <ScoreBar score={a.score} direction={a.direction} confidence={a.confidence} width={140} />
                </div>

                <span className={`tnum w-11 text-right text-sm font-bold ${scoreColor(a.score, a.direction)}`}>
                  {a.direction === 'uncertain' ? '?' : formatScore(a.score)}
                </span>

                <span className={`w-16 text-right text-[10px] font-medium ${style.color}`}>
                  {style.label}
                </span>

                <span className="w-3 text-[var(--color-faint)]" aria-hidden>
                  {isOpen ? '−' : '+'}
                </span>
              </button>

              {isOpen && (
                <div className="bg-[var(--color-bg)]/60 px-4 pt-1 pb-3">
                  {a.contributions.length === 0 ? (
                    <p className="py-2 text-xs text-[var(--color-faint)]">
                      No active drivers — nothing in the current data moves this asset.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {a.contributions.map((c) => (
                        <li key={c.label} className="flex items-baseline gap-2 text-[11px]">
                          <span
                            className={`tnum w-11 shrink-0 text-right font-semibold ${
                              c.contribution > 0
                                ? 'text-[var(--color-bull)]'
                                : 'text-[var(--color-bear)]'
                            }`}
                          >
                            {c.contribution > 0 ? '+' : ''}
                            {c.contribution}
                          </span>
                          <span className="text-[var(--color-muted)]">{c.label}</span>
                          <span className="tnum ml-auto shrink-0 text-[var(--color-faint)]">
                            {c.beta} × {c.input}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {a.confidence < 40 && (
                    <p className="mt-2 text-[11px] text-[var(--color-uncertain)]">
                      Confidence {a.confidence} — the news behind these factors is not corroborated
                      enough to call a direction.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
