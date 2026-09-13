'use client';

/**
 * A seasonal profile as a strip of signed bars, for the scorecard's rail.
 *
 * The compact sibling of the /seasonality tab: one granularity, one lookback,
 * no controls. Bars are the mean return for each bucket; the number beneath is
 * the win rate. Both are shown because either alone misleads — a +2% average
 * from one outlier year is not a tendency, and an 80% win rate on moves of
 * 0.05% is not tradeable.
 *
 * Buckets with no observations render as an explicit gap rather than a zero
 * bar. The upstream history has genuine holes, and drawing those flat would
 * invent a seasonal pattern out of missing data.
 */

import Link from 'next/link';
import type { SeasonalBucketKind, SeasonalProfile } from '@/lib/scoring/seasonality';
import { currentBucket } from '@/lib/scoring/seasonality';
import { Panel } from '@/components/ui';

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function bucketKeys(kind: SeasonalBucketKind): number[] {
  if (kind === 'month') return Array.from({ length: 12 }, (_, i) => i + 1);
  if (kind === 'week') return Array.from({ length: 53 }, (_, i) => i + 1);
  return [1, 2, 3, 4, 5];
}

function bucketName(kind: SeasonalBucketKind, key: number): string {
  if (kind === 'month') return MONTH_NAMES[key - 1] ?? `Month ${key}`;
  if (kind === 'week') return `Week ${key}`;
  return ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][key] ?? `Day ${key}`;
}

function tick(kind: SeasonalBucketKind, key: number): string {
  if (kind === 'month') return MONTH_LABELS[key - 1] ?? '';
  // Every fourth week only. 53 labels in a rail column is a grey smear.
  if (kind === 'week') return key % 8 === 1 ? String(key) : '';
  return ['', 'M', 'T', 'W', 'T', 'F'][key] ?? '';
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

export function SeasonalityStrip({
  kind,
  profile,
  lookbackYears,
  symbol,
  /** True for the one granularity that feeds the scorecard cell. */
  scores = false,
}: {
  kind: SeasonalBucketKind;
  profile: SeasonalProfile;
  lookbackYears: number;
  symbol: string;
  scores?: boolean;
}) {
  const here = currentBucket(kind, new Date());
  const keys = bucketKeys(kind);

  // Floored, so a market with no seasonality does not get dramatic-looking bars
  // made entirely of noise.
  const max = Math.max(0.5, ...[...profile.buckets.values()].map((b) => Math.abs(b.meanPct)));

  const title = kind === 'month' ? 'Seasonality · month' : kind === 'week' ? 'Seasonality · week' : 'Seasonality · weekday';

  return (
    <Panel
      title={title}
      subtitle={`${lookbackYears}-year average${scores ? ' · this is what the cell reads' : ''}`}
      action={
        <Link
          href="/seasonality"
          className="text-micro text-[var(--color-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-text)]"
        >
          scanner
        </Link>
      }
    >
      <div className="flex items-end gap-px px-3 pt-3">
        {keys.map((key) => {
          const stats = profile.buckets.get(key);
          const isCurrent = key === here;

          if (!stats) {
            return (
              <div key={key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div className="flex h-16 w-full items-center justify-center">
                  <span className="text-[8px] text-[var(--color-faint)]">·</span>
                </div>
                <span className="text-[8px] text-[var(--color-faint)]">{tick(kind, key)}</span>
              </div>
            );
          }

          const height = Math.max((Math.abs(stats.meanPct) / max) * 30, 2);
          const positive = stats.meanPct >= 0;

          return (
            <div
              key={key}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
              title={
                `${bucketName(kind, key)}: ${signed(stats.meanPct)} average, ` +
                `median ${signed(stats.medianPct)}, higher ${stats.winRatePct}% of the time ` +
                `over ${stats.samples} observation${stats.samples === 1 ? '' : 's'}` +
                (stats.reliable ? '' : ' — too few to lean on')
              }
            >
              {/* Fixed band with a centre line, so up and down share a baseline. */}
              <div className="relative flex h-16 w-full flex-col justify-center">
                <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--color-border)]" />
                <div
                  className="absolute inset-x-[0.5px] rounded-[1px]"
                  style={{
                    height: `${height}px`,
                    bottom: positive ? '50%' : undefined,
                    top: positive ? undefined : '50%',
                    backgroundColor: positive
                      ? `rgb(var(--color-bull-rgb) / ${stats.reliable ? 75 : 28}%)`
                      : `rgb(var(--color-bear-rgb) / ${stats.reliable ? 75 : 28}%)`,
                    outline: isCurrent ? '1px solid var(--color-text)' : undefined,
                  }}
                />
              </div>
              <span
                className={`text-[8px] ${
                  isCurrent ? 'font-bold text-[var(--color-text)]' : 'text-[var(--color-faint)]'
                }`}
              >
                {tick(kind, key)}
              </span>
              {kind !== 'week' && (
                <span className="tnum text-[8px] text-[var(--color-faint)]">
                  {stats.winRatePct}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className="px-3 py-2 text-micro leading-relaxed text-[var(--color-faint)]">
        Current {kind === 'month' ? 'month' : kind === 'week' ? 'week' : 'day'} outlined; faded bars
        are below the sample floor.{' '}
        {kind !== 'week' && 'Percentages beneath are how often that bucket closed higher. '}
        Gaps are holes in the upstream history, not flat periods.{' '}
        {scores
          ? `The cell above reads only the SIGN of the current bar. ${symbol} has ${profile.yearsCovered} years of data here.`
          : 'Context only — no cell reads this granularity.'}
      </p>
    </Panel>
  );
}
