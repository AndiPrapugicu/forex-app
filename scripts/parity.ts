/**
 * Scores the whole board against A1's published numbers, in one command.
 *
 * This exists because three consecutive scoring changes made parity WORSE while
 * each looked defensible on its own. Every one was judged by opening the page
 * and reading a few rows, which is how a change that fixes two symbols and
 * breaks five gets kept. The rule this enforces is simple: run it before a
 * change, run it after, keep the change only if the numbers improved.
 *
 *   npm run parity
 *
 * Reads `fixtures/a1-board.json` — evidence transcribed from their screen, not
 * configuration. Nothing in the app reads it. That file holds a LIST of captures
 * because their board is only reachable as livestream frames and a capture can
 * never be re-taken; this scores against the most recent one that has a date.
 *
 * Live network, deliberately. The point is to measure what the page actually
 * renders, so this runs the same `runSetupsPipeline` the page runs rather than a
 * fixture of our own output, which could only ever agree with itself.
 *
 * THERE IS A NOISE FLOOR OF ABOUT ±1, AND IT IS NOT OPTIONAL TO KNOW THIS.
 *
 * Macro releases are rewound to the capture date below, but technicals are left
 * live — they are a snapshot with no history to rewind. Trend is ±2 per symbol
 * and turns on a 3-day against a 14-day average, so a few hours of ordinary
 * price movement flips a row and moves TOTAL ABS GAP by a point or two with no
 * code change at all. Measured directly: two consecutive runs of an unmodified
 * tree reported 48 and then 47.
 *
 * So a single run cannot judge a small change. Run it two or three times before
 * and after, and treat anything inside ±1 as unmeasured rather than as an
 * improvement — the whole reason this script exists is that changes were being
 * kept on evidence weaker than the thing being measured.
 *
 * AND THE NUMBER IS NOT COMPARABLE ACROSS CAPTURES. TOTAL ABS GAP is a sum over
 * whichever symbols that capture published, so it moves when the capture changes
 * even though no code did. Measured: 63 against the 26-symbol 2026-08-19
 * capture, 80 against the 29-symbol 2026-08-21 one, same tree — the four index
 * rows the newer capture adds (JP225, GER40, JPYX, NAS100) carry large gaps on
 * their own. Compare runs against the SAME capture, or compare `exact` and
 * `within 1` as shares instead.
 *
 * Baseline on the 2026-08-21 capture, three runs each: HEAD (dd30468) 80/80/80,
 * working tree 80/80/80. The uncommitted scoring work is parity-neutral, which
 * is worth knowing before anyone bisects it looking for a regression.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import board from '@/fixtures/a1-board.json';
import { SCORING_SLOTS } from '@/config/setups.config';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { asOf } from '@/lib/scoring/backtest';
import { buildSetupsMatrix, type SymbolRow } from '@/lib/scoring/setups';
import {
  checkBounds,
  checkRowSum,
  checkStructuralZeros,
  explainGaps,
  solveA1Legs,
} from '@/lib/scoring/a1-legs';
import { listCaptures } from '@/lib/a1-capture-file';
import { parseCapture } from '@/lib/scoring/a1-pair-legs';
import { NAME_MAP, NOT_MODELED } from '@/lib/scoring/a1-symbol-map';

interface Capture {
  /** null when the capture's date could not be established. */
  capturedUtc: string | null;
  provenance: string;
  /**
   * Read out of A1's DOM under its own column headers, rather than transcribed
   * by eye from a video frame.
   *
   * It decides whether `checkStructuralZeros` may DROP a row. A transcription
   * can have its six header groups partitioned wrongly; a DOM read has no
   * mechanism for that, so an impossible cell there is A1's, not the reader's.
   */
  domRead: boolean;
  totals: Record<string, number>;
  cells: Record<string, Record<string, number>>;
}

