'use client';

/**
 * The Chart page shell: pick a setup, read its levels, see what disagrees.
 *
 * Ordered the way the user described working: conviction filter first, then the
 * chart with the levels on it, then the alignment, then the levels in detail,
 * and the third-party chart last for when they want to draw on it themselves.
 *
 * Every control is a link rather than local state, so the page stays a server
 * component and each read is a URL someone can come back to.
 */

import Link from 'next/link';
import { useState } from 'react';
import {
  CHART_TIMEFRAMES,
  TIMEFRAME_SPEC,
  type ChartTimeframe,
  type DailyBars,
} from '@/lib/connectors/technicals';
import type { Alignment, Check } from '@/lib/scoring/alignment';
import type { SymbolRow } from '@/lib/scoring/setups';
import type { StructureView } from '@/lib/scoring/structure';
import type { TradeIdea } from '@/lib/scoring/trade-ideas';
import { PriceChart } from '@/components/PriceChart';
import { SetupRead } from '@/components/SetupRead';
import { EmptyState, Panel } from '@/components/ui';

const CONVICTION_LEVELS = [7, 9, 12] as const;

function href(params: { symbol?: string; tf?: string; min?: number }): string {
  const q = new URLSearchParams();
  if (params.symbol) q.set('symbol', params.symbol);
  if (params.tf) q.set('tf', params.tf);
  if (params.min) q.set('min', String(params.min));
  return `/chart?${q.toString()}`;
}

function biasClass(score: number): string {
  return score > 0 ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]';
}

/** ✓ / ✗ / — where a dash means "could not tell", which is not a failure. */
function CheckRow({ check }: { check: Check }) {
  const mark = check.passed === null ? '—' : check.passed ? '✓' : '✗';
  const tone =
    check.passed === null
      ? 'text-[var(--color-faint)]'
      : check.passed
        ? 'text-[var(--color-bull)]'
        : 'text-[var(--color-bear)]';

  return (
    <div className="flex gap-2.5 border-b border-[var(--color-border)]/60 px-4 py-2 last:border-b-0">
      <span className={`w-3 shrink-0 text-center text-[12px] leading-5 font-bold ${tone}`}>
        {mark}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-medium">
          {check.label}
          {check.href && (
            <Link
              href={check.href}
              className="ml-2 text-[10px] font-normal text-[var(--color-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-text)]"
            >
              open
            </Link>
          )}
        </div>
        <p className="text-[10px] leading-relaxed text-[var(--color-faint)]">{check.detail}</p>
      </div>
    </div>
  );
}

