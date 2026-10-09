/**
 * AI Analysis: a fundamental analyst that reads the board, the rates, the
 * calendar, the news and the central banks' own words, and answers in prose.
 *
 * The chat is the page: it renders immediately, first and widest. The context
 * — what the analyst sees, then the market narrative — sits in a compact column
 * on the right that stays in view while a long answer scrolls (below the chat
 * on small screens). Both stream in under Suspense, because building them runs
 * the board pipeline, the news feeds, live search and the central-bank feeds.
 * Every question rebuilds the dossier on the server anyway, so what is shown
 * here is a preview of what the model sees, not a cache of it.
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
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
          {positions && (
            <Suspense fallback={null}>
              <PositionsSection analysis={analysis} symbol={def.symbol} error={positions.error} durable={positions.durable} />
            </Suspense>
          )}
        </div>
        {/* Stays in view beside a long answer; scrolls on its own when taller than the screen. */}
        <aside className="flex min-w-0 flex-col gap-4 *:shrink-0 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto xl:overscroll-contain">
          <Suspense fallback={<ContextSkeleton />}>
            <ContextCards def={def} analysis={analysis} />
          </Suspense>
          <Suspense fallback={<NarrativeSkeleton />}>
            <NarrativeSection analysis={analysis} />
          </Suspense>
        </aside>
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
async function NarrativeSection({ analysis }: { analysis: Promise<AnalysisInputs> }) {
  const inputs = await analysis;
  if (!inputs.narrative) {
    return (
      <Panel title="Market narrative" padded>
        <p className="text-micro text-[var(--color-uncertain)]">The narrative engine could not be built on this run; the analyst will answer from the dossier alone.</p>
      </Panel>
    );
  }
  return <NarrativePanel pair={inputs.narrative.pair} computedAtUtc={inputs.narrative.state.at} compact />;
}

