/**
 * IS OUR SEASONAL AVERAGE THEIR SEASONAL AVERAGE?
 *
 * Seasonality was the third-largest clean disagreement on the board (13 of 196
 * absolute cell error) and the one most likely to be a lookback or
 * month-boundary bug: our column is the SIGN of a 10-year monthly mean, and any
 * difference in the window, the dedupe or the month edge would move it.
 *
 * A1's Monthly Seasonality scanner publishes that mean directly, per symbol per
 * calendar month, so the comparison is exact rather than inferred. Captured to
 * `fixtures/a1-full-access/a1-seasonality-monthly-2026-09-03-0743.csv`.
 *
 * TWO QUESTIONS, AND THEY HAVE DIFFERENT ANSWERS.
 *
 * First, is their RULE ours? Yes, and their own numbers prove it: on the seven
 * symbols where our printed cell disagreed with theirs, `sign(their published
 * average)` reproduces THEIR printed cell 7 times out of 7. The column is the
 * sign of the mean and nothing else, exactly as `scoreSeasonality` computes it.
 *
 * Second, is our INPUT theirs? Not quite, and the residual is the finding. What
 * this script measures is whether the difference has structure — a systematic
 * offset would mean a different window or boundary and would be fixable. See
 * the summary it prints; as of 2026-09-03 it does not, and the honest
 * conclusion is that the column is a coin flip wherever the mean is near zero.
 *
 * SO THIS SCRIPT EXISTS TO PREVENT A FIX, not to license one. A rule tuned to
 * close these cells would be fitting noise: the mean is a decimal, the cell is
 * its sign, and half the board's monthly means sit inside a tenth of a percent
 * of zero.
 *
 *   npm run seasonality-parity
 */

import fs from 'node:fs';
import path from 'node:path';

import { ALL_SYMBOLS } from '@/config/symbols.config';
import { NAME_MAP } from '@/lib/scoring/a1-symbol-map';
import { computeSeasonality, fetchSeasonalHistory } from '@/lib/connectors/technicals';

const CAPTURE = 'a1-full-access/a1-seasonality-monthly-2026-09-03-0743.csv';

/** The moment the capture was taken, so our averages are cut where theirs were. */
const CAPTURED_AT = new Date('2026-09-03T07:43:00.000Z');

/**
 * Their scanner's names against ours.
 *
 * `NAME_MAP` covers most of them, but the seasonality page does not use the
 * board's vocabulary: the board says `US-DOLLAR` and this page says `USDOLLAR`,
 * which `NAME_MAP` has no entry for. So this overlay is consulted FIRST and
 * `NAME_MAP` second, rather than forking a second copy of the whole table.
 */
const NAME_OVERLAY: Record<string, string> = { USDOLLAR: 'DXY' };

const ourSymbol = (a1name: string) => NAME_OVERLAY[a1name] ?? NAME_MAP[a1name] ?? a1name;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (s: unknown, n: number) => String(s ?? '').padEnd(n);
const padS = (s: unknown, n: number) => String(s ?? '').padStart(n);

interface Published { symbol: string; month: number; tenYear: number }