export function ChartWorkspace({
  brief,
  row,
  label,
  candidates,
  minScore,
  timeframe,
  structureTimeframe,
  bars,
  view,
  idea,
  alignment,
  tradingViewSymbol,
}: {
  brief: string;
  row: SymbolRow;
  label: string;
  candidates: SymbolRow[];
  minScore: number;
  timeframe: ChartTimeframe;
  /** Which series the levels were measured on — see the chart page. */
  structureTimeframe: ChartTimeframe;
  bars: DailyBars | null;
  view: StructureView | null;
  idea: TradeIdea | null;
  alignment: Alignment;
  tradingViewSymbol: string;
}) {
  const [showTradingView, setShowTradingView] = useState(false);

  const dp = view ? (view.price >= 1000 ? 1 : view.price >= 10 ? 3 : 5) : 5;

  return (
    <div className="px-4 py-4">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <div>
          <h1 className="text-lg leading-tight font-bold">
            {row.symbol} <span className="text-sm font-normal text-[var(--color-faint)]">{label}</span>
          </h1>
          <p className="text-xs text-[var(--color-faint)]">
            Structure, levels and what agrees with them
          </p>
        </div>

        <div className={`flex items-baseline gap-2 ${biasClass(row.totalScore)}`}>
          <span className="tnum text-2xl leading-none font-bold">
            {row.totalScore > 0 ? '+' : ''}
            {row.totalScore}
          </span>
          <span className="text-[11px] font-semibold">{row.bias}</span>
        </div>

        <nav className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1">
            <span className="text-[9px] tracking-wider text-[var(--color-faint)] uppercase">Min</span>
            {CONVICTION_LEVELS.map((level) => (
              <Link
                key={level}
                href={href({ symbol: row.symbol, tf: timeframe, min: level })}
                aria-current={level === minScore ? 'page' : undefined}
                className={`rounded px-1.5 py-0.5 tabular-nums transition-colors ${
                  level === minScore
                    ? 'bg-[var(--color-bull)]/15 font-semibold text-[var(--color-bull)]'
                    : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]'
                }`}
              >
                ±{level}
              </Link>
            ))}
          </span>

          {/*
            Fine to coarse, left to right, which is how a chart's own timeframe
            selector reads everywhere else. Still links rather than state: the
            page stays a server component and each timeframe stays a URL.
          */}
          <span className="flex items-center gap-0.5">
            {CHART_TIMEFRAMES.map((tf) => (
              <Link
                key={tf}
                href={href({ symbol: row.symbol, tf, min: minScore })}
                aria-current={tf === timeframe ? 'page' : undefined}
                title={`${TIMEFRAME_SPEC[tf].prose} candles · ${TIMEFRAME_SPEC[tf].history} requested`}
                className={`rounded px-1.5 py-0.5 font-mono transition-colors ${
                  tf === timeframe
                    ? 'bg-[var(--color-bull)]/15 font-semibold text-[var(--color-bull)]'
                    : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]'
                }`}
              >
                {TIMEFRAME_SPEC[tf].label}
              </Link>
            ))}
          </span>
        </nav>
      </header>

      {/*
        The conviction filter, made literal. These are the only setups the user
        said they trade — everything weaker never appears.
      */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {candidates.length === 0 && (
          <span className="text-[11px] text-[var(--color-faint)]">
            Nothing else at ±{minScore} right now.
          </span>
        )}
        {candidates.map((c) => (
          <Link
            key={c.symbol}
            href={href({ symbol: c.symbol, tf: timeframe, min: minScore })}
            className={`flex items-baseline gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
              c.symbol === row.symbol
                ? 'border-[var(--color-bull)]/60 bg-[var(--color-surface-2)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-muted)]/50'
            }`}
          >
            <span className="font-mono font-medium">{c.symbol}</span>
            <span className={`tnum font-semibold ${biasClass(c.totalScore)}`}>
              {c.totalScore > 0 ? '+' : ''}
              {c.totalScore}
            </span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <Panel
            title={`${row.symbol} · ${TIMEFRAME_SPEC[timeframe].prose}`}
            subtitle={
              structureTimeframe === timeframe
                ? 'Broken structure, retracement and confluence, drawn on the price'
                : `Structure, retracement and confluence measured on the ${TIMEFRAME_SPEC[structureTimeframe].prose} series — a ${TIMEFRAME_SPEC[timeframe].prose} swing is noise`
            }
          >
            {bars && view ? (
              /*
                Keyed by symbol AND timeframe so React remounts the chart rather
                than re-using it. Reusing kept the previous instrument's price
                scale — switching USDJPY to EURUSD left the axis on 155-163 with
                the euro's candles off-canvas. A fresh instrument deserves a
                fresh chart, and losing the zoom on a symbol change is correct.
              */
              <PriceChart
                key={`${row.symbol}-${timeframe}`}
                bars={bars}
                view={view}
                idea={idea}
                label={row.symbol}
                symbol={row.symbol}
                timeframe={timeframe}
                structureTimeframe={structureTimeframe}
              />
            ) : (
              <EmptyState
                message="No structure to draw"
                hint={
                  bars
                    ? 'Not enough history, or the series is too flat to measure against.'
                    : 'Price history could not be loaded for this symbol.'
                }
              />
            )}
          </Panel>

          {view && (
            <Panel
              title="Levels"
              subtitle={`Nearest first · distances in ATR (1 ATR = ${view.atr.toFixed(dp)})`}
            >
              {view.zones.length === 0 ? (
                <EmptyState
                  message="No levels worth drawing"
                  hint="Nothing lines up within reach of price."
                />
              ) : (
                <table className="w-full text-right text-[11px]">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-[9px] tracking-wider text-[var(--color-faint)] uppercase">
                      <th className="px-3 py-2 text-left">Level</th>
                      <th className="px-2 py-2 text-left">Side</th>
                      <th className="px-2 py-2">Away</th>
                      <th className="px-2 py-2">ATR</th>
                      <th className="px-3 py-2 text-left">Made of</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.zones.map((z) => (
                      <tr
                        key={z.price}
                        className="border-b border-[var(--color-border)]/60 last:border-b-0"
                      >
                        <td className="tnum px-3 py-1.5 text-left font-semibold">
                          {z.price.toFixed(dp)}
                        </td>
                        <td
                          className={`px-2 py-1.5 text-left text-[10px] ${
                            z.side === 'support'
                              ? 'text-[var(--color-bull)]'
                              : 'text-[var(--color-bear)]'
                          }`}
                        >
                          {z.side}
                        </td>
                        <td className="tnum px-2 py-1.5 text-[var(--color-muted)]">
                          {z.distancePct > 0 ? '+' : ''}
                          {z.distancePct.toFixed(2)}%
                        </td>
                        <td className="tnum px-2 py-1.5 text-[var(--color-faint)]">
                          {z.distanceAtr.toFixed(1)}
                        </td>
                        <td className="px-3 py-1.5 text-left text-[10px] text-[var(--color-muted)]">
                          {z.sources.map((s) => s.label).join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="border-t border-[var(--color-border)] px-3 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
                Distances are in ATR as well as percent because percent is not
                comparable across symbols — 0.3% is most of a day in EURUSD and a
                fifth of one in gold. A level needs two independent sources to be
                listed — except the broken level and the range edges, which stay
                whatever else agrees with them.
              </p>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Panel
            title="Alignment"
            subtitle={`${alignment.direction} · ${alignment.passed} of ${alignment.applicable} conditions agree`}
          >
            <div className="border-b border-[var(--color-border)] px-4 py-2.5">
              {alignment.failures.length === 0 ? (
                <p className="text-[11px] text-[var(--color-bull)]">
                  Everything measurable points the same way.
                </p>
              ) : (
                <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
                  <span className="font-semibold text-[var(--color-bear)]">Disagreeing:</span>{' '}
                  {alignment.failures.map((f) => f.label.toLowerCase()).join('; ')}.
                </p>
              )}
            </div>

            {alignment.checks.map((check) => (
              <CheckRow key={check.key} check={check} />
            ))}

            {/*
              No grade and no probability, deliberately. The backtest found no
              statistically significant edge in the score itself, so a letter or
              a percentage here would be inventing confidence the data does not
              support. A count, and the names of what disagrees, is what the
              evidence licenses.
            */}
            <p className="border-t border-[var(--color-border)] px-4 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
              A count of conditions, not a grade or a probability. The conditions are
              unweighted — any weighting would be invented. Not financial advice.
            </p>
          </Panel>

          <SetupRead symbol={row.symbol} brief={brief} />

          {view?.structure.latest && (
            <Panel title="Structure" subtitle="What broke, and where it left the level">
              <div className="px-4 py-3 text-[11px] leading-relaxed">
                <p>
                  <span
                    className={
                      view.structure.latest.direction === 'bullish'
                        ? 'font-semibold text-[var(--color-bull)]'
                        : 'font-semibold text-[var(--color-bear)]'
                    }
                  >
                    {view.structure.latest.direction === 'bullish' ? 'Bullish' : 'Bearish'} break
                  </span>{' '}
                  of {view.structure.latest.level.toFixed(dp)}, {view.structure.latest.barsSince}{' '}
                  bars ago. That level now acts as{' '}
                  {view.structure.latest.direction === 'bullish' ? 'support' : 'resistance'} and has{' '}
                  {view.structure.latest.retested ? 'been retested since' : 'not been retested'}.
                </p>
                {view.structure.changeOfCharacter && (
                  <p className="mt-1.5 text-[var(--color-uncertain)]">
                    Structure changed character — the previous break ran the other way.
                  </p>
                )}
                {view.fib && (
                  <p className="mt-1.5 text-[var(--color-muted)]">
                    Impulse {view.fib.low.toFixed(dp)} → {view.fib.high.toFixed(dp)},{' '}
                    {(view.fib.positionRatio * 100).toFixed(0)}% retraced. The 0.618 sits at{' '}
                    <span className="font-semibold text-[var(--color-text)]">
                      {view.fib.levels.find((l) => l.ratio === 0.618)!.price.toFixed(dp)}
                    </span>
                    .
                    {!view.fib.legComplete &&
                      ' The high is not a confirmed swing yet, so these levels will move if the impulse extends.'}
                    {view.fib.invalidated &&
                      ' The impulse has fully reversed — treat these as history.'}
                  </p>
                )}
              </div>
            </Panel>
          )}
        </div>
      </div>

      {/*
        TradingView last and collapsed. It is a third-party frame, it cannot draw
        our levels, and the page has to be complete without it — so it loads only
        when asked for.
      */}
      <div className="mt-4">
        {showTradingView ? (
          <Panel
            title="TradingView"
            subtitle="Third-party chart — our levels are not drawn on it"
            action={
              <button
                type="button"
                onClick={() => setShowTradingView(false)}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
              >
                Hide
              </button>
            }
          >
            <iframe
              key={tradingViewSymbol}
              title={`TradingView chart for ${row.symbol}`}
              src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tradingViewSymbol)}&interval=${TIMEFRAME_SPEC[timeframe].tvInterval}&theme=dark&style=1&hidesidetoolbar=0&withdateranges=1&saveimage=0`}
              className="h-[520px] w-full border-0"
              loading="lazy"
              // A third-party frame gets no more reach than it needs.
              sandbox="allow-scripts allow-same-origin allow-popups"
              referrerPolicy="no-referrer-when-downgrade"
            />
            {/*
              THE ATTRIBUTION IS A LICENCE CONDITION, NOT DECORATION. Embedding
              the free widget obliges us to keep a visible, followable credit to
              TradingView at no smaller than 13px — so it is its own line at
              13px, not folded into the 10px note below it, and it is not
              conditional on anything.
            */}
            <p className="border-t border-[var(--color-border)] px-4 pt-2 text-[13px] text-[var(--color-muted)]">
              Chart by{' '}
              <a
                href="https://www.tradingview.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-text)]"
              >
                TradingView
              </a>
            </p>
            <p className="px-4 pb-2 text-[10px] text-[var(--color-faint)]">
              Their free widget has no API for custom horizontal lines, so the levels
              above cannot be drawn on it — use this one for drawing by hand, and the
              chart above for our read.
            </p>
          </Panel>
        ) : (
          <button
            type="button"
            onClick={() => setShowTradingView(true)}
            className="w-full rounded-xl border border-dashed border-[var(--color-border)] px-4 py-3 text-[11px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-muted)]/60 hover:text-[var(--color-text)]"
          >
            Open the TradingView chart for {row.symbol} — third-party frame, loads on click
          </button>
        )}
      </div>
    </div>
  );
}
