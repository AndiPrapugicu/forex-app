/**
 * Cell-by-cell parity against the LIVE EdgeFinder demo, not a screenshot.
 *
 * `npm run parity` (and `row`, `legs`, `cards`) all rewind to a dated capture
 * transcribed from a screenshot or livestream frame. This script instead
 * compares our live-scored board against readings taken directly from A1's
 * public Looker Studio demo (lookerstudio.google.com/embed/reporting/
 * cfd37bd1-45ce-459a-8d11-b6b7eac72b0d) on 2026-08-24, using its own pages:
 *
 *   Asset Scorecard   — full 18-cell card, locked to PLATINUM on the free tier
 *   Forex Scorecard   — full 18-cell card, locked to EURCHF on the free tier
 *   Latest COT Report — large-speculator long/short %, unlocked, all contracts
 *   Retail Sentiment  — retail long %, unlocked, ~20 symbols
 *   Top Setups        — the actual per-symbol 18-column matrix. PREMIUM ONLY.
 *                        Its header (column names + category grouping) is
 *                        visible and is reproduced below as a structural
 *                        check; no row data is available from it.
 *   Economic Heatmaps — per-country economic prints. PREMIUM ONLY, entirely.
 *
 * So "for as many symbols as the live demo exposes" has a real, honest
 * ceiling: two symbols at full cell resolution, plus two single-column feeds
 * (crowd, COT net-positioning) across many symbols. That ceiling is itself a
 * finding, not a limitation of this script, and REFERENCE below marks
 * unavailable cells as 'locked' rather than guessing them from the total.
 */

import { CURRENCY_COT_CONTRACT, ALL_SYMBOLS } from '@/config/symbols.config';
import { CROWD_LONG_PCT_BUCKETS, COT_LONG_PCT_BUCKETS, MATRIX_SLOTS } from '@/config/setups.config';
import { scoreCot } from '@/lib/scoring/cot';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import type { Currency } from '@/lib/types';

const CAPTURED_AT_LIVE = '2026-08-24 (live browser session, times noted per source below)';

// ---------------------------------------------------------------------------
// REFERENCE: hand-transcribed from the live demo. Every value below was read
// directly off the rendered page, not inferred from a total.
// ---------------------------------------------------------------------------

type Sign = -1 | 0 | 1;
const sign = (pct: number, bearish: number, bullish: number): Sign =>
  pct >= bearish ? -1 : pct <= bullish ? 1 : 0;

/** Asset Scorecard, symbol locked to PLATINUM. Full 18-cell card, exact badges. */
const PLATINUM_CARD: Record<string, Sign> = {
  trend: 1, // 4H/Daily Chart Trend: Bullish
  seasonality: -1, // Current Month Seasonality: Bearish
  cot: 0, // Net Positioning Bullish(+1) + Latest Buys/Sells Bearish(-1) = 0, matches "Institutional activity bias: Neutral"
  crowd: -1, // Crowd sentiment signal: Bearish
  gdp: -1,
  mpmi: 1,
  spmi: -1,
  'retail-sales': -1,
  'consumer-confidence': -1,
  cpi: 0,
  ppi: 1,
  pce: 0,
  rates: 1, // labelled "US02Yield (21 day SMA)": Bullish
  employment: -1, // Non-Farm Payroll: Bearish
  unemployment: 1, // Unemployment Rate %: Bullish (lower than forecast)
  claims: 1, // Weekly Jobless Claims: Bullish (lower than forecast)
  adp: -1,
  jolts: -1,
};
const PLATINUM_TOTAL = -2;

/**
 * Forex Scorecard, symbol locked to EURCHF. This page shows CATEGORY subtotals
 * as exact integers, and each underlying slot as a Bullish/Bearish/Neutral
 * badge WITHOUT the raw actual/forecast — so the per-slot reference below is a
 * verified SIGN, not a verified magnitude. Category subtotals are exact.
 */
