/**
 * A1'S OWN ARITHMETIC, TABULATED RATHER THAN SOLVED FOR.
 *
 * Every earlier instrument in this repo compared OUR cell against A1's and
 * argued about the difference. This one never looks at our engine at all. It
 * takes A1's board as published — the eight currency-index rows and the FX pair
 * rows on the same capture — and asks what function of the index rows produces
 * the pair rows. Because an index row is a single currency, each of its cells IS
 * that currency's leg, undifferenced; so the pair rows are the only unknown and
 * the transform can be READ rather than inferred.
 *
 * WHY A TRUTH TABLE AND NOT A HIT RATE. A candidate transform scoring 23 of 28
 * tells you it is wrong and nothing else. Cross-tabulating A1's printed cell
 * against the (legA, legB) state it was printed in tells you what they actually
 * do in each state, and — more usefully — whether a state is DECIDED at all.
 * The trend rule was adopted and reverted in one day on a 67%-of-18 majority
 * (HARDENING.md 9); this script exists so that shape of mistake is visible
 * before it is made rather than after.
 *
 * SECTION 3 is the other half, and it is only possible under full access:
 * A1 publishes the ACTUAL and the FORECAST behind each economic leg on their
 * Economic Data pages. Those are captured under `fixtures/a1-full-access/` and
 * scored here against the legs their own board prints, so an economic rule is
 * tested end to end — input, rule, published leg — with no step inferred.
 *
 * NOTHING HERE READS `lib/scoring/`. A1's internal consistency is a fact about
 * A1, and it must stay measurable even while our engine is being changed.
 */

import fs from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join(process.cwd(), 'fixtures');
const FULL_ACCESS = path.join(FIXTURES, 'a1-full-access');

/** Their index-row name -> the currency whose leg that row carries. */
const INDEX_ROW: Record<string, string> = {
  'US-DOLLAR': 'USD', EURO: 'EUR', 'GB-POUND': 'GBP', 'JP-YEN': 'JPY',
  'CH-FRANC': 'CHF', 'CA-DOLLAR': 'CAD', 'AU-DOLLAR': 'AUD', 'NZ-DOLLAR': 'NZD',
};
const CURRENCIES = Object.values(INDEX_ROW);

/**
 * Columns A1 computes on the INSTRUMENT, not by differencing two currencies.
 *
 * Excluded from the pair-transform test rather than reported as failures: a
 * pair's 3/14 crossover is a property of that pair's own price series, and
 * "EURUSD trend != EUR trend - USD trend" is not a finding, it is the design.
 */
const PER_INSTRUMENT = new Set(['Trend', 'Seasonality', 'COT', 'Crowd']);

interface Board {
  label: string;
  columns: string[];
  /** symbol -> column -> cell */
  cells: Map<string, Map<string, number>>;
}

