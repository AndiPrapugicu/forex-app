# Component spec — one row per board column

State as of **2026-09-13**. The production contract is [`SCORING-CONTRACT.md`](../SCORING-CONTRACT.md);
this is the reference sheet that sits beside it, with the evidence and confidence for each column.
A1 access closed 2026-09-07 — every "evidence" entry below points at a capture or ledger key that already
exists, and nothing marked UNKNOWN can now be settled by a new A1 capture.

Confidence: **CONFIRMED** (reproduces A1 on multiple dates) · **STRONG** · **PARTIAL** · **UNKNOWN**.

Every economic column shares one rule: per currency leg, `sign(actual − reference)` with polarity applied
(no dead band); a pair cell is `clamp(base − quote, ±2)`; a row total is the plain sum of 18 scoring cells;
bias bands are ±4 and ±7. Economic legs are cut at the release date on a rewind (`asOf`).

| Column | Source | Raw input | Formula | Thresholds | Lookback | Timing | Range | Edge cases | Confidence | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Trend | Yahoo daily bars (FX rebuilt from hourly at 22:00 UTC) | close | 3-day SMA vs 14-day SMA, docked by the 14-day slope | crossover ±1, slope adds ±1 | 14 sessions + slope lookback | `pricesAsOf` | −2…+2 | index rows read the dollar pair; flat slopes flip near zero | STRONG | `a1-index-row-trend-is-the-dollar-pair` 35/35; `trend:index-rows-agree-usdchf-is-a-flat-slope` |
| Seasonality | Yahoo dailies bucketed by release month | monthly return | sign of the 10-year mean for the current month | none | 10 years | rolls at month turn | −1…+1 | young symbols (ETH) have a different history | STRONG (rule), UNKNOWN (ETH) | `seasonality-is-a-coin-flip`; `seasonality:ethereum-is-a-different-history` |
| COT | CFTC legacy report | speculator long/short | net position band + weekly long-share change | 60/40 | 156 weeks for percentile | cut on Friday publication | −2…+2 | pairs use the weekly change leg only | CONFIRMED | `cot-cut-on-publication-not-survey` |
| Crowd | CFTC non-reportable, per symbol | retail long share | contrarian band | ≥60% long −1, ≤40% +1 | latest report | weekly | −1…+1 | **crosses null** — never synthesised | CONFIRMED on dollar pairs; BLOCKED on crosses | `a1-crowd-is-fxssi` 8/8; `crowd:no-public-cross-feed-passes-the-gate` |
| Rates (FX) | central-bank projection → next-decision consensus | expected rate path | base − quote of each leg's direction | none | next decision / projection | calendar | −1…+1 per leg | no calendar → null | CONFIRMED | `a1-rates-is-policy-vs-projection` 8/8 |
| Rates (assets, DXY) | FRED DGS2 | 2-year yield | vs its 21-day average, inverted for DXY | above/below | 21 days | daily | −1…+1 | yield never assumed | STRONG | `yield2y-is-flatlined` |
| GDP | FXStreet + TradingView consensus | actual, forecast | economic rule | — | ~150-day calendar + Supabase | release | ±2 | quarterly series forward-held | STRONG | `a1-econ-cell-is-sign-of-surprise` |
| Manufacturing PMI | FXStreet; seed for history | actual, forecast | economic rule | — | seed back to 2024 + accumulated | release | ±2 | flash vs final; A1 pair rows self-contradict | PARTIAL | `a1-pmi-vendor-and-chf-substitution`; `fxstreet-nulls-pmi-history` |
| Services PMI | FXStreet; seed for history | actual, forecast | economic rule | — | as above | release | ±2 | CHF/CAD/NZD have no series; A1 CHF = EUR | STRONG (EUR/GBP/JPY/AUD/USD), UNKNOWN (CAD) | `spmi:chf-reads-the-euro-area`; `profile:cad-nzd-spmi-blank-rejected` |
| Retail Sales | FXStreet + TradingView | actual, forecast | economic rule | — | calendar | release | ±2 | CAD advance estimate vs final; AUD blank in A1 | STRONG | `retail:cad-a1-heatmap-is-the-statcan-advance-estimate`; `retail-sales:AUD-a1-has-no-series` |
| Consumer Confidence | FXStreet; NZD/AUD primary series | actual, forecast or prior | economic rule, prior print where unforecast | — | calendar | release | ±2 | CAD has no series | STRONG | `cnsmr-conf-was-their-blank-not-our-gap` |
| CPI | FXStreet | YoY actual, forecast | economic rule | — | calendar | release | ±2 | — | CONFIRMED | `a1-truth-table` 8/8 |
| PPI | FXStreet | actual, forecast or prior | economic rule | — | calendar | release | ±2 | A1 negates on pair rows (mirrored, never adopted) | CONFIRMED (legs) | `a1-truth-table` 8/8; `a1-pair-rows-are-a-second-leg-vector` |
| PCE | FXStreet | actual, forecast | economic rule, USD only | — | calendar | release | ±2 | A1 scores it on JPY crosses | PARTIAL | `a1-scores-pce-on-jpy-crosses` |
| Employment (NFP etc.) | FXStreet | actual, forecast | economic rule | — | calendar | release | ±2 | per-country slot | CONFIRMED | 51/51 |
| Unemployment | FXStreet | rate | economic rule, polarity inverted | — | calendar | release | ±2 | — | CONFIRMED | `chf-legs-move-between-boards` |
| Claims, ADP, JOLTS | FXStreet | actual, forecast | economic rule, USD only | — | calendar | release | ±2 | single-leg, inverted for quote | CONFIRMED | 51/51 each |

## Not built, on purpose

| A1 page | Why |
|---|---|
| Market Spreads, Geopolitical Risk Tracker | no source |
| AAII Sentiment | AAII's terms forbid copying (`aaii:public-page-but-terms-forbid-copying`) |
| Scenario Backtests as a page | `npm run backtest` — each page view would refetch every symbol's full daily history |
| Chart, Trade Ideas | removed 2026-09-13 at the user's request |

## Built on a non-A1 source, context only

| A1 page | Our source | Note |
|---|---|---|
| Put-Call Ratio, Net Options Volume, Put & Call Walls | Yahoo option chains through tracking ETFs (SPY, QQQ, IWM, DIA, GLD, SLV, USO, UNG, UUP, FXE, FXB, FXY, FXA, FXC, FXF) | A1's 5-day average and 1.07 / 1.20 bands; history from `options_snapshots` (migration `lib/db/migrations/2026-09-13-options-snapshots.sql`) |