/**
 * The `fixtures/a1-top-setups-*.csv` captures, in this file's own Capture shape.
 *
 * WHY THESE EXIST SEPARATELY FROM a1-board.json. The JSON holds transcriptions
 * read off livestream video frames: a handful of rows per capture, cells for
 * fewer still, and a date that is sometimes only a day. The CSVs are the board
 * read out of the DOM during A1's full-access week — all 54 rows, all 18 cells,
 * stamped to the minute. Both are evidence and both are kept, but they are not
 * the same grade of evidence, and `selectCapture` prefers the newest, which is
 * now always a CSV.
 *
 * The filename's time is UTC, matching the convention `lib/a1-capture-file.ts`
 * documents. A capture with no time is left as a bare date, which the existing
 * CAPTURED_END_OF_DAY handling already reads as end-of-day.
 *
 * Rows are keyed by OUR symbol because that is what `totals[symbol]` is compared
 * against. A1's index rows carry their own names (US-DOLLAR, EURO, ...) and map
 * through NAME_MAP; their pair rows already are our symbols. A row we do not
 * model is skipped rather than mapped to nothing, so it cannot show up as a
 * phantom gap.
 */
function csvCaptures(): Capture[] {
  const out: Capture[] = [];
  for (const { file, date, time } of listCaptures()) {
    let text: string;
    try {
      text = readFileSync(path.join(process.cwd(), 'fixtures', file), 'utf8');
    } catch {
      continue;
    }
    const parsed = parseCapture(text, file);
    const totals: Record<string, number> = {};
    const cells: Record<string, Record<string, number>> = {};

    for (const [name, score] of parsed.scores) {
      if (NOT_MODELED.has(name)) continue;
      const symbol = NAME_MAP[name] ?? name;
      if (!Number.isFinite(score)) continue;
      totals[symbol] = score;
      const row = parsed.rows.get(name);
      if (row) cells[symbol] = { ...row };
    }

    out.push({
      capturedUtc: time === '0000' ? date : `${date}T${time.slice(0, 2)}:${time.slice(2)}:00.000Z`,
      provenance: `fixtures/${file} — read from A1's DOM during full access`,
      domRead: true,
      totals,
      cells,
    });
  }
  return out;
}

/**
 * `domRead: false` on every board.json capture, stated rather than defaulted:
 * those are livestream video frames read by eye, which is exactly the input
 * `checkStructuralZeros` was written to police.
 */
const captures: Capture[] = [
  ...(board.captures as unknown as Omit<Capture, 'domRead'>[]).map((c) => ({ ...c, domRead: false })),
  ...csvCaptures(),
];

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padStart = (s: string | number, n: number) => String(s).padStart(n);

/**
 * The capture to score against: the most recent one that HAS a date.
 *
 * An undated capture is not a lesser capture, it is an unusable one. `asOf`
 * rewinds our board to the instant theirs was taken, and without that instant
 * the comparison measures how much the calendar moved rather than how our
 * scoring reads. Those captures stay in the fixture for the date-independent
 * structure they pin — see the file's own comment — and are skipped here.
 */
function selectCapture(): Capture {
  const dated = captures.filter((c) => c.capturedUtc !== null);
  if (dated.length === 0) {
    throw new Error('no dated capture in fixtures/ — nothing can be scored against');
  }
  return dated.sort((a, b) => b.capturedUtc!.localeCompare(a.capturedUtc!))[0];
}

