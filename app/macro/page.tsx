/**
 * Macro Scanners — the cross-asset view that sits above any single symbol.
 *
 * Was /markets. Renamed and regrouped rather than duplicated: EdgeFinder splits
 * this material across a dozen named scanners, and building a second page over
 * the same pipeline would have guaranteed the two drifted apart. /markets still
 * resolves, as a redirect.
 *
 * Panels answer different questions from one fetch: is capital risk-seeking,
 * what does the curve say, who pays you to hold what, which economies are
 * beating expectations, and where is the board concentrated. The smart-money
 * table moved to /sentiment, where the rest of the positioning lives.
 *
 * All of it is derived in runSetupsPipeline from data the scorecard already
 * needed, so this page costs no additional upstream requests.
 */

import Link from 'next/link';
import { CURRENCY_REGIME } from '@/config/scoring.config';
import { COMPONENT_MAX } from '@/lib/scoring/eco-strength';
import { FX_SYMBOLS } from '@/config/symbols.config';
import { YIELD_SMA_DAYS } from '@/config/setups.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { RISK_BANDS, SURPRISE_MIN_SAMPLE, buildCarryTable, buildSurpriseIndex } from '@/lib/scoring/market';
import { CLUSTER_THRESHOLD } from '@/lib/scoring/correlation';
import { MAJORS } from '@/lib/types';
import { Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

function signColor(v: number): string {
  if (v > 0) return 'text-[var(--color-bull)]';
  if (v < 0) return 'text-[var(--color-bear)]';
  return 'text-[var(--color-muted)]';
}

const REGIME_STYLE: Record<string, { label: string; tone: string }> = {
  hiking: { label: 'Hiking', tone: 'text-[var(--color-bull)]' },
  cutting: { label: 'Cutting', tone: 'text-[var(--color-bear)]' },
  neutral: { label: 'On hold', tone: 'text-[var(--color-muted)]' },
};

export default async function MacroPage() {
  const { risk, strength, ecoStrength, policyRates, sovereignYields, yieldCurve, events, clusters } =
    await runSetupsPipeline();

  const carry = buildCarryTable(FX_SYMBOLS, policyRates);
  /**
   * Currencies with no directional release sort last rather than to the middle.
   * `index` is null for them, and treating that as 50 would rank "we know
   * nothing" above a genuinely weak economy.
   */
  const surprise = MAJORS.map((c) => buildSurpriseIndex(c, events)).sort(
    (a, b) => (b.index ?? -1) - (a.index ?? -1),
  );

  // Full-width bar geometry for the -6..+6 gauge.
  const riskPct = ((risk.score + 6) / 12) * 100;

  /**
   * One row per major: what the bank is doing, what it charges, what inflation
   * is doing to that, and what the market's own 2-year says where we can read
   * one. `strength` already carries the first three; the yield is the addition.
   */
  const rateRows = strength.map((row) => ({
    ...row,
    regime: CURRENCY_REGIME[row.currency],
    marketYield: sovereignYields.get(row.currency) ?? null,
  }));

  return (
    <div className="px-4 py-4">
      <header className="mb-4">
        <h1 className="text-lg font-bold">Macro</h1>
        <p className="text-xs text-[var(--color-faint)]">
          Cross-asset reads · derived from the same data as the scorecard
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* --- Concentration ----------------------------------------------- */}
        <Panel
          title="Concentration"
          subtitle="Top setups grouped into the trades they actually are"
          className="xl:col-span-2"
        >
          {clusters.length === 0 ? (
            <p className="px-4 py-6 text-center text-[11px] text-[var(--color-faint)]">
              No directional setups on the board right now.
            </p>
          ) : (
            /*
              Capped and scrollable, like the carry and strength tables below.
              This panel is full-width and lists every cluster including the
              singletons, so at 51 symbols it grew to twenty rows and pushed
              the rates and curve panels off the first screen — on a page whose
              whole job is to be read in one pass.
            */
            <div className="max-h-[22rem] divide-y divide-[var(--color-border)] overflow-y-auto">
              {clusters.map((c) => {
                const stacked = c.members.length > 1;
                return (
                  <div key={c.lead} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                    {/*
                      Direction is PER MEMBER, not per cluster. Short DXY and
                      long EURX are one short-dollar trade, and labelling the
                      whole group "short" would claim EURX is a short — false,
                      and exactly the kind of quiet wrongness this panel exists
                      to remove.
                    */}
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      {c.members.map((m, i) => (
                        <Link
                          key={m.symbol}
                          href={`/scorecard/${m.symbol}`}
                          title={`${m.direction} ${m.symbol}, score ${m.score > 0 ? '+' : ''}${m.score}`}
                          className={`font-mono text-[11px] hover:underline ${
                            m.direction === 'long' ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'
                          } ${i === 0 ? 'font-semibold' : 'opacity-80'}`}
                        >
                          {m.direction === 'long' ? '▲' : '▼'} {m.symbol}
                        </Link>
                      ))}
                    </span>

                    {stacked && (
                      <span
                        className="ml-auto text-[10px] text-[var(--color-uncertain)]"
                        title={`Mean pairwise correlation ${(c.meanCorrelation * 100).toFixed(0)}%`}
                      >
                        {c.members.length}x the same trade · {(c.meanCorrelation * 100).toFixed(0)}% correlated
                        {c.mixedSides && ' · opposite sides, same bet'}
                      </span>
                    )}
                    <span className={`tnum ${stacked ? '' : 'ml-auto'} w-12 text-right text-xs font-semibold`}>
                      {c.combinedScore}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="border-t border-[var(--color-border)] px-4 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
            Correlated symbols score alike <em>by construction</em> — EURUSD, GBPUSD and gold share the
            same dollar leg, so one macro story pushes them up the ranking together. A group of four
            here is one position at four times the size, which is the most common way a scorecard loses
            money: not by calling direction wrong, but by being right once and sized for four. Grouped
            above {Math.round(CLUSTER_THRESHOLD * 100)}% correlation of daily returns; an inverse pair
            called in opposite directions counts as one trade, called the same way it is a hedge.
          </p>
        </Panel>

        {/* --- Risk on / risk off ---------------------------------------- */}
        <Panel
          title="Risk on / risk off"
          subtitle={`${risk.populated} of 6 inputs · our rule set, not a reproduction`}
        >
          <div className="px-4 py-3">
            <div className="mb-1 flex items-baseline gap-3">
              <span className={`text-3xl font-bold tnum ${signColor(risk.score)}`}>
                {risk.score > 0 ? '+' : ''}
                {risk.score}
              </span>
              <span className={`text-sm font-semibold ${signColor(risk.score)}`}>{risk.label}</span>
              <span className="ml-auto text-[10px] text-[var(--color-faint)]">
                −6 risk-off · +6 risk-on
              </span>
            </div>

            <div className="relative mb-3 h-2 rounded-full bg-[var(--color-surface-2)]">
              <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border-bright)]" />
              <div
                className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                  risk.score > 0 ? 'bg-[var(--color-bull)]' : risk.score < 0 ? 'bg-[var(--color-bear)]' : 'bg-[var(--color-muted)]'
                }`}
                style={{ left: `${riskPct}%` }}
              />
            </div>

            <dl className="divide-y divide-[var(--color-border)] text-[11px]">
              {risk.components.map((c) => (
                <div key={c.key} className="flex items-center gap-2 py-1.5" title={c.explanation}>
                  <dt className="text-[var(--color-muted)]">
                    {c.label}
                    {c.inverted && (
                      <span className="ml-1 text-[9px] text-[var(--color-faint)]">inverted</span>
                    )}
                  </dt>
                  <dd className={`ml-auto tnum font-semibold ${signColor(c.cell)}`}>
                    {c.price === null ? '—' : c.cell > 0 ? '+1' : c.cell < 0 ? '-1' : '0'}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-2 border-t border-[var(--color-border)] pt-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
              Each input scores ±1 against its own 14-day average. VIX, gold and the
              dollar are inverted — they rise when capital seeks safety. Bands at
              ±{RISK_BANDS.moderate} and ±{RISK_BANDS.strong}.
            </p>
          </div>
        </Panel>

        {/*
          --- Economic strength -------------------------------------------
          Ranking only. The policy, CPI and real-yield columns this table used
          to carry now live in Policy and rates below, next to the stance and
          the market 2-year that give them meaning. Two tables printing the same
          three numbers is how they end up disagreeing.
        */}
        <Panel title="Economic strength" subtitle="Currencies ranked on their own fundamentals">
          <div className="divide-y divide-[var(--color-border)]">
            {strength.map((row) => {
              // Bar is the macro score against the widest reading on the board,
              // so the ranking is legible before any number is read.
              const widest = Math.max(1, ...strength.map((r) => Math.abs(r.macroScore)));
              const width = (Math.abs(row.macroScore) / widest) * 50;

              return (
                <div key={row.currency} className="flex items-center gap-3 px-4 py-1.5">
                  <span className="w-4 text-[10px] text-[var(--color-faint)]">{row.rank}</span>
                  <span className="w-9 text-[11px] font-semibold">{row.currency}</span>

                  <div className="relative h-2 flex-1 rounded-full bg-[var(--color-surface-2)]">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border-bright)]" />
                    <div
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        width: `${width}%`,
                        left: row.macroScore >= 0 ? '50%' : undefined,
                        right: row.macroScore >= 0 ? undefined : '50%',
                        backgroundColor:
                          row.macroScore >= 0 ? 'var(--color-bull)' : 'var(--color-bear)',
                        opacity: 0.8,
                      }}
                    />
                  </div>

                  <span
                    className={`tnum w-10 text-right text-xs font-semibold ${signColor(row.macroScore)}`}
                  >
                    {row.macroScore > 0 ? '+' : ''}
                    {row.macroScore}
                  </span>
                  <span
                    className={`w-16 text-right text-[10px] ${
                      row.realYield === null ? 'text-[var(--color-faint)]' : signColor(row.realYield)
                    }`}
                    title="Real yield — policy rate minus CPI. Detail in Policy and rates."
                  >
                    {row.realYield === null
                      ? 'real —'
                      : `real ${row.realYield > 0 ? '+' : ''}${row.realYield.toFixed(1)}%`}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="border-t border-[var(--color-border)] px-4 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
            The bar is each economy&rsquo;s own macro cells summed — the same cells the scorecard
            differences into a pair. Real yield rides alongside because a strong economy paying a
            negative real return is a different trade from one paying a positive one.
          </p>
        </Panel>

        {/*
          --- Eco strength index -------------------------------------------
          THE OTHER QUESTION. Every other panel on this page and every cell on
          the board scores a SURPRISE: how a release compared to what was
          expected. That deliberately says nothing about level — an economy can
          beat a low bar and lead the strength table while sitting last here.

          The construction is A1's, adopted because it reproduces: all 32
          published sub-scores fall out of it exactly (lib/scoring/eco-strength.ts).
          The numbers below are ours, computed from the same releases the board
          scores. It is never added to a symbol's score — a level and a surprise
          on the same release are not independent evidence.
        */}
        <Panel
          title="Eco strength index"
          subtitle="Where each economy stands, not whether it beat expectations"
        >
          <table className="w-full text-left text-[11px]">
            <thead className="text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-4 py-1.5 font-medium">Cur</th>
                <th className="px-2 py-1.5 text-right font-medium" title="GDP growth, higher is stronger">
                  GDP
                </th>
                <th className="px-2 py-1.5 text-right font-medium" title="Unemployment rate, LOWER is stronger">
                  Jobs
                </th>
                <th className="px-2 py-1.5 text-right font-medium" title="Headline CPI year on year, LOWER is stronger">
                  CPI
                </th>
                <th className="px-2 py-1.5 text-right font-medium" title="Policy rate, higher is stronger">
                  Rate
                </th>
                <th className="px-2 py-1.5 text-right font-medium">Score</th>
                <th className="px-4 py-1.5 text-right font-medium">Real</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {ecoStrength.map((row) => (
                <tr key={row.currency}>
                  <td className="px-4 py-1.5 font-semibold">{row.currency}</td>
                  {[row.gdpScore, row.unemploymentScore, row.cpiScore, row.interestRateScore].map(
                    (component, i) => (
                      <td
                        key={i}
                        className={`tnum px-2 py-1.5 text-right ${
                          component === null ? 'text-[var(--color-faint)]' : ''
                        }`}
                      >
                        {component ?? '—'}
                      </td>
                    ),
                  )}
                  <td className="tnum px-2 py-1.5 text-right font-semibold">
                    {row.totalScore}
                    {/*
                      A row missing a component cannot reach 100 and must not be
                      read beside one that can. Flagged rather than hidden.
                    */}
                    {row.componentsScored < 4 && (
                      <span
                        className="ml-1 text-[9px] text-[var(--color-uncertain)]"
                        title={`Only ${row.componentsScored} of 4 components resolved — not comparable with a full row`}
                      >
                        {row.componentsScored}/4
                      </span>
                    )}
                  </td>
                  <td
                    className={`tnum px-4 py-1.5 text-right ${
                      row.realYield === null ? 'text-[var(--color-faint)]' : signColor(row.realYield)
                    }`}
                    title="Policy rate minus headline CPI"
                  >
                    {row.realYield === null
                      ? '—'
                      : `${row.realYield > 0 ? '+' : ''}${row.realYield.toFixed(2)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-[var(--color-border)] px-4 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
            Each column is scored 0&ndash;{COMPONENT_MAX} against the other seven majors, so a 25 means
            best of the eight rather than good. Read it as a ranking with distances: if every economy
            weakens together the table barely moves.
          </p>
        </Panel>

        {/* --- Surprise index --------------------------------------------- */}
        <Panel title="Economic surprise index" subtitle="Share of recent releases that beat expectations">
          <div className="divide-y divide-[var(--color-border)]">
            {surprise.map((s) => (
              <div key={s.currency} className="flex items-center gap-3 px-4 py-2">
                <span className="w-9 text-[11px] font-semibold">{s.currency}</span>

                <div className="relative h-2 flex-1 rounded-full bg-[var(--color-surface-2)]">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border-bright)]" />
                  {s.index !== null && (
                    <div
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        left: s.index >= 50 ? '50%' : `${s.index}%`,
                        width: `${Math.abs(s.index - 50)}%`,
                        backgroundColor: s.index >= 50 ? 'var(--color-bull)' : 'var(--color-bear)',
                        opacity: 0.8,
                      }}
                    />
                  )}
                </div>

                <span
                  className={`tnum w-10 text-right text-xs font-semibold ${
                    s.index === null ? 'text-[var(--color-faint)]' : signColor(s.index - 50)
                  }`}
                >
                  {s.index === null ? '—' : `${s.index}%`}
                </span>
                <span
                  className="w-20 text-right text-[10px] text-[var(--color-faint)]"
                  title={`${s.beats} beat, ${s.misses} missed, ${s.inline} on forecast`}
                >
                  {s.sampled < SURPRISE_MIN_SAMPLE ? `thin (${s.sampled})` : `${s.beats}↑ ${s.misses}↓`}
                </span>
              </div>
            ))}
          </div>
          <p className="border-t border-[var(--color-border)] px-4 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
            100% means every tracked release beat forecast, 0% that all missed. An
            on-forecast print counts as half. Rows marked thin have fewer than{' '}
            {SURPRISE_MIN_SAMPLE} resolved releases and should not be read as a trend.
          </p>
        </Panel>

        {/* --- Policy and rates -------------------------------------------- */}
        <Panel
          title="Policy and rates"
          subtitle="What each bank is doing, and what it actually pays"
        >
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-[9px] tracking-wider text-[var(--color-faint)] uppercase">
                <th className="px-4 py-1.5">Currency</th>
                <th className="px-2 py-1.5">Stance</th>
                <th className="px-2 py-1.5 text-right">Policy</th>
                <th className="px-2 py-1.5 text-right">CPI</th>
                <th className="px-2 py-1.5 text-right">Real</th>
                <th className="px-4 py-1.5 text-right">Market 2y</th>
              </tr>
            </thead>
            <tbody>
              {rateRows.map((row) => {
                const regime = REGIME_STYLE[row.regime] ?? REGIME_STYLE.neutral;
                return (
                  <tr key={row.currency} className="border-t border-[var(--color-border)]">
                    <td className="px-4 py-1.5 font-semibold">{row.currency}</td>
                    <td className={`px-2 py-1.5 text-[10px] ${regime.tone}`}>{regime.label}</td>
                    <td className="tnum px-2 py-1.5 text-right text-[var(--color-muted)]">
                      {row.policyRate === null ? '—' : `${row.policyRate.toFixed(2)}%`}
                    </td>
                    <td className="tnum px-2 py-1.5 text-right text-[var(--color-muted)]">
                      {row.cpi === null ? '—' : `${row.cpi.toFixed(1)}%`}
                    </td>
                    <td
                      className={`tnum px-2 py-1.5 text-right font-semibold ${
                        row.realYield === null ? 'text-[var(--color-faint)]' : signColor(row.realYield)
                      }`}
                    >
                      {row.realYield === null
                        ? '—'
                        : `${row.realYield > 0 ? '+' : ''}${row.realYield.toFixed(2)}%`}
                    </td>
                    <td
                      className="tnum px-4 py-1.5 text-right text-[var(--color-muted)]"
                      title={
                        row.marketYield
                          ? `${row.marketYield.source}, observed ${row.marketYield.observedOn}`
                          : 'No free daily 2-year exists for this currency — the rate cell falls back to the hand-maintained regime above'
                      }
                    >
                      {row.marketYield ? (
                        `${row.marketYield.value.toFixed(2)}%`
                      ) : (
                        <span className="text-[var(--color-faint)]">assumed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-[var(--color-border)] px-4 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
            <strong className="text-[var(--color-muted)]">Real</strong> is the policy rate minus
            CPI — the actual return on holding the currency, and the column that explains flows the
            others cannot: 5% against 6% inflation is a negative real return.{' '}
            <strong className="text-[var(--color-muted)]">Market 2y</strong> is a genuine market
            price for USD and EUR only, from FRED and the ECB. No free daily 2-year exists for the
            other six, so they read <em>assumed</em> — their rate cell comes from the hand-maintained
            stance column, and the distinction is shown rather than smoothed over.
          </p>
        </Panel>

        {/* --- Yield curve --------------------------------------------------- */}
        <Panel
          title="US yield curve"
          subtitle={
            yieldCurve.observedOn
              ? `10-year minus 2-year · observed ${yieldCurve.observedOn}`
              : '10-year minus 2-year'
          }
        >
          {yieldCurve.spread === null ? (
            <p className="px-4 py-6 text-center text-[11px] text-[var(--color-faint)]">
              FRED did not answer. The curve is the only panel here that needs it; everything else
              on this page is unaffected.
            </p>
          ) : (
            <div className="px-4 py-3">
              <div className="mb-3 flex items-baseline gap-3">
                <span className={`tnum text-3xl font-bold ${signColor(yieldCurve.spread)}`}>
                  {yieldCurve.spread > 0 ? '+' : ''}
                  {yieldCurve.spread.toFixed(2)}%
                </span>
                <span className={`text-sm font-semibold ${signColor(yieldCurve.spread)}`}>
                  {yieldCurve.spread < 0 ? 'Inverted' : yieldCurve.spread < 0.25 ? 'Flat' : 'Positive'}
                </span>
                <span className="ml-auto text-[10px] text-[var(--color-faint)]">
                  inverted · flat · positive
                </span>
              </div>

              <dl className="divide-y divide-[var(--color-border)] text-[11px]">
                <div className="flex items-center gap-2 py-1.5">
                  <dt className="text-[var(--color-muted)]">2-year</dt>
                  <dd className="tnum ml-auto font-semibold">
                    {yieldCurve.twoYear === null ? '—' : `${yieldCurve.twoYear.toFixed(2)}%`}
                  </dd>
                </div>
                <div className="flex items-center gap-2 py-1.5">
                  <dt className="text-[var(--color-muted)]">10-year</dt>
                  <dd className="tnum ml-auto font-semibold">
                    {yieldCurve.tenYear === null ? '—' : `${yieldCurve.tenYear.toFixed(2)}%`}
                  </dd>
                </div>
              </dl>

              <p className="mt-2 border-t border-[var(--color-border)] pt-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
                The spread is FRED&rsquo;s own <code>T10Y2Y</code> series, not the two levels
                above subtracted. They look equivalent and are not — FRED publishes each on its own
                schedule, so deriving the spread from the legs reports a stale curve as current.
                {yieldCurve.levelsLag && ' The levels above are currently a session or two behind the spread.'}{' '}
                <strong className="text-[var(--color-muted)]">This panel does not score.</strong> The
                scorecard&rsquo;s rate cell reads the 2-year against its {YIELD_SMA_DAYS}-day
                average; the curve is context.
              </p>
            </div>
          )}
        </Panel>

        {/* --- Carry -------------------------------------------------------- */}
        <Panel
          title="Carry scanner"
          subtitle="Annual policy-rate differential, widest first"
        >
          {carry.length === 0 ? (
            <p className="px-4 py-6 text-center text-[11px] text-[var(--color-faint)]">
              No policy rates resolved from the calendar yet. Pairs are omitted rather
              than assuming a missing rate is zero.
            </p>
          ) : (
            <div className="max-h-[22rem] overflow-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-[var(--color-surface)]">
                  <tr className="text-[9px] tracking-wider text-[var(--color-faint)] uppercase">
                    <th className="px-4 py-1.5">Pair</th>
                    <th className="px-2 py-1.5 text-right">Base</th>
                    <th className="px-2 py-1.5 text-right">Quote</th>
                    <th className="px-2 py-1.5 text-right">Carry</th>
                    <th className="px-4 py-1.5">Collect by</th>
                  </tr>
                </thead>
                <tbody>
                  {carry.slice(0, 14).map((row) => (
                    <tr key={row.symbol} className="border-t border-[var(--color-border)]">
                      <td className="px-4 py-1.5">
                        <Link href={`/scorecard/${row.symbol}`} className="hover:text-[var(--color-bull)]">
                          {row.label}
                        </Link>
                      </td>
                      <td className="tnum px-2 py-1.5 text-right text-[var(--color-muted)]">
                        {row.baseRate.toFixed(2)}%
                      </td>
                      <td className="tnum px-2 py-1.5 text-right text-[var(--color-muted)]">
                        {row.quoteRate.toFixed(2)}%
                      </td>
                      <td className={`tnum px-2 py-1.5 text-right font-semibold ${signColor(row.carry)}`}>
                        {row.carry > 0 ? '+' : ''}
                        {row.carry.toFixed(2)}%
                      </td>
                      <td className="px-4 py-1.5 text-[10px] uppercase">
                        <span className={row.direction === 'long' ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'}>
                          {row.direction}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-[var(--color-border)] px-4 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
            Carry is base rate minus quote rate, signed against the pair as quoted —
            a negative carry is collected by holding the short. Gross of broker spread
            and financing, so treat it as the theoretical differential, not a quote.
          </p>
        </Panel>
      </div>

      <p className="mt-3 px-1 text-[10px] leading-relaxed text-[var(--color-faint)]">
        Institutional versus retail positioning moved to{' '}
        <Link
          href="/sentiment"
          className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-text)]"
        >
          Sentiment
        </Link>
        , alongside the crowd bars and the 3-year percentiles it is read against. Seasonal
        tendencies are on{' '}
        <Link
          href="/seasonality"
          className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-text)]"
        >
          Seasonality
        </Link>
        .
      </p>
    </div>
  );
}
