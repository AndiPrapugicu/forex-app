'use client';

/**
 * The Seasonality tab.
 *
 * Two questions, in the order a trader asks them: "which market has the
 * strongest tendency right now" (the scanner), then "what does that tendency
 * actually look like" (the three bucket charts for one symbol).
 *
 * Hand-rolled SVG, like every other chart here except the candlesticks. These
 * are signed bars against a centre line — a charting library would cost more
 * bundle than the page.
 *
 * WHAT THE NUMBERS ARE NOT. An average of ten Augusts is a description of ten
 * Augusts. The win rate and the sample count sit next to every mean precisely
 * so it cannot be read as a forecast: +0.9% at a 50% win rate over 6 years is
 * one good year and five coin flips, and the page should make that obvious
 * rather than leaving it in a tooltip.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  SEASONALITY_LOOKBACKS,
  currentBucket,
  type SeasonalBucket,
  type SeasonalBucketKind,
  type SeasonalityLookback,
} from '@/lib/scoring/seasonality';
import { SEASONALITY_YEARS } from '@/config/setups.config';
import type { SymbolKind } from '@/config/symbols.config';
import { PageHeader } from '@/components/primitives';
import { EmptyState, Panel } from '@/components/ui';

export interface SymbolSeasonality {
  symbol: string;
  label: string;
  kind: SymbolKind;
  /** Keyed `${kind}:${years}` — a Map does not cross the RSC boundary. */
  profiles: Record<string, { buckets: SeasonalBucket[]; yearsCovered: number }>;
}

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const KINDS: { key: SeasonalBucketKind; label: string; hint: string }[] = [
  { key: 'month', label: 'Month of year', hint: '12 buckets · the one that scores' },
  { key: 'week', label: 'Week of year', hint: '53 ISO buckets' },
  { key: 'weekday', label: 'Day of week', hint: 'Mon–Fri, day over day' },
];

/** Every bucket a kind can have, so an absent one renders as a gap not a skip. */
function allKeys(kind: SeasonalBucketKind): number[] {
  if (kind === 'month') return Array.from({ length: 12 }, (_, i) => i + 1);
  if (kind === 'week') return Array.from({ length: 53 }, (_, i) => i + 1);
  return [1, 2, 3, 4, 5];
}

function bucketName(kind: SeasonalBucketKind, key: number): string {
  if (kind === 'month') return MONTH_NAMES[key - 1] ?? `Month ${key}`;
  if (kind === 'week') return `Week ${key}`;
  return WEEKDAY_NAMES[key] ?? `Day ${key}`;
}

function bucketTick(kind: SeasonalBucketKind, key: number): string {
  if (kind === 'month') return MONTH_LABELS[key - 1] ?? '';
  if (kind === 'week') return key % 4 === 1 ? String(key) : '';
  return (WEEKDAY_NAMES[key] ?? '').slice(0, 1);
}

