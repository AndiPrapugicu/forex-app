/**
 * AI Analysis: a fundamental analyst that reads the board, the rates, the
 * calendar, the news and the central banks' own words, and answers in prose.
 *
 * The chat renders immediately. The context cards and the dossier — the exact
 * text the model will read — stream in under Suspense, because building them
 * runs the board pipeline, the news feeds, live search and the central-bank
 * feeds. Every question rebuilds the dossier on the server anyway, so what is
 * shown here is a preview of what the model sees, not a cache of it.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { ALL_SYMBOLS, findSymbol } from '@/config/symbols.config';
import { AiAnalysisChat } from '@/components/AiAnalysisChat';
import { AiSymbolPicker } from '@/components/AiSymbolPicker';
import { PageHeader } from '@/components/primitives';
import { SymbolSelect, type SwitcherOption } from '@/components/SymbolSelect';
import { Panel, Skeleton } from '@/components/ui';
import { DEFAULT_OPENROUTER_MODEL, getOpenRouterConfig } from '@/lib/ai/openrouter';
import { ACCESS_COOKIE, hasAccess, isAccessConfigured } from '@/lib/analysis/access';
import { age, buildDossier, fmtNum, fmtSigned, type AnalysisInputs } from '@/lib/analysis/dossier';
import { selectKnowledge, type KnowledgeSelection } from '@/lib/analysis/knowledge';
import { loadAnalysisInputs } from '@/lib/analysis/load';
import { NarrativePanel } from '@/components/NarrativePanel';
import { PositionsPanel } from '@/components/PositionsPanel';
import { readOpenPositions } from '@/lib/analysis/positions-load';
import { assetClassOf, CLASS_ORDER } from '@/lib/scoring/asset-class';
import { runSetupsPipeline, type SetupsPayload } from '@/lib/setups-pipeline';
import { heatStyle } from '@/lib/ui/heat';
import type { SymbolDefinition } from '@/config/symbols.config';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Same cut the scorecard banner is painted against: Very Bullish. */
const VERY_BIAS_CUT = 7;

const switcherOptions: SwitcherOption[] = ALL_SYMBOLS.slice()
  .sort((a, b) => CLASS_ORDER.indexOf(assetClassOf(a.symbol, a.kind)) - CLASS_ORDER.indexOf(assetClassOf(b.symbol, b.kind)))
  .map((s) => ({ symbol: s.symbol, label: s.label, assetClass: assetClassOf(s.symbol, s.kind) }));

