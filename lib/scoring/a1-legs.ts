/**
 * Solves A1's per-currency macro legs out of their published board, and names
 * every transcribed cell that contradicts the rest.
 *
 * WHY THIS EXISTS. `fixtures/a1-board.json` records, at length, that the row
 * sum check is "necessary and NOT sufficient": it catches one misread cell and
 * is blind to two that cancel, and eighteen columns give it plenty of room. A
 * row that passed it was once believed, drove a real change to the GBP producer
 * price series, and moved TOTAL ABS GAP from 80 to 90 — every sterling pair
 * further from their board. That file asks for a second check. This is it, and
 * unlike the sum it is exact rather than heuristic.
 *
 * THE INSIGHT. Most columns are LEG-DIFFERENCED: a pair cell is `base - quote`
 * over two per-currency legs, each in {-1,0,+1}, and a single-economy row's cell
 * IS one currency's leg. So every captured row is an equation over the same
 * eight unknowns, and fifty-one rows against eight currencies is enormously
 * over-determined. Redundancy that would otherwise be wasted becomes an error
 * detector: a column where one row disagrees with the rest is a misread, and the
 * disagreement names the cell.
 *
 * It pays a second dividend. The solution IS A1's macro leg vector per currency
 * — the same quantity `npm run legs` prints for us. Comparing those two tables
 * is a direct reading of both models at the level where a fix is actually made:
 * a wrong leg is not a wrong row, it is a wrong column in every row that
 * currency appears in, sign-flipped by side.
 *
 * AND IT IS NOT CONFOUNDED BY THE CLOCK. `scripts/parity.ts` warns that their
 * board moved 29 points across 22 symbols between two frames of the same day, so
 * roughly a third of any measured gap is WHEN the frame was taken. A pinned leg
 * is a fact about their model rather than about the hour — every row in the
 * capture was read off one screen at one instant, so the algebra holds whatever
 * that instant was.
 *
 * WHAT IT DOES NOT CLAIM.
 *   - Where several leg assignments explain the rows equally well the answer is
 *     reported AMBIGUOUS rather than resolved by an arbitrary tie-break.
 *   - A row is only accused when it disagrees under EVERY optimal assignment.
 *     Blaming a cell for losing a coin-flip is how a good check starts producing
 *     confident bad evidence, which is the failure it exists to prevent.
 *   - Constraints that pass through `macroPolarity` (gold reading a US print
 *     inverted, and so on) are marked `assumed` and reported in a SECOND TIER,
 *     because they are conditional on our polarity table being a correct model
 *     of theirs. A contradiction there may be our polarity, not their cell.
 */

import { PAIR_CELL_MAX, SCORING_SLOTS, type SlotDefinition } from '@/config/setups.config';
import { ALL_SYMBOLS, type MacroCategory, type SymbolDefinition } from '@/config/symbols.config';
import { CURRENCIES, type Currency } from '@/lib/types';

/** A single currency's contribution to one column. Always ternary. */
export type Leg = -1 | 0 | 1;

const LEG_VALUES: readonly Leg[] = [-1, 0, 1] as const;

/** One captured board row: slot key -> the -2..+2 cell read off their screen. */
export type CapturedCells = Record<string, number>;

/**
 * `cell = clamp(sum of coef*leg, +/-bound)` for one captured cell.
 *
 * The clamp is carried rather than assumed away because exactly one column
 * needs it — see `crowd` in `equationFor`.
 */
export interface Equation {
  symbol: string;
  slotKey: string;
  value: number;
  terms: { currency: Currency; coef: number }[];
  bound: number;
  /**
   * True when a coefficient came from `macroPolarity`. Such a constraint tests
   * our polarity table as much as it tests their cell, so contradictions among
   * these are reported separately and are never grounds for editing a capture.
   */
  assumed: boolean;
}

export interface Conflict {
  symbol: string;
  slotKey: string;
  /** What the capture says. */
  transcribed: number;
  /** What the solved legs say it must be. Null when the optima disagree. */
  implied: number | null;
  assumed: boolean;
  detail: string;
}

