/**
 * Clusters the board's top setups into the trades they actually are.
 *
 * The Top Setups ranking has a structural bias that is easy to miss and
 * expensive to ignore: correlated symbols score alike BY CONSTRUCTION. EURUSD,
 * GBPUSD and AUDUSD share the same USD leg, so a dollar-bearish macro picture
 * pushes all three up the list together, and gold usually follows. Acting on the
 * top five can be one short-dollar position at five times the intended size,
 * which is the most common way a scorecard loses money — not by being wrong
 * about direction, but by being right once and sized for five.
 *
 * The clustering is deliberately naive: correlation of daily returns, greedy
 * grouping above a threshold. A covariance-based risk model would be more
 * precise and would need assumptions this app has no way to validate. The
 * question here is only "is the board telling me the same thing several times",
 * and a correlation matrix answers it.
 */

import type { DailyBars } from '@/lib/connectors/technicals';
import type { SymbolRow } from '@/lib/scoring/setups';

/**
 * Above this, two symbols are treated as the same trade.
 *
 * 0.7 is a judgement, not a law. It puts EURUSD with GBPUSD (which move together
 * on any dollar story) while leaving EURUSD and USDJPY apart, which matches how
 * these actually behave.
 */
export const CLUSTER_THRESHOLD = 0.7;

/** Fewest overlapping days before a correlation is worth believing. */
export const MIN_OVERLAP = 40;

export interface ClusterMember {
  symbol: string;
  score: number;
  /**
   * This symbol's OWN direction, which is not always the cluster's.
   *
   * Short DXY and long EURX are the same short-dollar trade, so they belong in
   * one cluster — but labelling the whole group "short" would say EURX is a
   * short, which is false. Each member carries its own side.
   */
  direction: 'long' | 'short';
}

export interface Cluster {
  /** Highest-conviction symbol, which names the cluster. */
  lead: string;
  members: ClusterMember[];
  /** Summed absolute score — how much of the board this one trade represents. */
  combinedScore: number;
  /** Mean pairwise correlation among the members. */
  meanCorrelation: number;
  /** The lead's direction. Members may be opposite and still be the same bet. */
  direction: 'long' | 'short';
  /** True when members disagree on side — an inverse pair expressing one view. */
  mixedSides: boolean;
}

/** Daily percent returns from a close series. */
export function toReturns(bars: DailyBars): { t: number; r: number }[] {
  const out: { t: number; r: number }[] = [];
  for (let i = 1; i < bars.closes.length; i++) {
    const prev = bars.closes[i - 1];
    if (!prev) continue;
    out.push({ t: bars.timestamps[i], r: (bars.closes[i] / prev - 1) * 100 });
  }
  return out;
}

/**
 * Pearson correlation over the days both series actually traded.
 *
 * Joined on timestamp rather than by index: FX trades days the metals do not,
 * and lining the arrays up positionally would silently compare Tuesday's gold
 * with Wednesday's euro and report a correlation that is pure artefact.
 */
export function correlation(a: { t: number; r: number }[], b: { t: number; r: number }[]): number | null {
  const byTime = new Map(a.map((p) => [p.t, p.r]));
  const xs: number[] = [];
  const ys: number[] = [];

  for (const p of b) {
    const match = byTime.get(p.t);
    if (match !== undefined) {
      xs.push(match);
      ys.push(p.r);
    }
  }

  if (xs.length < MIN_OVERLAP) return null;

  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a1 = xs[i] - mx;
    const b1 = ys[i] - my;
    num += a1 * b1;
    dx += a1 * a1;
    dy += b1 * b1;
  }

  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : num / den;
}

/**
 * Groups directional setups into clusters of effectively the same trade.
 *
 * Walks the board strongest-first and attaches each symbol to the first cluster
 * it correlates with. Greedy rather than optimal, which means the clustering
 * depends on the ranking — deliberately so: the lead of each cluster is then the
 * setup you would actually have taken.
 *
 * SIGN MATTERS. Two symbols correlating at +0.9 are the same trade only if the
 * board wants them in the same direction; long EURUSD and short EURUSD are a
 * hedge, not a doubling. And a strong NEGATIVE correlation between opposite
 * calls is also one trade, which is why the sign of the correlation is compared
 * against the sign of the two scores rather than used raw.
 */
export function clusterSetups(
  rows: SymbolRow[],
  bars: Map<string, DailyBars>,
  threshold = CLUSTER_THRESHOLD,
): Cluster[] {
  const directional = rows
    .filter((r) => r.bias !== 'Neutral' && bars.has(r.symbol))
    .sort((a, b) => Math.abs(b.totalScore) - Math.abs(a.totalScore));

  const returns = new Map<string, { t: number; r: number }[]>();
  for (const row of directional) returns.set(row.symbol, toReturns(bars.get(row.symbol)!));

  const clusters: { rows: SymbolRow[]; correlations: number[] }[] = [];

  for (const row of directional) {
    const mine = returns.get(row.symbol)!;
    let placed = false;

    for (const cluster of clusters) {
      const lead = cluster.rows[0];
      const c = correlation(returns.get(lead.symbol)!, mine);
      if (c === null) continue;

      /**
       * Aligned when the correlation and the two calls agree. Symbols that move
       * together and are called the same way, or move oppositely and are called
       * oppositely, are one position either way.
       */
      const sameCall = Math.sign(row.totalScore) === Math.sign(lead.totalScore);
      const aligned = sameCall ? c : -c;

      if (aligned >= threshold) {
        cluster.rows.push(row);
        cluster.correlations.push(Math.abs(c));
        placed = true;
        break;
      }
    }

    if (!placed) clusters.push({ rows: [row], correlations: [] });
  }

  return clusters.map((c) => {
    const members: ClusterMember[] = c.rows.map((r) => ({
      symbol: r.symbol,
      score: r.totalScore,
      direction: r.totalScore > 0 ? ('long' as const) : ('short' as const),
    }));

    return {
      lead: c.rows[0].symbol,
      members,
      combinedScore: c.rows.reduce((s, r) => s + Math.abs(r.totalScore), 0),
      meanCorrelation:
        c.correlations.length === 0
          ? 1
          : c.correlations.reduce((s, v) => s + v, 0) / c.correlations.length,
      direction: members[0].direction,
      mixedSides: new Set(members.map((m) => m.direction)).size > 1,
    };
  });
}