/**
 * Every transcribed row must sum to the total printed beside it.
 *
 * The cells are read off a compressed video frame where a 1 and a 2 differ by a
 * few pixels, so a misread is the normal case, not the exceptional one. Their
 * board publishes the check for free: the score column IS the sum of the 18
 * cells, so a row that does not add up was transcribed wrong.
 *
 * Rows that fail are DROPPED rather than reported, because the whole purpose of
 * per-slot attribution is to say which column is at fault, and a misread row
 * says so confidently and wrongly. This runs before the network does, so a bad
 * transcription is caught in a second rather than after a full pipeline run.
 *
 * IT IS NOT SUFFICIENT, AND A ROW THAT PASSES HAS NOT BEEN VERIFIED. Two misread
 * cells that cancel sum correctly, and 18 cells leave ample room for that. It
 * has already happened once: a GBPUSD row read PPI as 0 instead of +2 and
 * something else two points high, passed here, and sent a change into the GBP
 * producer-price series that moved TOTAL ABS GAP from 80 to 90 — see the
 * 2026-08-21 note in the fixture.
 *
 * The check that caught it is the run itself. A correctly-read cell implies a
 * rule change that moves ONE row toward their board; a misread one moves every
 * pair sharing that leg the wrong way. So treat a transcribed cell as a
 * hypothesis, change the rule it implies, and let TOTAL ABS GAP judge it.
 */
function validateCells(capture: Capture): {
  cells: Record<string, Record<string, number>>;
  rejected: string[];
  /** Structurally impossible cells that are A1's own, so the row stays. */
  kept: string[];
} {
  const good: Record<string, Record<string, number>> = {};
  const rejected: string[] = [];
  const kept: string[] = [];

  for (const [symbol, row] of Object.entries(capture.cells)) {
    const published = capture.totals[symbol];

    if (published === undefined) {
      rejected.push(`${pad(symbol, 9)} has cells but no published total`);
      continue;
    }

    const check = checkRowSum(row, published);
    if (!check.ok) {
      rejected.push(`${pad(symbol, 9)} ${check.detail}`);
      continue;
    }
    good[symbol] = row;
  }

  for (const breach of checkBounds(good)) {
    rejected.push(`${pad(breach.symbol, 9)} ${breach.slotKey} = ${signed(breach.value)} — ${breach.detail}`);
    delete good[breach.symbol];
  }

  /**
   * And the check the sum is blind to BY CONSTRUCTION, because addition does not
   * care about order. See `checkStructuralZeros`: a row read with its columns
   * shifted still adds to the printed total.
   *
   * On a DOM capture these are REPORTED AND KEPT. The shift this catches cannot
   * happen when cells are read under their own headers, so an impossible cell is
   * A1's own — dropping the row discarded seventeen good cells to avoid
   * believing one, and took eight of fifty-one rows out of the attribution
   * below without saying so.
   */
  for (const breach of checkStructuralZeros(good, capture.domRead ? 'dom' : 'transcribed')) {
    const note = `${pad(breach.symbol, 9)} ${breach.slotKey} = ${signed(breach.value)} — ${breach.detail}`;
    if (breach.discard) {
      rejected.push(note);
      delete good[breach.symbol];
    } else {
      kept.push(note);
    }
  }

  return { cells: good, rejected, kept };
}

/**
 * The SECOND check on the captured cells, and the one the sum cannot perform.
 *
 * `validateCells` above asks whether each row adds up. That is necessary and not
 * sufficient: it is blind to two misreads that cancel, and this file's own
 * history records a row that passed it, was believed, and drove TOTAL ABS GAP
 * from 80 to 90. `solveA1Legs` asks whether the rows can all be true AT ONCE,
 * which is a much harder thing to pass by accident.
 *
 * Rows are NOT dropped on a contradiction. It implicates at least two of them
 * and usually cannot say which, so dropping both would discard good evidence
 * along with bad. Instead the contradicted COLUMNS are returned and the
 * attribution below marks them, so nobody reads a fix out of a cell that is
 * known to be in dispute.
 */
function contradictedColumns(cells: Record<string, Record<string, number>>) {
  const solved = solveA1Legs(cells);
  return {
    solved,
    disputed: new Set(solved.contradicted.map((c) => c.slotKey)),
  };
}

const CAPTURE = selectCapture();
const totals = CAPTURE.totals;
const { cells, rejected, kept } = validateCells(CAPTURE);