function signed(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// One granularity's bars
// ---------------------------------------------------------------------------

function BucketBars({
  kind,
  buckets,
  highlight,
}: {
  kind: SeasonalBucketKind;
  buckets: Map<number, SeasonalBucket>;
  highlight: number;
}) {
  const keys = allKeys(kind);

  /**
   * Scale floored at 0.5%, so a market with no seasonality does not get a
   * chart full of dramatic-looking bars made of noise.
   */
  const max = Math.max(0.5, ...[...buckets.values()].map((b) => Math.abs(b.meanPct)));

  return (
    <div className="flex items-end gap-px px-3 pt-3">
      {keys.map((key) => {
        const b = buckets.get(key);
        const isCurrent = key === highlight;

        if (!b) {
          return (
            <div key={key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex h-24 w-full items-center justify-center">
                <span className="text-micro text-[var(--color-faint)]">·</span>
              </div>
              <span className="truncate text-micro text-[var(--color-faint)]">
                {bucketTick(kind, key)}
              </span>
            </div>
          );
        }

        const height = Math.max((Math.abs(b.meanPct) / max) * 46, 2);
        const positive = b.meanPct >= 0;

        return (
          <div
            key={key}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
            title={
              `${bucketName(kind, key)}: ${signed(b.meanPct)} average, ` +
              `median ${signed(b.medianPct)}, higher ${b.winRatePct}% of the time, ` +
              `best ${signed(b.bestPct)} / worst ${signed(b.worstPct)}, ` +
              `${b.samples} observation${b.samples === 1 ? '' : 's'}` +
              (b.reliable ? '' : ' — too few to lean on')
            }
          >
            <div className="relative flex h-24 w-full flex-col justify-center">
              <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--color-border)]" />
              <div
                className="absolute inset-x-[0.5px] rounded-[1px]"
                style={{
                  height: `${height}px`,
                  bottom: positive ? '50%' : undefined,
                  top: positive ? undefined : '50%',
                  // Thin sample reads as thin ink. The bar is still drawn to
                  // scale, so the reader sees both the size and the doubt.
                  backgroundColor: positive
                    ? `rgb(var(--color-bull-rgb) / ${b.reliable ? 80 : 28}%)`
                    : `rgb(var(--color-bear-rgb) / ${b.reliable ? 80 : 28}%)`,
                  outline: isCurrent ? '1px solid var(--color-text)' : undefined,
                }}
              />
            </div>
            <span
              className={`truncate text-micro ${
                isCurrent ? 'font-bold text-[var(--color-text)]' : 'text-[var(--color-faint)]'
              }`}
            >
              {bucketTick(kind, key)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SeasonalityScanner({
  symbols,
  nowIso,
  historyYears,
  missing,
  total,
}: {
  symbols: SymbolSeasonality[];
  nowIso: string;
  historyYears: number;
  missing: number;
  total: number;
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  const [lookback, setLookback] = useState<SeasonalityLookback>(SEASONALITY_YEARS as SeasonalityLookback);
  const [scanKind, setScanKind] = useState<SeasonalBucketKind>('month');
  const [selected, setSelected] = useState(symbols[0]?.symbol ?? '');
  const [query, setQuery] = useState('');

  /** The bucket the calendar is in, which is what the scanner ranks on. */
  const [scanBucket, setScanBucket] = useState<number | null>(null);
  const activeBucket = scanBucket ?? currentBucket(scanKind, now);

  /**
   * Rebuilds a lookup from the flat bucket array the server sent. Memoised on
   * `lookback` so the ranking below can list it as a dependency honestly rather
   * than suppressing the lint — a stale closure here would rank one lookback's
   * numbers under another's label.
   */
  const lookupFor = useCallback(
    (s: SymbolSeasonality, kind: SeasonalBucketKind) => {
      const p = s.profiles[`${kind}:${lookback}`];
      return {
        buckets: new Map((p?.buckets ?? []).map((b) => [b.key, b])),
        yearsCovered: p?.yearsCovered ?? 0,
      };
    },
    [lookback],
  );

  const ranked = useMemo(() => {
    const q = query.trim().toUpperCase();
    return symbols
      .filter((s) => !q || s.symbol.includes(q) || s.label.toUpperCase().includes(q))
      .map((s) => ({ s, bucket: lookupFor(s, scanKind).buckets.get(activeBucket) ?? null }))
      .sort((a, b) => {
        if (!a.bucket) return 1;
        if (!b.bucket) return -1;
        return b.bucket.meanPct - a.bucket.meanPct;
      });
  }, [symbols, query, scanKind, activeBucket, lookupFor]);

  const active = symbols.find((s) => s.symbol === selected) ?? symbols[0];

  if (!active) {
    return (
      <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
        <Panel title="Seasonality">
          <EmptyState message="No symbols with price history" />
        </Panel>
      </div>
    );
  }

  const strongest = Math.max(1, ...ranked.map((r) => Math.abs(r.bucket?.meanPct ?? 0)));

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Seasonality"
        description={`Average return per calendar bucket · up to ${historyYears} years of daily bars`}
        updated={
          missing > 0
            ? `${missing} of ${total} symbols have no history yet — Yahoo throttled the first load; reload`
            : undefined
        }
        info={
          <>
            The scorecard&rsquo;s Seasonality cell reads the sign of the {SEASONALITY_YEARS}-year monthly average for
            the current month. The lookback buttons are a reading aid and never change that cell. An average of ten
            Augusts describes ten Augusts: read it with its win rate and sample count, not as a forecast.
          </>
        }
        actions={
          <div className="flex items-center gap-1" role="group" aria-label="Lookback">
            <span className="mr-1 text-caption text-[var(--color-faint)]">Lookback</span>
            {SEASONALITY_LOOKBACKS.map((years) => (
              <button
                key={years}
                type="button"
                aria-pressed={lookback === years}
                onClick={() => setLookback(years)}
                className={`min-h-11 min-w-11 rounded-[var(--radius-control)] border px-2 text-small transition-colors md:min-h-9 ${
                  lookback === years
                    ? 'border-[var(--color-bull)] text-[var(--color-bull)]'
                    : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {years}y{years === SEASONALITY_YEARS ? ' ★' : ''}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* --- Scanner ---------------------------------------------------- */}
        <Panel
          title="Scanner"
          subtitle={`Every symbol, ranked by ${bucketName(scanKind, activeBucket)}`}
          action={
            <div className="flex items-center gap-1">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => {
                    setScanKind(k.key);
                    setScanBucket(null);
                  }}
                  className={`min-h-9 rounded px-2 text-caption transition-colors ${
                    scanKind === k.key
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {k.label.split(' ')[0]}
                </button>
              ))}
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter symbols"
              className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-small outline-none focus:border-[var(--color-border-bright)] md:min-h-9 md:w-32 md:flex-none"
            />
            <select
              value={activeBucket}
              onChange={(e) => setScanBucket(Number(e.target.value))}
              className="min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-small outline-none md:min-h-9"
            >
              {allKeys(scanKind).map((key) => (
                <option key={key} value={key}>
                  {bucketName(scanKind, key)}
                  {key === currentBucket(scanKind, now) ? ' (now)' : ''}
                </option>
              ))}
            </select>
            <span className="ml-auto text-micro text-[var(--color-faint)]">
              {ranked.length} symbols
            </span>
          </div>

          <div className="max-h-[50dvh] overflow-y-auto xl:max-h-[calc(100dvh-16rem)]">
            <table className="w-full text-small">
              <thead className="table-head sticky top-0 z-10">
                <tr className="text-caption font-semibold">
                  <th className="px-3 py-1.5 text-left">Symbol</th>
                  <th className="px-2 py-1.5 text-right">Avg</th>
                  <th className="w-20 px-2 py-1.5" />
                  <th className="px-2 py-1.5 text-right">Higher</th>
                  <th className="px-3 py-1.5 text-right">n</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(({ s, bucket }) => {
                  const isSelected = s.symbol === active.symbol;
                  const width = bucket ? (Math.abs(bucket.meanPct) / strongest) * 100 : 0;

                  return (
                    <tr
                      key={s.symbol}
                      onClick={() => setSelected(s.symbol)}
                      className={`cursor-pointer border-b border-[var(--color-border)]/50 ${
                        isSelected ? 'bg-[var(--color-surface-2)]' : 'hover:bg-[var(--color-surface-2)]/50'
                      }`}
                    >
                      <td className="px-3 py-2.5 md:py-1.5 font-mono">{s.symbol}</td>
                      <td
                        className={`tnum px-2 py-2.5 md:py-1.5 text-right font-semibold ${
                          !bucket
                            ? 'text-[var(--color-faint)]'
                            : bucket.meanPct >= 0
                              ? 'text-[var(--color-bull)]'
                              : 'text-[var(--color-bear)]'
                        }`}
                      >
                        {bucket ? signed(bucket.meanPct) : '—'}
                      </td>
                      <td className="px-2 py-2.5 md:py-1.5">
                        {/* Centre-anchored bar, so sign reads before magnitude. */}
                        <div className="relative h-1.5 w-full">
                          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-[var(--color-border)]" />
                          {bucket && (
                            <div
                              className="absolute top-0 bottom-0 rounded-[1px]"
                              style={{
                                width: `${width / 2}%`,
                                left: bucket.meanPct >= 0 ? '50%' : undefined,
                                right: bucket.meanPct >= 0 ? undefined : '50%',
                                backgroundColor:
                                  bucket.meanPct >= 0
                                    ? `rgb(var(--color-bull-rgb) / ${bucket.reliable ? 80 : 30}%)`
                                    : `rgb(var(--color-bear-rgb) / ${bucket.reliable ? 80 : 30}%)`,
                              }}
                            />
                          )}
                        </div>
                      </td>
                      <td className="tnum px-2 py-2.5 md:py-1.5 text-right text-[var(--color-muted)]">
                        {bucket ? `${bucket.winRatePct}%` : '—'}
                      </td>
                      <td
                        className={`tnum px-3 py-2.5 md:py-1.5 text-right ${
                          bucket?.reliable ? 'text-[var(--color-faint)]' : 'text-[var(--color-uncertain)]'
                        }`}
                        title={bucket?.reliable ? undefined : 'Below the sample floor — not enough history to lean on'}
                      >
                        {bucket?.samples ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="border-t border-[var(--color-border)] px-3 py-2 text-micro leading-relaxed text-[var(--color-faint)]">
            Ranked by the average, not by conviction. A large average on a small
            <span className="text-[var(--color-uncertain)]"> n </span>
            is one year of history wearing a decade&rsquo;s clothes — those bars are drawn faded and
            their sample count amber.
          </p>
        </Panel>

        {/* --- One symbol, three granularities ---------------------------- */}
        <div className="flex flex-col gap-3">
          {KINDS.map((k) => {
            const { buckets, yearsCovered } = lookupFor(active, k.key);
            const here = currentBucket(k.key, now);
            const bucket = buckets.get(here);

            return (
              <Panel
                key={k.key}
                title={`${active.label} · ${k.label}`}
                subtitle={
                  `${lookback}-year window · ${yearsCovered} year${yearsCovered === 1 ? '' : 's'} of data` +
                  (k.key === 'month' ? ' · this is the bucket the scorecard cell reads' : '')
                }
                action={
                  bucket ? (
                    <span className="text-micro text-[var(--color-faint)]">
                      {bucketName(k.key, here)} averages{' '}
                      <span
                        className={
                          bucket.meanPct >= 0 ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'
                        }
                      >
                        {signed(bucket.meanPct)}
                      </span>{' '}
                      · higher {bucket.winRatePct}% of {bucket.samples}
                    </span>
                  ) : (
                    <span className="text-micro text-[var(--color-faint)]">
                      no history for {bucketName(k.key, here)}
                    </span>
                  )
                }
              >
                {buckets.size === 0 ? (
                  <EmptyState
                    message="No usable history in this window"
                    hint={`Try a longer lookback — ${active.symbol} may be younger than ${lookback} years.`}
                  />
                ) : (
                  <>
                    <BucketBars kind={k.key} buckets={buckets} highlight={here} />
                    <div className="px-3 pt-1 pb-2 text-micro text-[var(--color-faint)]">
                      Current bucket outlined. Faded bars are below the sample floor. Tap the scanner to change symbol.
                    </div>
                  </>
                )}
              </Panel>
            );
          })}

          <p className="px-1 text-micro leading-relaxed text-[var(--color-faint)]">
            The scorecard&rsquo;s Seasonality cell reads the SIGN of the {SEASONALITY_YEARS}-year
            monthly average for the current month, and nothing here changes it — the lookback
            buttons are a reading aid, not a setting. Bias bands in this app are absolute, so a cell
            that moved with a dropdown would quietly redefine &ldquo;Bullish&rdquo; on every symbol.{' '}
            <Link
              href={`/scorecard/${active.symbol}`}
              className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-text)]"
            >
              Open {active.symbol}&rsquo;s scorecard
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
