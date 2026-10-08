/**
 * Everything the AI analyst is allowed to know about one symbol, as text.
 *
 * THE DOSSIER IS THE BOUNDARY. The model is told to use no number that is not
 * in here, so every figure carries a date and every gap is named rather than
 * left for the model to fill. It is rebuilt for every question — the news and
 * the official feeds are minutes old, not a cached morning view.
 *
 * Pure: `load.ts` does the fetching, this does the writing, so the whole text
 * can be pinned by a test without a network.
 */

import { BIAS_THRESHOLDS, maxScoreForKind, SLOTS, type Bias } from '@/config/setups.config';
import { TRADINGVIEW } from '@/config/sources.config';
import type { CrossAssetDriver } from '@/config/ai.config';
import type { SymbolDefinition } from '@/config/symbols.config';
import type { LevelSet } from '@/lib/analysis/levels';
import { narrativeLines } from '@/lib/analysis/narrative-text';
import { positionLines, type PositionView } from '@/lib/analysis/positions-load';
import type { PairNarrative } from '@/lib/analysis/state';
import type { MarketState } from '@/lib/analysis/themes';
import { matchEventRule } from '@/config/scoring.config';
import { computeSurprise } from '@/lib/scoring/surprise';
import type { BankCommunication } from '@/lib/connectors/central-banks';
import type { SearchHit } from '@/lib/connectors/news-search';
import type { SovereignYield } from '@/lib/connectors/yields';
import type { Technicals } from '@/lib/connectors/technicals';
import type { CotScore, CrowdScore } from '@/lib/scoring/cot';
import type { RetailPositioning } from '@/lib/scoring/crowd';
import type { EcoStrengthRow } from '@/lib/scoring/eco-strength';
import type { RiskGauge, StrengthRow, SurpriseIndex } from '@/lib/scoring/market';
import type { SymbolRow } from '@/lib/scoring/setups';
import type { TrendScore } from '@/lib/scoring/technical';
import type { Currency, NewsCluster, NormalizedEvent, ScoreSnapshot, SourceHealth } from '@/lib/types';

export interface DriverReading {
  driver: CrossAssetDriver;
  last: number | null;
  /** `YYYY-MM-DD` of the last close. */
  date: string | null;
  change1wPct: number | null;
  change1mPct: number | null;
}

export interface LegPositioning {
  currency: Currency | null;
  contract: string;
  cot: CotScore | null;
  crowd: CrowdScore | null;
}

export interface AnalysisInputs {
  def: SymbolDefinition;
  economies: Currency[];
  now: Date;
  row: SymbolRow | null;
  /** The currency-index row behind each economy (EURX, DXY, …), for the bias gap. */
  indexRows: SymbolRow[];
  events: NormalizedEvent[];
  technicals: Technicals | null;
  trend: TrendScore | null;
  sovereignYields: Map<Currency, SovereignYield>;
  policyRates: Map<Currency, number>;
  ecoStrength: EcoStrengthRow[];
  strength: StrengthRow[];
  surprise: SurpriseIndex[];
  positioning: LegPositioning[];
  retail: RetailPositioning | null;
  history: ScoreSnapshot[];
  levels: LevelSet | null;
  news: NewsCluster[];
  searches: { query: string; hits: SearchHit[] }[];
  drivers: DriverReading[];
  droppedDrivers: string[];
  banks: BankCommunication[];
  risk: RiskGauge | null;
  health: SourceHealth[];
  cotReportDate: string | null;
  /**
   * The deterministic market state (lib/analysis/themes.ts) for this symbol,
   * printed first. Optional so a dossier still builds when the narrative
   * engine could not load.
   */
  narrative?: { pair: PairNarrative; state: MarketState } | null;
  /**
   * The user's open positions on this symbol, with their thesis check. Present
   * only for the passphrase holder: the public page's dossier never has them.
   */
  positions?: PositionView[];
}