function summarise(rows: SymbolRow[]) {
  const compared = Object.keys(totals)
    .map((symbol) => {
      const row = rows.find((r) => r.symbol === symbol);
      if (!row) return null;
      return { symbol, ours: row.totalScore, a1: totals[symbol], gap: row.totalScore - totals[symbol] };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const exact = compared.filter((c) => c.gap === 0).length;
  const within1 = compared.filter((c) => Math.abs(c.gap) <= 1).length;
  const within2 = compared.filter((c) => Math.abs(c.gap) <= 2).length;
  const totalAbsGap = compared.reduce((t, c) => t + Math.abs(c.gap), 0);

  return { compared, exact, within1, within2, totalAbsGap };
}

/**
 * Which COLUMN a gap came from, for the rows captured cell by cell.
 *
 * The per-symbol total says a row moved; this says why. Without it a regression
 * is a number that got worse, and the next change is another guess.
 */
function attribute(row: SymbolRow, expected: Record<string, number>, disputed: Set<string>) {
  const lines: string[] = [];
  let accounted = 0;

  for (const slot of SCORING_SLOTS) {
    const theirs = expected[slot.key];
    if (theirs === undefined) continue;

    const ours = row.cells[slot.key]?.cell ?? 0;
    const diff = ours - theirs;
    if (diff === 0) continue;

    accounted += diff;
    /**
     * A DISPUTED column is one the leg solver proved cannot hold across every
     * captured row at once. The number is still printed, because the total has
     * to reconcile — but it must not be read as a target. An unmarked line here
     * is exactly how a misread cell becomes a config change, which this file's
     * own history records happening once already.
     */
    const flag = disputed.has(slot.key) ? '   !! disputed — do not fix from this' : '';
    lines.push(
      `      ${pad(slot.label, 18)} ours ${padStart(signed(ours), 3)}   A1 ${padStart(signed(theirs), 3)}   ` +
        `${signed(diff)}${flag}`,
    );
  }

  return { lines, accounted };
}

/**
 * The board was captured at a moment, and releases have landed since.
 *
 * This is not a detail. The morning after the capture, a new UK unemployment
 * print (4.9 against 4.8, where the day before it was 4.9 against 5.0) flipped
 * the GBP leg from +1 to -1 and moved the total gap from 48 to 56 with NO code
 * change — while the per-slot attribution reported a confident "systematic
 * unemployment gap" on two rows. Chasing that would have been chasing the
 * calendar.
 *
 * So the board is scored AS OF its capture time, reusing the backtest's
 * look-ahead guard, and every comparison is like for like. Once the drift is
 * wide enough that the fixture no longer describes a reachable state, the answer
 * is a fresh capture, not a code change.
 *
 * A SAME-DAY capture cannot be rewound, and pretending otherwise lets look-ahead
 * back in. `T23:59:59` on today's date is in the future, so the cutoff would trim
 * nothing and our board would be scored against releases that landed after their
 * frame was taken — the very error the rewind exists to prevent, running silently
 * and in the direction that flatters us. The cutoff is therefore clamped to now,
 * and the intra-day risk is reported rather than hidden.
 */
const HAS_TIME = CAPTURE.capturedUtc!.includes('T');
const CAPTURED_END_OF_DAY = new Date(HAS_TIME ? CAPTURE.capturedUtc! : `${CAPTURE.capturedUtc}T23:59:59.000Z`);
const SAME_DAY = !HAS_TIME && CAPTURED_END_OF_DAY.getTime() > Date.now();
const CAPTURED_AT = new Date(Math.min(CAPTURED_END_OF_DAY.getTime(), Date.now()));

/**
 * How far THEIR board moved between the two most recent captures.
 *
 * This is the honest noise floor for the whole comparison, and it is far larger
 * than the ±1 the technicals contribute. Two frames from the same day's stream
 * differed by 29 points across 22 shared symbols — 16 of them moved, CADJPY by
 * 3 and GBPUSD by 2 — against a TOTAL ABS GAP of 80. About a third of what looks
 * like a scoring gap is the hour the frame was grabbed.
 *
 * Printed on every run so nobody reads a 2-point row gap as a defect again.
 */
function boardDrift() {
  const dated = captures.filter((c) => c.capturedUtc !== null);
  const [current, previous] = dated;
  if (!previous) return null;

  const shared = Object.keys(current.totals).filter((s) => previous.totals[s] !== undefined);
  if (shared.length === 0) return null;

  const moves = shared.map((s) => current.totals[s] - previous.totals[s]);
  return {
    from: previous.capturedUtc!,
    shared: shared.length,
    moved: moves.filter((m) => m !== 0).length,
    total: moves.reduce((t, m) => t + Math.abs(m), 0),
    biggest: Math.max(...moves.map(Math.abs)),
  };
}

async function main() {
  const started = Date.now();
  /**
   * `pricesAsOf`, not `now`. The price series behind the trend cell is cut at
   * the capture — it was computed live until 2026-08-30, no matter what date
   * this script claimed to reproduce. `now` stays live on purpose: rewinding it
   * narrows the calendar fetch and loses scheduled events the frame could see.
   */
  const payload = await runSetupsPipeline(new Date(), { pricesAsOf: CAPTURED_AT });

  const driftHours = (Date.now() - CAPTURED_AT.getTime()) / 3_600_000;
  const trimmed = asOf({ events: payload.events, cot: payload.cot, bars: new Map(), seasonality: new Map() }, CAPTURED_AT);
  const dropped = payload.events.length - trimmed.events.length;

  /**
   * Rebuilt from the trimmed inputs rather than reusing `payload.matrix`, which
   * was scored against now. Technicals and yields are left live: they are a
   * snapshot with no history to rewind here, and both move far less over a day
   * than a fresh macro release does.
   */
  const matrix = buildSetupsMatrix({
    events: trimmed.events,
    cot: trimmed.cot,
    technicals: payload.technicals,
    sovereignYields: payload.sovereignYields,
    /**
     * NOT OPTIONAL, THOUGH THE TYPE SAYS IT IS. Omitting it does not blank one
     * cell — it blanks the rate column on DXY and all fourteen non-FX rows, so
     * this script scored a board the app never rendered and reported DXY at -7
     * where /scorecard showed -8. The value now rides on the payload for exactly
     * this reason; see `SetupsPayload.yield2y`.
     */
    yield2y: payload.yield2y,
    now: CAPTURED_AT,
  });
  const health = payload.health;

  console.log(
    `scored as of ${CAPTURE.capturedUtc} (${SAME_DAY ? 'today' : `${driftHours.toFixed(0)}h ago`}, ` +
      `${CAPTURE.provenance}) — ` +
      `${dropped} release${dropped === 1 ? '' : 's'} published since then held back\n`,
  );
  if (SAME_DAY) {
    console.log('  no time on this capture, so the cutoff is now: anything they had seen by their');
    console.log('  frame but that we fetched later in the day is still in. Record an ISO datetime');
    console.log('  in `capturedUtc` when the stream shows one and this rewinds to the hour.\n');
  }

  const drift = boardDrift();
  if (drift) {
    console.log(
      `  THEIR BOARD MOVED ${drift.total} points across ${drift.shared} shared symbols since the ` +
        `${drift.from} capture`,
    );
    console.log(
      `  (${drift.moved} of ${drift.shared} symbols moved, biggest ${drift.biggest}) — that is the ` +
        'floor under every gap below.',
    );
    console.log('  A row inside it is not evidence. Chase patterns across a currency, not single rows.\n');
  }
  if (driftHours > 96) {
    console.log('  the capture is over four days old; refresh the fixture rather than trusting a gap below\n');
  }

  const { compared, exact, within1, within2, totalAbsGap } = summarise(matrix.rows);

  const degraded = health.filter((h) => !h.ok || h.detail);
  if (degraded.length > 0) {
    console.log('SOURCES REPORTING TROUBLE — a gap below may be a fetch, not a rule\n');
    for (const h of degraded) console.log(`  ${h.ok ? 'degraded' : 'FAILED  '}  ${h.source}: ${h.detail ?? ''}`);
    console.log('');
  }

  /**
   * Healthy sources with something to say — kept apart from the block above so
   * a routine number never reads as a warning. The backfill's yield lives here:
   * it is the figure that lets "reachable but useless" be told apart from
   * "working", which is the failure that hid a broken merge for a fortnight.
   */
  const notes = health.filter((h) => h.note);
  if (notes.length > 0) {
    for (const h of notes) console.log(`  note  ${h.source}: ${h.note}`);
    console.log('');
  }

  /**
   * A rejected row is a transcription error, not a scoring error, and saying so
   * loudly is the point — it is the one failure that would otherwise be silent
   * and would then be explained as a bug in the code.
   */
  if (rejected.length > 0) {
    console.log('CAPTURED ROWS REJECTED — these do not sum to their own published total\n');
    for (const r of rejected) console.log(`  ${r}`);
    console.log('\n  re-read them off the frame; they are excluded from attribution below\n');
  }

  /**
   * Kept, not rejected, and the distinction is the whole point of the block.
   * These cells are impossible as leg differences AND they are what A1
   * published, which makes them a fact about their model rather than about our
   * reading of it. The rows stay in the attribution; the leg solve is what
   * decides the column is in dispute.
   */
  if (kept.length > 0) {
    console.log('A1 CELLS THAT CANNOT BE LEG DIFFERENCES - kept, because they are THEIRS\n');
    for (const k of kept) console.log(`  ${k}`);
    console.log(
      '  These rows REMAIN in the attribution below. The columns they contradict are marked ' +
        'disputed by the leg solve, which is where a contradiction belongs.\n',
    );
  }

  console.log(`PARITY vs A1's board captured ${CAPTURE.capturedUtc}\n`);
  console.log(`  ${pad('symbol', 9)}${padStart('ours', 5)}${padStart('A1', 5)}${padStart('gap', 6)}`);
  console.log(`  ${'-'.repeat(24)}`);

  for (const c of [...compared].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.symbol.localeCompare(b.symbol))) {
    const flag = c.gap === 0 ? ' <- exact' : '';
    console.log(`  ${pad(c.symbol, 9)}${padStart(signed(c.ours), 5)}${padStart(signed(c.a1), 5)}${padStart(signed(c.gap), 6)}${flag}`);
  }

  console.log(`\n  compared        ${compared.length} of ${Object.keys(totals).length} published symbols`);
  console.log(`  exact           ${exact}`);
  console.log(`  within 1        ${within1}`);
  console.log(`  within 2        ${within2}`);
  console.log(`  TOTAL ABS GAP   ${totalAbsGap}    <- the number to drive down`);

  /**
   * WHICH LEG, from the score column alone.
   *
   * Each currency has a single-economy row on their board, so its gap measures
   * that currency's macro error directly — no cell transcription, which is the
   * step this codebase has repeatedly failed at. Every pair gap then becomes a
   * PREDICTION, and the residual separates the two kinds of problem: a pair
   * landing on its prediction is explained by legs it shares with seven other
   * rows, and a pair missing it has something local going on.
   */
  const ourTotals = Object.fromEntries(matrix.rows.map((r) => [r.symbol, r.totalScore]));
  const analysis = explainGaps(ourTotals, totals);

  console.log('\nWHICH LEG — each currency read off its own single-economy row\n');
  console.log(`  ${pad('cur', 5)}${pad('via', 7)}${padStart('ours', 6)}${padStart('A1', 5)}${padStart('delta', 7)}`);
  console.log(`  ${'-'.repeat(30)}`);
  for (const leg of analysis.legErrors) {
    console.log(
      `  ${pad(leg.currency, 5)}${pad(leg.via, 7)}${padStart(signed(leg.ours), 6)}` +
        `${padStart(signed(leg.theirs), 5)}${padStart(signed(leg.delta), 7)}`,
    );
  }
  console.log('\n  delta > 0 means we score that currency too HIGH. It carries into every');
  console.log('  pair it appears in, positively as base and negatively as quote.');

  const unexplained = analysis.pairs.filter((p) => p.residual !== 0);
  console.log(
    `\n  PAIRS THE LEGS DO NOT EXPLAIN — ${unexplained.length} of ${analysis.pairs.length}\n`,
  );
  console.log(
    `  ${pad('symbol', 9)}${padStart('gap', 5)}${padStart('legs', 6)}${padStart('left', 6)}`,
  );
  console.log(`  ${'-'.repeat(26)}`);
  for (const p of unexplained.slice(0, 12)) {
    console.log(
      `  ${pad(p.symbol, 9)}${padStart(signed(p.gap), 5)}${padStart(signed(p.predicted), 6)}` +
        `${padStart(signed(p.residual), 6)}`,
    );
  }
  console.log('\n  `legs` is what the two currencies predict; `left` is what they do not.');
  console.log('  This reads dP = 0 — that our trend, seasonality, COT and crowd cells match');
  console.log('  theirs. They do not always, so a residual is a POINTER, not a verdict.');

  /**
   * The captured cells, checked against EACH OTHER rather than against
   * themselves. See `contradictedColumns`.
   */
  const { solved, disputed } = contradictedColumns(cells);
  if (solved.contradicted.length > 0) {
    console.log('\nCAPTURED CELLS CONTRADICT EACH OTHER — the check the row sum cannot do\n');
    for (const column of solved.contradicted) {
      console.log(
        `  ${pad(column.label, 20)} only ${column.satisfied} of ${column.equations} rows can hold at once`,
      );
      console.log(
        `  ${' '.repeat(20)} re-read ${column.suspects.join(' or ') || 'these rows — no single one rescues the column'}`,
      );
    }
    console.log('\n  A pair cell is base minus quote over legs of -1, 0 or +1, so the captured');
    console.log('  rows are equations over the same eight unknowns. These columns have no');
    console.log('  solution: at least one cell in each is misread. Every row still sums to its');
    console.log('  own published total, which is why this needed a second check.');
    console.log('  The rows are NOT dropped — a contradiction implicates two and rarely says');
    console.log('  which — but the columns are marked in the attribution below.\n');
  }

  const captured = Object.keys(cells).length;
  console.log(`\nPER-SLOT ATTRIBUTION — ${captured} of ${compared.length} rows captured cell by cell`);
  if (captured === 0) {
    console.log('\n  NO ROWS CAPTURED CELL BY CELL. The table above says WHICH rows disagree');
    console.log('  and by how much; nothing here can say WHICH COLUMN caused it, so any fix');
    console.log('  made from this run alone is a guess. Transcribe a few rows into the');
    console.log(`  ${CAPTURE.capturedUtc} capture in fixtures/a1-board.json — each is checked`);
    console.log('  against its own published total as you add it.');
  }
  for (const [symbol, expected] of Object.entries(cells)) {
    const row = matrix.rows.find((r) => r.symbol === symbol);
    if (!row) continue;

    const gap = row.totalScore - totals[symbol];
    console.log(`\n  ${symbol}  ours ${signed(row.totalScore)}  A1 ${signed(totals[symbol])}  gap ${signed(gap)}`);

    const { lines, accounted } = attribute(row, expected, disputed);
    if (lines.length === 0) console.log('      every column agrees');
    else console.log(lines.join('\n'));

    /**
     * The columns must explain the total. If they do not, the captured row is
     * misaligned against ours — which is worth knowing loudly, because every
     * conclusion drawn from it would be wrong.
     */
    if (accounted !== gap) {
      console.log(`      !! columns sum to ${signed(accounted)} but the total differs by ${signed(gap)}`);
      console.log('      !! the captured row is misaligned — do not trust the attribution above');
    }
  }

  console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('parity run failed:', err);
  process.exitCode = 1;
});