function loadBoards(): Board[] {
  const pattern = /^a1-top-setups-(\d{4}-\d{2}-\d{2})(?:-(\d{4}))?\.csv$/;
  return fs.readdirSync(FIXTURES)
    .map((file) => ({ file, m: pattern.exec(file) }))
    .filter((x): x is { file: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => `${a.m[1]}${a.m[2] ?? '0000'}`.localeCompare(`${b.m[1]}${b.m[2] ?? '0000'}`))
    .map(({ file, m }) => {
      const lines = fs.readFileSync(path.join(FIXTURES, file), 'utf8').trim().split(/\r?\n/);
      const head = lines[0].split(',');
      const columns = head.slice(3).filter((c) => c !== 'A1DayDelta');
      const cells = new Map<string, Map<string, number>>();
      for (const line of lines.slice(1)) {
        const v = line.split(',');
        const row = new Map<string, number>();
        head.forEach((h, i) => {
          if (i < 3 || h === 'A1DayDelta') return;
          const n = Number.parseInt(v[i], 10);
          if (Number.isFinite(n)) row.set(h, n);
        });
        cells.set(v[0], row);
      }
      const label = m[2] ? `${m[1]} ${m[2].slice(0, 2)}:${m[2].slice(2)}` : m[1];
      return { label, columns, cells };
    });
}

/** Every FX pair row on the board whose two legs both have an index row. */
function pairsOf(board: Board): { symbol: string; base: string; quote: string }[] {
  const out: { symbol: string; base: string; quote: string }[] = [];
  for (const symbol of board.cells.keys()) {
    if (symbol.length !== 6) continue;
    const base = symbol.slice(0, 3);
    const quote = symbol.slice(3);
    if (CURRENCIES.includes(base) && CURRENCIES.includes(quote)) out.push({ symbol, base, quote });
  }
  return out;
}

const clamp = (n: number) => Math.max(-2, Math.min(2, n));

const CANDIDATES: { name: string; f: (a: number, b: number) => number }[] = [
  { name: 'base - quote', f: (a, b) => clamp(a - b) },
  { name: 'quote - base', f: (a, b) => clamp(b - a) },
  { name: 'sign(base-quote)', f: (a, b) => Math.sign(a - b) },
  { name: 'base + quote', f: (a, b) => clamp(a + b) },
];

interface Observation { a: number; b: number; observed: number }

function legOf(board: Board, currency: string, column: string): number | undefined {
  const row = Object.entries(INDEX_ROW).find(([, c]) => c === currency)?.[0];
  return row ? board.cells.get(row)?.get(column) : undefined;
}

/** Section 1 + 2: what function of the two legs produces the pair cell. */
function pairTransform(boards: Board[]): void {
  const columns = boards[0].columns;

  console.log('\n=== 1. PAIR TRANSFORM — candidate fits, pooled over every capture ===\n');
  console.log(`captures: ${boards.map((b) => b.label).join('  |  ')}\n`);
  console.log(
    `${'COLUMN'.padEnd(14)}${'n'.padStart(4)}  ` +
    CANDIDATES.map((c) => c.name.padStart(17)).join('') + '   VERDICT',
  );

  const unresolved: string[] = [];
  const perColumn = new Map<string, Observation[]>();

  for (const column of columns) {
    if (PER_INSTRUMENT.has(column)) continue;
    const obs: Observation[] = [];
    for (const board of boards) {
      for (const { symbol, base, quote } of pairsOf(board)) {
        const a = legOf(board, base, column);
        const b = legOf(board, quote, column);
        const observed = board.cells.get(symbol)?.get(column);
        if (a === undefined || b === undefined || observed === undefined) continue;
        obs.push({ a, b, observed });
      }
    }
    perColumn.set(column, obs);

    const hits = CANDIDATES.map((c) => obs.filter((o) => c.f(o.a, o.b) === o.observed).length);
    const best = Math.max(...hits);
    const bestName = CANDIDATES[hits.indexOf(best)].name;
    const exact = best === obs.length;
    const verdict = exact ? `EXACT: ${bestName}` : `UNEXPLAINED (best ${bestName})`;
    if (!exact) unresolved.push(column);

    console.log(
      `${column.padEnd(14)}${String(obs.length).padStart(4)}  ` +
      hits.map((h) => `${h}/${obs.length}`.padStart(17)).join('') +
      `   ${verdict}`,
    );
  }

  console.log(`\nper-instrument columns excluded by design: ${[...PER_INSTRUMENT].join(', ')}`);
  console.log('  (a pair\'s trend/seasonality/COT/crowd is a property of that pair, not of its two legs)');

  if (!unresolved.length) return;

  console.log('\n=== 2. WHAT A1 ACTUALLY PRINTS, for the columns nothing explains ===\n');
  for (const column of unresolved) {
    const obs = perColumn.get(column)!;
    const byState = new Map<string, Map<number, number>>();
    for (const o of obs) {
      const key = `${o.a >= 0 ? '+' : ''}${o.a} , ${o.b >= 0 ? '+' : ''}${o.b}`;
      if (!byState.has(key)) byState.set(key, new Map());
      const dist = byState.get(key)!;
      dist.set(o.observed, (dist.get(o.observed) ?? 0) + 1);
    }
    console.log(`${column}:`);
    console.log(`  ${'legA , legB'.padEnd(14)}${'n'.padStart(4)}  ${'expected'.padStart(9)}   A1 prints`);
    for (const [state, dist] of [...byState.entries()].sort()) {
      const n = [...dist.values()].reduce((s, x) => s + x, 0);
      const [a, b] = state.split(' , ').map(Number);
      const top = [...dist.entries()].sort((x, y) => y[1] - x[1]);
      const share = top[0][1] / n;
      const decided = n >= 20 && share >= 0.6;
      const printed = top.map(([v, c]) => `${v >= 0 ? '+' : ''}${v}:${c}`).join('  ');
      const mark = n < 20 ? 'thin' : decided ? '' : 'UNDECIDED';
      console.log(
        `  ${state.padEnd(14)}${String(n).padStart(4)}  ` +
        `${(clamp(a - b) >= 0 ? '+' : '') + clamp(a - b)}`.padStart(9) +
        `   ${printed}  ${mark}`,
      );
    }
    const range = obs.map((o) => o.observed);
    console.log(`  observed range: ${Math.min(...range)} .. ${Math.max(...range)}\n`);
  }
}

/** Section 0: is the printed score the plain sum of the printed columns? */
function aggregation(boards: Board[]): void {
  console.log('\n=== 0. AGGREGATION — is the score a plain unweighted sum? ===\n');
  for (const board of boards) {
    const lines = fs.readdirSync(FIXTURES); // touched only to keep the loader honest
    void lines;
    let rows = 0;
    let sumOk = 0;
    let bandOk = 0;
    const raw = board.cells;
    for (const [symbol, cells] of raw) {
      const score = scoreOf(board, symbol);
      if (score === undefined) continue;
      rows++;
      const sum = board.columns.reduce((s, c) => s + (cells.get(c) ?? 0), 0);
      if (sum === score) sumOk++;
      if (biasOf(board, symbol) === bandLabel(score)) bandOk++;
    }
    console.log(
      `  ${board.label.padEnd(18)} score == sum(columns) ${String(sumOk).padStart(3)}/${rows}` +
      `   bias == +-4/+-7 bands ${String(bandOk).padStart(3)}/${rows}`,
    );
  }
}

/** Score and bias live outside `columns`, so they are re-read from the file. */
const scoreCache = new Map<string, Map<string, { score: number; bias: string }>>();
function meta(board: Board): Map<string, { score: number; bias: string }> {
  if (scoreCache.has(board.label)) return scoreCache.get(board.label)!;
  const file = fs.readdirSync(FIXTURES).find((f) => {
    const m = /^a1-top-setups-(\d{4}-\d{2}-\d{2})(?:-(\d{4}))?\.csv$/.exec(f);
    if (!m) return false;
    const label = m[2] ? `${m[1]} ${m[2].slice(0, 2)}:${m[2].slice(2)}` : m[1];
    return label === board.label;
  })!;
  const lines = fs.readFileSync(path.join(FIXTURES, file), 'utf8').trim().split(/\r?\n/);
  const out = new Map<string, { score: number; bias: string }>();
  for (const line of lines.slice(1)) {
    const v = line.split(',');
    out.set(v[0], { score: Number.parseInt(v[2], 10), bias: v[1] });
  }
  scoreCache.set(board.label, out);
  return out;
}
const scoreOf = (b: Board, s: string) => meta(b).get(s)?.score;
const biasOf = (b: Board, s: string) => meta(b).get(s)?.bias;
const bandLabel = (n: number) =>
  n >= 7 ? 'Very Bullish' : n >= 4 ? 'Bullish' : n <= -7 ? 'Very Bearish' : n <= -4 ? 'Bearish' : 'Neutral';

/**
 * Section 3: their published inputs, scored against their published legs.
 *
 * Each file is one metric page captured off Economic Data. `idx` is that
 * currency's own release order — the pages do NOT share a month grid, and
 * several series are quarterly — so only the LAST row is comparable across
 * currencies, which is exactly the row the board is scoring today.
 */
interface MetricFile { file: string; column: string; title: string }
const METRICS: MetricFile[] = [
  { file: 'econ-cpi-yoy-2026-09-02-0905.csv', column: 'CPI', title: 'CPI YoY' },
  { file: 'econ-ppi-yoy-2026-09-02-0910.csv', column: 'PPI', title: 'PPI YoY' },
  { file: 'econ-consumer-confidence-2026-09-02-0920.csv', column: 'CnsmrConf', title: 'Consumer Confidence' },
];

function readMetric(file: string): Map<string, { actual: number; forecast: number | null; prev: number | null }> {
  const lines = fs.readFileSync(path.join(FULL_ACCESS, file), 'utf8')
    .split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const head = lines[0].split(',');
  const iActual = head.indexOf('actual');
  const buckets = ['met', 'lower', 'higher'].map((b) => head.indexOf(b));
  const iForecast = head.indexOf('forecast');
  const last = new Map<string, { actual: number; forecast: number | null; prev: number | null }>();
  const previous = new Map<string, number | null>();
  for (const line of lines.slice(1)) {
    const v = line.split(',');
    const cur = v[0];
    const actual = iActual >= 0
      ? Number.parseFloat(v[iActual])
      : Number.parseFloat(buckets.map((i) => v[i]).find((x) => x !== '') ?? 'NaN');
    if (!Number.isFinite(actual)) continue;
    const f = v[iForecast];
    // PREVIOUS ROW, and deliberately not "previous DISTINCT print".
    //
    // The refinement was tried and withdrawn the same hour. Their pages
    // forward-fill quarterly series, so a repeat can be a fill or a genuine
    // unchanged release, and the two observations that bear on it CONTRADICT
    // each other: CHF PPI ends -1.80, -2.10, -2.10 and A1 scores it 0, which
    // needs the previous ROW; NZD consumer confidence ends 94.7, 80.4, 80.4 and
    // A1 scores it -1, which needs the previous DISTINCT print. One observation
    // each, pointing opposite ways. Previous-row is kept because it is the
    // simpler rule and the one that fits PPI 8/8; the disagreement is reported
    // rather than resolved. See HARDENING.md 9 on fitting to a thin majority.
    previous.set(cur, last.get(cur)?.actual ?? null);
    last.set(cur, { actual, forecast: f === '' ? null : Number.parseFloat(f), prev: previous.get(cur) ?? null });
  }
  return last;
}

/**
 * The leg vector their PAIR rows imply, by exhaustive search over {-2..2}^8.
 *
 * Needed because on some columns A1's index rows are BLANK where their pair
 * rows carry a value -- consumer confidence is the case that motivated it, with
 * the index row printing 0 for six of eight currencies while the pair rows fit a
 * leg vector exactly. Comparing a rule only against the index rows would have
 * called that rule wrong when it was their index row that was empty.
 */
function solveLegsFromPairs(board: Board, column: string): { legs: Record<string, number>; fit: number; of: number; negated: boolean } | null {
  const eqs = pairsOf(board)
    .map(({ symbol, base, quote }) => ({ base, quote, cell: board.cells.get(symbol)?.get(column) }))
    .filter((e): e is { base: string; quote: string; cell: number } => e.cell !== undefined);
  if (!eqs.length) return null;

  const values = [-2, -1, 0, 1, 2];
  let best: { legs: Record<string, number>; fit: number } | null = null;
  const vec = new Array<number>(CURRENCIES.length).fill(0);
  const recurse = (i: number): void => {
    if (i === CURRENCIES.length) {
      const legs: Record<string, number> = {};
      CURRENCIES.forEach((c, k) => { legs[c] = vec[k]; });
      let fit = 0;
      for (const e of eqs) if (clamp(legs[e.base] - legs[e.quote]) === e.cell) fit++;
      if (!best || fit > best.fit) best = { legs: { ...legs }, fit };
      return;
    }
    for (const v of values) { vec[i] = v; recurse(i + 1); }
  };
  recurse(0);
  if (!best) return null;

  // ANCHOR IT. Differencing determines the vector only up to an additive
  // constant -- add 1 to every leg and every pair cell is unchanged -- so the
  // raw search result is offset by whatever the enumeration happened to reach
  // first. Shift it to the offset that best matches the index rows, which are
  // the same legs published undifferenced; where a column's index rows are
  // blank the surviving non-blank ones still pin it.
  const solved = (best as { legs: Record<string, number>; fit: number }).legs;

  // ANCHOR IT, AND ALLOW THE NEGATION.
  //
  // Differencing determines the vector only up to an additive constant -- add 1
  // to every leg and every pair cell is unchanged -- so the raw search result is
  // offset by whatever the enumeration reached first. Worse, a column whose pair
  // rows are the NEGATION of its legs (PPI) fits just as exactly, so the sign is
  // undetermined too. Both are resolved the same way: score every offset of the
  // vector AND of its negation against the index rows, and keep the best.
  //
  // Only NON-ZERO index legs are used as anchors. A column whose index rows are
  // mostly blank -- consumer confidence prints 0 for six of eight -- would
  // otherwise anchor onto the blanks and reproduce the blank vector, which is
  // precisely the thing being tested. Zero carries no information here: it is
  // equally "scored neutral" and "not scored at all".
  const anchors = CURRENCIES.filter((c) => (legOf(board, c, column) ?? 0) !== 0);
  const against = anchors.length ? anchors : CURRENCIES;

  let shifted = solved;
  let negated = false;
  let bestAgreement = -1;
  for (const sign of [1, -1]) {
    for (const offset of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const candidate: Record<string, number> = {};
      for (const c of CURRENCIES) candidate[c] = sign * solved[c] + offset;
      let agreement = 0;
      for (const c of against) if (legOf(board, c, column) === candidate[c]) agreement++;
      if (agreement > bestAgreement) { bestAgreement = agreement; shifted = candidate; negated = sign === -1; }
    }
  }
  return { legs: shifted, fit: (best as { fit: number }).fit, of: eqs.length, negated };
}

function economicRules(boards: Board[]): void {
  const board = boards[boards.length - 1];
  console.log(`\n=== 3. ECONOMIC LEG RULE — their published inputs vs their published legs (${board.label}) ===\n`);
  console.log('rule: sign(actual - forecast); where the series carries no forecast, sign(actual - previous)\n');

  for (const { file, column, title } of METRICS) {
    if (!fs.existsSync(path.join(FULL_ACCESS, file))) {
      console.log(`  ${title.padEnd(22)} SKIPPED — ${file} not captured`);
      continue;
    }
    const data = readMetric(file);
    let ok = 0;
    let n = 0;
    const misses: string[] = [];
    for (const [row, cur] of Object.entries(INDEX_ROW)) {
      const d = data.get(cur);
      const a1 = board.cells.get(row)?.get(column);
      if (!d || a1 === undefined) continue;
      n++;
      const ref = d.forecast ?? d.prev;
      if (ref === null) continue;
      const rule = Math.sign(Number((d.actual - ref).toFixed(6)));
      if (rule === a1) ok++;
      else misses.push(`${cur} rule ${rule >= 0 ? '+' : ''}${rule} vs index row ${a1 >= 0 ? '+' : ''}${a1}` +
        ` (actual ${d.actual} vs ${d.forecast !== null ? `forecast ${d.forecast}` : `previous ${d.prev}`})`);
    }

    // Their pair rows are a second, independent publication of the same legs.
    const solved = solveLegsFromPairs(board, column);
    let pairOk = 0;
    let pairNeg = 0;
    let pairN = 0;
    if (solved) {
      for (const cur of CURRENCIES) {
        const d = data.get(cur);
        if (!d) continue;
        const ref = d.forecast ?? d.prev;
        if (ref === null) continue;
        pairN++;
        const rule = Math.sign(Number((d.actual - ref).toFixed(6)));
        if (rule === solved.legs[cur]) pairOk++;
        // Reported alongside because a negated fit is not a failed fit -- it is
        // the PPI finding, and a column that only matches negated says so here.
        if (rule === -solved.legs[cur]) pairNeg++;
      }
    }

    const verdict = ok === n ? 'CONFIRMED on this capture' : `${n - ok} differ from the index row`;
    console.log(
      `  ${title.padEnd(22)} vs index rows ${String(ok).padStart(2)}/${n}` +
      (solved
        ? `   vs pair-solved legs ${String(pairOk).padStart(2)}/${pairN}` +
          (solved.negated ? ' [their pair rows are the NEGATION of these legs]' : '') +
          (pairNeg > pairOk ? ` (matches negated ${pairNeg}/${pairN})` : '') +
          ` [solve fits ${solved.fit}/${solved.of}]`
        : '') +
      `   ${verdict}`,
    );
    for (const m of misses) console.log(`      ${m}`);
  }
}

const boards = loadBoards();
if (!boards.length) {
  console.error('no a1-top-setups-*.csv captures in fixtures/');
  process.exit(1);
}
aggregation(boards);
pairTransform(boards);
economicRules(boards);
console.log('');