export interface SolvedColumn {
  slotKey: string;
  label: string;
  /** Absent for a currency no row constrained. */
  legs: Partial<Record<Currency, Leg>>;
  /** Currencies whose leg several equally-good solutions disagree about. */
  ambiguous: Currency[];
  equations: number;
  satisfied: number;
  /**
   * False when NO leg assignment explains every row — the column contradicts
   * itself and at least one of its cells is misread.
   *
   * This is the headline result, and it must be read BEFORE `conflicts`. A
   * contradiction usually implicates two rows symmetrically, and neither can be
   * blamed under every best fit, so `conflicts` is frequently EMPTY on a column
   * that is definitively broken. Reporting only `conflicts` would silently
   * downgrade "these rows cannot both be right" to "this leg is ambiguous",
   * which is how the finding gets lost.
   */
  satisfiable: boolean;
  /** Rows wrong under EVERY best fit. Individually condemned. */
  conflicts: Conflict[];
  /**
   * Rows whose removal alone restores a perfect fit — the minimal suspects.
   *
   * A contradiction implicates at least two rows, and dropping both destroys
   * good data along with bad. This narrows "some cell in this column is wrong"
   * to "one of these two, and one more row of that currency decides which",
   * which is a re-read someone can actually perform.
   */
  suspects: string[];
}

export interface SolveResult {
  columns: SolvedColumn[];
  /** Per currency, the solved leg for every column that determined one. */
  legs: Map<Currency, Partial<Record<string, Leg>>>;
  /** Sum of the solved legs — directly comparable to `npm run legs`. */
  macroTotals: Map<Currency, number>;
  /**
   * Columns no leg assignment can explain. THE HEADLINE RESULT — read this
   * before `conflicts`, which is often empty on a column that is definitively
   * broken. See `SolvedColumn.satisfiable`.
   */
  contradicted: SolvedColumn[];
  /** Contradictions among fx and currency-index rows only. Trustworthy. */
  conflicts: Conflict[];
  /** Contradictions that pass through `macroPolarity`. Weaker evidence. */
  assumedConflicts: Conflict[];
}

/**
 * Columns the leg algebra cannot speak to, and why.
 *
 * `trend` and `seasonality` are properties of ONE symbol's price series —
 * GBPJPY's own 3/14 SMA cross, GBPJPY's own ten Augusts. They are never
 * differenced out of two currencies, so there is no equation to write. They are
 * still bounds-checked in `checkBounds`; they are just not solvable.
 */
const UNSOLVABLE_SLOTS = new Set(['trend', 'seasonality']);

type RowShape = 'fx' | 'currency-index' | 'asset';