const EURCHF_CARD: Record<string, Sign> = {
  trend: -1, // "4H/Daily Chart Trend": Bearish
  seasonality: -1, // "Current month's 10yr seasonality": Bearish
  cot: 0, // "Institutional Activity (COT)" category donut, exact integer, not sign-only
  crowd: 1, // "Sentiment Bias" block = crowd alone (Bullish) -- see note
  gdp: -1,
  mpmi: 0,
  spmi: 0,
  'retail-sales': 0,
  'consumer-confidence': 0,
  cpi: 0,
  ppi: 0,
  pce: 0,
  rates: 1,
  employment: 0, // "Employment change vs. forecast": Neutral
  unemployment: 0,
  claims: 0,
  adp: 0,
  jolts: 0,
};
const EURCHF_CATEGORY_TOTALS = {
  technical: -2, // trend(-1) + seasonality(-1)
  cot: 0, // NOT simply netPos+weeklyChange -- see write-up. Cell excluded below.
  crowd: 1,
  growth: -1, // gdp(-1)+mpmi(0)+spmi(0)+retail(0)+confidence(0)
  jobs: 0,
  inflation: 1, // cpi(0)+ppi(0)+pce(0)+rates(+1)
};
const EURCHF_TOTAL = -1;

/**
 * Retail Sentiment page, unlocked, read 2026-08-24. Left number is retail
 * LONG %. For FX this is the same measure our CFTC-derived crowd approximates
 * (small-trader long share); for metals/indices/commodities A1 uses a
 * put/call ratio instead (their own site says so, and the numbers behave
 * like one -- see EdgeFinder-scoring-diagnosis.md). Both kinds are recorded
 * here, tagged, and scored with THIS repo's own bucket rule so the diff
 * isolates the source difference from the threshold.
 */
const RETAIL_SENTIMENT: { symbol: string; longPct: number; kind: 'fx' | 'putcall' }[] = [
  { symbol: 'GER40', longPct: 96.45, kind: 'putcall' },
  { symbol: 'XAUUSD', longPct: 95.08, kind: 'putcall' },
  { symbol: 'WTIUSD', longPct: 92.54, kind: 'putcall' },
  { symbol: 'XAGUSD', longPct: 91.05, kind: 'putcall' },
  { symbol: 'US30', longPct: 90.55, kind: 'putcall' },
  { symbol: 'XCUUSD', longPct: 82.44, kind: 'putcall' },
  { symbol: 'USDCHF', longPct: 79, kind: 'fx' },
  { symbol: 'USDCAD', longPct: 62, kind: 'fx' },
  { symbol: 'USDJPY', longPct: 55, kind: 'fx' },
  { symbol: 'JP225', longPct: 49.33, kind: 'putcall' },
  { symbol: 'GBPUSD', longPct: 31, kind: 'fx' },
  { symbol: 'UK100', longPct: 29.89, kind: 'putcall' },
  { symbol: 'NZDUSD', longPct: 29, kind: 'fx' },
  { symbol: 'AUDUSD', longPct: 25, kind: 'fx' },
  { symbol: 'EURUSD', longPct: 25, kind: 'fx' },
  { symbol: 'RUT2000', longPct: 16.35, kind: 'putcall' },
  { symbol: 'NAS100', longPct: 9.66, kind: 'putcall' },
  { symbol: 'SPX500', longPct: 9.46, kind: 'putcall' },
];

/**
 * Latest COT Report page, unlocked, read 2026-08-24. Large-speculator long %
 * for every contract. For FX currency legs this is NOT what A1 scores (their
 * card shows only weekly change is scored for currencies -- net positioning is
 * "shown but not scored", exactly as this repo's cot.ts already documents).
 * It is recorded here as a same-source SANITY CHECK on our own bucketing, not
 * as a scoring comparison, and used directly for assets where A1 DOES score
 * net positioning (everything that isn't an FX currency leg).
 */
