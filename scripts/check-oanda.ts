/**
 * Does the OANDA position book work with this token, and what does it cover?
 *
 *   npm run check:oanda
 *
 * Prints which of our FX symbols OANDA publishes a position book for, the long
 * share it reads, and the Crowd cell that share scores. Never prints the token.
 */

import { ALL_SYMBOLS } from '@/config/symbols.config';
import { OandaPositionBookProvider } from '@/lib/connectors/crowd';
import { scoreRetailLongPct } from '@/lib/scoring/crowd';

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

async function main() {
  const provider = new OandaPositionBookProvider();
  console.log('OANDA position book check');
  console.log('----------------------------------------------------------');
  console.log(`  token set      ${process.env.OANDA_API_TOKEN ? 'yes' : 'NO'}`);
  console.log(`  environment    ${process.env.OANDA_ENV === 'live' ? 'live' : 'practice'}`);
  if (!provider.isConfigured()) {
    console.log('\nFAIL: set OANDA_API_TOKEN in .env.local (a practice-account token works).');
    process.exit(1);
  }

  const res = await provider.fetchPositioning();
  if (!res.ok) {
    console.log(`\nFAIL: ${res.error}`);
    process.exit(1);
  }

  const fx = ALL_SYMBOLS.filter((d) => d.kind === 'fx');
  let covered = 0;
  for (const def of fx) {
    const entry = res.data.get(def.symbol);
    if (entry) covered++;
    console.log(
      `  ${def.symbol.padEnd(8)} ${
        entry ? `${entry.longPct.toFixed(1).padStart(5)}% long  cell ${signed(scoreRetailLongPct(entry.longPct))}  (${entry.observedAt})` : 'no book'
      }`,
    );
  }
  console.log('----------------------------------------------------------');
  console.log(`${covered}/${fx.length} FX symbols covered${res.degraded ? `; ${res.degraded}` : ''}`);
  console.log(covered > 0 ? '\nPASS: OANDA crowd data is reachable.' : '\nFAIL: no instrument returned a book.');
  process.exit(covered > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