function shapeOf(def: SymbolDefinition): RowShape {
  if (def.base && def.quote) return 'fx';
  if (def.kind === 'currency' && def.macroEconomy) return 'currency-index';
  return 'asset';
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * The equation one captured cell contributes, or null when that row does not
 * constrain that column.
 *
 * Every exclusion below mirrors a branch in `buildSetupsMatrix`. They are not
 * defensive guesses — a row excluded here has a cell that is a DIFFERENT
 * QUANTITY from a currency leg, so including it would not merely add noise, it
 * would drag the solution toward the answer to another question.
 */
function equationFor(
  def: SymbolDefinition,
  slot: SlotDefinition,
  value: number,
): Equation | null {
  const shape = shapeOf(def);
  const single = (currency: Currency, coef: number, bound: number, assumed: boolean): Equation => ({
    symbol: def.symbol,
    slotKey: slot.key,
    value,
    terms: [{ currency, coef }],
    bound,
    assumed,
  });
  const differenced = (bound: number): Equation => ({
    symbol: def.symbol,
    slotKey: slot.key,
    value,
    terms: [
      { currency: def.base as Currency, coef: 1 },
      { currency: def.quote as Currency, coef: -1 },
    ],
    bound,
    assumed: false,
  });

  if (slot.key === 'cot') {
    /**
     * FX PAIRS ONLY. A standalone row with its own contract takes
     * `scoreCot(series, 'asset')` — net positioning PLUS the weekly change,
     * bounded +/-2 — while a pair differences two legs carrying the weekly
     * change alone. Those are different numbers, and the currency-index rows sit
     * on the asset side of that split: see the comment defending it in
     * `lib/scoring/setups.ts`, which cites their US-DOLLAR card. Feeding an
     * asset-rule cell into a leg solve would corrupt the column it looks most
     * helpful for.
     */
    return shape === 'fx' ? differenced(slot.maxCell ?? PAIR_CELL_MAX) : null;
  }

  if (slot.key === 'crowd') {
    /**
     * THE ONE COLUMN THAT CLAMPS. `combinePairCells` is called with
     * `slot.maxCell = 1` here, so a pair whose legs are +1 and -1 reads +1 and
     * not +2. Every other differenced column is bounded at 2, which its legs
     * cannot exceed, so the clamp is inert everywhere else. It makes this column
     * LOSSY rather than useless: a +1 cell no longer distinguishes (+1,0) from
     * (+1,-1), so it constrains less than the others but still constrains.
     *
     * A standalone asset's crowd cell is that CONTRACT's retail positioning —
     * gold's own longs, not the dollar's — so assets are excluded. A currency
     * index reads `scoreCrowd` on that currency's own contract, which is exactly
     * the leg, so it stays.
     */
    if (shape === 'fx') return differenced(slot.maxCell ?? 1);
    if (shape === 'currency-index') return single(def.macroEconomy as Currency, 1, 1, false);
    return null;
  }

  if (slot.key === 'rates') {
    /**
     * DXY IS EXCLUDED AND IT IS NOT THE ONLY ONE. Its rate cell is
     * `-scoreYield2y(...)` — the US 2-year against its own 21-day average,
     * negated for the dollar's side — not USD's rate-expectation leg. Every
     * other single-economy row reads that same 2-year un-negated, which is the
     * same not-a-leg quantity, so commodities, indices and crypto are out too.
     */
    if (shape === 'fx') return differenced(PAIR_CELL_MAX);
    if (shape === 'currency-index' && def.symbol !== 'DXY') {
      return single(def.macroEconomy as Currency, 1, 1, false);
    }
    return null;
  }

  if (slot.kind !== 'economic') return null;

  if (shape === 'fx') return differenced(PAIR_CELL_MAX);
  if (shape === 'currency-index') return single(def.macroEconomy as Currency, 1, 1, false);

  /**
   * An asset reads ONE economy through its own polarity table: a cooler US print
   * is -1 for the dollar and +1 for gold. The coefficient is that polarity and
   * the leg underneath is still USD's — but the table is OUR reading of their
   * model, so the constraint is marked `assumed`.
   */
  if (!def.macroEconomy) return null;
  const polarity = def.macroPolarity?.[slot.category as MacroCategory] ?? 1;
  return single(def.macroEconomy, polarity, 1, def.macroPolarity !== undefined);
}

/** What a solved leg assignment predicts for one cell, plus which currencies it rests on. */
export interface Prediction {
  value: number;
  currencies: Currency[];
}

/**
 * The value a SOLVED leg assignment predicts for one (symbol, column) cell —
 * the same equation `equationFor` builds for the row-sum solve, evaluated
 * against legs that solve already pinned rather than against a hypothesis.
 *
 * Null two ways, and callers should not conflate them: the column has no
 * equation for this row's shape (`equationFor` returned null — trend and
 * seasonality are never leg-differenced, see `UNSOLVABLE_SLOTS`), or the
 * equation needs a currency's leg that the solve left unpinned (missing from
 * `legs`, or ambiguous — `SolvedColumn.ambiguous` already says which).
 */
export function predictCell(
  def: SymbolDefinition,
  slot: SlotDefinition,
  legs: Map<Currency, Partial<Record<string, Leg>>>,
): Prediction | null {
  const equation = equationFor(def, slot, 0);
  if (!equation) return null;

  let sum = 0;
  const currencies: Currency[] = [];
  for (const term of equation.terms) {
    const leg = legs.get(term.currency)?.[slot.key];
    if (leg === undefined) return null;
    sum += term.coef * leg;
    currencies.push(term.currency);
  }
  return { value: Math.max(-equation.bound, Math.min(equation.bound, sum)), currencies };
}

function evaluate(equation: Equation, assignment: Map<Currency, Leg>): number {
  let sum = 0;
  for (const term of equation.terms) {
    sum += term.coef * (assignment.get(term.currency) ?? 0);
  }
  return Math.max(-equation.bound, Math.min(equation.bound, sum));
}

interface Optimum {
  assignment: Map<Currency, Leg>;
  satisfied: number;
}

/**
 * Brute force over every ternary assignment of the participating currencies.
 *
 * At most nine currencies appear (eight majors plus ZAR), so the search is
 * 3^9 = 19,683 candidates against ~51 equations per column — microseconds, and
 * exhaustive. A propagating solver would be faster and would trade away the one
 * property that matters here: that "no better explanation exists" is a fact
 * rather than a hope.
 */
function bestFits(equations: Equation[], participants: Currency[]): Optimum[] {
  let best = -1;
  let optima: Optimum[] = [];

  const assignment = new Map<Currency, Leg>();
  const walk = (index: number) => {
    if (index === participants.length) {
      let satisfied = 0;
      for (const equation of equations) {
        if (evaluate(equation, assignment) === equation.value) satisfied++;
      }
      if (satisfied > best) {
        best = satisfied;
        optima = [{ assignment: new Map(assignment), satisfied }];
      } else if (satisfied === best) {
        optima.push({ assignment: new Map(assignment), satisfied });
      }
      return;
    }
    for (const value of LEG_VALUES) {
      assignment.set(participants[index], value);
      walk(index + 1);
    }
  };
  if (participants.length > 0) walk(0);
  return optima;
}

function participantsOf(equations: Equation[]): Currency[] {
  const set = new Set(equations.flatMap((e) => e.terms.map((t) => t.currency)));
  return [...set].sort((a, b) => CURRENCIES.indexOf(a) - CURRENCIES.indexOf(b));
}

/**
 * Rows whose removal alone makes the column perfectly satisfiable.
 *
 * Searched over rows rejected by AT LEAST ONE best fit, not by all of them. The
 * usual shape of a contradiction is two rows that cannot both hold — CADX says
 * CAD's leg is 0, CADCHF says CAD minus CHF is -2 — and every best fit keeps one
 * and drops the other. Neither is condemned under all of them, so restricting
 * this search to unanimously-rejected rows finds nothing and the whole
 * contradiction disappears into an "ambiguous" leg.
 */
function findSuspects(equations: Equation[], optima: Optimum[]): string[] {
  const rejected = new Set<string>();
  for (const optimum of optima) {
    for (const equation of equations) {
      if (evaluate(equation, optimum.assignment) !== equation.value) rejected.add(equation.symbol);
    }
  }

  const suspects: string[] = [];
  for (const symbol of rejected) {
    const without = equations.filter((e) => e.symbol !== symbol);
    const fits = bestFits(without, participantsOf(without));
    if (fits.length > 0 && fits[0].satisfied === without.length) suspects.push(symbol);
  }
  return suspects.sort();
}

function solveColumn(slot: SlotDefinition, equations: Equation[]): SolvedColumn {
  const participants = participantsOf(equations);
  const optima = bestFits(equations, participants);

  // A leg is only reported when EVERY optimal assignment agrees on it.
  const legs: Partial<Record<Currency, Leg>> = {};
  const ambiguous: Currency[] = [];
  for (const currency of participants) {
    const values = new Set(optima.map((o) => o.assignment.get(currency)));
    if (values.size === 1) legs[currency] = optima[0].assignment.get(currency);
    else ambiguous.push(currency);
  }

  /**
   * Only accuse a cell that is wrong under EVERY optimal assignment. A row one
   * tie-breaking solution happens to dislike has not been shown to be misread,
   * and reporting it would turn this check into exactly the confident-and-wrong
   * evidence it exists to prevent.
   */
  const conflicts: Conflict[] = [];
  for (const equation of equations) {
    const implied = new Set(optima.map((o) => evaluate(equation, o.assignment)));
    if (implied.has(equation.value)) continue;
    const shown = implied.size === 1 ? [...implied][0] : null;
    const legText = equation.terms
      .map((t) => `${t.coef < 0 ? '-' : '+'}${t.coef === 1 || t.coef === -1 ? '' : `${Math.abs(t.coef)}x`}${t.currency}`)
      .join(' ');
    conflicts.push({
      symbol: equation.symbol,
      slotKey: equation.slotKey,
      transcribed: equation.value,
      implied: shown,
      assumed: equation.assumed,
      detail:
        shown === null
          ? `${legText} cannot produce ${signed(equation.value)} under any best fit`
          : `${legText} implies ${signed(shown)}, capture says ${signed(equation.value)}`,
    });
  }

  const satisfied = optima.length > 0 ? optima[0].satisfied : 0;
  const satisfiable = satisfied === equations.length;

  return {
    slotKey: slot.key,
    label: slot.label,
    legs,
    ambiguous,
    equations: equations.length,
    satisfied,
    satisfiable,
    conflicts,
    suspects: satisfiable ? [] : findSuspects(equations, optima),
  };
}

/**
 * Solves every solvable column of a set of captured rows.
 *
 * `rows` is keyed by OUR symbol name — the same keys `fixtures/a1-board.json`
 * uses, with their names already mapped in each capture's note.
 */
export function solveA1Legs(rows: Record<string, CapturedCells>): SolveResult {
  const bySymbol = new Map(ALL_SYMBOLS.map((d) => [d.symbol, d]));
  const columns: SolvedColumn[] = [];

  for (const slot of SCORING_SLOTS) {
    if (UNSOLVABLE_SLOTS.has(slot.key)) continue;

    const equations: Equation[] = [];
    for (const [symbol, cells] of Object.entries(rows)) {
      const def = bySymbol.get(symbol);
      const value = cells[slot.key];
      if (!def || value === undefined || value === null) continue;
      const equation = equationFor(def, slot, value);
      if (equation) equations.push(equation);
    }
    if (equations.length === 0) continue;
    columns.push(solveColumn(slot, equations));
  }

  const legs = new Map<Currency, Partial<Record<string, Leg>>>();
  const macroTotals = new Map<Currency, number>();
  for (const column of columns) {
    for (const [currency, leg] of Object.entries(column.legs) as [Currency, Leg][]) {
      const row = legs.get(currency) ?? {};
      row[column.slotKey] = leg;
      legs.set(currency, row);
      macroTotals.set(currency, (macroTotals.get(currency) ?? 0) + leg);
    }
  }

  const all = columns.flatMap((c) => c.conflicts);
  return {
    columns,
    legs,
    macroTotals,
    contradicted: columns.filter((c) => !c.satisfiable),
    conflicts: all.filter((c) => !c.assumed),
    assumedConflicts: all.filter((c) => c.assumed),
  };
}

/** One capture: every row read off ONE screen at ONE instant. */
export interface DatedCapture {
  /** ISO date the capture was taken. */
  date: string;
  rows: Record<string, CapturedCells>;
}

/**
 * Solve each capture on its own, and make merging two of them a type error.
 *
 * WHY THIS EXISTS AS A FUNCTION RATHER THAN A CONVENTION. A leg is not a
 * constant. A1's board moves day to day, so `{...capture24, ...capture25}` is
 * not "more evidence" — it is one currency's Monday leg and its Tuesday leg
 * asserted simultaneously, which makes a column unsatisfiable and then names an
 * innocent cell as the suspect. That merge has been made in this project before
 * and cost a round. Callers used to hold the discipline by hand, passing
 * `cells24` and `cells25` to two separate `solveA1Legs` calls; this turns the
 * discipline into the only shape available.
 *
 * A DUPLICATE DATE IS REFUSED OUTRIGHT. Two captures claiming the same date are
 * either the same screen recorded twice or a date that was guessed, and both
 * want a human rather than a silent last-write-wins.
 */
export function solvePerCapture(captures: DatedCapture[]): { date: string; result: SolveResult }[] {
  const seen = new Set<string>();
  for (const capture of captures) {
    if (seen.has(capture.date)) {
      throw new Error(
        `solvePerCapture: two captures both dated ${capture.date}. Merge them deliberately into ` +
          `one capture, or fix the date — do not solve them as if they were independent screens.`,
      );
    }
    seen.add(capture.date);
  }
  return captures.map((capture) => ({ date: capture.date, result: solveA1Legs(capture.rows) }));
}

/**
 * Symbols that appear in more than one capture — the rows a merge would eat.
 *
 * Reported rather than thrown: appearing twice is normal and useful (it is how
 * `scripts/cross-day.ts` separates PERSISTENT from TIMING). It is only a fault
 * when the two rows are then solved together.
 */
export function symbolsInMultipleCaptures(captures: DatedCapture[]): string[] {
  const count = new Map<string, number>();
  for (const capture of captures) {
    for (const symbol of Object.keys(capture.rows)) {
      count.set(symbol, (count.get(symbol) ?? 0) + 1);
    }
  }
  return [...count.entries()].filter(([, n]) => n > 1).map(([symbol]) => symbol).sort();
}

export interface SumCheck {
  ok: boolean;
  sum: number;
  published: number;
  /** Scoring slots the captured row left out. */
  missing: string[];
  detail: string;
}

/**
 * The FIRST check: the eighteen cells must add to the row's own published total.
 *
 * Necessary and not sufficient — blind to two misreads that cancel, which is
 * precisely why `solveA1Legs` exists. Kept here so `scripts/parity.ts` and the
 * tests run one implementation rather than two that drift.
 */
export function checkRowSum(cells: CapturedCells, published: number): SumCheck {
  const missing = SCORING_SLOTS.filter((s) => cells[s.key] === undefined).map((s) => s.key);
  const sum = SCORING_SLOTS.reduce((total, slot) => total + (cells[slot.key] ?? 0), 0);
  const ok = missing.length === 0 && sum === published;
  return {
    ok,
    sum,
    published,
    missing,
    detail:
      missing.length > 0
        ? `missing ${missing.length} of ${SCORING_SLOTS.length} columns: ${missing.join(', ')}`
        : ok
          ? `sums to ${signed(published)}`
          : `sums to ${signed(sum)}, published total is ${signed(published)}`,
  };
}

/** One currency's estimated leg error, read off its own single-economy row. */
export interface LegError {
  currency: Currency;
  /** The row it was read from — `DXY` for USD, `${cur}X` otherwise. */
  via: string;
  ours: number;
  theirs: number;
  /** ours - theirs. Positive means we score this currency too high. */
  delta: number;
}

/** A pair whose gap the leg errors do or do not account for. */
export interface GapExplanation {
  symbol: string;
  base: Currency;
  quote: Currency;
  ours: number;
  theirs: number;
  gap: number;
  /** `delta(base) - delta(quote)` — what the shared legs predict. */
  predicted: number;
  /** gap - predicted. Whatever is left is NOT a shared-leg problem. */
  residual: number;
}

export interface GapAnalysis {
  legErrors: LegError[];
  pairs: GapExplanation[];
  /** Currencies with no index row in either board. */
  unmeasured: Currency[];
}

/**
 * Splits every pair's gap into the part its two currency legs explain and the
 * part they do not — from TOTALS ALONE, with no cell transcription.
 *
 * THE ARITHMETIC. Write a row's score as `P + M`, where P is the four
 * per-symbol technical and sentiment cells and M is the macro block. For a pair,
 * `M = M(base) - M(quote)`; for a currency-index row, `M = M(currency)`. Taking
 * the difference between our board and theirs:
 *
 *     gap(XY)    = dP(XY) + dM(X) - dM(Y)
 *     gap(index) = dP(index) + dM(currency)
 *
 * So each currency's own index row measures `dM` directly, and every pair gap
 * becomes a PREDICTION rather than an observation. A pair that lands on its
 * prediction is fully explained by legs it shares with seven other rows — fix
 * the leg and eight rows move. A pair with a large residual is telling you the
 * opposite: whatever is wrong there is local to that row.
 *
 * THE ASSUMPTION, STATED PLAINLY: this reads `dP = 0`, that our trend,
 * seasonality, COT and crowd cells agree with theirs. They demonstrably do not
 * always — the captured rows show seasonality and crowd disagreeing — so a
 * residual is a POINTER, not a verdict. It says "this row's gap is not the
 * shared legs", which is exactly the question the board table cannot answer and
 * the reason `board:diff` groups by leg in the first place.
 *
 * Why this exists alongside `solveA1Legs`: that one is exact but needs their
 * cells, and cells at video-frame resolution are the thing this codebase has
 * repeatedly failed to read. This needs only the score column, which is large,
 * unambiguous, and already transcribed for all 51 rows.
 */
export function explainGaps(
  ourTotals: Record<string, number>,
  theirTotals: Record<string, number>,
): GapAnalysis {
  const bySymbol = new Map(ALL_SYMBOLS.map((d) => [d.symbol, d]));

  const indexRowFor = (currency: Currency) => (currency === 'USD' ? 'DXY' : `${currency}X`);

  const legErrors: LegError[] = [];
  const unmeasured: Currency[] = [];
  const delta = new Map<Currency, number>();

  for (const currency of CURRENCIES) {
    const via = indexRowFor(currency);
    const ours = ourTotals[via];
    const theirs = theirTotals[via];
    if (ours === undefined || theirs === undefined) {
      unmeasured.push(currency);
      continue;
    }
    legErrors.push({ currency, via, ours, theirs, delta: ours - theirs });
    delta.set(currency, ours - theirs);
  }

  const pairs: GapExplanation[] = [];
  for (const [symbol, theirs] of Object.entries(theirTotals)) {
    const def = bySymbol.get(symbol);
    const ours = ourTotals[symbol];
    if (!def?.base || !def.quote || ours === undefined) continue;
    if (!delta.has(def.base) || !delta.has(def.quote)) continue;

    const gap = ours - theirs;
    const predicted = delta.get(def.base)! - delta.get(def.quote)!;
    pairs.push({
      symbol,
      base: def.base,
      quote: def.quote,
      ours,
      theirs,
      gap,
      predicted,
      residual: gap - predicted,
    });
  }

  return {
    legErrors: legErrors.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    pairs: pairs.sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual)),
    unmeasured,
  };
}