export interface DossierSummary {
  symbol: string;
  label: string;
  generatedAtUtc: string;
  board: { total: number; bias: Bias; max: number; populated: number } | null;
  rates: { currency: Currency; rate: number | null; next: { dateUtc: string; consensus: number | null } | null }[];
  /** False when the decision calendar did not answer, so a missing `next` means unknown. */
  decisionCalendar: boolean;
  nextEvent: { name: string; currency: string; dateUtc: string; impact: string } | null;
  news: { clusters: number; newestUtc: string | null; searchHits: number };
  banks: { bank: string; title: string | null; publishedUtc: string | null; gap: string | null }[];
  gaps: string[];
}

export interface Dossier {
  text: string;
  summary: DossierSummary;
}

const DECISION = TRADINGVIEW.rateDecisions.publishAs;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Formatting — no `undefined`, no `NaN`, no float noise reaches the model
// ---------------------------------------------------------------------------

/** Decimals by magnitude, so EURUSD keeps five and the S&P keeps two. */
export function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  const abs = Math.abs(v);
  const dp = abs >= 1000 ? 2 : abs >= 20 ? 3 : abs >= 1 ? 5 : 6;
  return v.toFixed(dp);
}

export function fmtNum(v: number | null | undefined, dp = 2, unit = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  return `${Number(v.toFixed(dp))}${unit}`;
}

export function fmtSigned(v: number | null | undefined, dp = 0, unit = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  const s = Number(v.toFixed(dp));
  return `${s > 0 ? '+' : ''}${s}${unit}`;
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : 'n/a');

