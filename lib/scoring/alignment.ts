/**
 * The alignment checklist: does everything this app knows point the same way?
 *
 * The user's own description of the workflow is the specification — take a setup
 * with a genuinely good score, find where price broke structure, lay a
 * retracement over it, "and align all of these infos". Every input below already
 * exists somewhere in the app; what was missing was the one screen that puts
 * them side by side and says which ones disagree.
 *
 * IT IS A COUNT, NOT A GRADE, AND DELIBERATELY SO. The backtest run against this
 * scorecard found no statistically significant edge — the bucket table looks
 * monotonic, but corrected for correlated symbols and overlapping windows it is
 * t≈0.75 over eighteen independent five-day windows. Attaching a letter grade or
 * a win probability to a checklist would manufacture confidence the data does
 * not support. "Five of seven aligned, and here are the two that do not" is what
 * the evidence actually licenses, and it is more useful anyway: the failures are
 * the part worth reading.
 *
 * The conditions are not weighted, for the same reason A1's own columns are not:
 * any weighting would be invented, and an unweighted count is at least honest
 * about being arbitrary.
 */

import { cotTicker } from '@/config/symbols.config';
import type { CotFlow } from '@/lib/scoring/cot-flow';
import type { Cluster } from '@/lib/scoring/correlation';
import type { SymbolRow } from '@/lib/scoring/setups';
import type { StructureView } from '@/lib/scoring/structure';
import type { UpcomingEvent } from '@/lib/scoring/trade-ideas';

export interface Check {
  key: string;
  label: string;
  /** Null when the input is missing — an unknown is not a failure. */
  passed: boolean | null;
  /** The evidence, in the user's terms. Always populated, including on a pass. */
  detail: string;
  /** Page that owns this input, so the reader can go and look. */
  href?: string;
}

export interface Alignment {
  direction: 'long' | 'short';
  checks: Check[];
  passed: number;
  /** Checks that could be evaluated at all. The denominator. */
  applicable: number;
  /** The ones that failed, for the summary line. */
  failures: Check[];
}

export interface AlignmentInput {
  row: SymbolRow;
  structure: StructureView | null;
  flow: CotFlow | null;
  events: UpcomingEvent[];
  cluster: Cluster | null;
  minScore: number;
}

const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

export function buildAlignment(input: AlignmentInput): Alignment {
  const { row, structure, flow, events, cluster, minScore } = input;
  const direction: 'long' | 'short' = row.totalScore >= 0 ? 'long' : 'short';
  const wantBullish = direction === 'long';

  const checks: Check[] = [];

  // 1. Conviction. The user's own gate: not barely a +4.
  checks.push({
    key: 'conviction',
    label: `Score at or beyond ${minScore >= 0 ? '±' : ''}${Math.abs(minScore)}`,
    passed: Math.abs(row.totalScore) >= minScore,
    detail: `${row.bias} at ${row.totalScore > 0 ? '+' : ''}${row.totalScore}, from ${row.populated} populated columns`,
    href: `/scorecard/${row.symbol}`,
  });

  // 2. Structure agrees with the fundamental call.
  const brk = structure?.structure.latest ?? null;
  checks.push({
    key: 'structure',
    label: 'Price structure agrees',
    passed: structure === null ? null : brk === null ? false : brk.direction === (wantBullish ? 'bullish' : 'bearish'),
    detail:
      structure === null
        ? 'Not enough price history to read structure'
        : brk === null
          ? structure.structure.range
            ? `Ranging between ${structure.structure.range.low.toFixed(5)} and ${structure.structure.range.high.toFixed(5)} — no break either way`
            : 'No clean break of structure'
          : `${brk.direction} break of ${brk.level.toFixed(5)}, ${brk.barsSince} bars ago${brk.retested ? ', since retested' : ', not yet retested'}`,
  });

  // 3. Location. A good setup at a bad price is still a bad entry.
  const fib = structure?.fib ?? null;
  checks.push({
    key: 'location',
    label: 'Price in a retracement, not extended',
    passed: fib === null ? null : fib.inDiscountZone || fib.inGoldenZone,
    detail:
      fib === null
        ? 'No impulse leg long enough to retrace'
        : fib.invalidated
          ? 'The impulse has fully reversed — these levels are history'
          : `${(fib.positionRatio * 100).toFixed(0)}% retraced` +
            (fib.inGoldenZone
              ? ' — in the 0.618 zone'
              : fib.inDiscountZone
                ? ' — inside the 0.5-0.786 pocket'
                : fib.positionRatio < 0.382
                  ? ' — extended, still near the extreme'
                  : ' — shallow, above the 0.5'),
  });

  // 4. Confluence at the level price would actually trade into.
  const zone = wantBullish ? structure?.nearestSupport : structure?.nearestResistance;
  checks.push({
    key: 'confluence',
    label: `Confluence at the nearest ${wantBullish ? 'support' : 'resistance'}`,
    passed: structure === null ? null : zone !== undefined && zone !== null && zone.sources.length >= 2,
    detail:
      structure === null
        ? 'Not enough price history'
        : !zone
          ? `Nothing found ${wantBullish ? 'below' : 'above'} price`
          : `${zone.sources.length} at ${zone.price.toFixed(5)} (${zone.distanceAtr.toFixed(1)} ATR, ${pct(zone.distancePct)}): ${zone.sources.map((s) => s.label).join(', ')}`,
  });

  // 5. What the big money did last week.
  checks.push({
    key: 'cot',
    label: 'Weekly COT flow agrees',
    passed:
      flow === null || flow.direction === 'flat'
        ? null
        : flow.direction === (wantBullish ? 'buying' : 'selling'),
    detail:
      flow === null
        ? 'No CFTC contract covers this market'
        : `${cotTicker(flow.contract)}: ${flow.headline} — ${flow.direction}${flow.againstPosition ? ', but against their own book' : ''}`,
    href: '/cot',
  });

  /**
   * 6. Event risk. The stop is sized from realised volatility, which by
   * definition has not seen the release yet — so the one number that can
   * invalidate the levels is the one the levels cannot know about.
   */
  checks.push({
    key: 'events',
    label: 'No high-impact release within 48h',
    passed: events.length === 0,
    detail:
      events.length === 0
        ? 'Nothing high-impact due for either leg'
        : events
            .slice(0, 3)
            .map((e) => `${e.currency} ${e.name} in ${e.hoursAway}h`)
            .join(' · '),
    href: '/news',
  });

  /**
   * 7. Concentration. The board ranks correlated symbols alike by construction,
   * so taking the top few can be one position at several times the intended
   * size. That is the most common way a scorecard loses money — not by being
   * wrong, but by being right once and sized for five.
   */
  const others = cluster ? cluster.members.filter((m) => m.symbol !== row.symbol) : [];
  checks.push({
    key: 'concentration',
    label: 'Not already crowded into this trade',
    passed: cluster === null ? null : others.length === 0,
    detail:
      cluster === null
        ? 'No correlation data for this symbol'
        : others.length === 0
          ? 'The board is not repeating this trade elsewhere'
          : `${others.length} other setup${others.length > 1 ? 's' : ''} say the same thing: ${others.map((m) => m.symbol).join(', ')} (${Math.round(cluster.meanCorrelation * 100)}% correlated)`,
    href: '/markets',
  });

  const applicable = checks.filter((c) => c.passed !== null);

  return {
    direction,
    checks,
    passed: applicable.filter((c) => c.passed).length,
    applicable: applicable.length,
    failures: applicable.filter((c) => c.passed === false),
  };
}
