/**
 * Trade Ideas — every symbol past the Bullish/Bearish line, with levels.
 *
 * `buildTradeIdeas` already existed and fed the scorecard; this lists them all.
 */

import { ALL_SYMBOLS } from '@/config/symbols.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { MIN_ABS_SCORE, STOP_ATR, buildTradeIdeas, upcomingEventRisk } from '@/lib/scoring/trade-ideas';
import { IdeasTable, type IdeaRow } from '@/components/IdeasTable';
import { MetricDescription, PageHeader } from '@/components/primitives';
import { Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function IdeasPage() {
  const { matrix, technicals, events } = await runSetupsPipeline();
  const now = new Date();
  const bySymbol = new Map(matrix.rows.map((r) => [r.symbol, r]));

  const rows: IdeaRow[] = buildTradeIdeas(matrix.rows, technicals).map((idea) => {
    const row = bySymbol.get(idea.symbol)!;
    const def = ALL_SYMBOLS.find((s) => s.symbol === idea.symbol);
    const currencies = def && 'base' in def ? [def.base, def.quote] : [];
    return {
      ...idea,
      label: def?.label ?? idea.symbol,
      score: row.totalScore,
      bias: row.bias,
      events: upcomingEventRisk(currencies, events, now).map((e) => ({
        name: e.name,
        currency: e.currency,
        hoursAway: e.hoursAway,
      })),
    };
  });

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Trade Ideas"
        description={`${rows.length} symbols scoring ±${MIN_ABS_SCORE} or beyond`}
        updated={`Scores computed ${matrix.generatedAtUtc.slice(11, 16)} UTC`}
        info={
          <>
            Levels are derived from volatility alone: an entry band around the price, a stop at {STOP_ATR}× the average daily
            move and a target at {rows[0]?.rewardRisk ?? 2}:1. There is no support, liquidity or calendar awareness in them.
          </>
        }
      />
      <Panel title="Ideas" subtitle="Strongest conviction first. Tap a row for the reasoning.">
        <IdeasTable rows={rows} />
      </Panel>
      <MetricDescription>
        These are not signals and not advice. They show where the board&rsquo;s bias would put an entry, a stop and a target
        if the only thing you knew about a market was how far it usually moves in a day. The event-risk column is there
        because the one number that invalidates a volatility-sized stop is the release it has not seen yet.
      </MetricDescription>
    </div>
  );
}