function readCapture(): Published[] {
  const text = fs.readFileSync(path.join(process.cwd(), 'fixtures', CAPTURE), 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const cols = lines[0].split(',');
  const iSym = cols.indexOf('symbol');
  const iMonth = cols.indexOf('month');
  const iTen = cols.indexOf('tenYearAvgPct');
  return lines.slice(1).flatMap((line) => {
    const c = line.split(',');
    const ten = Number.parseFloat(c[iTen]);
    if (!Number.isFinite(ten)) return [];
    return [{ symbol: c[iSym], month: Number.parseInt(c[iMonth], 10), tenYear: ten }];
  });
}

async function main() {
  const published = readCapture();
  const tickerOf = new Map(ALL_SYMBOLS.map((d) => [d.symbol, d.yahoo]));

  const bySymbol = new Map<string, Published[]>();
  for (const p of published) {
    const list = bySymbol.get(p.symbol) ?? [];
    list.push(p);
    bySymbol.set(p.symbol, list);
  }

  type Pair = { symbol: string; month: number; theirs: number; ours: number };
  const pairs: Pair[] = [];
  const unpriced: string[] = [];

  for (const [a1name, months] of bySymbol) {
    const ticker = tickerOf.get(ourSymbol(a1name));
    if (!ticker) { unpriced.push(a1name); continue; }
    const bars = await fetchSeasonalHistory(ticker);
    if (!bars) { unpriced.push(`${a1name} (no bars)`); continue; }
    const ours = computeSeasonality(bars.timestamps, bars.closes, CAPTURED_AT);
    for (const m of months) {
      const o = ours[m.month];
      if (!o) continue;
      pairs.push({ symbol: a1name, month: m.month, theirs: m.tenYear, ours: o.meanPct });
    }
  }

  console.log('='.repeat(86));
  console.log(`SEASONALITY PARITY — ${pairs.length} month-cells across ${bySymbol.size - unpriced.length} symbols`);
  console.log('='.repeat(86));
  if (unpriced.length) console.log(`\ncould not price: ${unpriced.join(', ')}`);

  const diff = pairs.map((p) => p.ours - p.theirs);
  const abs = diff.map(Math.abs).sort((a, b) => a - b);
  const mean = diff.reduce((a, b) => a + b, 0) / diff.length;
  const mx = pairs.reduce((a, p) => a + p.theirs, 0) / pairs.length;
  const my = pairs.reduce((a, p) => a + p.ours, 0) / pairs.length;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (const p of pairs) { const a = p.theirs - mx; const b = p.ours - my; sxy += a * b; sxx += a * a; syy += b * b; }

  const flips = pairs.filter((p) => Math.sign(p.ours) !== Math.sign(p.theirs));
  const agree = pairs.length - flips.length;

  console.log('\nDOES OUR AVERAGE MATCH THEIRS?');
  console.log(`  correlation                ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)}   (are we computing the same statistic at all)`);
  console.log(`  mean signed difference     ${mean >= 0 ? '+' : ''}${mean.toFixed(3)} pp   (a systematic offset would show HERE)`);
  console.log(`  median |difference|        ${abs[Math.floor(abs.length / 2)].toFixed(3)} pp`);
  console.log(`  SIGN agrees                ${agree}/${pairs.length}  (${((agree / pairs.length) * 100).toFixed(1)}%)`);

  /**
   * The cell is a sign, so only a flip can cost a point — and a flip on a mean
   * of 0.02% is a rounding argument, not a modelling one. Bucketing by how far
   * their own average sits from zero separates the two.
   */
  console.log('\nWHERE THE SIGN FLIPS, BY HOW FAR THEIR AVERAGE IS FROM ZERO');
  console.log(`  ${pad('|their average|', 22)}${padS('flips', 8)}${padS('of cells', 10)}${padS('flip rate', 12)}`);
  const bands: [string, number, number][] = [
    ['under 0.10 pp', 0, 0.1], ['0.10 - 0.25 pp', 0.1, 0.25], ['0.25 - 0.50 pp', 0.25, 0.5],
    ['0.50 - 1.00 pp', 0.5, 1], ['1.00 pp and over', 1, Infinity],
  ];
  for (const [label, lo, hi] of bands) {
    const inBand = pairs.filter((p) => Math.abs(p.theirs) >= lo && Math.abs(p.theirs) < hi);
    const f = inBand.filter((p) => Math.sign(p.ours) !== Math.sign(p.theirs)).length;
    if (inBand.length === 0) continue;
    console.log(
      `  ${pad(label, 22)}${padS(f, 8)}${padS(inBand.length, 10)}${padS(`${((f / inBand.length) * 100).toFixed(0)}%`, 12)}`,
    );
  }

  console.log('\nTHE FLIPS THAT A RULE COULD PLAUSIBLY EXPLAIN — |their average| at or above 0.5 pp');
  const big = flips.filter((f) => Math.abs(f.theirs) >= 0.5).sort((a, b) => Math.abs(b.theirs) - Math.abs(a.theirs));
  if (big.length === 0) console.log('  none.');
  for (const f of big) {
    console.log(`  ${pad(f.symbol, 10)}${pad(MONTHS[f.month - 1], 5)}theirs ${padS(f.theirs.toFixed(2), 7)}   ours ${padS(f.ours.toFixed(2), 7)}`);
  }
  console.log(`\n  ${big.length} of ${flips.length} flips. The rest sit close enough to zero that the sign is noise.`);
}

main().catch((err) => {
  console.error('seasonality-parity failed:', err);
  process.exit(1);
});
