---
title: How the board scores
asOf: 2026-10-03
sources:
  - internal: config/setups.config.ts (the slot list, cuts and maxima)
  - internal: README.md, sections "The Top Setups scorecard" and "COT and crowd sentiment"
---

# How the board scores a symbol

The board is a fixed rule engine that follows the method of A1 Trading's EdgeFinder. It is deliberately simple and discrete. Read it as a checklist of evidence, not as a forecast.

## The total and the bias

- Every column produces a small integer cell. The **total** is the sum of the scoring cells.
- The bias cuts are **absolute**: ≥ +7 Very Bullish, ≥ +4 Bullish, −3..+3 Neutral, ≤ −4 Bearish, ≤ −7 Very Bearish. They do not scale with the number of columns, so +14 is simply twice "Very Bullish", not near a cap.
- The theoretical maximum is ±34 for an FX pair and ±20 for a single-economy asset. Real totals rarely pass ±15.

## Pairs are differences

For a currency pair every economic cell is **base minus quote**: each economy gets a leg of −1, 0 or +1, and the pair cell is `leg(base) − leg(quote)`, so it spans −2..+2. Good news for the base currency is bullish for the pair; good news for the quote currency is bearish. An economy that publishes no such series (the euro area has no payrolls, JOLTS or PCE) contributes 0, which is why US-only columns can only reach ±1 on a pair.

Single-economy assets read one economy, with a sign set by the asset class. For gold, strong US growth is bearish because gold is the haven trade. For equity indices, strong growth is bullish but hot inflation is bearish, because it implies tighter policy. Silver and platinum are read like gold; oil reads demand.

## The columns

| Column | Rule | Range on a pair |
|---|---|---|
| Trend | 3-day vs 14-day simple average. The crossover is the score (±2); a 14-day slope pointing the other way docks one point | ±2 |
| Seasonality | Sign of the 10-year average return for this calendar month | ±1 |
| COT | Currencies: the weekly change in speculators' long share. Other assets: that change plus net positioning (long share > 55% → +1, < 45% → −1) | ±2 |
| Crowd | Retail long %, read contrarian: ≥ 60% long → −1, ≤ 40% long → +1 | ±1 |
| GDP, mPMI, sPMI, Retail Sales, Consumer Confidence | Each leg: +1 if the print beat its forecast, −1 if it missed, 0 if in line | ±2 |
| CPI, PPI, PCE | Same rule. A hot inflation print is bullish for the currency (more room to hike) | ±2 (PCE ±1, US only) |
| Interest Rates | Each leg compares the central bank's expected next move with the standing rate: a hike expected → +1, a cut → −1 | ±2 |
| NFP, Unemployment, Claims, ADP, JOLTS | Beat/miss vs forecast, with the sign inverted where a higher number is worse (unemployment, claims) | ±1 (US only) or ±2 |

## Things the rules deliberately ignore

- **Magnitude.** A 0.1-point miss and a 3-point miss score the same −1. The size of a surprise is visible in the dossier; the cell is not.
- **Staleness.** A print several months old still scores. The dossier marks such legs stale; weigh them less.
- **News, speeches and central bank tone.** None of them enter the score. That is your job.
- **Market pricing of rates.** The rates cell reads the bank's own projection or the consensus for its next decision, not futures pricing. The 2-year yields in the dossier are the market's view, for contrast.

## Sources behind the cells

Economic releases: the FXStreet calendar, with forecasts topped up from TradingView and ForexFactory. Positioning: the CFTC Commitments of Traders (legacy futures-only), surveyed on Tuesday and published on Friday, so it is always at least three days old. Retail crowd: Myfxbook's community outlook where configured. Prices: Yahoo Finance daily bars.
