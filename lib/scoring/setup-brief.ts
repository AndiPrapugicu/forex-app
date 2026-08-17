/**
 * The setup, in prose, with no model involved.
 *
 * Two jobs. It is what the Chart page shows when there is no API key, no
 * network, or the model call fails — the page is never blank and never depends
 * on a third party being up, which is the same rule every other optional
 * subsystem in this app follows. And it is the bundle the AI reads: the AI is
 * given these exact facts and asked to do the one thing this cannot, which is
 * judge which conflict matters most.
 *
 * Composed from templates, never generated. Every clause is switched on a value
 * computed upstream, so there is no path by which this text can claim something
 * the numbers do not say — the failure mode that makes a fluent model dangerous
 * here.
 */

import { TIMEFRAME_SPEC, type ChartTimeframe } from '@/lib/connectors/technicals';
import type { Alignment } from '@/lib/scoring/alignment';
import type { SymbolRow } from '@/lib/scoring/setups';
import type { StructureView } from '@/lib/scoring/structure';

export interface SetupBundle {
  symbol: string;
  label: string;
  row: SymbolRow;
  view: StructureView | null;
  alignment: Alignment;
  timeframe: ChartTimeframe;
  /**
   * Which timeframe the levels in `view` were actually measured on. Usually the
   * same as `timeframe`, and deliberately not on the two finest widths — see
   * `structureTimeframe` on the chart page. The brief has to name the series the
   * numbers came from, not the one being looked at.
   */
  structureTimeframe: ChartTimeframe;
}

function dp(price: number): number {
  return price >= 1000 ? 1 : price >= 10 ? 3 : 5;
}

/**
 * The one level that would prove the read wrong.
 *
 * For a long that is the level below which the reason for being long stops
 * existing: the broken structure it is standing on, or failing that the range
 * floor. Everything else on the page is a reason to be in; this is the reason to
 * be out, which is the sentence a plan actually needs.
 */
export function invalidationLevel(
  view: StructureView | null,
  direction: 'long' | 'short',
): { price: number; why: string } | null {
  if (!view) return null;

  const brk = view.structure.latest;
  if (brk) {
    const agrees = brk.direction === (direction === 'long' ? 'bullish' : 'bearish');
    if (agrees) {
      return {
        price: brk.level,
        why: `a close back ${direction === 'long' ? 'below' : 'above'} the broken level reclaims it, and the structure reason for this trade is gone`,
      };
    }
  }

  const range = view.structure.range;
  if (range) {
    const price = direction === 'long' ? range.low : range.high;
    return {
      price,
      why: `there is no break to lean on, so the range ${direction === 'long' ? 'floor' : 'ceiling'} is the only structural line`,
    };
  }

  return null;
}

/** The deterministic read. Always available, never wrong about the numbers. */
export function buildSetupBrief(bundle: SetupBundle): string {
  const { row, view, alignment, structureTimeframe } = bundle;
  const dir = alignment.direction;
  /**
   * Names the STRUCTURE timeframe, not the one on screen. On a 1-minute chart
   * the levels are the daily ones, and calling them "the 1-minute chart's"
   * would misattribute every number that follows.
   */
  const tf = TIMEFRAME_SPEC[structureTimeframe].prose;

  const parts: string[] = [];

  parts.push(
    `${row.symbol} scores ${row.totalScore > 0 ? '+' : ''}${row.totalScore} (${row.bias}) across ` +
      `${row.populated} columns, which is a ${dir} on the fundamentals.`,
  );

  if (!view) {
    parts.push('There is not enough price history to read structure, so there are no levels to check it against.');
    return parts.join(' ');
  }

  const d = dp(view.price);
  const brk = view.structure.latest;

  if (brk) {
    const agrees = brk.direction === (dir === 'long' ? 'bullish' : 'bearish');
    parts.push(
      `On the ${tf} chart price broke ${brk.direction === 'bullish' ? 'above' : 'below'} ` +
        `${brk.level.toFixed(d)} ${brk.barsSince} bars ago, which ${agrees ? 'agrees with' : 'runs against'} that call` +
        `${brk.retested ? ' and has since been retested' : ' and has not been retested'}.`,
    );
  } else if (view.structure.range) {
    parts.push(
      `Price is ranging between ${view.structure.range.low.toFixed(d)} and ` +
        `${view.structure.range.high.toFixed(d)} with no clean break either way, so the ${tf} ` +
        `chart is not confirming anything yet.`,
    );
  }

  if (view.fib && !view.fib.invalidated) {
    const golden = view.fib.levels.find((l) => l.ratio === 0.618)!;
    parts.push(
      `The impulse ran ${view.fib.low.toFixed(d)} to ${view.fib.high.toFixed(d)} and price has ` +
        `given back ${(view.fib.positionRatio * 100).toFixed(0)}% of it` +
        (view.fib.inGoldenZone
          ? `, sitting in the 0.618 zone at ${golden.price.toFixed(d)}.`
          : view.fib.inDiscountZone
            ? `, inside the 0.5-0.786 pocket, with the 0.618 at ${golden.price.toFixed(d)}.`
            : `, so it is ${view.fib.positionRatio < 0.382 ? 'still extended near the extreme' : 'only shallowly retraced'}; the 0.618 is at ${golden.price.toFixed(d)}.`),
    );
  }

  const zone = dir === 'long' ? view.nearestSupport : view.nearestResistance;
  if (zone) {
    parts.push(
      `The nearest ${zone.side} is ${zone.price.toFixed(d)}, ${zone.distanceAtr.toFixed(1)} ATR away, ` +
        `made of ${zone.sources.map((s) => s.label).join(', ')}.`,
    );
  }

  parts.push(
    alignment.failures.length === 0
      ? `All ${alignment.applicable} checks that could be evaluated agree.`
      : `${alignment.passed} of ${alignment.applicable} checks agree; the objections are ` +
        `${alignment.failures.map((f) => f.detail.toLowerCase()).join('; ')}.`,
  );

  const invalid = invalidationLevel(view, dir);
  if (invalid) {
    parts.push(`It stops being this trade at ${invalid.price.toFixed(d)} — ${invalid.why}.`);
  }

  return parts.join(' ');
}
