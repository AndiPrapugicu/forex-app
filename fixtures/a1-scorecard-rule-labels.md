# A1's own rule labels, read off the Forex Scorecard (EURUSD, 2026-08-31)

The scorecard prints a definition under each reading. These are A1's words, not
ours, and several confirm rules we had inferred.

| Column | A1's label | Our implementation |
|---|---|---|
| Trend | `4H/Daily Chart Trend` | technical.ts |
| Seasonality | `Current month's 10yr seasonality` | **confirmed** — `SEASONALITY_LOOKBACKS` names 10 as the scorecard window |
| COT | `COT Net Positioning` + `COT Weekly Change` | **confirmed** — cot.ts computes both and sums them |
| Crowd | `Crowd Bias` ("Crowd is mixed") | crowd.ts, 40/60 band |
| GDP | `GDP vs. forecast` | |
| mPMI | `ISM mPMI vs. forecast` | ISM is the US series |
| sPMI | `ISM sPMI vs. forecast` | |
| Retail Sales | `Retail sales vs. forecast` | |
| Cnsmr Conf | `Consumer Conf. vs forec.` | but slot 8 is Wage Growth YoY for the US |
| CPI / PPI / PCE | `... YoY vs. forecast` | |
| Interest Rates | `Interest rates` | no basis stated |
| Jobs | `Employment change / Unemployment rate / Weekly unemp. claims / JOLTS / ADP vs. forecast` | |

Also published per symbol: three price Targets, `Recent realized volatility`
(avg daily move over 7 and 90 days), and rolled-up group readings — `Eco Growth
Comparison`, `Jobs Market Comparison`, `Inflation Data Comparison`,
`Sentiment Bias`, `Technical Signal`, `Institutional Activity (COT)`.

**Unresolved.** The bias chart draws reference lines at -12, -5, 0, 5, 12, but
the live board calls AUDNZD "Very Bullish" at +7 and NZDCAD "Very Bearish" at -7.
Those cannot both be absolute thresholds on the same scale. The likely
explanation is a percentage-of-scoreable-columns denominator - crosses score
fewer columns than USD pairs - which is the same denominator effect already
recorded in [[a1-cards-differ-from-board]]. NOT established; do not implement.
