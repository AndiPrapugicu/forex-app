/**
 * Market Narrative: what each economy and asset is being moved by this week,
 * read deterministically — and what would turn it.
 *
 * The same engine the AI analyst is told to restate (lib/analysis/themes.ts),
 * shown without spending a request. It is NOT the board: the board reproduces
 * A1's scoring; this reads the week's data, the futures strip, energy, risk and
 * the headlines into labelled themes, and nothing here feeds a board score.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { ALL_SYMBOLS, findSymbol, type SymbolDefinition } from '@/config/symbols.config';
import { CURRENCY_THEMES, THEME_LABEL } from '@/config/narrative.config';
import { PageHeader } from '@/components/primitives';
import { Unlock } from '@/components/AiAnalysisChat';
import { EffectCell, FlipList, SectionLabel, ThemeRow, signed } from '@/components/narrative';
import { PositionsPanel } from '@/components/PositionsPanel';
import { Panel, Skeleton } from '@/components/ui';
import { pricedBp } from '@/lib/connectors/fed-futures';
import { ACCESS_COOKIE, hasAccess, isAccessConfigured } from '@/lib/analysis/access';
import { loadNarrative, pairFromBundle, type NarrativeBundle } from '@/lib/analysis/narrative-load';
import { loadPositions } from '@/lib/analysis/positions-load';
import type { FlipCondition, PairNarrative, Verdict } from '@/lib/analysis/state';
import { assetClassOf, CLASS_ORDER } from '@/lib/scoring/asset-class';
import { runSetupsPipeline, type SetupsPayload } from '@/lib/setups-pipeline';
import { MAJORS, type Currency } from '@/lib/types';
import { heatStyle } from '@/lib/ui/heat';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VERDICT_TEXT: Record<Verdict, string> = {
  BULLISH: 'text-[var(--color-bull)]',
  BEARISH: 'text-[var(--color-bear)]',
  NEUTRAL: 'text-[var(--color-muted)]',
};

function VerdictWord({ v }: { v: Verdict }) {
  return <span className={`text-micro font-bold tracking-wide ${VERDICT_TEXT[v]}`}>{v}</span>;
}

/** The currency-index symbol behind each economy: EURX for EUR, DXY for USD. */
function indexSymbol(c: Currency): SymbolDefinition | undefined {
  return ALL_SYMBOLS.find((s) => s.kind === 'currency' && s.macroEconomy === c);
}

const ASSET_ROWS: { symbol: string; label: string }[] = [
  { symbol: 'XAUUSD', label: 'Gold' },
  { symbol: 'XAGUSD', label: 'Silver' },
  { symbol: 'XPTUSD', label: 'Platinum' },
  { symbol: 'WTIUSD', label: 'Oil' },
  { symbol: 'XCUUSD', label: 'Copper' },
  { symbol: 'SPX500', label: 'US equities' },
  { symbol: 'GER40', label: 'European equities' },
  { symbol: 'UK100', label: 'UK equities' },
  { symbol: 'JP225', label: 'Japanese equities' },
  { symbol: 'BTCUSD', label: 'Crypto' },
];

export default function NarrativePage() {
  const pipeline = runSetupsPipeline();
  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Market Narrative"
        description="What each economy and asset is being moved by this week, read by fixed rules — and what would turn it."
        info={
          <>
            Every theme is read from dated inputs: releases against their forecasts (sigma and polarity), the fed funds
            futures strip and 2-year yields, Brent, WTI and TTF gas, the VIX and equities, and headlines matched by fixed
            phrase rules. Market prices decide each state; headlines only explain it. Effects run from −2 to +2 on the
            economy or asset, tactical (days to two weeks) and structural (one to three months). Rates count twice. This
            is not the board score and never feeds it.
          </>
        }
      />
      <Suspense fallback={<PageSkeleton />}>
        <NarrativeBody pipeline={pipeline} />
      </Suspense>
    </div>
  );
}

const SYMBOL_OPTIONS = ALL_SYMBOLS.map((s) => ({ symbol: s.symbol, label: s.label }));