/** The passphrase holder's position on this symbol, with its thesis check. */
async function PositionsSection({
  analysis,
  symbol,
  error,
  durable,
}: {
  analysis: Promise<AnalysisInputs>;
  symbol: string;
  error: string | null;
  durable: boolean;
}) {
  const inputs = await analysis;
  return (
    <PositionsPanel
      views={inputs.positions ?? []}
      error={error}
      durable={durable}
      symbols={POSITION_SYMBOLS}
      defaultSymbol={symbol}
      title={`Your ${symbol} position`}
      emptyText={`No open ${symbol} position. Add one and the analyst checks its thesis.`}
    />
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

/** One line of the dossier summary: what it is on the left, what it says on the right. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2.5">
      <dt className="pt-px text-micro text-[var(--color-muted)]">{label}</dt>
      <dd className="min-w-0 text-xs leading-relaxed text-[var(--color-text)]">{children}</dd>
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Tue 13 Oct, 06:00 UTC" — or just the day when there is no time. */
function when(iso: string, withTime = true): string {
  const d = new Date(iso);
  const day = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return withTime ? `${day}, ${iso.slice(11, 16)} UTC` : day;
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

  const rated = s.rates.filter((r) => r.rate !== null);

  return (
    <Panel title="What the analyst sees" subtitle={`The dossier as of ${s.generatedAtUtc.slice(11, 16)} UTC. Every question rebuilds it.`}>
      <dl className="divide-y divide-[var(--color-border)] px-4">
        <Row label="Board score">
          {s.board ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="tnum rounded px-2 py-0.5 text-sm font-bold" style={heatStyle(s.board.total, { max: VERY_BIAS_CUT })}>
                {fmtSigned(s.board.total)} {s.board.bias}
              </span>
              <span className="text-micro text-[var(--color-faint)]">
                out of ±{s.board.max}, from {s.board.populated} cells
              </span>
              <Link href={`/scorecard/${def.symbol}`} className="ml-auto text-micro text-[var(--color-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline">
                Open scorecard
              </Link>
            </div>
          ) : (
            <span className="text-[var(--color-muted)]">No board row on this run.</span>
          )}
        </Row>

        <Row label="Policy rates">
          <ul className="space-y-1">
            {s.rates.map((r) => (
              <li key={r.currency}>
                <span className="font-semibold">{r.currency}</span> <span className="tnum">{fmtNum(r.rate, 2, '%')}</span>
                <span className="text-[var(--color-faint)]">
                  {r.next
                    ? `, next decision ${when(r.next.dateUtc, false)}${r.next.consensus === null ? '' : `, expected ${fmtNum(r.next.consensus, 2, '%')}`}`
                    : s.decisionCalendar
                      ? ', no decision scheduled'
                      : ', decision calendar unavailable'}
                </span>
              </li>
            ))}
          </ul>
          {rated.length === 2 && (
            <p className="mt-1 text-[var(--color-muted)]">
              {(() => {
                const [hi, lo] = rated[0].rate! >= rated[1].rate! ? [rated[0], rated[1]] : [rated[1], rated[0]];
                const gap = hi.rate! - lo.rate!;
                return gap === 0 ? 'Both pay the same rate' : `${hi.currency} pays ${gap.toFixed(2)}pp more than ${lo.currency}`;
              })()}
            </p>
          )}
        </Row>

        <Row label="Next release">
          {s.nextEvent ? (
            <>
              <span>
                {s.nextEvent.currency} {s.nextEvent.name}
              </span>
              <span className="block text-[var(--color-faint)]">{when(s.nextEvent.dateUtc)}</span>
            </>
          ) : (
            <span className="text-[var(--color-muted)]">Nothing high-impact in the calendar window.</span>
          )}
        </Row>

        <Row label="News">
          {s.news.clusters} stories in the last 48 hours{s.news.newestUtc ? `, the newest ${age(s.news.newestUtc, now)}` : ''}, plus {s.news.searchHits} search
          results
        </Row>

        <Row label="Central banks">
          <ul className="space-y-1.5">
            {s.banks.map((b) => (
              <li key={b.bank} className="min-w-0">
                <span className="text-[var(--color-muted)]">{b.bank}</span>
                {b.title ? (
                  <span className="block truncate" title={b.title}>
                    {b.title} <span className="text-[var(--color-faint)]">({b.publishedUtc ? when(b.publishedUtc, false) : 'undated'})</span>
                  </span>
                ) : (
                  <span className="block text-[var(--color-uncertain)]">Not readable: {b.gap}</span>
                )}
              </li>
            ))}
          </ul>
        </Row>

        {s.gaps.length > 0 && (
          <Row label="Missing data">
            <ul className="space-y-1 text-[var(--color-muted)]">
              {s.gaps.slice(0, 6).map((g) => (
                <li key={g}>{g.length > 140 ? `${g.slice(0, 140)}…` : g}</li>
              ))}
            </ul>
          </Row>
        )}
      </dl>

      <div className="flex flex-col gap-2 border-t border-[var(--color-border)] px-4 py-3">
        {typeof knowledge === 'string' ? (
          <p className="text-micro text-[var(--color-bear)]">Background files could not be read: {knowledge}</p>
        ) : (
          <details>
            <summary className="cursor-pointer text-micro text-[var(--color-muted)] hover:text-[var(--color-text)]">
              Background files the analyst reads ({knowledge.files.length})
            </summary>
            <ul className="mt-2 space-y-0.5 text-micro text-[var(--color-muted)]">
              {knowledge.files.map((f) => (
                <li key={f.id}>
                  {f.title} <span className="text-[var(--color-faint)]">(checked {f.asOf})</span>
                </li>
              ))}
              {knowledge.missing.map((m) => (
                <li key={m} className="text-[var(--color-uncertain)]">
                  {m}: not written yet
                </li>
              ))}
            </ul>
          </details>
        )}
        <details>
          <summary className="cursor-pointer text-micro text-[var(--color-muted)] hover:text-[var(--color-text)]">
            The full dossier, as the model reads it (about {Math.round(dossier.text.length / 4 / 100) / 10}k tokens)
          </summary>
          <pre className="mt-2 max-h-[50vh] overflow-auto rounded bg-[var(--color-surface-2)] p-2 text-[11px] leading-snug whitespace-pre-wrap text-[var(--color-muted)]">
            {dossier.text}
          </pre>
        </details>
      </div>
    </Panel>
  );
}
