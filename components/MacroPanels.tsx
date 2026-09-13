'use client';

/**
 * The macro scanner panels, shared by /macro and the /scanners/* routes.
 *
 * Extracted from the 600-line /macro page so each scanner can have its own
 * address without a second copy of its rendering — two copies of one table is
 * how the /macro and /heatmap surprise numbers once came to disagree.
 *
 * Client-side because the tables use `DataTable`, whose column definitions are
 * functions and cannot cross from a server component. Every prop is plain
 * data; constants that live in server-leaning modules (`RISK_BANDS`,
 * `SURPRISE_MIN_SAMPLE`) arrive as props rather than imports, so this file pulls
 * nothing but types from the scoring code.
 */

import Link from 'next/link';
import type { SovereignYield, YieldCurve } from '@/lib/connectors/yields';
import type { Cluster } from '@/lib/scoring/correlation';
import type { EcoStrengthRow } from '@/lib/scoring/eco-strength';
import type { CarryRow, RiskGauge, StrengthRow, SurpriseIndex } from '@/lib/scoring/market';
import { heatStyle } from '@/lib/ui/heat';
import { DataTable, type Column } from '@/components/DataTable';
import { DivergingRow } from '@/components/charts';
import { Panel } from '@/components/ui';

function signColor(v: number): string {
  if (v > 0) return 'text-[var(--color-bull-cell)]';
  if (v < 0) return 'text-[var(--color-bear)]';
  return 'text-[var(--color-muted)]';
}