/**
 * The user's own trades with their thesis status. Private: with the feature off
 * nothing is rendered, and while locked the page shows only the unlock form —
 * never a count, never a symbol.
 */
async function PositionsSection({ bundle, payload, now }: { bundle: NarrativeBundle; payload: SetupsPayload; now: Date }) {
  if (!isAccessConfigured()) return null;
  const jar = await cookies();
  if (!hasAccess(jar.get(ACCESS_COOKIE)?.value)) {
    return <Unlock title="Your positions" subtitle="Locked — your positions and their thesis status are private to the passphrase holder" />;
  }
  const { views, error, durable } = await loadPositions(now, payload, bundle);
  return <PositionsPanel views={views} error={error} durable={durable} symbols={SYMBOL_OPTIONS} />;
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-64" />
      <Skeleton className="h-48" />
    </div>
  );
}

async function NarrativeBody({ pipeline }: { pipeline: Promise<SetupsPayload> }) {
  const now = new Date();
  const [bundle, payload] = await Promise.all([loadNarrative(now, pipeline), pipeline]);

  const currencyPairs = new Map<Currency, PairNarrative>();
  for (const c of MAJORS) {
    const def = indexSymbol(c);
    const p = def ? pairFromBundle(bundle, def) : null;
    if (p) currencyPairs.set(c, p);
  }

  return (
    <div className="flex flex-col gap-4">
      {bundle.state.gaps.length > 0 && (
        <p className="rounded border border-[var(--color-uncertain)] px-3 py-2 text-micro text-[var(--color-uncertain)]">Gaps on this run: {bundle.state.gaps.join(' · ')}</p>
      )}

      <Suspense fallback={<Skeleton className="h-24" />}>
        <PositionsSection bundle={bundle} payload={payload} now={now} />
      </Suspense>

      <CurrencyMatrix bundle={bundle} pairs={currencyPairs} />

      <div className="grid gap-4 xl:grid-cols-2">
        <FedPathCard bundle={bundle} />
        <UpcomingFlips pairs={[...currencyPairs.values()]} now={now} />
      </div>

      <AssetTable bundle={bundle} />

      <EvidenceByEconomy pairs={currencyPairs} />

      <AllSymbols bundle={bundle} payload={payload} />
    </div>
  );
}