/**
 * The THIRD check, and the first one that is sensitive to column ORDER.
 *
 * THE HOLE IT FILLS. `checkRowSum` adds eighteen numbers. Addition is
 * commutative, so a row transcribed with its columns SHIFTED — the classic
 * failure when reading a dense screenshot whose six header groups (2|2|5|3|1|5)
 * have to be partitioned by eye — sums to exactly the same total as the correct
 * reading and sails through. `solveA1Legs` catches it eventually, but only as a
 * diffuse "this column contradicts itself" that implicates innocent rows
 * alongside the guilty one.
 *
 * THE OBSERVATION THAT MAKES IT WORK. Five of A1's columns are US series and
 * nothing else — PCE, NFP, initial claims, ADP, JOLTS (`usOnly` in
 * `config/setups.config.ts`). A row with no dollar leg therefore CANNOT carry a
 * value in them, and A1 prints 0 there; `component-parity.ts` already relies on
 * that convention for its NOT_VISIBLE status. So a non-zero in one of those five
 * on a non-dollar row is not a difference of opinion about the economy, it is
 * arithmetic that cannot happen — which makes it a transcription error, full
 * stop, with no interpretation required.
 *
 * WHAT IT FOUND. Five rows across two independently captured fixtures:
 * GB-POUND (pce -1, NFP +1, claims -1), EURJPY (pce -1), JPYX (pce -1), GBPJPY
 * (pce -1) and CADX (claims +1). Every one of them had passed the row-sum
 * checksum. GB-POUND and EURJPY were the two rows whose admission had just
 * raised the leg solve's self-contradicting column count from 2 to 8 — a
 * finding that read as "A1's model is not leg-differenced after all" and was in
 * fact five misread cells.
 *
 * ROWS ARE DISCARDED, NEVER REPAIRED. A breach says the partition is wrong
 * somewhere, not where — the misplaced value could have come from any column in
 * the row. Nudging cells until the structure holds is the "never alter a cell to
 * make a check pass" rule with an extra step.
 */
