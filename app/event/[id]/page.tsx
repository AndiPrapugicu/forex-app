/**
 * Event detail.
 *
 * The important ordering decision: the RULE TRACE renders before any AI text.
 * The number has to justify itself with arithmetic the reader can follow — the
 * model's prose is commentary on a conclusion already shown to be sound, never
 * the reason to believe it.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CURRENCY_REGIME, TRACKED_PAIRS, matchEventRule } from '@/config/scoring.config';
import { getStore } from '@/lib/db/client';
import { runPipeline } from '@/lib/pipeline';
import { scoreEvent } from '@/lib/scoring/surprise';
import type { NormalizedEvent, ScoreTraceStep } from '@/lib/types';
import { ActualInput } from '@/components/ActualInput';
import { ConfidenceRing, ScoreGauge } from '@/components/Gauge';
import { AiExplanation } from '@/components/AiExplanation';
import {
  CurrencyChip,
  DIRECTION_STYLE,
  ImpactBadge,
  Panel,
  SourceBadge,
  formatValue,
  timeAgo,
  utcTime,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Events live in the store, but on a cold serverless instance (or the in-memory
 * fallback) the store may be empty. Running the pipeline repopulates it rather
 * than 404ing on a link that was valid a moment ago.
 */
async function loadEvent(id: string): Promise<NormalizedEvent | null> {
  const store = getStore();

  const direct = await store.getEvent(id).catch(() => null);
  if (direct) return direct;

  const result = await runPipeline({ deliverAlerts: false }).catch(() => null);
  if (!result) return null;

  return (
    [...result.dashboard.upcoming, ...result.dashboard.recent.map((r) => r.event)].find(
      (e) => e.id === id,
    ) ?? null
  );
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await loadEvent(id);
  if (!event) notFound();

  const score = scoreEvent(event);
  const rule = matchEventRule(event.name);
  const style = DIRECTION_STYLE[score.direction];

  // Pairs where this currency is a leg, so "what does this touch" is concrete.
  const affectedPairs = TRACKED_PAIRS.filter(
    ([base, quote]) => base === event.currency || quote === event.currency,
  ).map(([base, quote]) => ({
    pair: `${base}/${quote}`,
    // Score is expressed for the event's currency; flip it when that currency
    // is the quote leg, since a stronger quote pushes the pair down.
    direction: base === event.currency ? score.score : -score.score,
  }));

  const released = event.actual !== null;

  return (
    <div className="grid-bg min-h-screen">
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link href="/" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]">
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        {/* --- Header ------------------------------------------------------ */}
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <CurrencyChip currency={event.currency} />
          <ImpactBadge impact={event.impact} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl leading-tight font-bold text-[var(--color-text)]">{event.name}</h1>
            <p className="tnum mt-0.5 text-xs text-[var(--color-faint)]">
              {utcTime(event.dateUtc)} · {timeAgo(event.dateUtc)} ·{' '}
              {event.dateUtc.slice(0, 10)}
              {event.isPreliminary && ' · preliminary'}
              {event.isSpeech && ' · speech'}
            </p>
          </div>
          {event.sourceUrl && (
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-[var(--color-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-text)]"
            >
              View source
            </a>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* --- Left: verdict --------------------------------------------- */}
          <div className="flex flex-col gap-4">
            <Panel>
              <div className="flex flex-col items-center gap-3 px-4 py-5">
                <ScoreGauge
                  score={score.score}
                  direction={score.direction}
                  confidence={score.confidence}
                  label={`for ${event.currency}`}
                />
                <ConfidenceRing confidence={score.confidence} />

                {score.direction === 'uncertain' && (
                  <p className="text-center text-[11px] leading-relaxed text-[var(--color-uncertain)]">
                    Confidence is below the threshold, so no direction is asserted.
                  </p>
                )}
              </div>
            </Panel>

            {/* Values: actual is meaningless without forecast and previous
                beside it, so they are always shown together. */}
            <Panel title="Values">
              <dl className="divide-y divide-[var(--color-border)]">
                <ValueRow
                  label="Actual"
                  value={formatValue(event.actual, event.unit)}
                  emphasis
                  badge={event.actualSource ? <SourceBadge source={event.actualSource} /> : null}
                />
                <ValueRow label="Forecast" value={formatValue(event.consensus, event.unit)} />
                <ValueRow label="Previous" value={formatValue(event.previous, event.unit)} />
                {event.revised !== null && (
                  <ValueRow label="Revised" value={formatValue(event.revised, event.unit)} />
                )}
                {score.surprise !== null && (
                  <ValueRow
                    label="Surprise"
                    value={`${score.surprise > 0 ? '+' : ''}${score.surprise}σ`}
                  />
                )}
              </dl>
            </Panel>

            <ActualInput event={event} />
          </div>

          {/* --- Right: the reasoning -------------------------------------- */}
          <div className="flex flex-col gap-4 lg:col-span-2">
            {/*
              THE RULE TRACE. This is the core of the product: the arithmetic in
              full, before any model output, so the score never has to be taken
              on trust.
            */}
            <Panel title="How this score was calculated" subtitle="Every step, in order">
              <ol className="divide-y divide-[var(--color-border)]">
                {score.trace.map((step, i) => (
                  <li key={`${step.label}-${i}`} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[10px] font-semibold text-[var(--color-muted)]">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-semibold text-[var(--color-text)]">
                          {step.label}
                        </span>
                        <span
                          className={`tnum shrink-0 text-sm font-bold ${
                            step.label === 'Score'
                              ? style.color
                              : 'text-[var(--color-muted)]'
                          }`}
                        >
                          {formatTraceValue(step.value, step.op)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
                        {step.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="border-t border-[var(--color-border)] px-4 py-2.5">
                <p className="text-[10px] leading-relaxed text-[var(--color-faint)]">
                  Classified as <span className="text-[var(--color-muted)]">{rule.key}</span> (
                  {rule.category}). {event.currency} policy regime:{' '}
                  <span className="text-[var(--color-muted)]">{CURRENCY_REGIME[event.currency]}</span>.
                  Tune these in <code>config/scoring.config.ts</code>.
                </p>
              </div>
            </Panel>

            {score.polarityConflict && (
              <div className="rounded-lg border border-[var(--color-uncertain)]/30 bg-[var(--color-uncertain)]/5 px-4 py-3">
                <p className="text-xs font-semibold text-[var(--color-uncertain)]">
                  Sources disagree
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
                  {event.source} rates this print as{' '}
                  {event.isBetterThanExpected ? 'better' : 'worse'} than expected, which conflicts
                  with our polarity rule for {rule.key}. Confidence has been reduced. Worth a look
                  before acting on it.
                </p>
              </div>
            )}

            {/* AI commentary comes last, clearly labelled, after the maths. */}
            <AiExplanation eventId={event.id} released={released} />

            <Panel title="Affected pairs" subtitle={`Pairs where ${event.currency} is a leg`}>
              {!released ? (
                <p className="px-4 py-4 text-xs text-[var(--color-faint)]">
                  Not yet released — no directional read until an actual value lands.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-px bg-[var(--color-border)] sm:grid-cols-3">
                  {affectedPairs.map((p) => {
                    const dir =
                      score.direction === 'uncertain'
                        ? 'uncertain'
                        : p.direction > 0.5
                          ? 'bullish'
                          : p.direction < -0.5
                            ? 'bearish'
                            : 'neutral';
                    const s = DIRECTION_STYLE[dir];
                    return (
                      <div key={p.pair} className="bg-[var(--color-surface)] px-3 py-2">
                        <div className="font-mono text-xs text-[var(--color-text)]">{p.pair}</div>
                        <div className={`mt-0.5 text-[11px] font-medium ${s.color}`}>
                          {s.glyph} {s.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Renders a trace value according to its role in the arithmetic.
 *
 * Multipliers get a "×" and never a "+". Showing the regime step as "+0.6" in a
 * column of numbers implies it is added to the score when it actually scales it,
 * which makes the trace read as if it does not add up.
 */
function formatTraceValue(value: number, op: ScoreTraceStep['op']): string {
  if (op === 'multiplier') return `×${value}`;
  if (op === 'plain') return '';
  return `${value > 0 ? '+' : ''}${value}`;
}

function ValueRow({
  label,
  value,
  emphasis,
  badge,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2">
      <dt className="text-[11px] tracking-wide text-[var(--color-faint)] uppercase">{label}</dt>
      <dd className="flex items-center gap-2">
        {badge}
        <span
          className={`tnum ${emphasis ? 'text-base font-bold text-[var(--color-text)]' : 'text-sm text-[var(--color-muted)]'}`}
        >
          {value}
        </span>
      </dd>
    </div>
  );
}