/** "35 min ago", "5 h ago", "3 d ago" — relative to the dossier's own clock. */
export function age(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function biasOf(total: number): Bias {
  return BIAS_THRESHOLDS.find((t) => total >= t.min)?.bias ?? 'Neutral';
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function boardSection(i: AnalysisInputs): string[] {
  const { row, def } = i;
  if (!row) return ['## 1. Board', 'This symbol produced no board row on this run — every score below is missing, not neutral.'];

  const out = [
    '## 1. Board (our deterministic score — the source of truth for "the board")',
    `Total ${fmtSigned(row.totalScore)} of a possible ±${maxScoreForKind(def.kind)} → ${row.bias}. Cuts: ≥+7 Very Bullish, ≥+4 Bullish, −3..+3 Neutral, ≤−4 Bearish, ≤−7 Very Bearish.`,
    `By category: ${Object.entries(row.categoryScores).map(([k, v]) => `${k} ${fmtSigned(v)}`).join(', ')}. ${row.populated} scoring cells complete${row.partial > 0 ? `, ${row.partial} built from one leg only` : ''}.`,
  ];

  for (const slot of SLOTS) {
    const cell = row.cells[slot.key];
    if (!cell) continue;
    const head = `- ${slot.label} [${slot.category}${slot.scoring ? '' : ', context only'}]: ${cell.cell === null ? 'blank' : fmtSigned(cell.cell)}${cell.stale ? ' (a leg is stale)' : ''}${cell.status === 'partial' ? ` (partial: ${cell.missingLeg ?? 'one leg'} missing)` : ''}`;
    out.push(head);
    if (cell.legs && cell.legs.length > 0) {
      for (const leg of cell.legs) {
        // An economy that publishes no such series (EUR has no payrolls) is a
        // fact about the column, not a reading — one line, not a row of n/a.
        if (leg.seriesName === null && leg.actual === null) {
          out.push(`    ${leg.currency}: publishes no such series, so this leg is 0 by construction`);
          continue;
        }
        const unit = leg.unit ?? '';
        out.push(
          `    ${leg.currency} ${leg.seriesName ?? '(no series)'}: actual ${fmtNum(leg.actual, 3, unit)} vs ${leg.referenceLabel} ${fmtNum(leg.reference, 3, unit)}` +
            `, previous ${fmtNum(leg.previous, 3, unit)}, released ${day(leg.dateUtc)}, leg ${leg.cell === null ? 'n/a' : fmtSigned(leg.cell)}`,
        );
      }
    } else if (cell.explanation) {
      out.push(`    ${cell.explanation.replace(/\s+/g, ' ').slice(0, 400)}`);
    }
    if (cell.note) out.push(`    note: ${cell.note.replace(/\s+/g, ' ').slice(0, 300)}`);
  }

  if (i.history.length > 1) {
    const sorted = [...i.history].sort((a, b) => a.capturedAtUtc.localeCompare(b.capturedAtUtc));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totals = sorted.map((s) => s.totalScore);
    const dayAgo = Date.parse(last.capturedAtUtc) - DAY_MS;
    const prior = [...sorted].reverse().find((s) => Date.parse(s.capturedAtUtc) <= dayAgo) ?? null;
    out.push(
      `Score path (stored boards): ${fmtSigned(first.totalScore)} on ${day(first.capturedAtUtc)} → ${fmtSigned(last.totalScore)} on ${day(last.capturedAtUtc)}; ` +
        `range ${fmtSigned(Math.min(...totals))}..${fmtSigned(Math.max(...totals))} over ${sorted.length} captures.` +
        (prior ? ` One day earlier (${prior.capturedAtUtc.slice(0, 16)}Z) it read ${fmtSigned(prior.totalScore)}.` : ''),
    );
  } else {
    out.push('Score path: fewer than two stored boards for this symbol, so no trajectory.');
  }
  return out;
}

function biasGapSection(i: AnalysisInputs): string[] {
  if (i.indexRows.length === 0) return [];
  const out = ['## 2. Each economy on its own (currency-index rows)'];
  for (const r of i.indexRows) {
    out.push(
      `- ${r.symbol} (${r.label}): ${fmtSigned(r.totalScore)} → ${r.bias}; ` +
        Object.entries(r.categoryScores).map(([k, v]) => `${k} ${fmtSigned(v)}`).join(', '),
    );
  }
  if (i.indexRows.length === 2) {
    const [a, b] = i.indexRows;
    out.push(`Gap ${a.symbol} − ${b.symbol}: ${fmtSigned(a.totalScore - b.totalScore)}.`);
  }
  return out;
}

function decisionsFor(currency: Currency, events: NormalizedEvent[], now: Date) {
  const iso = now.toISOString();
  const rows = events.filter((e) => e.name === DECISION && e.currency === currency).sort((a, b) => a.dateUtc.localeCompare(b.dateUtc));
  const last = [...rows].reverse().find((e) => e.dateUtc <= iso && e.actual !== null) ?? null;
  const next = rows.find((e) => e.dateUtc > iso && e.actual === null) ?? null;
  return { last, next };
}

/**
 * Whether the decision calendar answered at all on this run. It is fetched all
 * or nothing, so no decision rows means the SOURCE is down — not that no bank
 * meets. Saying "no next decision" in that case would tell the model there is
 * no meeting coming, which is false.
 */
export function hasDecisionCalendar(events: NormalizedEvent[]): boolean {
  return events.some((e) => e.name === DECISION);
}

function ratesSection(i: AnalysisInputs): string[] {
  const out = ['## 3. Rates and policy'];
  const calendar = hasDecisionCalendar(i.events);
  if (!calendar) {
    out.push('The central-bank decision calendar (TradingView) did not answer on this run, so past and next decision dates are UNKNOWN here — not absent. Use the official texts in section 11 and the headlines instead.');
  }
  for (const c of i.economies) {
    const rate = i.policyRates.get(c) ?? null;
    const y2 = i.sovereignYields.get(c) ?? null;
    const eco = i.ecoStrength.find((r) => r.currency === c) ?? null;
    const { last, next } = decisionsFor(c, i.events, i.now);
    const lastMove =
      last && last.actual !== null && last.previous !== null
        ? last.actual > last.previous ? 'hiked' : last.actual < last.previous ? 'cut' : 'held'
        : null;
    out.push(
      `- ${c}: standing policy rate ${fmtNum(rate, 2, '%')} (the rate the board reads)` +
        (last
          ? `; last decision on the TradingView calendar ${day(last.dateUtc)}: ${lastMove ?? 'set'} to ${fmtNum(last.actual, 2, '%')} from ${fmtNum(last.previous, 2, '%')}${c === 'EUR' ? " (the calendar's headline refinancing rate, not the deposit rate the board reads)" : ''}`
          : calendar ? '; no past decision on the calendar' : '') +
        (next
          ? `; next decision ${day(next.dateUtc)}, consensus ${next.consensus === null ? 'not published yet' : fmtNum(next.consensus, 2, '%')}`
          : calendar ? '; no next decision on the calendar' : '') +
        `; 2-year yield ${y2 ? `${fmtNum(y2.value, 2, '%')} (${y2.observedOn}, ${y2.source})` : 'n/a'}` +
        `; CPI ${fmtNum(eco?.cpiYoY, 2, '%')} → real policy rate ${fmtNum(eco?.realYield, 2, '%')}.`,
    );
  }
  if (i.economies.length === 2) {
    const [a, b] = i.economies;
    const ra = i.policyRates.get(a);
    const rb = i.policyRates.get(b);
    const ya = i.sovereignYields.get(a)?.value;
    const yb = i.sovereignYields.get(b)?.value;
    const ea = i.ecoStrength.find((r) => r.currency === a)?.realYield;
    const eb = i.ecoStrength.find((r) => r.currency === b)?.realYield;
    out.push(
      `Differentials ${a} − ${b}: policy ${ra !== undefined && rb !== undefined ? fmtSigned(ra - rb, 2, 'pp') : 'n/a'}` +
        `, 2-year ${ya !== undefined && yb !== undefined ? fmtSigned(ya - yb, 2, 'pp') : 'n/a'}` +
        `, real policy rate ${ea != null && eb != null ? fmtSigned(ea - eb, 2, 'pp') : 'n/a'}. Positive favours ${a}.`,
    );
  }
  out.push("The board's Interest Rates cell and its reasoning are in section 1.");
  return out;
}

function momentumSection(i: AnalysisInputs): string[] {
  const out = ['## 4. Macro momentum'];
  for (const c of i.economies) {
    const s = i.strength.find((r) => r.currency === c);
    const sx = i.surprise.find((r) => r.currency === c);
    const eco = i.ecoStrength.find((r) => r.currency === c);
    out.push(
      `- ${c}: surprise index ${sx?.index === null || sx?.index === undefined ? 'n/a' : `${fmtNum(sx.index, 0)}%`}` +
        (sx ? ` (${sx.beats} beat, ${sx.misses} missed, ${sx.inline} in line of ${sx.sampled})` : '') +
        `; own macro cells sum ${s ? fmtSigned(s.macroScore) : 'n/a'} (rank ${s?.rank ?? 'n/a'} of 8)` +
        `; GDP growth ${fmtNum(eco?.gdpGrowth, 2, '%')}, unemployment ${fmtNum(eco?.unemploymentRate, 2, '%')}` +
        (eco ? `; eco strength ${eco.bias} (${fmtNum(eco.totalScore, 1)}, ${eco.componentsScored}/4 components).` : '.'),
    );
  }
  return out;
}

function positioningSection(i: AnalysisInputs): string[] {
  const out = [`## 5. Positioning (CFTC report ${i.cotReportDate ?? 'date unknown'}; COT is surveyed Tuesday, published Friday)`];
  for (const p of i.positioning) {
    const who = p.currency ? `${p.currency} (${p.contract})` : p.contract;
    out.push(
      `- ${who}: ` +
        (p.cot
          ? `speculators ${fmtNum(p.cot.specLongPct, 1)}% long, net ${fmtNum(p.cot.net, 0)} contracts (week change ${fmtSigned(p.cot.netChange, 0)}), ${fmtNum(p.cot.percentile, 0)}th percentile of 3 years`
          : 'no COT reading') +
        (p.crowd ? `; CFTC small traders ${fmtNum(p.crowd.retailLongPct, 1)}% long${p.crowd.divergence ? ', on the opposite side to large speculators' : ''}` : '') +
        '.',
    );
  }
  if (i.retail) {
    out.push(
      `- Retail broker book for ${i.retail.symbol} (${i.retail.source}, ${i.retail.observedAt}): ${fmtNum(i.retail.longPct, 1)}% long. Read contrarian: ≥60% long is bearish, ≤40% bullish.`,
    );
  } else {
    out.push(`- No retail broker reading for ${i.def.symbol}.`);
  }
  return out;
}

function priceSection(i: AnalysisInputs): string[] {
  const t = i.technicals;
  if (!t) return ['## 6. Price context', 'No price history on this run.'];
  const vs = (label: string, v: number | null) => (v === null ? null : `${label} ${fmtPrice(v)} (${t.price >= v ? 'above' : 'below'})`);
  const month = i.now.getUTCMonth() + 1;
  const season = t.seasonality[month];
  return [
    '## 6. Price context (timing only — not the thesis)',
    `Price ${fmtPrice(t.price)}${i.row?.changePct !== null && i.row?.changePct !== undefined ? `, day change ${fmtSigned(i.row.changePct, 2, '%')}` : ''}.`,
    i.trend
      ? `Trend cell ${fmtSigned(i.trend.cell)}: 3-day vs 14-day average ${i.trend.crossover > 0 ? 'above' : 'below'} by ${fmtNum(i.trend.marginPct, 2, '%')}, slow average ${i.trend.slope > 0 ? 'rising' : 'falling'}${i.trend.nearFlip ? ', within a hair of flipping' : ''}.`
      : 'Trend: not computable.',
    [vs('SMA20', t.sma20), vs('SMA50', t.sma50), vs('SMA100', t.sma100), vs('SMA200', t.sma200)].filter(Boolean).join(', ') + '.',
    `Average daily move: ${fmtNum(t.avgDailyMove7Pct, 2, '%')} (7 sessions), ${fmtNum(t.avgDailyMove90Pct, 2, '%')} (90 sessions); realised volatility ${fmtNum(t.realizedVolPct, 1, '%')} annualised.`,
    season
      ? `Seasonality for this calendar month over ${season.years} years: mean ${fmtSigned(season.meanPct, 2, '%')}, up in ${fmtNum(season.winRatePct, 0)}% of years.`
      : 'Seasonality for this month: no history.',
  ];
}

function levelsSection(i: AnalysisInputs): string[] {
  const set = i.levels;
  if (!set || set.levels.length === 0) return ['## 7. Levels', 'No levels: not enough closed daily bars. Do not name any price level.'];
  const out = [
    '## 7. Levels (the ONLY prices you may name as zones; read off closed daily bars)',
    `Reference price ${fmtPrice(set.price)}${set.sessionInProgress ? ' (today\'s session is still trading and is excluded)' : ''}.`,
  ];
  for (const l of set.levels) {
    out.push(`- ${fmtPrice(l.price)}  ${l.label}${l.date ? ` (${l.date})` : ''}, ${fmtSigned(l.distancePct, 2, '%')} from price`);
  }
  return out;
}

function calendarSection(i: AnalysisInputs): string[] {
  const iso = i.now.toISOString();
  const horizon = new Date(i.now.getTime() + 7 * DAY_MS).toISOString();
  const since = new Date(i.now.getTime() - 3 * DAY_MS).toISOString();
  const mine = i.events.filter((e) => i.economies.includes(e.currency as Currency) && (e.impact === 'HIGH' || e.impact === 'MEDIUM'));

  const upcoming = mine
    .filter((e) => e.dateUtc > iso && e.dateUtc <= horizon && e.actual === null)
    .sort((a, b) => a.dateUtc.localeCompare(b.dateUtc))
    .slice(0, 25);
  const recent = mine
    .filter((e) => e.dateUtc <= iso && e.dateUtc >= since && e.actual !== null)
    .sort((a, b) => b.dateUtc.localeCompare(a.dateUtc))
    .slice(0, 20);

  const out = ['## 8. Calendar'];
  out.push(upcoming.length ? 'Next 7 days (HIGH/MEDIUM):' : 'Next 7 days: nothing HIGH or MEDIUM scheduled for these economies.');
  for (const e of upcoming) {
    const u = e.unit ?? '';
    out.push(`- ${e.dateUtc.slice(0, 16)}Z ${e.currency} ${e.name} [${e.impact}]: forecast ${fmtNum(e.consensus, 3, u)}, previous ${fmtNum(e.previous, 3, u)}`);
  }
  out.push(recent.length ? 'Last 72 hours (released):' : 'Last 72 hours: no HIGH/MEDIUM release for these economies.');
  for (const e of recent) {
    const u = e.unit ?? '';
    const surprise = e.actual !== null && e.consensus !== null ? `, surprise ${fmtSigned(e.actual - e.consensus, 3, u)}` : '';
    // Sigma and polarity, so "UR above forecast" reads as currency-NEGATIVE without the model having to know.
    const sigma = computeSurprise(e).sigma;
    const polarity = matchEventRule(e.name).polarity;
    const read =
      sigma === null ? '' : Math.abs(sigma) < 0.25 ? ` (${fmtSigned(sigma, 2)}σ, in line)` : ` (${fmtSigned(sigma, 2)}σ → ${sigma * polarity > 0 ? 'positive' : 'negative'} for ${e.currency})`;
    out.push(`- ${e.dateUtc.slice(0, 16)}Z ${e.currency} ${e.name}: actual ${fmtNum(e.actual, 3, u)} vs forecast ${fmtNum(e.consensus, 3, u)}${surprise}${read}, previous ${fmtNum(e.previous, 3, u)}`);
  }
  return out;
}

function newsSection(i: AnalysisInputs): string[] {
  const out = [
    '## 9. News (headlines, not articles — a headline is a claim about a story, not the story)',
  ];
  if (i.news.length === 0) out.push('No RSS headline in the last 48 hours touches these economies.');
  for (const c of i.news) {
    const lead = c.items[0];
    const summary = lead.summary ? ` — ${lead.summary.replace(/\s+/g, ' ').slice(0, 220)}` : '';
    out.push(`- [${age(c.lastSeenUtc, i.now)} · ${c.domainCount} source${c.domainCount === 1 ? '' : 's'} · ${c.category}] ${c.headline}${summary}`);
  }
  for (const s of i.searches) {
    out.push(`Search "${s.query}" (Google News, last 2 days): ${s.hits.length === 0 ? 'no results' : ''}`);
    for (const h of s.hits) out.push(`- [${age(h.publishedUtc, i.now)} · ${h.source || h.domain}] ${h.title}`);
  }
  return out;
}

function driversSection(i: AnalysisInputs): string[] {
  const out = ['## 10. Cross-asset drivers (price is data; the channel is background)'];
  if (i.risk) out.push(`Risk gauge: ${i.risk.label} (${fmtSigned(i.risk.score)} of ±6, ${i.risk.populated}/6 inputs).`);
  for (const d of i.drivers) {
    out.push(
      `- ${d.driver.label} (${d.driver.ticker}): ${d.driver.ticker.startsWith('^') && d.last !== null && d.last < 100 ? fmtNum(d.last, 2) : fmtPrice(d.last)} on ${d.date ?? 'n/a'}, 1 week ${fmtSigned(d.change1wPct, 2, '%')}, 1 month ${fmtSigned(d.change1mPct, 2, '%')}. Channel: ${d.driver.channel}.`,
    );
  }
  if (i.droppedDrivers.length > 0) out.push(`Unavailable this run: ${i.droppedDrivers.join(', ')}.`);
  return out;
}

function banksSection(i: AnalysisInputs): string[] {
  const out = ['## 11. Official communication (from each central bank\'s own feed)'];
  for (const b of i.banks) {
    if (b.gap) out.push(`- ${b.bank}: GAP — ${b.gap}.`);
    for (const d of b.documents) {
      out.push(`### ${b.bank} — ${d.title} (${day(d.publishedUtc)}, ${age(d.publishedUtc, i.now)})`);
      out.push(`Source: ${d.url}`);
      out.push(d.text ?? `Text not available: ${d.note ?? 'unknown reason'}. Use the title only.`);
    }
  }
  return out;
}

function gapsSection(i: AnalysisInputs): { lines: string[]; gaps: string[] } {
  const gaps = i.health.filter((h) => !h.ok).map((h) => `${h.source}${h.detail ? `: ${h.detail}` : ''}`);
  for (const b of i.banks) if (b.gap) gaps.push(`${b.bank}: ${b.gap}`);
  return {
    gaps,
    lines: ['## 12. Data gaps on this run', ...(gaps.length ? gaps.map((g) => `- ${g}`) : ['None reported.'])],
  };
}

// ---------------------------------------------------------------------------

export function buildDossier(i: AnalysisInputs): Dossier {
  const { lines: gapLines, gaps } = gapsSection(i);
  const header = [
    `# Dossier: ${i.def.symbol} (${i.def.label})`,
    `Built ${i.now.toISOString().slice(0, 16)}Z. Economies read: ${i.economies.join(', ')}.` +
      (i.def.base && i.def.quote ? ` A pair is base minus quote: good news for ${i.def.base} is bullish, for ${i.def.quote} bearish.` : ''),
  ];

  const positionText = (i.positions ?? []).flatMap(positionLines);
  const sections = [
    header,
    i.narrative ? narrativeLines(i.narrative.pair, i.narrative.state, { positionLines: positionText }) : positionText,
    boardSection(i),
    biasGapSection(i),
    ratesSection(i),
    momentumSection(i),
    positioningSection(i),
    priceSection(i),
    levelsSection(i),
    calendarSection(i),
    newsSection(i),
    driversSection(i),
    banksSection(i),
    gapLines,
  ].filter((s) => s.length > 0);

  const iso = i.now.toISOString();
  const next = i.events
    .filter((e) => i.economies.includes(e.currency as Currency) && e.impact === 'HIGH' && e.dateUtc > iso && e.actual === null)
    .sort((a, b) => a.dateUtc.localeCompare(b.dateUtc))[0];

  const summary: DossierSummary = {
    symbol: i.def.symbol,
    label: i.def.label,
    generatedAtUtc: iso,
    board: i.row
      ? { total: i.row.totalScore, bias: i.row.bias ?? biasOf(i.row.totalScore), max: maxScoreForKind(i.def.kind), populated: i.row.populated }
      : null,
    rates: i.economies.map((c) => {
      const { next: n } = decisionsFor(c, i.events, i.now);
      return { currency: c, rate: i.policyRates.get(c) ?? null, next: n ? { dateUtc: n.dateUtc, consensus: n.consensus } : null };
    }),
    decisionCalendar: hasDecisionCalendar(i.events),
    nextEvent: next ? { name: next.name, currency: next.currency, dateUtc: next.dateUtc, impact: next.impact } : null,
    news: {
      clusters: i.news.length,
      newestUtc: i.news.reduce<string | null>((m, c) => (m === null || c.lastSeenUtc > m ? c.lastSeenUtc : m), null),
      searchHits: i.searches.reduce((n, s) => n + s.hits.length, 0),
    },
    banks: i.banks.map((b) => ({
      bank: b.bank,
      title: b.documents[0]?.title ?? null,
      publishedUtc: b.documents[0]?.publishedUtc ?? null,
      gap: b.gap,
    })),
    gaps,
  };

  return { text: sections.map((s) => s.join('\n')).join('\n\n'), summary };
}