export interface StructuralBreach {
  symbol: string;
  slotKey: string;
  value: number;
  detail: string;
}

export function checkStructuralZeros(
  rows: Record<string, CapturedCells>,
): StructuralBreach[] {
  const bySymbol = new Map(ALL_SYMBOLS.map((d) => [d.symbol, d]));
  const usOnlySlots = SCORING_SLOTS.filter((s) => s.usOnly);

  const breaches: StructuralBreach[] = [];
  for (const [symbol, cells] of Object.entries(rows)) {
    const def = bySymbol.get(symbol);
    if (!def) continue;

    /**
     * Every way a row can legitimately read the US economy. An asset reads it
     * through `macroEconomy` — gold's US columns are real, and inverted by its
     * polarity table rather than absent.
     */
    const readsUs =
      def.base === 'USD' || def.quote === 'USD' || def.macroEconomy === 'USD';
    if (readsUs) continue;

    for (const slot of usOnlySlots) {
      const value = cells[slot.key];
      if (value === undefined || value === 0) continue;
      breaches.push({
        symbol,
        slotKey: slot.key,
        value,
        detail:
          `${slot.label} is a US-only series and ${symbol} has no dollar leg — A1 prints 0 here. ` +
          `A ${signed(value)} cannot be their cell, so this row's columns are misaligned or misread.`,
      });
    }
  }
  return breaches;
}

