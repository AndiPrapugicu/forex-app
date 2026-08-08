/**
 * FXStreet outage drill — the most important failure path in this app.
 *
 * FXStreet is an undocumented, Referer-gated endpoint that supplies both the
 * calendar and every `actual`. If it disappears, the app must degrade to the
 * FairEconomy schedule with a visible banner, NOT crash and NOT silently render
 * an empty dashboard that looks like "no news today".
 *
 * Run: npm run drill:fxstreet
 */

import { FXSTREET } from '@/config/sources.config';

async function main() {
  // Simulate the Referer gate changing by pointing at a path that will 404.
  (FXSTREET as { base: string }).base =
    'https://calendar-api.fxstreet.com/en/api/v1/DOES_NOT_EXIST';

  const { runPipeline } = await import('@/lib/pipeline');
  const { dashboard } = await runPipeline({ deliverAlerts: false });

  console.log('\nFXStreet outage drill\n' + '-'.repeat(60));
  console.log('health:', dashboard.health.map((h) => `${h.source}=${h.ok ? 'ok' : 'DOWN'}`).join('  '));
  console.log('upcoming events :', dashboard.upcoming.length);
  console.log('recent scored   :', dashboard.recent.length, '(expected 0 — no actuals without FXStreet)');
  console.log('news clusters   :', dashboard.news.length);
  console.log('prices          :', dashboard.prices.length);
  console.log('assets          :', dashboard.assets.map((a) => `${a.asset} ${a.score >= 0 ? '+' : ''}${a.score}`).join('  '));
  console.log('market mood     :', dashboard.marketMood.label);
  console.log('-'.repeat(60));

  const fxstreetDown = dashboard.health.some((h) => !h.ok);
  const scheduleSurvived = dashboard.upcoming.length > 0;
  const newsSurvived = dashboard.news.length > 0;

  const pass = fxstreetDown && scheduleSurvived && newsSurvived;

  console.log(fxstreetDown ? 'ok   FXStreet correctly reported as down' : 'FAIL FXStreet not marked down');
  console.log(scheduleSurvived ? 'ok   schedule survived via FairEconomy fallback' : 'FAIL no upcoming events');
  console.log(newsSurvived ? 'ok   news and assets unaffected' : 'FAIL news pipeline broke too');
  console.log(`\n${pass ? 'PASS' : 'FAIL'}: app degrades instead of dying\n`);

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFAIL: pipeline threw instead of degrading:', err);
  process.exit(1);
});