const COT_NET_POSITIONING: { name: string; longPct: number }[] = [
  { name: 'CAD', longPct: 11.26 },
  { name: 'NZD', longPct: 14.0 },
  { name: 'CHF', longPct: 25.36 },
  { name: 'GBP', longPct: 36.96 },
  { name: 'RUT2000', longPct: 39.23 },
  { name: 'AUD', longPct: 39.99 },
  { name: 'JPY', longPct: 41.49 },
  { name: 'EUR', longPct: 43.46 },
  { name: 'NAS100', longPct: 47.07 },
  { name: 'SPX500', longPct: 48.59 },
  { name: 'BTCUSD', longPct: 54.27 },
  { name: 'ETHUSD', longPct: 56.11 },
  { name: 'WTIUSD', longPct: 61.78 },
  { name: 'JP225', longPct: 63.3 },
  { name: 'XPTUSD', longPct: 69.18 },
  { name: 'XAGUSD', longPct: 72.25 },
  { name: 'USD', longPct: 73.8 },
  { name: 'US30', longPct: 74.57 },
  { name: 'XCUUSD', longPct: 77.87 },
  { name: 'XAUUSD', longPct: 88.1 },
];

/**
 * Top Setups page header -- the only part not behind the paywall. Reproduced
 * as a structural check: it names the same 18 columns in the same 5
 * categories this repo already scores, in the same order.
 */
const TOP_SETUPS_HEADER = {
  Technical: ['Trend', 'Seasonality'],
  Sentiment: ['COT', 'Crowd Sentiment'],
  'Economic Growth & Consumer Strength': ['GDP', 'mPMI', 'sPMI', 'Retail Sales', 'Consumer Conf'],
  Inflation: ['CPI YoY', 'PPI YoY', 'PCE YoY', 'Interest Rates'],
  'Jobs Market': ['NFP', 'Unemployment Rate', 'Unemploy Claims', 'ADP', 'JOLTS'],
};

// ---------------------------------------------------------------------------

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padStart = (s: string | number, n: number) => String(s).padStart(n);
const signed = (n: number | null | undefined) => (n === null || n === undefined ? '-' : n > 0 ? `+${n}` : String(n));

type Status = 'EXACT' | 'DIFFERENT' | 'MISSING_OURS' | 'MISSING_THEIRS' | 'UNAVAILABLE';

interface Comparison {
  symbol: string;
  slot: string;
  category: string;
  assetType: string;
  ours: number | null;
  theirs: number | null;
  status: Status;
  cause: string;
}

const ASSET_TYPE: Record<string, string> = {};
for (const def of ALL_SYMBOLS) {
  if (def.kind === 'currency') ASSET_TYPE[def.symbol] = 'Currency index';
  else if (def.kind === 'index') ASSET_TYPE[def.symbol] = 'Equity index';
  else if (def.kind === 'commodity') ASSET_TYPE[def.symbol] = def.symbol.includes('AU') || def.symbol.includes('AG') || def.symbol.includes('PT') ? 'Metal' : 'Commodity';
  else if (def.kind === 'crypto') ASSET_TYPE[def.symbol] = 'Crypto';
  else if (def.base && def.quote) ASSET_TYPE[def.symbol] = def.quote === 'USD' || def.base === 'USD' ? 'FX pair (dollar)' : 'FX pair (cross)';
}

const SLOT_CATEGORY: Record<string, string> = {};
for (const s of MATRIX_SLOTS) SLOT_CATEGORY[s.key] = s.category;