export default async function AiAnalysisPage({ searchParams }: { searchParams: Promise<{ symbol?: string }> }) {
  const { symbol } = await searchParams;
  const def = (symbol ? findSymbol(symbol) : undefined) ?? findSymbol('EURUSD')!;

  const cookieStore = await cookies();
  const accessConfigured = isAccessConfigured();
  const unlocked = hasAccess(cookieStore.get(ACCESS_COOKIE)?.value);
  const openRouter = getOpenRouterConfig();
  // Private: read only for the passphrase holder, so the public dossier never has them.
  const positions = unlocked ? await readOpenPositions() : null;
  const mine = positions?.positions.filter((p) => p.symbol === def.symbol) ?? [];
  // Started once, awaited three times: the picker's scores, the narrative and the dossier.
  const pipeline = runSetupsPipeline();
  const analysis = loadAnalysisInputs(def, new Date(), pipeline, { positions: mine });

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="AI Analysis"
        description="A macro analyst on top of the board: rate differentials, policy, data surprises, news and positioning, in words."
        info={
          <>
            Each question rebuilds a dossier from the board, the central-bank decision calendar, the economic calendar,
            eight RSS feeds, live Google News searches, the banks&apos; own feeds and cross-asset prices, and sends it with
            background files written from official sources. The model may cite only numbers from the dossier. It runs on
            OpenRouter&apos;s free Nemotron model, and the server refuses any model that is not priced at zero. Nothing it
            writes reaches a score.
          </>
        }
        actions={
          <Suspense
            fallback={<SymbolSelect symbol={def.symbol} options={switcherOptions} hrefTemplate="/ai?symbol={symbol}" className="py-1 text-xs" />}
          >
            <ScoredPicker symbol={def.symbol} pipeline={pipeline} />
          </Suspense>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Suspense fallback={<NarrativeSkeleton />}>
            <NarrativeSection analysis={analysis} symbol={def.symbol} positions={positions && { error: positions.error, durable: positions.durable }} />
          </Suspense>
          <AiAnalysisChat
            key={def.symbol}
            symbol={def.symbol}
            label={def.label}
            model={openRouter?.model ?? DEFAULT_OPENROUTER_MODEL}
            accessConfigured={accessConfigured}
            openRouterConfigured={openRouter !== null}
            unlocked={unlocked}
            hasPosition={mine.length > 0}
          />
        </div>
        <div className="min-w-0">
          <Suspense fallback={<ContextSkeleton />}>
            <ContextCards def={def} analysis={analysis} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function NarrativeSkeleton() {
  return (
    <Panel title="Market narrative" subtitle="Reading the week…" padded>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-24" />
      </div>
    </Panel>
  );
}

/** The deterministic state the analyst restates, or a line saying it could not be built. */
async function NarrativeSection({
  analysis,
  symbol,
  positions,
}: {
  analysis: Promise<AnalysisInputs>;
  symbol: string;
  /** Null while locked: then no position block renders at all. */
  positions: { error: string | null; durable: boolean } | null;
}) {
  const inputs = await analysis;
  const mine = positions ? (
    <PositionsPanel
      views={inputs.positions ?? []}
      error={positions.error}
      durable={positions.durable}
      symbols={POSITION_SYMBOLS}
      defaultSymbol={symbol}
      title={`Your ${symbol} position`}
      emptyText={`No open ${symbol} position. Add one and the analyst checks its thesis.`}
    />
  ) : null;
  if (!inputs.narrative) {
    return (
      <>
        <Panel title="Market narrative" padded>
          <p className="text-micro text-[var(--color-uncertain)]">The narrative engine could not be built on this run; the analyst will answer from the dossier alone.</p>
        </Panel>
        {mine}
      </>
    );
  }
  return (
    <>
      <NarrativePanel pair={inputs.narrative.pair} computedAtUtc={inputs.narrative.state.at} />
      {mine}
    </>
  );
}

const POSITION_SYMBOLS = ALL_SYMBOLS.map((s) => ({ symbol: s.symbol, label: s.label }));

function ContextSkeleton() {
  return (
    <Panel title="What the analyst sees" subtitle="Building the dossier…" padded>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-24" />
      </div>
    </Panel>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[var(--color-border)] px-3 py-2">
      <p className="text-micro font-semibold tracking-wide text-[var(--color-faint)] uppercase">{title}</p>
      <div className="mt-1 text-sm text-[var(--color-text)]">{children}</div>
    </div>
  );
}

/**
 * The background files, or why there are none. A deployment that lost
 * `knowledge/` (see `outputFileTracingIncludes` in next.config.ts) should say
 * so here rather than take the whole column down.
 */
function readKnowledge(def: SymbolDefinition): KnowledgeSelection | string {
  try {
    return selectKnowledge(def);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** The symbol picker, with every option carrying its board score. */
async function ScoredPicker({ symbol, pipeline }: { symbol: string; pipeline: Promise<SetupsPayload> }) {
  const { matrix } = await pipeline;
  const bySymbol = new Map(matrix.rows.map((r) => [r.symbol, r]));
  const options = switcherOptions.map((o) => {
    const row = bySymbol.get(o.symbol);
    return row ? { ...o, score: row.totalScore, bias: row.bias } : o;
  });
  return <AiSymbolPicker symbol={symbol} options={options} />;
}

async function ContextCards({ def, analysis }: { def: SymbolDefinition; analysis: Promise<AnalysisInputs> }) {
  const inputs = await analysis;
  const now = inputs.now;
  const dossier = buildDossier(inputs);
  const knowledge = readKnowledge(def);
  const s = dossier.summary;

  return (
    <Panel title="What the analyst sees" subtitle={`Dossier built ${s.generatedAtUtc.slice(11, 16)} UTC · rebuilt for every question`}>
      <div className="flex flex-col gap-2 px-4 py-4">
        <Card title="Board">
          {s.board ? (
            <div className="flex items-center gap-2">
              <span className="tnum rounded px-2 py-0.5 font-bold" style={heatStyle(s.board.total, { max: VERY_BIAS_CUT })}>
                {fmtSigned(s.board.total)} · {s.board.bias}
              </span>
              <span className="text-micro text-[var(--color-faint)]">of ±{s.board.max}, {s.board.populated} cells</span>
              <Link href={`/scorecard/${def.symbol}`} className="ml-auto text-micro text-[var(--color-muted)] hover:text-[var(--color-text)]">
                Scorecard →
              </Link>
            </div>
          ) : (
            <span className="text-[var(--color-muted)]">No board row on this run.</span>
          )}
        </Card>

        <Card title="Rates">
          <ul className="space-y-0.5">
            {s.rates.map((r) => (
              <li key={r.currency} className="flex flex-wrap gap-x-2">
                <span className="font-mono text-xs">{r.currency}</span>
                <span className="tnum">{fmtNum(r.rate, 2, '%')}</span>
                <span className="text-micro text-[var(--color-faint)]">
                  {r.next
                    ? `next ${r.next.dateUtc.slice(0, 10)}${r.next.consensus === null ? ', no consensus yet' : `, consensus ${fmtNum(r.next.consensus, 2, '%')}`}`
                    : s.decisionCalendar
                      ? 'no decision on the calendar'
                      : 'decision calendar unavailable this run'}
                </span>
              </li>
            ))}
          </ul>
          {s.rates.length === 2 && s.rates[0].rate !== null && s.rates[1].rate !== null && (
            <p className="mt-1 text-micro text-[var(--color-muted)]">
              Policy gap {s.rates[0].currency} − {s.rates[1].currency}: {fmtSigned(s.rates[0].rate - s.rates[1].rate, 2, 'pp')}
            </p>
          )}
        </Card>

        <Card title="Next high-impact event">
          {s.nextEvent ? (
            <span>
              {s.nextEvent.currency} {s.nextEvent.name}{' '}
              <span className="text-micro text-[var(--color-faint)]">{s.nextEvent.dateUtc.slice(0, 16).replace('T', ' ')} UTC</span>
            </span>
          ) : (
            <span className="text-[var(--color-muted)]">None in the calendar window.</span>
          )}
        </Card>

        <Card title="News and official texts">
          <p>
            {s.news.clusters} stories in 48h{s.news.newestUtc ? `, newest ${age(s.news.newestUtc, now)}` : ''} · {s.news.searchHits} search hits
          </p>
          <ul className="mt-1 space-y-0.5 text-micro text-[var(--color-muted)]">
            {s.banks.map((b) => (
              <li key={b.bank}>
                {b.bank}:{' '}
                {b.title ? (
                  <>
                    {b.title} <span className="text-[var(--color-faint)]">({b.publishedUtc?.slice(0, 10)})</span>
                  </>
                ) : (
                  <span className="text-[var(--color-uncertain)]">gap — {b.gap}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        {s.gaps.length > 0 && (
          <Card title="Gaps the analyst will name">
            <ul className="list-disc space-y-0.5 pl-4 text-micro text-[var(--color-muted)]">
              {s.gaps.slice(0, 6).map((g) => (
                <li key={g}>{g.length > 160 ? `${g.slice(0, 160)}…` : g}</li>
              ))}
            </ul>
          </Card>
        )}

        {typeof knowledge === 'string' ? (
          <Card title="Background files">
            <span className="text-micro text-[var(--color-bear)]">{knowledge}</span>
          </Card>
        ) : (
          <details className="rounded border border-[var(--color-border)] px-3 py-2">
            <summary className="cursor-pointer text-micro font-semibold tracking-wide text-[var(--color-faint)] uppercase">
              Background files ({knowledge.files.length})
            </summary>
            <ul className="mt-2 space-y-0.5 text-micro text-[var(--color-muted)]">
              {knowledge.files.map((f) => (
                <li key={f.id}>
                  <span className="font-mono">knowledge/{f.id}.md</span> — {f.title}, as of {f.asOf}
                </li>
              ))}
              {knowledge.missing.map((m) => (
                <li key={m} className="text-[var(--color-uncertain)]">
                  knowledge/{m}.md — not written yet
                </li>
              ))}
            </ul>
          </details>
        )}

        <details className="rounded border border-[var(--color-border)] px-3 py-2">
          <summary className="cursor-pointer text-micro font-semibold tracking-wide text-[var(--color-faint)] uppercase">
            Full dossier (~{Math.round(dossier.text.length / 4 / 100) / 10}k tokens)
          </summary>
          <pre className="mt-2 max-h-[60vh] overflow-auto text-[11px] leading-snug whitespace-pre-wrap text-[var(--color-muted)]">
            {dossier.text}
          </pre>
        </details>
      </div>
    </Panel>
  );
}