export interface BoundBreach {
  symbol: string;
  slotKey: string;
  value: number;
  detail: string;
}

/**
 * Bounds for the two columns no equation can reach.
 *
 * `scoreTrend` returns {-2,-1,+1,+2} and NEVER 0 — a flat slow average counts as
 * downward — so a zero in that column is a misread, not a neutral trend.
 * Seasonality is the sign of a ten-year monthly average, bounded +/-1 for every
 * symbol kind, gold and silver included.
 */
export function checkBounds(rows: Record<string, CapturedCells>): BoundBreach[] {
  const breaches: BoundBreach[] = [];
  for (const [symbol, cells] of Object.entries(rows)) {
    const trend = cells.trend;
    if (trend !== undefined && (trend === 0 || Math.abs(trend) > 2)) {
      breaches.push({
        symbol,
        slotKey: 'trend',
        value: trend,
        detail:
          trend === 0
            ? 'trend is never 0 — a flat slow average scores as downward'
            : 'trend never exceeds +/-2',
      });
    }
    const seasonality = cells.seasonality;
    if (seasonality !== undefined && Math.abs(seasonality) > 1) {
      breaches.push({
        symbol,
        slotKey: 'seasonality',
        value: seasonality,
        detail: 'seasonality never exceeds +/-1',
      });
    }
  }
  return breaches;
}