function pct(v: number | null, dp = 2, signed = false): string {
  if (v === null) return '—';
  return `${signed && v > 0 ? '+' : ''}${v.toFixed(dp)}%`;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-t border-[var(--color-border)] px-4 py-3 text-caption leading-relaxed text-[var(--color-faint)]">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Concentration
// ---------------------------------------------------------------------------

export function ConcentrationPanel({ clusters, threshold }: { clusters: Cluster[]; threshold: number }) {
  return (
    <Panel title="Concentration" subtitle="Top setups grouped into the trades they actually are">
      {clusters.length === 0 ? (
        <p className="px-4 py-6 text-center text-small text-[var(--color-faint)]">No directional setups on the board right now.</p>
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {clusters.map((c) => {
            const stacked = c.members.length > 1;
            return (
              <div key={c.lead} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                {/*
                  Direction is PER MEMBER, not per cluster. Short DXY and long
                  EURX are one short-dollar trade, and labelling the whole group
                  "short" would claim EURX is a short.
                */}
                <span className="flex flex-wrap items-center gap-x-1 gap-y-1">
                  {c.members.map((m, i) => (
                    <Link
                      key={m.symbol}
                      href={`/scorecard/${m.symbol}`}
                      aria-label={`${m.direction} ${m.symbol}, score ${m.score > 0 ? '+' : ''}${m.score}`}
                      className={`inline-flex min-h-9 items-center px-1 font-mono text-small hover:underline ${
                        m.direction === 'long' ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'
                      } ${i === 0 ? 'font-semibold' : 'opacity-80'}`}
                    >
                      {m.direction === 'long' ? '▲' : '▼'} {m.symbol}
                    </Link>
                  ))}
                </span>
                {stacked && (
                  <span className="text-caption text-[var(--color-uncertain)] md:ml-auto">
                    {c.members.length}× the same trade · {(c.meanCorrelation * 100).toFixed(0)}% correlated
                    {c.mixedSides && ' · opposite sides, same bet'}
                  </span>
                )}
                <span className={`tnum ${stacked ? '' : 'ml-auto'} ml-auto w-10 text-right text-small font-semibold md:ml-0`}>
                  {c.combinedScore}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <Note>
        Correlated symbols score alike <em>by construction</em> — EURUSD, GBPUSD and gold share the same dollar leg. A group
        of four here is one position at four times the size. Grouped above {Math.round(threshold * 100)}% correlation of
        daily returns; an inverse pair called in opposite directions counts as one trade.
      </Note>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Risk on / risk off
// ---------------------------------------------------------------------------

export function RiskPanel({ risk, bands }: { risk: RiskGauge; bands: { moderate: number; strong: number } }) {
  const riskPct = ((risk.score + 6) / 12) * 100;
  return (
    <Panel title="Risk on / risk off" subtitle={`${risk.populated} of 6 inputs · our rule set, not a reproduction`}>
      <div className="px-4 py-4">
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          <span className={`tnum text-3xl font-bold ${signColor(risk.score)}`}>
            {risk.score > 0 ? '+' : ''}
            {risk.score}
          </span>
          <span className={`text-body font-semibold ${signColor(risk.score)}`}>{risk.label}</span>
          <span className="ml-auto text-caption text-[var(--color-faint)]">−6 risk-off · +6 risk-on</span>
        </div>
        <div className="relative mb-4 h-2 rounded-full bg-[var(--color-surface-2)]">
          <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border-bright)]" />
          <div
            className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-surface)] ${
              risk.score > 0 ? 'bg-[var(--color-bull)]' : risk.score < 0 ? 'bg-[var(--color-bear)]' : 'bg-[var(--color-muted)]'
            }`}
            style={{ left: `${riskPct}%` }}
          />
        </div>
        <dl className="divide-y divide-[var(--color-border)]">
          {risk.components.map((c) => (
            <div key={c.key} className="py-2">
              <div className="flex items-center gap-2 text-small">
                <dt className="text-[var(--color-text)]">
                  {c.label}
                  {c.inverted && <span className="ml-1.5 text-micro text-[var(--color-faint)]">inverted</span>}
                </dt>
                <dd className={`tnum ml-auto font-semibold ${signColor(c.cell)}`}>
                  {c.price === null ? '—' : c.cell > 0 ? '+1' : c.cell < 0 ? '−1' : '0'}
                </dd>
              </div>
              <p className="mt-0.5 text-caption text-[var(--color-faint)]">{c.explanation}</p>
            </div>
          ))}
        </dl>
      </div>
      <Note>
        Each input scores ±1 against its own 14-day average. VIX, gold and the dollar are inverted — they rise when capital
        seeks safety. Bands at ±{bands.moderate} and ±{bands.strong}.
      </Note>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Economic strength (surprise-based macro score)
// ---------------------------------------------------------------------------

export function StrengthPanel({ strength }: { strength: StrengthRow[] }) {
  const widest = Math.max(1, ...strength.map((r) => Math.abs(r.macroScore)));
  return (
    <Panel title="Economic strength" subtitle="Each economy's own macro cells summed">
      <div className="flex flex-col gap-1 px-4 py-3">
        {strength.map((row) => (
          <DivergingRow
            key={row.currency}
            label={
              <>
                <span className="mr-2 text-caption text-[var(--color-faint)]">{row.rank}</span>
                {row.currency}
              </>
            }
            value={row.macroScore}
            max={widest}
            format={(v) => `${v > 0 ? '+' : ''}${v}`}
          />
        ))}
      </div>
      <Note>
        The same cells the scorecard differences into a pair, summed per economy. A ranking of surprises — for where each
        economy stands, see the Eco Strength Index.
      </Note>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Eco strength index (levels, A1's construction)
// ---------------------------------------------------------------------------

const BIAS_TONE = {
  Bullish: 'text-[var(--color-bull)]',
  Neutral: 'text-[var(--color-muted)]',
  Bearish: 'text-[var(--color-bear)]',
} as const;

export function EcoStrengthPanel({ rows, componentMax }: { rows: EcoStrengthRow[]; componentMax: number }) {
  const component = (
    key: string,
    label: string,
    explain: string,
    score: (r: EcoStrengthRow) => number | null,
    raw: (r: EcoStrengthRow) => number | null,
  ): Column<EcoStrengthRow> => ({
    key,
    label,
    explain,
    sortValue: score,
    render: (r) => (
      <span className={score(r) === null ? 'text-[var(--color-faint)]' : ''}>
        {score(r) ?? '—'}
        <span className="ml-1.5 text-micro text-[var(--color-faint)]">{pct(raw(r), 1)}</span>
      </span>
    ),
  });

  const columns: Column<EcoStrengthRow>[] = [
    {
      key: 'currency',
      label: 'Currency',
      align: 'left',
      sticky: true,
      hideOnCards: true,
      sortValue: (r) => r.currency,
      defaultDir: 'asc',
      render: (r) => <span className="font-semibold">{r.currency}</span>,
    },
    component('gdp', 'GDP', 'GDP growth. Higher is stronger.', (r) => r.gdpScore, (r) => r.gdpGrowth),
    component('jobs', 'Jobs', 'Unemployment rate. LOWER is stronger.', (r) => r.unemploymentScore, (r) => r.unemploymentRate),
    component('cpi', 'CPI', 'Headline CPI year on year. LOWER is stronger.', (r) => r.cpiScore, (r) => r.cpiYoY),
    component('rate', 'Rate', 'Policy rate. Higher is stronger.', (r) => r.interestRateScore, (r) => r.interestRate),
    {
      key: 'total',
      label: 'Score',
      explain: `Sum of the four components, each 0–${componentMax}. A row missing a component cannot reach the maximum and is flagged.`,
      sortValue: (r) => r.totalScore,
      render: (r) => (
        <span className="font-semibold">
          {r.totalScore}
          {r.componentsScored < 4 && (
            <span className="ml-1 text-micro text-[var(--color-uncertain)]">{r.componentsScored}/4</span>
          )}
        </span>
      ),
    },
    {
      key: 'bias',
      label: 'Bias',
      align: 'left',
      sortValue: (r) => r.totalScore,
      hideOnCards: true,
      render: (r) => <span className={BIAS_TONE[r.bias]}>{r.bias}</span>,
    },
    {
      key: 'real',
      label: 'Real yield',
      explain: 'Policy rate minus headline CPI.',
      sortValue: (r) => r.realYield,
      cellStyle: (r) => heatStyle(r.realYield, { max: 3, zeroGrey: false }),
      render: (r) => (
        <span className={r.realYield === null ? 'text-[var(--color-faint)]' : signColor(r.realYield)}>
          {pct(r.realYield, 2, true)}
        </span>
      ),
    },
  ];

  return (
    <Panel title="Eco strength index" subtitle="Where each economy stands, not whether it beat expectations">
      <DataTable
        caption="Eco strength index"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.currency}
        defaultSort={{ key: 'total', dir: 'desc' }}
        cardTitle={(r) => r.currency}
        cardAside={(r) => <span className={`text-small ${BIAS_TONE[r.bias]}`}>{r.bias}</span>}
      />
      <Note>
        Each component is scored 0–{componentMax} against the other seven majors, so a {componentMax} means best of the eight
        rather than good. Read it as a ranking with distances: if every economy weakens together the table barely moves. It
        is never added to a symbol&rsquo;s score — a level and a surprise on the same release are not independent evidence.
      </Note>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Surprise list
// ---------------------------------------------------------------------------

export function SurpriseListPanel({ surprise, minSample }: { surprise: SurpriseIndex[]; minSample: number }) {
  return (
    <Panel title="Economic surprise" subtitle="Share of recent releases that beat expectations">
      <div className="flex flex-col gap-1 px-4 py-3">
        {surprise.map((s) => (
          <DivergingRow
            key={s.currency}
            label={s.currency}
            value={s.index === null ? null : s.index - 50}
            max={50}
            format={() => `${s.index}%`}
            aside={
              <span className="ml-2 text-micro font-normal text-[var(--color-faint)]">
                {s.sampled < minSample ? `thin` : `${s.beats}↑${s.misses}↓`}
              </span>
            }
          />
        ))}
      </div>
      <Note>
        Beats over beats plus misses; on-forecast prints are left out. Rows marked thin have fewer than {minSample} resolved
        releases.{' '}
        <Link href="/surprise" className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-text)]">
          Open the surprise index
        </Link>
        .
      </Note>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Policy and rates / real yield
// ---------------------------------------------------------------------------

export interface RateRow extends StrengthRow {
  regime: 'hiking' | 'cutting' | 'neutral' | string;
  marketYield: SovereignYield | null;
}

const REGIME_STYLE: Record<string, { label: string; tone: string }> = {
  hiking: { label: 'Hiking', tone: 'text-[var(--color-bull)]' },
  cutting: { label: 'Cutting', tone: 'text-[var(--color-bear)]' },
  neutral: { label: 'On hold', tone: 'text-[var(--color-muted)]' },
};

const RATE_COLUMNS: Column<RateRow>[] = [
  {
    key: 'currency',
    label: 'Currency',
    align: 'left',
    sticky: true,
    hideOnCards: true,
    sortValue: (r) => r.currency,
    defaultDir: 'asc',
    render: (r) => <span className="font-semibold">{r.currency}</span>,
  },
  {
    key: 'stance',
    label: 'Stance',
    align: 'left',
    render: (r) => {
      const s = REGIME_STYLE[r.regime] ?? REGIME_STYLE.neutral;
      return <span className={s.tone}>{s.label}</span>;
    },
  },
  { key: 'policy', label: 'Policy', sortValue: (r) => r.policyRate, render: (r) => pct(r.policyRate) },
  { key: 'cpi', label: 'CPI', sortValue: (r) => r.cpi, render: (r) => pct(r.cpi, 1) },
  {
    key: 'real',
    label: 'Real yield',
    explain: 'Policy rate minus CPI — the actual return on holding the currency. 5% against 6% inflation is a negative real return.',
    sortValue: (r) => r.realYield,
    cellStyle: (r) => heatStyle(r.realYield, { max: 3, zeroGrey: false }),
    render: (r) => (
      <span className={`font-semibold ${r.realYield === null ? 'text-[var(--color-faint)]' : signColor(r.realYield)}`}>
        {pct(r.realYield, 2, true)}
      </span>
    ),
  },
  {
    key: 'market',
    label: 'Market 2y',
    explain:
      'A genuine market price for USD and EUR only, from FRED and the ECB. No free daily 2-year exists for the other six, so they read "assumed" and their rate cell comes from the stance column.',
    sortValue: (r) => r.marketYield?.value ?? null,
    render: (r) =>
      r.marketYield ? (
        <span title={`${r.marketYield.source}, observed ${r.marketYield.observedOn}`}>{pct(r.marketYield.value)}</span>
      ) : (
        <span className="text-[var(--color-faint)]">assumed</span>
      ),
  },
];

export function RatesPanel({ rows }: { rows: RateRow[] }) {
  return (
    <Panel title="Policy and real yield" subtitle="What each bank is doing, and what it actually pays">
      <DataTable
        caption="Policy and real yield"
        columns={RATE_COLUMNS}
        rows={rows}
        rowKey={(r) => r.currency}
        defaultSort={{ key: 'real', dir: 'desc' }}
        cardTitle={(r) => r.currency}
        cardAside={(r) => (
          <span className={`tnum text-small font-semibold ${r.realYield === null ? 'text-[var(--color-faint)]' : signColor(r.realYield)}`}>
            real {pct(r.realYield, 2, true)}
          </span>
        )}
      />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// US yield curve
// ---------------------------------------------------------------------------

export function YieldCurvePanel({ curve, smaDays }: { curve: YieldCurve; smaDays: number }) {
  return (
    <Panel
      title="US yield curve"
      subtitle={curve.observedOn ? `10-year minus 2-year · observed ${curve.observedOn}` : '10-year minus 2-year'}
    >
      {curve.spread === null ? (
        <p className="px-4 py-6 text-center text-small text-[var(--color-faint)]">
          FRED did not answer. The curve is the only panel that needs it.
        </p>
      ) : (
        <div className="px-4 py-4">
          <div className="mb-3 flex flex-wrap items-baseline gap-3">
            <span className={`tnum text-3xl font-bold ${signColor(curve.spread)}`}>{pct(curve.spread, 2, true)}</span>
            <span className={`text-body font-semibold ${signColor(curve.spread)}`}>
              {curve.spread < 0 ? 'Inverted' : curve.spread < 0.25 ? 'Flat' : 'Positive'}
            </span>
          </div>
          <dl className="divide-y divide-[var(--color-border)] text-small">
            <div className="flex items-center gap-2 py-2">
              <dt className="text-[var(--color-muted)]">2-year</dt>
              <dd className="tnum ml-auto font-semibold">{pct(curve.twoYear)}</dd>
            </div>
            <div className="flex items-center gap-2 py-2">
              <dt className="text-[var(--color-muted)]">10-year</dt>
              <dd className="tnum ml-auto font-semibold">{pct(curve.tenYear)}</dd>
            </div>
          </dl>
        </div>
      )}
      <Note>
        The spread is FRED&rsquo;s own <code>T10Y2Y</code> series, not the two levels subtracted — FRED publishes each on its
        own schedule.{curve.levelsLag && ' The levels are currently a session or two behind the spread.'}{' '}
        <strong className="text-[var(--color-muted)]">This panel does not score.</strong> The rate cell reads the 2-year
        against its {smaDays}-day average.
      </Note>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Carry
// ---------------------------------------------------------------------------

const CARRY_COLUMNS: Column<CarryRow>[] = [
  {
    key: 'symbol',
    label: 'Pair',
    align: 'left',
    sticky: true,
    hideOnCards: true,
    sortValue: (r) => r.symbol,
    defaultDir: 'asc',
    render: (r) => (
      <Link href={`/scorecard/${r.symbol}`} className="font-mono font-semibold hover:text-[var(--color-bull)]">
        {r.symbol}
      </Link>
    ),
  },
  { key: 'base', label: 'Base rate', sortValue: (r) => r.baseRate, render: (r) => `${r.base} ${pct(r.baseRate)}` },
  { key: 'quote', label: 'Quote rate', sortValue: (r) => r.quoteRate, render: (r) => `${r.quote} ${pct(r.quoteRate)}` },
  {
    key: 'carry',
    label: 'Carry',
    explain: 'Base rate minus quote rate, per year, signed against the pair as quoted.',
    sortValue: (r) => Math.abs(r.carry),
    cellStyle: (r) => heatStyle(r.carry, { max: 5, zeroGrey: false }),
    render: (r) => <span className={`font-semibold ${signColor(r.carry)}`}>{pct(r.carry, 2, true)}</span>,
  },
  {
    key: 'direction',
    label: 'Collect by',
    align: 'left',
    sortValue: (r) => r.direction,
    defaultDir: 'asc',
    render: (r) => (
      <span className={`uppercase ${r.direction === 'long' ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'}`}>
        {r.direction}
      </span>
    ),
  },
];

export function CarryPanel({ carry, maxHeight }: { carry: CarryRow[]; maxHeight?: string }) {
  return (
    <Panel title="Carry scanner" subtitle="Annual policy-rate differential, widest first">
      <DataTable
        caption="Carry scanner"
        columns={CARRY_COLUMNS}
        rows={carry}
        rowKey={(r) => r.symbol}
        defaultSort={{ key: 'carry', dir: 'desc' }}
        maxHeight={maxHeight}
        cardTitle={(r) => (
          <Link href={`/scorecard/${r.symbol}`} className="font-mono">
            {r.symbol}
          </Link>
        )}
        cardAside={(r) => <span className={`tnum text-small font-semibold ${signColor(r.carry)}`}>{pct(r.carry, 2, true)}</span>}
        empty="No policy rates resolved from the calendar yet. Pairs are omitted rather than assuming a missing rate is zero."
      />
      <Note>
        A negative carry is collected by holding the short. Gross of broker spread and financing, so treat it as the
        theoretical differential, not a quote.
      </Note>
    </Panel>
  );
}
