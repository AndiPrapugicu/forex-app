/**
 * What does the retail-positioning provider actually cover?
 *
 * THE ONE QUESTION THAT DECIDES WHETHER THE CROWD COLUMN IS FIXED. A1 score
 * that column on every cross; we score it on none, because CFTC has no contract
 * for a cross and differencing two dollar pairs measures the wrong instruments.
 * A provider only closes that gap if it answers for the 21 crosses — and no
 * public documentation says which symbols Myfxbook's Community Outlook carries,
 * so this has to be measured against a live response rather than assumed.
 *
 * Run it after setting MYFXBOOK_EMAIL / MYFXBOOK_PASSWORD:
 *
 *   npm run crowd-coverage
 *
 * It reports coverage per symbol class and, for anything covered, the cell the
 * feed would produce next to the cell we score today. Read the CHANGED list as
 * a proposal, not a result: no A1 cross value has ever been compared against
 * this provider, so the first run is the experiment.
 */

import { ALL_SYMBOLS } from '@/config/symbols.config';
import { fetchRetailPositioning } from '@/lib/connectors/crowd';
import { fetchCotData } from '@/lib/connectors/cftc';
import { resolveCrowd, scoreRetailLongPct } from '@/lib/scoring/crowd';

const signed = (n: number | null) => (n === null ? '-' : n > 0 ? `+${n}` : `${n}`);
const pad = (s: string, n: number) => s.padEnd(n);

async function main() {
  const feed = await fetchRetailPositioning();
  if (!feed.ok) {
    console.error(`\n${feed.source}: ${feed.error}\n`);
    process.exit(1);
  }

  const cot = await fetchCotData();
  const cotData = cot.ok ? cot.data : new Map();

  const fx = ALL_SYMBOLS.filter((d) => d.kind === 'fx');
  const dollar = fx.filter((d) => d.base === 'USD' || d.quote === 'USD');
  const crosses = fx.filter((d) => d.base !== 'USD' && d.quote !== 'USD');
  const other = ALL_SYMBOLS.filter((d) => d.kind !== 'fx');

  console.log(`\n${'='.repeat(88)}`);
  console.log(`CROWD COVERAGE -- ${feed.source}`);
  console.log(`${'='.repeat(88)}`);
  console.log(`Feed returned ${feed.data.size} FX symbols after filtering.\n`);

  const changed: string[] = [];

  for (const [label, group] of [
    ['DOLLAR PAIRS', dollar],
    ['CROSSES', crosses],
    ['NON-FX (feed deliberately does not answer)', other],
  ] as const) {
    console.log(`--- ${label} ---`);
    let covered = 0;
    for (const def of group) {
      const entry = feed.data.get(def.symbol);
      const now = resolveCrowd(def, cotData);
      const next = resolveCrowd(def, cotData, feed.data);
      if (entry) covered++;
      const move = now.cell !== next.cell ? '  <-- CHANGES' : '';
      if (move) changed.push(`${def.symbol} ${signed(now.cell)} -> ${signed(next.cell)}`);
      console.log(
        `  ${pad(def.symbol, 9)}${pad(entry ? `${entry.longPct.toFixed(1)}% long` : 'not covered', 16)}` +
          `now ${pad(signed(now.cell), 4)}(${now.basis})   with feed ${pad(signed(next.cell), 4)}(${next.basis})${move}`,
      );
      if (entry) void scoreRetailLongPct(entry.longPct);
    }
    console.log(`  ${covered}/${group.length} covered\n`);
  }

  console.log(`${'-'.repeat(88)}`);
  console.log(`${changed.length} cells would change:`);
  for (const c of changed) console.log(`  ${c}`);
  console.log(
    `\nNext step: re-run \`npm run top-setups-parity\` with the provider enabled and compare\n` +
      `the crowd column against A1's checksum-verified rows before treating this as an improvement.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