function CurrencyMatrix({ bundle, pairs }: { bundle: NarrativeBundle; pairs: Map<Currency, PairNarrative> }) {
  return (
    <Panel title="Economies × themes" subtitle={`Tactical effect on each currency · computed ${bundle.state.at.slice(11, 16)} UTC · hover a cell for its state`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-micro text-[var(--color-faint)] uppercase">
              <th className="sticky left-0 bg-[var(--color-surface)] px-3 py-2">Currency</th>
              <th className="px-2 py-2">Tactical</th>
              <th className="px-2 py-2">Structural</th>
              {CURRENCY_THEMES.map((id) => (
                <th key={id} className="px-2 py-2 text-center">
                  {THEME_LABEL[id]}
                  {id === 'policy' ? ' ×2' : ''}
                </th>
              ))}
              <th className="px-2 py-2">This week</th>
            </tr>
          </thead>
          <tbody>
            {MAJORS.map((c) => {
              const p = pairs.get(c);
              const subject = bundle.state.subjects[c];
              return (
                <tr key={c} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="sticky left-0 bg-[var(--color-surface)] px-3 py-1.5 font-mono font-semibold">
                    <Link href={`/ai?symbol=${indexSymbol(c)?.symbol ?? ''}`} className="hover:underline">
                      {c}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">{p ? <VerdictWord v={p.tactical.label} /> : '—'}</td>
                  <td className="px-2 py-1.5">{p ? <VerdictWord v={p.structural.label} /> : '—'}</td>
                  {CURRENCY_THEMES.map((id) => {
                    const t = subject?.themes.find((x) => x.id === id);
                    return (
                      <td key={id} className="px-2 py-1.5 text-center">
                        <EffectCell
                          value={t && !t.gap ? t.tactical : null}
                          title={t ? `${t.label}: ${t.gap ? `no data — ${t.gap}` : `${t.state} (structural ${signed(t.structural)})`}` : undefined}
                        />
                      </td>
                    );
                  })}
                  <td className="max-w-[260px] px-2 py-1.5 text-micro text-[var(--color-muted)]">
                    {p && p.changes.length > 0 ? p.changes.slice(0, 2).map((ch) => ch.text.split(' (')[0]).join('; ') : 'unchanged'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {[...pairs.values()][0]?.changeBasis && <p className="px-4 pb-3 text-[10px] text-[var(--color-faint)]">This week is compared with {[...pairs.values()][0].changeBasis}.</p>}
    </Panel>
  );
}

function FedPathCard({ bundle }: { bundle: NarrativeBundle }) {
  const path = bundle.state.fedPath;
  const at = new Date(bundle.state.at);
  const rows = [1, 2, 3, 4, 5, 6].map((m) => pricedBp(path, at, m)).filter((r) => r !== null && r.now !== null);
  return (
    <Panel title="Fed path" subtitle={path.reference ? `bp priced vs ${path.reference.label} ${path.reference.value}% (${path.reference.date})` : 'no reading'}>
      <div className="overflow-x-auto px-4 py-3">
        {rows.length === 0 ? (
          <p className="text-micro text-[var(--color-faint)]">No fed funds futures on this run.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-micro text-[var(--color-faint)] uppercase">
                <th className="py-1">Month</th>
                <th className="py-1">Implied</th>
                <th className="py-1">Priced now</th>
                <th className="py-1">A week ago</th>
                <th className="py-1">A month ago</th>
                <th className="py-1">Week change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const week = r!.weekAgo === null ? null : r!.now! - r!.weekAgo;
                return (
                  <tr key={r!.point.ticker} className="border-t border-[var(--color-border)]">
                    <td className="py-1 font-mono">
                      {r!.point.month} <span className="text-[var(--color-faint)]">{r!.point.ticker}</span>
                    </td>
                    <td className="tnum py-1">{r!.point.implied}%</td>
                    <td className="tnum py-1">{signed(r!.now)}bp</td>
                    <td className="tnum py-1 text-[var(--color-muted)]">{signed(r!.weekAgo)}bp</td>
                    <td className="tnum py-1 text-[var(--color-muted)]">{signed(r!.monthAgo)}bp</td>
                    <td className="tnum py-1">
                      <span className="rounded px-1" style={heatStyle(week, { max: 15 })}>
                        {signed(week)}bp
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[10px] text-[var(--color-faint)]">CBOT 30-day fed funds futures on Yahoo; implied rate = 100 − price. Only the Fed has a free futures strip; other banks are read off 2-year yields.</p>
      </div>
    </Panel>
  );
}

function UpcomingFlips({ pairs, now }: { pairs: PairNarrative[]; now: Date }) {
  const horizon = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const seen = new Set<string>();
  const items: FlipCondition[] = [];
  for (const p of pairs) {
    for (const f of p.flips) {
      if ((f.kind !== 'calendar' && f.kind !== 'policy') || !f.dueUtc || f.dueUtc > horizon || seen.has(f.id)) continue;
      seen.add(f.id);
      // On a currency's own row, "favours" is that currency's side.
      items.push({ ...f, role: 'tip' });
    }
  }
  items.sort((a, b) => (a.dueUtc ?? '').localeCompare(b.dueUtc ?? ''));
  return (
    <Panel title="Next 7 days: what could turn a theme" subtitle="HIGH-impact releases and decisions, with the thresholds that would move them">
      <div className="max-h-[420px] overflow-y-auto px-4 py-3">
        <FlipList flips={items} empty="No HIGH-impact release or decision in the next seven days." />
        <p className="mt-2 text-[10px] text-[var(--color-faint)]">Threshold = forecast (or the previous print, when no forecast is out) ± one typical miss for that series. The arrow is the side it pushes that currency.</p>
      </div>
    </Panel>
  );
}

function AssetTable({ bundle }: { bundle: NarrativeBundle }) {
  return (
    <Panel title="Assets" subtitle="Each with its own themes · tactical effect (structural on hover)">
      <div className="flex flex-col divide-y divide-[var(--color-border)]">
        {ASSET_ROWS.map(({ symbol, label }) => {
          const def = findSymbol(symbol);
          const p = def ? pairFromBundle(bundle, def) : null;
          if (!p) return null;
          return (
            <div key={symbol} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
              <Link href={`/ai?symbol=${symbol}`} className="w-36 shrink-0 text-xs font-semibold hover:underline">
                {label} <span className="font-mono text-micro text-[var(--color-faint)]">{symbol}</span>
              </Link>
              <span className="w-40 shrink-0 text-micro">
                <VerdictWord v={p.tactical.label} /> <span className="text-[var(--color-faint)]">/</span> <VerdictWord v={p.structural.label} />
              </span>
              <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                {p.themes.map((t) => (
                  <span key={t.id} className="flex items-center gap-1 text-micro text-[var(--color-muted)]" title={t.base ? (t.base.gap ? `no data — ${t.base.gap}` : `${t.base.state} (structural ${signed(t.structural)})`) : undefined}>
                    {t.label}
                    <EffectCell value={t.tactical} />
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function EvidenceByEconomy({ pairs }: { pairs: Map<Currency, PairNarrative> }) {
  return (
    <Panel title="Evidence by economy" subtitle="Open a currency, then a theme, for the dated releases, prices and headlines behind it">
      <div className="flex flex-col divide-y divide-[var(--color-border)]">
        {MAJORS.map((c) => {
          const p = pairs.get(c);
          if (!p) return null;
          return (
            <details key={c} className="px-4 py-2">
              <summary className="cursor-pointer text-xs font-semibold">
                {c} <span className="ml-2 font-normal text-[var(--color-muted)]">{p.tactical.text}</span>
              </summary>
              <div className="mt-2">
                {p.themes.map((t) => (
                  <ThemeRow key={t.id} pair={p} theme={t} />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </Panel>
  );
}

function AllSymbols({ bundle, payload }: { bundle: NarrativeBundle; payload: SetupsPayload }) {
  const board = new Map(payload.matrix.rows.map((r) => [r.symbol, r]));
  const rows = ALL_SYMBOLS.map((def) => ({ def, p: pairFromBundle(bundle, def), cls: assetClassOf(def.symbol, def.kind) }))
    .filter((r) => r.p !== null)
    .sort((a, b) => CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls) || a.def.symbol.localeCompare(b.def.symbol));
  return (
    <Panel title="Every symbol" subtitle="Narrative verdict beside the board, which stays the source of truth for scores">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-micro text-[var(--color-faint)] uppercase">
              <th className="px-3 py-2">Symbol</th>
              <th className="px-2 py-2">Class</th>
              <th className="px-2 py-2">Tactical</th>
              <th className="px-2 py-2">Structural</th>
              <th className="px-2 py-2">Board</th>
              <th className="px-2 py-2">Counts (tactical)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ def, p, cls }) => {
              const b = board.get(def.symbol);
              return (
                <tr key={def.symbol} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="px-3 py-1">
                    <Link href={`/ai?symbol=${def.symbol}`} className="font-mono font-semibold hover:underline">
                      {def.symbol}
                    </Link>
                  </td>
                  <td className="px-2 py-1 text-micro text-[var(--color-faint)]">{cls}</td>
                  <td className="px-2 py-1">
                    <VerdictWord v={p!.tactical.label} />
                  </td>
                  <td className="px-2 py-1">
                    <VerdictWord v={p!.structural.label} />
                  </td>
                  <td className="tnum px-2 py-1 text-micro text-[var(--color-muted)]">{b ? `${signed(b.totalScore)} ${b.bias}` : '—'}</td>
                  <td className="px-2 py-1 text-micro text-[var(--color-faint)]">
                    {p!.tactical.bullish} up · {p!.tactical.bearish} down · of {p!.tactical.counted}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 pt-2 pb-3 text-[10px] text-[var(--color-faint)]">
        <SectionLabel>Why the two can differ</SectionLabel>
        The board reproduces A1&apos;s rules cell by cell; the narrative weighs this week&apos;s repricing, energy, risk and headlines.
        Read them as two opinions on different horizons.
      </div>
    </Panel>
  );
}