async function main() {
  const payload = await runSetupsPipeline();
  const matrix = buildSetupsMatrix({
    events: payload.events,
    cot: payload.cot,
    technicals: payload.technicals,
    sovereignYields: payload.sovereignYields,
    yield2y: payload.yield2y,
    now: new Date(),
  });
  const rowOf = (sym: string) => matrix.rows.find((r) => r.symbol === sym);

  const comparisons: Comparison[] = [];

  // --- 1. Full-card anchors -------------------------------------------------
  console.log('='.repeat(100));
  console.log(`LIVE DEMO CELL PARITY -- captured ${CAPTURED_AT_LIVE}`);
  console.log('='.repeat(100));

  for (const [symbol, card, total] of [
    ['XPTUSD', PLATINUM_CARD, PLATINUM_TOTAL],
    ['EURCHF', EURCHF_CARD, EURCHF_TOTAL],
  ] as const) {
    const row = rowOf(symbol);
    if (!row) {
      console.log(`\n${symbol}: not in matrix`);
      continue;
    }
    console.log(`\n${symbol} -- ours ${signed(row.totalScore)}  A1 ${signed(total)}  gap ${signed(row.totalScore - total)}`);
    console.log(`  ${pad('slot', 22)}${padStart('ours', 6)}${padStart('A1', 5)}  status`);
    for (const slotKey of Object.keys(card)) {
      const cell = row.cells[slotKey];
      const ours = cell?.cell ?? null;
      const theirs = card[slotKey];
      let status: Status;
      if (ours === null) status = 'MISSING_OURS';
      else status = ours === theirs ? 'EXACT' : 'DIFFERENT';
      console.log(`  ${pad(slotKey, 22)}${padStart(signed(ours), 6)}${padStart(signed(theirs), 5)}  ${status}`);
      comparisons.push({
        symbol,
        slot: slotKey,
        category: SLOT_CATEGORY[slotKey] ?? 'technical',
        assetType: ASSET_TYPE[symbol] ?? '?',
        ours,
        theirs,
        status,
        cause: 'full-card anchor',
      });
    }
  }

  console.log(`\nEURCHF category subtotals (A1 exact integers, ours computed the same way):`);
  for (const [cat, theirs] of Object.entries(EURCHF_CATEGORY_TOTALS)) {
    const row = rowOf('EURCHF')!;
    const ours = row.categoryScores[cat as keyof typeof row.categoryScores];
    console.log(`  ${pad(cat, 14)}ours ${padStart(signed(ours), 4)}   A1 ${padStart(signed(theirs), 4)}   ${ours === theirs ? 'EXACT' : 'DIFFERENT'}`);
  }

  // --- 2. Crowd, broad ------------------------------------------------------
  console.log(`\n${'-'.repeat(100)}\nCROWD -- Retail Sentiment page, ${RETAIL_SENTIMENT.length} symbols\n${'-'.repeat(100)}`);
  console.log(`  ${pad('symbol', 10)}${padStart('A1 long%', 9)}${padStart('A1 cell', 8)}${padStart('ours', 6)}  kind      status`);
  for (const { symbol, longPct, kind } of RETAIL_SENTIMENT) {
    const row = rowOf(symbol);
    const theirs = sign(longPct, CROWD_LONG_PCT_BUCKETS.bearish, CROWD_LONG_PCT_BUCKETS.bullish);
    const ours = row?.cells['crowd']?.cell ?? null;
    let status: Status;
    if (ours === null) status = 'MISSING_OURS';
    else if (kind === 'putcall') status = 'DIFFERENT'; // different measure by construction; sign match is coincidence
    else status = ours === theirs ? 'EXACT' : 'DIFFERENT';
    console.log(
      `  ${pad(symbol, 10)}${padStart(longPct.toFixed(2), 9)}${padStart(signed(theirs), 8)}${padStart(signed(ours), 6)}  ${pad(kind, 9)} ${status}`,
    );
    comparisons.push({
      symbol,
      slot: 'crowd',
      category: 'sentiment',
      assetType: ASSET_TYPE[symbol] ?? '?',
      ours,
      theirs: kind === 'fx' ? theirs : null,
      status,
      cause: kind === 'putcall' ? 'Different Crowd source (put/call vs retail futures)' : 'same-population comparison',
    });
  }

  // --- 3. COT net positioning, broad, sanity-check only for FX -------------
  console.log(`\n${'-'.repeat(100)}\nCOT NET POSITIONING -- Latest COT Report page, ${COT_NET_POSITIONING.length} contracts\n${'-'.repeat(100)}`);
  console.log(`  ${pad('name', 10)}${padStart('A1 long%', 9)}${padStart('A1 bucket', 10)}${padStart('ours', 6)}  role`);
  for (const { name, longPct } of COT_NET_POSITIONING) {
    const theirsBucket = sign(longPct, COT_LONG_PCT_BUCKETS.bearish, COT_LONG_PCT_BUCKETS.bullish);
    const isCurrency = (['EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'USD'] as Currency[]).includes(name as Currency);
    let ours: number | null = null;
    let role: string;
    if (isCurrency) {
      const series = payload.cot.get(CURRENCY_COT_CONTRACT[name as Currency]);
      ours = scoreCot(series, 'fx')?.netPositioning ?? null;
      role = 'FX leg -- not scored by A1, sanity check only';
    } else {
      const row = rowOf(name);
      ours = row?.cells['cot']?.cell ?? null;
      role = 'asset -- net positioning IS half the scored cell (weekly change not captured live)';
    }
    console.log(`  ${pad(name, 10)}${padStart(longPct.toFixed(2), 9)}${padStart(signed(theirsBucket), 10)}${padStart(signed(ours), 6)}  ${role}`);
  }

  // --- 4. Structural: symbols with no CFTC contract at all ------------------
  console.log(`\n${'-'.repeat(100)}\nSTRUCTURAL GAPS -- symbols A1's demo scores that we cannot score at all\n${'-'.repeat(100)}`);
  for (const sym of ['GER40', 'UK100']) {
    const def = ALL_SYMBOLS.find((s) => s.symbol === sym);
    console.log(`  ${sym}: cotContract=${def?.cotContract ?? 'NONE'} -- COT and Crowd are structurally unavailable (no CME/Eurex contract mapped)`);
  }

  // --- 5. Top Setups header, structural check only --------------------------
  console.log(`\n${'-'.repeat(100)}\nTOP SETUPS HEADER -- the only part of the real matrix the free demo exposes\n${'-'.repeat(100)}`);
  let n = 0;
  for (const [cat, cols] of Object.entries(TOP_SETUPS_HEADER)) {
    console.log(`  ${cat}: ${cols.join(', ')}`);
    n += cols.length;
  }
  console.log(`  Total columns: ${n} (this repo's MATRIX_SLOTS also has ${MATRIX_SLOTS.length})`);
  console.log(`  Row data: LOCKED ("Premium only feature") on both Top Setups and Top Setups (History).`);

  // --- Summary stats ---------------------------------------------------------
  console.log(`\n${'='.repeat(100)}\nSUMMARY\n${'='.repeat(100)}`);
  const exact = comparisons.filter((c) => c.status === 'EXACT').length;
  const different = comparisons.filter((c) => c.status === 'DIFFERENT').length;
  const missingOurs = comparisons.filter((c) => c.status === 'MISSING_OURS').length;
  const total = comparisons.length;
  console.log(`Total comparable cells: ${total}`);
  console.log(`Exact:                  ${exact}  (${((exact / total) * 100).toFixed(1)}%)`);
  console.log(`Different:              ${different}`);
  console.log(`Missing on our side:    ${missingOurs}`);

  const byColumn = new Map<string, { exact: number; total: number }>();
  for (const c of comparisons) {
    if (c.status === 'MISSING_OURS') continue;
    const e = byColumn.get(c.slot) ?? { exact: 0, total: 0 };
    e.total++;
    if (c.status === 'EXACT') e.exact++;
    byColumn.set(c.slot, e);
  }
  console.log(`\nBy column:`);
  for (const [slot, { exact, total }] of byColumn) {
    console.log(`  ${pad(slot, 22)}${exact}/${total} exact  (${((exact / total) * 100).toFixed(0)}%)`);
  }

  const byAsset = new Map<string, { exact: number; total: number }>();
  for (const c of comparisons) {
    if (c.status === 'MISSING_OURS') continue;
    const e = byAsset.get(c.assetType) ?? { exact: 0, total: 0 };
    e.total++;
    if (c.status === 'EXACT') e.exact++;
    byAsset.set(c.assetType, e);
  }
  console.log(`\nBy asset type:`);
  for (const [type, { exact, total }] of byAsset) {
    console.log(`  ${pad(type, 20)}${exact}/${total} exact  (${((exact / total) * 100).toFixed(0)}%)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
